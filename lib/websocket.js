// 极简 WebSocket 客户端：只支持项目要的能力（wss 连接、自定义请求头、二进制收发、ping/pong、分片）。
// 不用第三方依赖，也不依赖宿主 runtime；好处是握手失败时能拿到 HTTP 状态和错误正文，便于定位鉴权问题。
import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'

const OPCODE_CONTINUATION = 0x0
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa

function encodeFrame(opcode, payload) {
  const length = payload.length
  let headerLength = 2
  if (length > 65535) headerLength += 8
  else if (length > 125) headerLength += 2
  headerLength += 4 // 客户端帧必须带掩码
  const frame = Buffer.allocUnsafe(headerLength + length)
  frame[0] = 0x80 | opcode
  if (length > 65535) {
    frame[1] = 0x80 | 127
    frame.writeBigUInt64BE(BigInt(length), 2)
  } else if (length > 125) {
    frame[1] = 0x80 | 126
    frame.writeUInt16BE(length, 2)
  } else {
    frame[1] = 0x80 | length
  }
  const maskOffset = headerLength - 4
  const mask = randomBytes(4)
  mask.copy(frame, maskOffset)
  for (let index = 0; index < length; index += 1) frame[maskOffset + 4 + index] = payload[index] ^ mask[index & 3]
  return frame
}

/**
 * 建立 WebSocket 连接。
 * @param {{url: string, headers?: Record<string,string>, timeoutMs?: number, signal?: AbortSignal}} input
 * @returns {Promise<{send: (payload: Buffer) => void, messages: () => AsyncGenerator<Buffer>, close: () => void, headers: object, status: number}>}
 */
export function connectWebSocket({ url, headers = {}, timeoutMs = 20000, signal } = {}) {
  const target = new URL(url)
  const secure = target.protocol === 'wss:'
  const transport = secure ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...headers,
      },
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('WebSocket 连接超时')))
    signal?.addEventListener('abort', () => request.destroy(signal.reason ?? new Error('已取消')), { once: true })
    request.on('error', (error) => reject(error))
    request.on('upgrade', (response, socket, head) => {

      let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0)
      let closed = false
      let fragments = []
      const queue = []
      let waiter = null

      const push = (payload) => {
        if (waiter) {
          const notify = waiter
          waiter = null
          notify({ value: payload, done: false })
        } else {
          queue.push(payload)
        }
      }
      const finish = () => {
        closed = true
        if (waiter) {
          const notify = waiter
          waiter = null
          notify({ value: undefined, done: true })
        }
      }
      const sendRaw = (opcode, payload) => {
        if (closed || socket.destroyed) return
        socket.write(encodeFrame(opcode, payload))
      }

      const handleFrame = (fin, opcode, payload) => {
        if (opcode === OPCODE_PING) return sendRaw(OPCODE_PONG, payload)
        if (opcode === OPCODE_PONG) return
        if (opcode === OPCODE_CLOSE) {
          finish()
          socket.end()
          return
        }
        if (opcode === OPCODE_BINARY || opcode === OPCODE_TEXT) {
          fragments = fin ? [payload] : [payload]
          if (fin) {
            push(opcode === OPCODE_TEXT ? Buffer.from(payload.toString('utf8')) : payload)
          }
          return
        }
        if (opcode === OPCODE_CONTINUATION) {
          fragments.push(payload)
          if (fin) push(Buffer.concat(fragments))
        }
      }

      const parse = () => {
        for (;;) {
          if (buffer.length < 2) return
          const first = buffer[0]
          const second = buffer[1]
          const fin = (first & 0x80) !== 0
          const opcode = first & 0x0f
          const masked = (second & 0x80) !== 0
          let length = second & 0x7f
          let offset = 2
          if (length === 126) {
            if (buffer.length < 4) return
            length = buffer.readUInt16BE(2)
            offset = 4
          } else if (length === 127) {
            if (buffer.length < 10) return
            length = Number(buffer.readBigUInt64BE(2))
            offset = 10
          }
          let mask
          if (masked) {
            if (buffer.length < offset + 4) return
            mask = buffer.subarray(offset, offset + 4)
            offset += 4
          }
          if (buffer.length < offset + length) return
          let payload = buffer.subarray(offset, offset + length)
          if (masked) {
            const copy = Buffer.from(payload)
            for (let index = 0; index < copy.length; index += 1) copy[index] ^= mask[index & 3]
            payload = copy
          }
          buffer = buffer.subarray(offset + length)
          handleFrame(fin, opcode, payload)
        }
      }

      socket.on('data', (chunk) => {

        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
        parse()
      })
      socket.on('error', () => finish())
      socket.on('close', () => finish())

      resolve({
        status: response.statusCode,
        headers: response.headers,
        send: (payload) => sendRaw(OPCODE_BINARY, payload),
        close: () => {
          try { sendRaw(OPCODE_CLOSE, Buffer.alloc(0)) } catch {}
          socket.end()
          finish()
        },
        async *messages() {
          for (;;) {
            if (queue.length) {
              yield queue.shift()
              continue
            }
            if (closed) return
            const next = await new Promise((notify) => { waiter = notify })
            if (next.done) return
            yield next.value
          }
        },
      })
    })
    request.on('response', (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => {
        const error = new Error(`WebSocket 握手失败（HTTP ${response.statusCode}）：${body.replace(/\s+/g, ' ').slice(0, 400)}`)
        error.status = response.statusCode
        error.body = body
        error.logId = response.headers['x-tt-logid']
        reject(error)
      })
    })
    request.end()
  })
}
