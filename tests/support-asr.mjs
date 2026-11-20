import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

// Minimal local Volc streaming endpoint; return only after a final audio packet.
export async function mockAsr(utterances, { finish = true } = {}) {
  const server = createServer((req, res) => res.writeHead(400).end())
  const sockets = new Set()
  const state = { connections: 0, packets: 0 }
  const payload = gzipSync(JSON.stringify({ result: { utterances } }))
  const message = Buffer.alloc(8 + payload.length)
  message.set([0x11, finish ? 0x92 : 0x90, 0x11, 0])
  message.writeUInt32BE(payload.length, 4)
  payload.copy(message, 8)
  const header = message.length < 126 ? Buffer.from([0x82, message.length])
    : Buffer.from([0x82, 126, message.length >> 8, message.length & 255])
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    state.connections++
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    let buffer = Buffer.alloc(0)
    const consume = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 6) {
        const bits = buffer[1] & 127
        const offset = bits === 126 ? 4 : bits === 127 ? 10 : 2
        if (buffer.length < offset + 4) return
        const length = bits === 126 ? buffer.readUInt16BE(2) : bits === 127 ? Number(buffer.readBigUInt64BE(2)) : bits
        const end = offset + 4 + length
        if (buffer.length < end) return
        const opcode = buffer[0] & 15
        if (opcode === 8) { socket.end(); return }
        const type = length >= 2 ? buffer[offset + 5] ^ buffer[offset + 1] : 0
        buffer = buffer.subarray(end)
        if ((type >> 4) !== 2) continue
        state.packets++
        if ((type & 3) === 3) {
          socket.write(Buffer.concat([header, message]))
          if (!finish) socket.end()
        }
      }
    }
    socket.on('data', consume)
    consume(head)
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  return { state, url: `ws://127.0.0.1:${server.address().port}/asr`, close: async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  } }
}
