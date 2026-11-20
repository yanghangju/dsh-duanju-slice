// Build a literal description catalog once; choose from JSON, then resolve only selected audio directories.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstat, open, opendir, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_DESCRIPTION_BYTES = 16 * 1024
const MAX_DESCRIPTIONS_BYTES = 128 * 1024
const MAX_AUDIO = 200
const MAX_ENTRIES = 10_000
const MAX_DEPTH = 32
const AUDIO = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.opus'])
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const hash = (value) => createHash('sha256').update(value).digest('hex')

export function safeName(name) {
  assert(typeof name === 'string' && name && name !== '.' && name !== '..'
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/[. ]$/.test(name)
    && !/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name),
  `BGM 文件名不能包含非法路径、Windows 保留名或路径别名：${name}`)
}

// Check every ancestor: lstat catches links/junctions; realpath also catches aliases.
async function canonicalInfo(file, directory, signal) {
  const absolute = resolve(file)
  const root = parse(absolute).root
  const parts = absolute.slice(root.length).split(sep).filter(Boolean)
  let cursor = root
  let info
  for (let index = -1; index < parts.length; index++) {
    signal?.throwIfAborted()
    if (index >= 0) { safeName(parts[index]); cursor = join(cursor, parts[index]) }
    // NTFS inode values exceed Number's integer precision; identity comparisons must stay exact.
    info = await lstat(cursor, { bigint: true })
    assert(!info.isSymbolicLink(), `BGM 路径不能包含符号链接或 junction：${cursor}`)
    const wantDirectory = index < parts.length - 1 || directory
    assert(wantDirectory ? info.isDirectory() : info.isFile(), `BGM 路径必须是${wantDirectory ? '真实目录' : '普通文件'}：${cursor}`)
  }
  assert(samePath(await realpath(absolute), absolute), `BGM 路径不能是别名：${absolute}`)
  signal?.throwIfAborted()
  return info
}
function unchanged(before, after, file) {
  // Node on Windows can report dev=0 for lstat but the volume ID for fstat.
  const sameDevice = before.dev === after.dev || (process.platform === 'win32' && (!before.dev || !after.dev))
  const sameKind = before.isDirectory() ? after.isDirectory() : after.isFile()
  assert(sameKind && sameDevice && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.mtimeNs === after.mtimeNs && before.nlink === after.nlink, `BGM 文件在读取期间变化：${file}`)
}

async function readBytes(file, info, signal) {
  let handle
  try {
    handle = await open(file, 'r')
    signal?.throwIfAborted()
    unchanged(info, await handle.stat({ bigint: true }), file)
    // Read at most the observed size + 1, even if another process keeps growing it.
    const buffer = Buffer.alloc(Number(info.size) + 1)
    let length = 0
    while (length < buffer.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    unchanged(info, await handle.stat({ bigint: true }), file)
    assert(length === Number(info.size), `BGM 文件在读取期间变化：${file}`)
    signal?.throwIfAborted()
    return buffer.subarray(0, length)
  } finally { await handle?.close() }
}

async function audioHash(file, signal) {
  const info = await canonicalInfo(file, false, signal)
  const size = Number(info.size)
  assert(Number.isSafeInteger(size) && size >= 0 && size < Number.MAX_SAFE_INTEGER, `BGM 音频大小无效：${file}`)
  const handle = await open(file, 'r')
  try {
    signal?.throwIfAborted()
    unchanged(info, await handle.stat({ bigint: true }), file)
    const digest = createHash('sha256')
    let length = 0
    for await (const chunk of handle.createReadStream({ autoClose: false, signal, start: 0, end: size })) {
      signal?.throwIfAborted()
      digest.update(chunk)
      length += chunk.length
    }
    signal?.throwIfAborted()
    unchanged(info, await handle.stat({ bigint: true }), file)
    unchanged(info, await canonicalInfo(file, false, signal), file)
    assert(length === Number(info.size), `BGM 文件在读取期间变化：${file}`)
    return digest.digest('hex')
  } finally { await handle.close() }
}

/** Discover same-directory description.txt + exactly one audio, without opening any asset index. */
export async function scanLibrary(musicDir, signal) {
  try {
    signal?.throwIfAborted()
    assert(typeof musicDir === 'string' && musicDir.trim() && musicDir.length <= 4096, 'BGM 音乐目录必须是有界非空路径')
    const libraryDir = resolve(musicDir)
    const tracks = []
    const skipped = []
    let entriesSeen = 0
    let totalTrackCount = 0
    let descriptionCount = 0
    let descriptionBytes = 0
    const portable = (file) => {
      const path = relative(libraryDir, file)
      assert(path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`), 'BGM 路径越出曲库目录')
      return path.split(sep).join('/')
    }
    const identity = (file) => ({ trackId: `track-${hash(portable(file))}`, title: samePath(dirname(file), libraryDir) ? basename(file, extname(file)) : basename(dirname(file)), file })

    async function visit(directory, depth) {
      signal?.throwIfAborted()
      assert(depth <= MAX_DEPTH, 'BGM 曲库目录深度不能超过 32 层')
      const before = await canonicalInfo(directory, true, signal)
      const entries = []
      const reader = await opendir(directory)
      for await (const entry of reader) {
        signal?.throwIfAborted()
        assert(++entriesSeen <= MAX_ENTRIES, 'BGM 曲库目录项不能超过 10000 项')
        safeName(entry.name)
        entries.push(entry)
      }
      entries.sort((a, b) => compare(a.name, b.name))
      const audios = []
      const descriptions = []
      const directories = []
      for (const entry of entries) {
        signal?.throwIfAborted()
        const file = join(directory, entry.name)
        portable(file)
        if (entry.name.toLowerCase() === 'description.txt') {
          const info = await canonicalInfo(file, false, signal)
          assert(info.nlink === 1n, `BGM description.txt 不能是硬链接：${file}`)
          assert(info.size <= MAX_DESCRIPTION_BYTES, 'BGM description.txt 不能超过 16 KiB')
          assert(descriptionBytes + Number(info.size) <= MAX_DESCRIPTIONS_BYTES, 'BGM description.txt 总计不能超过 128 KiB')
          const bytes = await readBytes(file, info, signal)
          const after = await canonicalInfo(file, false, signal)
          unchanged(info, after, file)
          assert(after.nlink === 1n, `BGM description.txt 不能是硬链接：${file}`)
          descriptionBytes += bytes.length
          descriptionCount++
          let description
          try { description = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch (error) {
            throw new Error(`BGM description.txt 必须是有效 UTF-8 文本：${file}`, { cause: error })
          }
          descriptions.push({ descriptionFile: file, description })
        } else if (AUDIO.has(extname(entry.name).toLowerCase())) {
          await canonicalInfo(file, false, signal)
          assert(++totalTrackCount <= MAX_AUDIO, 'BGM 音频不能超过 200 首')
          audios.push(file)
        } else if (entry.isDirectory() || entry.isSymbolicLink()) {
          // Never traverse an unchecked directory or directory link, including empty ones.
          await canonicalInfo(file, true, signal)
          directories.push(file)
        }
      }
      const reason = !descriptions.length ? '缺少同目录 description.txt'
        : descriptions.length !== 1 ? '同目录存在多个 description.txt（大小写不敏感），无法唯一配对'
          : audios.length !== 1 ? `同目录有 ${audios.length} 个支持音频，description.txt 无法唯一配对`
            : !descriptions[0].description.trim() ? 'description.txt 为空白' : null
      if (reason) {
        for (const file of audios) skipped.push({ ...identity(file), reason })
        if (!audios.length) for (const { descriptionFile } of descriptions) skipped.push({ descriptionFile, reason })
      } else {
        const file = audios[0]
        tracks.push({ ...identity(file), ...descriptions[0], sha256: await audioHash(file, signal),
          license: 'Unknown', rights: null, attribution_required: null, attribution_text: null })
      }
      for (const child of directories) await visit(child, depth + 1)
      unchanged(before, await canonicalInfo(directory, true, signal), directory)
    }

    await visit(libraryDir, 0)
    tracks.sort((a, b) => compare(portable(a.file), portable(b.file)))
    skipped.sort((a, b) => compare(portable(a.file ?? a.descriptionFile), portable(b.file ?? b.descriptionFile)))
    assert(tracks.length > 0, 'BGM 曲库没有包含有效 description.txt + 同目录唯一音频的候选曲目，不会回退汇总或标签文件')
    const descriptionHash = hash(JSON.stringify(tracks.map(({ trackId, description }) => [trackId, description])))
    const assetHash = hash(JSON.stringify(tracks.map(({ trackId, file, sha256 }) => [trackId, portable(file), sha256])))
    signal?.throwIfAborted()
    return { libraryDir, tracks, skipped, descriptionHash, assetHash, totalTrackCount, descriptionCount }
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
}

const INDEX_NAME = 'music_library.json'
const MAX_INDEX_BYTES = 1024 * 1024

function catalogDirectory(libraryDir, directory) {
  assert(typeof directory === 'string' && directory.length > 0 && directory.length <= 4096, 'BGM 汇总 directory 必须是有界非空相对目录')
  if (directory === '.') return libraryDir
  assert(!isAbsolute(directory) && !directory.includes('\\'), 'BGM 汇总目录不能使用绝对路径或反斜杠')
  const parts = directory.split('/')
  assert(parts.length <= MAX_DEPTH, 'BGM 汇总目录深度不能超过 32 层')
  for (const part of parts) safeName(part)
  return resolve(libraryDir, ...parts)
}

/** Explicit refresh also backs up a pre-existing catalog; audio and description files are never changed. */
export async function buildLibraryIndex(musicDir, signal) {
  const scanned = await scanLibrary(musicDir, signal)
  const indexFile = join(scanned.libraryDir, INDEX_NAME)
  const tiers = new Map()
  const directoryKey = (directory) => process.platform === 'win32' ? directory.toLowerCase() : directory
  let previous
  try { previous = await canonicalInfo(indexFile, false, signal) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    assert(previous.nlink === 1n && previous.size <= MAX_INDEX_BYTES, 'BGM 旧汇总不能是硬链接或超过 1 MiB')
    const bytes = await readBytes(indexFile, previous, signal)
    unchanged(previous, await canonicalInfo(indexFile, false, signal), indexFile)
    // Explicit refresh can repair corrupt catalogs while preserving valid tier assignments.
    let saved
    try { saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {}
    if (Array.isArray(saved)) for (const entry of saved) {
      if (typeof entry?.directory === 'string' && ['primary', 'secondary'].includes(entry.library)) tiers.set(directoryKey(entry.directory), entry.library)
    }
    // One untouched backup is enough: this catalog is derived and can be regenerated from descriptions.
    try { await writeFile(`${indexFile}.bak`, bytes, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const entries = scanned.tracks.map(({ file, description }) => {
    const directory = relative(scanned.libraryDir, dirname(file)).split(sep).join('/') || '.'
    const library = tiers.get(directoryKey(directory))
    return { directory, description, ...(library ? { library } : {}) }
  })
  const bytes = Buffer.from(`${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  assert(bytes.length <= MAX_INDEX_BYTES, 'BGM 汇总不能超过 1 MiB')
  const pending = join(scanned.libraryDir, `.${INDEX_NAME}-${randomUUID()}.tmp`)
  await writeFile(pending, bytes, { flag: 'wx' })
  signal?.throwIfAborted()
  if (previous) unchanged(previous, await canonicalInfo(indexFile, false, signal), indexFile)
  // ponytail: atomic publication, not a cross-process edit lock; do not refresh one library from multiple Hosts.
  await rename(pending, indexFile)
  return { ...scanned, entries, indexFile, indexHash: hash(bytes) }
}

/** Existing catalogs are authoritative: no per-track description reads, enumeration or audio hashing here. */
export async function loadLibraryIndex(musicDir, signal, { createIfMissing = true } = {}) {
  signal?.throwIfAborted()
  assert(typeof musicDir === 'string' && musicDir.trim() && musicDir.length <= 4096, 'BGM 音乐目录必须是有界非空路径')
  const libraryDir = resolve(musicDir)
  await canonicalInfo(libraryDir, true, signal)
  const indexFile = join(libraryDir, INDEX_NAME)
  let info
  try { info = await canonicalInfo(indexFile, false, signal) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    assert(createIfMissing, '高级模式缺少必读的 music_library.json，请补齐汇总，不会自动新建')
    await buildLibraryIndex(libraryDir, signal)
    info = await canonicalInfo(indexFile, false, signal)
  }
  assert(info.nlink === 1n && info.size <= MAX_INDEX_BYTES, 'BGM 汇总不能是硬链接或超过 1 MiB')
  const bytes = await readBytes(indexFile, info, signal)
  unchanged(info, await canonicalInfo(indexFile, false, signal), indexFile)
  let entries
  try { entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch (error) {
    throw new Error('BGM music_library.json 汇总必须是有效 UTF-8 JSON，请从原 description 文件重新生成', { cause: error })
  }
  assert(Array.isArray(entries) && entries.length > 0 && entries.length <= MAX_AUDIO, 'BGM 汇总必须是 1–200 个 {directory, description} 对象的数组，请重新生成')
  const directories = new Set()
  let descriptionBytes = 0
  const tracks = entries.map((entry) => {
    signal?.throwIfAborted()
    assert(entry && typeof entry === 'object' && !Array.isArray(entry)
      && Object.hasOwn(entry, 'directory') && Object.hasOwn(entry, 'description')
      && Object.keys(entry).every((key) => ['directory', 'description', 'library'].includes(key)), 'BGM 汇总每项只能包含 directory、description 和可选 library，请重新生成')
    assert(!Object.hasOwn(entry, 'library') || ['primary', 'secondary'].includes(entry.library), 'BGM 汇总 library 只能是 primary（主曲库）或 secondary（副曲库）')
    const directory = catalogDirectory(libraryDir, entry.directory)
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory
    assert(!directories.has(key), 'BGM 汇总包含重复目录')
    directories.add(key)
    assert(typeof entry.description === 'string' && entry.description.trim(), 'BGM 汇总 description 必须是非空原文')
    const length = Buffer.byteLength(entry.description, 'utf8')
    assert(length <= MAX_DESCRIPTION_BYTES, 'BGM 汇总每份 description 不能超过 16 KiB')
    descriptionBytes += length
    assert(descriptionBytes <= MAX_DESCRIPTIONS_BYTES, 'BGM 汇总 description 总计不能超过 128 KiB')
    return { trackId: `track-${hash(entry.directory)}`, title: basename(directory), directory, description: entry.description, library: entry.library ?? 'secondary',
      license: 'Unknown', rights: null, attribution_required: null, attribution_text: null }
  })
  return { libraryDir, indexFile, indexHash: hash(bytes), tracks, skipped: [],
    descriptionHash: hash(JSON.stringify(tracks.map(({ trackId, description }) => [trackId, description]))),
    totalTrackCount: tracks.length, descriptionCount: tracks.length }
}

/** Resolve only the IDs selected from the catalog; never accept model-supplied filesystem paths. */
export async function resolveLibraryTracks(library, selectedTracks, signal) {
  signal?.throwIfAborted()
  await canonicalInfo(library.libraryDir, true, signal)
  const tracks = []
  let entriesSeen = 0
  for (const selected of selectedTracks) {
    const track = library.tracks.find((item) => item.trackId === selected.trackId)
    assert(track && !tracks.some((item) => item.trackId === track.trackId), 'BGM 选中曲目必须是汇总中的唯一 ID')
    const before = await canonicalInfo(track.directory, true, signal)
    const audios = []
    for await (const entry of await opendir(track.directory)) {
      signal?.throwIfAborted()
      assert(++entriesSeen <= MAX_ENTRIES, 'BGM 选中目录项不能超过 10000 项')
      safeName(entry.name)
      if (AUDIO.has(extname(entry.name).toLowerCase())) audios.push(join(track.directory, entry.name))
    }
    assert(audios.length === 1, `BGM 选中目录必须包含唯一支持音频，实际 ${audios.length} 个：${track.directory}`)
    const file = audios[0]
    tracks.push({ ...track, file, sha256: await audioHash(file, signal) })
    unchanged(before, await canonicalInfo(track.directory, true, signal), track.directory)
  }
  signal?.throwIfAborted()
  const assetHash = hash(JSON.stringify(tracks.map(({ trackId, file, sha256 }) => [trackId, relative(library.libraryDir, file).split(sep).join('/'), sha256])))
  return { tracks, assetHash }
}

// Installed packages may be directory junctions: compare the actual entry file, not its link path.
if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))
  && samePath(realpathSync(process.argv[1]), fileURLToPath(import.meta.url))) {
  buildLibraryIndex(process.argv[2]).then(({ indexFile, entries, skipped }) => {
    console.log(`已汇总 ${entries.length} 首音乐，跳过 ${skipped.length} 项：${indexFile}；原 description 和音频均保留。`)
    for (const item of skipped) console.log(`跳过：${item.file ?? item.descriptionFile}（${item.reason}）`)
  }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
