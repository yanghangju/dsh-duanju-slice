// Minimal ZIP reader/writer: a .docx is a zip of XML parts, and the host has
// no zip library. Only the two things we need: inflate a stored/deflated
// entry, and emit a deflated archive.
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** @returns {Map<string, Buffer>} entry name → uncompressed bytes */
export function readZip(buf, { maxBytes = Infinity, maxEntries = Infinity } = {}) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive')
  const count = buf.readUInt16LE(eocd + 10)
  const central = buf.readUInt32LE(eocd + 16)
  if (count > maxEntries) throw new Error('Too many ZIP entries')
  let off = central, total = 0
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (off + 46 > eocd || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Broken ZIP central directory')
    const method = buf.readUInt16LE(off + 10)
    const crc = buf.readUInt32LE(off + 16)
    const compSize = buf.readUInt32LE(off + 20)
    const size = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const end = off + 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    total += size
    if (total > maxBytes || end > eocd || localOff + 30 > central || buf.readUInt32LE(localOff) !== 0x04034b50 ||
        (buf.readUInt16LE(off + 8) & 1) || ![0, 8].includes(method)) throw new Error('Invalid or oversized ZIP entry')
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28)
    if (entries.has(name) || dataStart + compSize > central || (method === 0 && size !== compSize)) throw new Error('Invalid ZIP entry')
    const raw = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, size) })
    if (data.length !== size || crc32(data) !== crc) throw new Error('ZIP entry checksum mismatch')
    entries.set(name, data)
    off = end
  }
  return entries
}

/** @param {Array<{name: string, data: Buffer|string}>} files */
export function writeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const comp = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += 30 + name.length + comp.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, eocd])
}
