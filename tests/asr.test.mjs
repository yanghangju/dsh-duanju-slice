// 火山流式语音识别：协议编解码 + 用本地假服务跑通整条链路（含缓存）。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  buildAudioRequest,
  buildFullRequest,
  collectUtterances,
  extractAudio,
  parseResponse,
  transcribeFile,
  transcribeWav,
  volcSettings,
} from '../lib/asr.js'
import { cleanup, ffmpeg, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function readClientFrames(socket, onFrame) {
  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    for (;;) {
      if (buffer.length < 2) return
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined
      if (masked) offset += 4
      if (buffer.length < offset + length) return
      const payload = Buffer.from(buffer.subarray(offset, offset + length))
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]
      buffer = buffer.subarray(offset + length)
      if (opcode === 0x8) return socket.end()
      if (opcode === 0x1 || opcode === 0x2) onFrame(payload)
    }
  })
}

/** 把一段二进制包成 WebSocket 二进制帧（服务端发出的帧不加掩码）。 */
function wsFrame(payload) {
  const length = payload.length
  if (length <= 125) return Buffer.concat([Buffer.from([0x82, length]), payload])
  if (length <= 65535) {
    const head = Buffer.allocUnsafe(4)
    head[0] = 0x82
    head[1] = 126
    head.writeUInt16BE(length, 2)
    return Buffer.concat([head, payload])
  }
  const head = Buffer.allocUnsafe(10)
  head[0] = 0x82
  head[1] = 127
  head.writeBigUInt64BE(BigInt(length), 2)
  return Buffer.concat([head, payload])
}

/** 服务端响应：ASR 帧（头 0x11 0x9?_ 0x11 0x00 + 4 字节长度 + gzip JSON）。 */
function asrFrame({ code = 0, utterances = [], isLast = false, text = '' }) {
  const message = { code, audio_info: { duration: 1000 }, result: { text, utterances } }
  const payload = gzipSync(Buffer.from(JSON.stringify(message), 'utf8'))
  const header = Buffer.from([0x11, isLast ? 0x92 : 0x90, 0x11, 0x00])
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, size, payload])
}

/** 真实服务把 ASR 帧套在 WebSocket 二进制帧里发出去。 */
function serverFrame(options) {
  return wsFrame(asrFrame(options))
}

/** 客户端帧：4 字节头 + seq + 4 字节长度 + gzip 载荷。 */
function decodeClient(payload) {
  const messageType = payload[1] >> 4
  const flags = payload[1] & 0x0f
  const sequence = payload.readInt32BE(4)
  const size = payload.readUInt32BE(8)
  const body = gunzipSync(payload.subarray(12, 12 + size))
  return { messageType, flags, sequence, body }
}

/** 假识别服务：记录收到的配置与音频包，按预定结果回帧。 */
async function mockServer({ utterances = [], failStatus = 0, failBody = '' } = {}) {
  const state = { connections: 0, configs: [], packets: 0, lastFlags: 0 }
  const server = http.createServer((request, response) => {
    response.writeHead(failStatus || 500, { 'content-type': 'application/json' })
    response.end(failBody || '{"error":"unexpected"}')
  })
  server.on('upgrade', (request, socket) => {
    if (failStatus) {
      const body = failBody || '{"error":"unexpected"}'
      socket.write(`HTTP/1.1 ${failStatus} Forbidden\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`)
      socket.end()
      return
    }
    state.connections += 1
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}${ACCEPT_GUID}`).digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      'X-Tt-Logid: mock-log-id',
      '', '',
    ].join('\r\n'))
    readClientFrames(socket, (frame) => {
      const { messageType, flags, sequence, body } = decodeClient(frame)
      if (messageType === 0b0001) {
        state.configs.push(JSON.parse(body.toString('utf8')))
        socket.write(serverFrame({}))
        return
      }
      state.packets += 1
      state.lastFlags = flags
      if (sequence < 0) {
        socket.write(serverFrame({ utterances, isLast: true, text: utterances.map((item) => item.text).join(' ') }))
        return
      }
      socket.write(serverFrame({}))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `ws://127.0.0.1:${port}/api/v3/sauc/bigmodel_async`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('协议帧：首包与音频包可解，服务端帧可解析并取出分句', () => {
  const full = buildFullRequest(1, { audio: { rate: 16000 }, request: { show_utterances: true } })
  const decoded = decodeClient(full)
  assert.equal(decoded.messageType, 0b0001)
  assert.equal(decoded.sequence, 1)
  assert.equal(JSON.parse(decoded.body.toString('utf8')).audio.rate, 16000)

  const audio = buildAudioRequest(2, Buffer.from([1, 2, 3, 4]), false)
  assert.equal(decodeClient(audio).messageType, 0b0010)
  const tail = decodeClient(buildAudioRequest(3, Buffer.from([5, 6]), true))
  assert.equal(tail.sequence, -3, '最后一包用负序号标记结束')
  assert.equal(tail.flags & 0x02, 0x02)

  const response = parseResponse(asrFrame({
    utterances: [
      { definite: true, start_time: 280, end_time: 2000, text: '您好。' },
      { definite: false, start_time: 2000, end_time: 2600, text: '未定。' },
    ],
    isLast: true,
    text: '您好。未定。',
  }))
  assert.equal(response.isLast, true)
  assert.equal(response.code, 0)
  const collected = new Map()
  collectUtterances(response.message, collected)
  assert.deepEqual([...collected.values()], [{ start: 0.28, end: 2, text: '您好。', words: [] }], '未确定的分句不能算')
})

test('一次识别：配置包、音频分包、结束包和分句时间码都对', { skip: !hasFfmpeg }, async () => {
  const dir = await tempDir('slice-asr-')
  const mock = await mockServer({
    utterances: [
      { definite: true, start_time: 300, end_time: 1200, text: 'I never lied to you.' },
      { definite: true, start_time: 1300, end_time: 2400, text: 'You did.' },
    ],
  })
  try {
    const video = await makeVideo(dir, 'a.mp4', { seconds: 1, audio: true })
    const settings = volcSettings({ volcApiKey: 'test-key', volcEndpoint: mock.url, volcPaceMs: 0, volcChunkMs: 200 })
    const wav = join(dir, 'a.wav')
    await extractAudio(ffmpeg, video, wav)

    const result = await transcribeWav({ wav, settings })
    assert.equal(mock.state.connections, 1)
    assert.equal(mock.state.configs[0].audio.rate, 16000)
    assert.equal(mock.state.configs[0].request.show_utterances, true)
    assert.equal(mock.state.configs[0].request.model_name, 'bigmodel')
    assert.ok(mock.state.packets > 1, `应分包推送，实际 ${mock.state.packets} 包`)
    assert.equal(mock.state.lastFlags & 0x02, 0x02, '最后一包要带结束标记')
    assert.deepEqual(result.lines, [
      { start: 0.3, end: 1.2, text: 'I never lied to you.', words: [] },
      { start: 1.3, end: 2.4, text: 'You did.', words: [] },
    ])
    assert.ok(result.duration > 0.9 && result.duration < 1.2, `WAV 时长 ${result.duration}`)
  } finally {
    await mock.close()
    await cleanup(dir)
  }
})

test('识别结果落缓存：同一素材第二次不再连服务、不再计费', { skip: !hasFfmpeg }, async () => {
  const dir = await tempDir('slice-asr-cache-')
  const mock = await mockServer({ utterances: [{ definite: true, start_time: 0, end_time: 900, text: 'Cached line.' }] })
  try {
    const video = await makeVideo(dir, 'b.mp4', { seconds: 1, audio: true })
    const cacheDir = join(dir, 'cache')
    await mkdir(cacheDir, { recursive: true })
    const config = { volcApiKey: 'test-key', volcEndpoint: mock.url, volcPaceMs: 0, volcChunkMs: 200 }

    const first = await transcribeFile({ ffmpeg, file: video, cacheDir, config })
    assert.equal(first.cached, false)
    assert.equal(first.lines.length, 1)
    assert.ok(first.billedSeconds > 0.9 && first.billedSeconds < 1.2)
    assert.equal(mock.state.connections, 1)

    const second = await transcribeFile({ ffmpeg, file: video, cacheDir, config })
    assert.equal(second.cached, true)
    assert.equal(second.billedSeconds, 0)
    assert.deepEqual(second.lines, first.lines)
    assert.equal(mock.state.connections, 1, '命中缓存后不能再连服务')

    const files = await readdir(join(cacheDir, 'asr'))
    assert.equal(files.length, 1)
    const raw = JSON.parse(await readFile(join(cacheDir, 'asr', files[0]), 'utf8'))
    assert.equal(raw.resourceId, volcSettings({ volcApiKey: 'x' }).resourceId)
    assert.equal(raw.lines.length, 1)
  } finally {
    await mock.close()
    await cleanup(dir)
  }
})

test('资源没开通时给出可操作的报错', { skip: !hasFfmpeg }, async () => {
  const dir = await tempDir('slice-asr-403-')
  const mock = await mockServer({ failStatus: 403, failBody: '{"error":"[resource_id=volc.seedasr.sauc.duration] requested resource not granted"}' })
  try {
    const video = await makeVideo(dir, 'c.mp4', { seconds: 1, audio: true })
    const config = { volcApiKey: 'test-key', volcEndpoint: mock.url, volcPaceMs: 0 }
    await assert.rejects(
      transcribeFile({ ffmpeg, file: video, cacheDir: join(dir, 'cache'), config }),
      /没有开通这个资源/,
    )
  } finally {
    await mock.close()
    await cleanup(dir)
  }
})

test('缺 Key 时直接报错，不发起连接', async () => {
  await assert.rejects(
    transcribeFile({ ffmpeg, file: join(tmpdir(), 'nope.mp4'), cacheDir: tmpdir(), config: {} }),
    /没有火山语音识别 Key/,
  )
})
