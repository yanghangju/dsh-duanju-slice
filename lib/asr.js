// 台词定位不再依赖剪映字幕轨：从源视频抽出 16 kHz 单声道 WAV，整段推给
// 火山引擎（豆包语音）双向流式语音识别，直接用它返回的分句时间码当台词时间码。
//
// 协议：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
// 鉴权：X-Api-Key + X-Api-Resource-Id + X-Api-Request-Id（新版控制台 API Key）
// 帧格式：4 字节头 + (seq) + (payload_size) + gzip 载荷，见官方 protocol.py。
// 计费按音频时长，所以结果按「文件指纹 + 资源 + 端点」缓存在本地，重复选段不再花钱。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { connectWebSocket } from './websocket.js'

export const VOLC_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
/** 豆包流式语音识别 1.0 小时版（多数账号默认开通这一版）；2.0 用 volc.seedasr.sauc.duration，并发版把 duration 换成 concurrent。 */
export const VOLC_RESOURCE = 'volc.bigasr.sauc.duration'
export const SAMPLE_RATE = 16000
const CACHE_VERSION = 3 // Source-clock WAV and word-aligned timestamps.

const MESSAGE_TYPE = { FULL_CLIENT_REQUEST: 0b0001, AUDIO_ONLY: 0b0010, SERVER_FULL_RESPONSE: 0b1001, SERVER_ERROR: 0b1111 }
const FLAG = { POS_SEQUENCE: 0b0001, NEG_WITH_SEQUENCE: 0b0011 }

export function volcSettings(config = {}) {
  const apiKey = [config.volcApiKey, process.env.VOLCENGINE_API_KEY, process.env.VOLC_API_KEY].map((value) => String(value ?? '').trim()).find(Boolean) ?? ''
  return {
    apiKey,
    endpoint: String(config.volcEndpoint ?? VOLC_ENDPOINT).trim() || VOLC_ENDPOINT,
    resourceId: String(config.volcResourceId ?? VOLC_RESOURCE).trim() || VOLC_RESOURCE,
    // 每包音频时长（毫秒）与包间节奏：节奏越短推得越快（实时识别接口按流式设计）。
    chunkMs: Math.max(100, Math.min(800, Number(config.volcChunkMs) || 200)),
    paceMs: Math.max(0, Math.min(500, Number(config.volcPaceMs ?? 40))),
    maxSessionSeconds: Math.max(30, Math.min(1800, Number(config.volcSessionSeconds) || 300)),
  }
}

function run(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], signal })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`${command} 退出码 ${code}：${stderr.slice(-800)}`))))
  })
}

/** 抽成 16 kHz 单声道 16 位 WAV（识别接口要求的格式之一）。 */
export async function extractAudio(ffmpeg, file, outFile, { signal } = {}) {
  // Use the same first audio stream as the cutter. Preserve late audio starts on the video seek clock.
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:a:0', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', outFile], { signal })
  assert(existsSync(outFile), `抽音频失败：${file}`)
  return outFile
}

/** 16 位单声道 WAV 的时长：直接读 RIFF 头，避开封装时长取整。 */
export async function wavDuration(file) {
  const bytes = await readFile(file)
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`抽出来的不是 WAV：${file}`)
  let bytesPerSecond = 0
  let dataBytes = 0
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    if (tag === 'fmt ' && length >= 16) bytesPerSecond = bytes.readUInt32LE(offset + 16)
    if (tag === 'data') dataBytes += length
    offset += 8 + length + (length % 2)
  }
  if (!(bytesPerSecond > 0 && dataBytes > 0)) throw new Error(`WAV 缺少有效数据块：${file}`)
  return dataBytes / bytesPerSecond
}

function header(messageType, flags) {
  return Buffer.from([(0b0001 << 4) | 1, (messageType << 4) | flags, (0b0001 << 4) | 0b0001, 0x00])
}

/** 首包：JSON 配置（gzip）。 */
export function buildFullRequest(seq, payload) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(compressed.length, 0)
  const sequence = Buffer.allocUnsafe(4)
  sequence.writeInt32BE(seq, 0)
  return Buffer.concat([header(MESSAGE_TYPE.FULL_CLIENT_REQUEST, FLAG.POS_SEQUENCE), sequence, size, compressed])
}

/** 音频包；最后一包用负序号标记结束。 */
export function buildAudioRequest(seq, chunk, isLast = false) {
  const compressed = gzipSync(chunk)
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(compressed.length, 0)
  const sequence = Buffer.allocUnsafe(4)
  sequence.writeInt32BE(isLast ? -seq : seq, 0)
  const flags = isLast ? FLAG.NEG_WITH_SEQUENCE : FLAG.POS_SEQUENCE
  return Buffer.concat([header(MESSAGE_TYPE.AUDIO_ONLY, flags), sequence, size, compressed])
}

/** 解析服务端响应帧：头里 flags 决定后面依次有没有 seq / event / payload_size。 */
export function parseResponse(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 4) throw new Error('识别返回的帧太短')
  const headerBytes = (frame[0] & 0x0f) * 4
  const messageType = frame[1] >> 4
  const flags = frame[1] & 0x0f
  const serialization = frame[2] >> 4
  const compression = frame[2] & 0x0f
  let payload = frame.subarray(headerBytes)
  let code = 0
  let event = 0
  let isLast = false
  let sequence = 0
  if (flags & 0x01) {
    sequence = payload.readInt32BE(0)
    payload = payload.subarray(4)
  }
  if (flags & 0x02) isLast = true
  if (flags & 0x04) {
    event = payload.readInt32BE(0)
    payload = payload.subarray(4)
  }
  if (messageType === MESSAGE_TYPE.SERVER_FULL_RESPONSE) {
    payload = payload.subarray(4)
  } else if (messageType === MESSAGE_TYPE.SERVER_ERROR) {
    code = payload.readInt32BE(0)
    payload = payload.subarray(8)
  }
  let message
  if (payload.length) {
    let bytes = payload
    if (compression === 0b0001) {
      try {
        bytes = gunzipSync(payload)
      } catch {
        bytes = payload
      }
    }
    if (serialization === 0b0001) {
      try {
        message = JSON.parse(bytes.toString('utf8'))
      } catch {
        message = undefined
      }
    }
  }
  if (!code && message?.code) code = Number(message.code) || 0
  return { code, event, isLast, sequence, message }
}

/**
 * 从一次响应里收集分句：取最终确定（definite）的那些；同一分句后续包会更完整，按起始时间覆盖。
 * 同时保留逐词时间码（配乐满铺时一句话可能很长，切点靠词级时间码收紧）。
 */
export function collectUtterances(message, into) {
  const utterances = message?.result?.utterances
  if (!Array.isArray(utterances)) return
  for (const item of utterances) {
    if (!item?.text || typeof item.text !== 'string') continue
    if (item.definite === false) continue
    const start = Number(item.start_time) / 1000
    const end = Number(item.end_time) / 1000
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const words = []
    for (const word of Array.isArray(item.words) ? item.words : []) {
      const text = typeof word.text === 'string' ? word.text.trim() : ''
      const wordStart = Number(word.start_time) / 1000
      const wordEnd = Number(word.end_time) / 1000
      if (!text || !Number.isFinite(wordStart) || !Number.isFinite(wordEnd) || wordStart < 0 || wordEnd < wordStart) continue
      words.push({ start: wordStart, end: wordEnd, text })
    }
    into.set(start.toFixed(2), { start, end, text: item.text.trim(), words })
  }
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * 识别一段 WAV：一次连接推完整段，返回分句时间码。
 * @param {{wav: string, settings: object, signal?: AbortSignal, onProgress?: (done:number, total:number)=>void, offsetSeconds?: number}} input
 */
export async function transcribeWav({ wav, settings, signal, onProgress }) {
  const bytes = await readFile(wav)
  const duration = await wavDuration(wav)
  const chunkBytes = Math.max(3200, Math.round((SAMPLE_RATE * 2 * settings.chunkMs) / 1000))
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes)))
  if (!chunks.length) return { lines: [], duration, logId: undefined }

  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const socket = await connectWebSocket({
    url: settings.endpoint,
    headers: {
      'X-Api-Key': settings.apiKey,
      'X-Api-Resource-Id': settings.resourceId,
      'X-Api-Request-Id': requestId,
    },
    signal,
  })
  const logId = socket.headers?.['x-tt-logid']
  const utterances = new Map()
  let failure
  let finalized = false
  let sentLast = false
  let idleTimeout
  const waitForResult = () => {
    clearTimeout(idleTimeout)
    idleTimeout = setTimeout(() => {
      failure ??= new Error('语音识别超过 60 秒没有新结果，已中止')
      socket.close()
    }, 60_000)
  }

  socket.send(buildFullRequest(1, {
    user: { uid: 'dsh-duanju-slice' },
    audio: { format: 'wav', codec: 'raw', rate: SAMPLE_RATE, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
      // 二遍识别：分句结束后重新识别这一句，离线场景要的是最终准确结果。
      enable_nonstream: true,
      end_window_size: 800,
    },
  }))

  const sending = (async () => {
    for (let index = 0; index < chunks.length; index += 1) {
      signal?.throwIfAborted()
      if (failure) return
      const isLast = index === chunks.length - 1
      socket.send(buildAudioRequest(index + 2, chunks[index], isLast))
      sentLast = isLast
      onProgress?.(index + 1, chunks.length)
      if (!isLast) await sleep(settings.paceMs)
    }
  })()

  const receiving = (async () => {
    waitForResult()
    for await (const frame of socket.messages()) {
      waitForResult()
      let response
      try {
        response = parseResponse(frame)
      } catch (error) {
        failure ??= error
        break
      }
      if (response.code) {
        const detail = response.message?.message ?? response.message?.error ?? ''
        failure ??= Object.assign(new Error(`语音识别失败（code ${response.code}）：${detail || '服务端返回错误'}`), { code: response.code, logId })
        break
      }
      collectUtterances(response.message, utterances)
      if (response.isLast) { finalized = sentLast; break }
    }
    if (!finalized) failure ??= new Error('火山语音连接结束或音频未传完，未返回最终识别结果，不能用部分转写定位')
  })()

  try {
    await Promise.all([sending, receiving])
  } finally {
    clearTimeout(idleTimeout)
    socket.close()
  }
  signal?.throwIfAborted()
  if (failure) throw Object.assign(failure, { logId })
  const lines = [...utterances.values()].sort((a, b) => a.start - b.start)
  return { lines, duration, logId }
}

function cacheKey({ file, info, settings }) {
  return createHash('sha1').update(JSON.stringify({
    file, size: info.size, mtime: info.mtimeMs, version: CACHE_VERSION,
    endpoint: settings.endpoint, resourceId: settings.resourceId,
  })).digest('hex')
}

async function readCache(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    if (raw?.version === CACHE_VERSION && Array.isArray(raw.lines) && Number.isFinite(raw.duration)) return raw
    return undefined
  } catch {
    return undefined
  }
}

function explainHandshake(error) {
  if (error?.status === 401) return new Error('火山语音识别鉴权失败（401）：检查插件设置里的 volcApiKey 是否正确')
  if (error?.status === 403) {
    const body = String(error.body ?? '')
    if (/resource not granted/i.test(body)) {
      return Object.assign(new Error(`火山语音识别没有开通这个资源（${body.replace(/\s+/g, ' ').slice(0, 160)}）。请在豆包语音控制台开通「流式语音识别」，或把 volcResourceId 改成已开通的版本（2.0 小时版 volc.seedasr.sauc.duration / 1.0 volc.bigasr.sauc.duration）`), { logId: error.logId })
    }
    return Object.assign(new Error(`火山语音识别拒绝连接（403）：${body.replace(/\s+/g, ' ').slice(0, 200)}`), { logId: error.logId })
  }
  return error
}

/**
 * 识别一个视频文件的台词（带缓存）。
 * @returns {Promise<{duration:number, lines:Array<{start:number,end:number,text:string,words:Array<{start:number,end:number,text:string}>}>, cached:boolean, billedSeconds:number, transcriptFile:string}>}
 */
export async function transcribeFile({ ffmpeg, file, cacheDir, config, signal, onProgress, force = false }) {
  const settings = volcSettings(config)
  assert(settings.apiKey, '没有火山语音识别 Key：请在插件设置里填 volcApiKey（豆包语音控制台的 API Key），或设置环境变量 VOLCENGINE_API_KEY')
  const info = await stat(file)
  await mkdir(cacheDir, { recursive: true })
  const cachePath = join(cacheDir, 'asr', `${cacheKey({ file, info, settings })}.json`)
  const cached = force ? undefined : await readCache(cachePath)
  signal?.throwIfAborted()
  if (cached) {
    onProgress?.({ stage: 'asr-cached', file })
    return { duration: cached.duration, lines: cached.lines, cached: true, billedSeconds: 0, transcriptFile: cachePath }
  }

  const workDir = await mkdtemp(join(cacheDir, 'asr-work-'))
  try {
    const audio = join(workDir, 'audio.wav')
    await extractAudio(ffmpeg, file, audio, { signal })
    const duration = await wavDuration(audio)
    // 一段连接最多推 maxSessionSeconds：超长素材切成几段，时间码平移到整段上。
    const lines = []
    let billed = 0
    const segmentSeconds = settings.maxSessionSeconds
    const count = Math.max(1, Math.ceil(duration / segmentSeconds))
    for (let index = 0; index < count; index += 1) {
      signal?.throwIfAborted()
      const start = index * segmentSeconds
      const length = Math.min(segmentSeconds, duration - start)
      if (length <= 0.2) break
      let part = audio
      if (count > 1) {
        part = join(workDir, `part${index}.wav`)
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', audio, '-c:a', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', '1', part], { signal })
      }
      let result
      try {
        result = await transcribeWav({
          wav: part,
          settings,
          signal,
          onProgress: (done, total) => onProgress?.({ stage: 'asr', file, done: done + index * total, total: total * count }),
        })
      } catch (error) {
        throw explainHandshake(error)
      }
      billed += result.duration
      const offset = (line) => ({ ...line, start: line.start + start, end: line.end + start })
      for (const line of result.lines) lines.push({ ...offset(line), words: line.words.map(offset) })
      if (part !== audio) await rm(part, { force: true })
    }
    lines.sort((a, b) => a.start - b.start)
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify({
      version: CACHE_VERSION, file, size: info.size, mtimeMs: info.mtimeMs, duration,
      endpoint: settings.endpoint, resourceId: settings.resourceId,
      createdAt: new Date().toISOString(), lines,
    }), 'utf8')
    return { duration, lines, cached: false, billedSeconds: Number(billed.toFixed(3)), transcriptFile: cachePath }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * 识别一整集：多文件的一集按段识别，时间码平移到这一集的时间线上。
 * @param {object} episode drama-source 里的集对象
 */
export async function transcribeEpisode(episode, { ffmpeg, cacheDir, config, signal, onProgress }) {
  const lines = []
  let billedSeconds = 0
  let cached = true
  for (const part of episode.parts) {
    signal?.throwIfAborted()
    const segment = episode.videoSegments.find((item) => item.path === part.path)
    const offset = Number.isFinite(segment?.targetStart) ? segment.targetStart : 0
    const result = await transcribeFile({
      ffmpeg, file: part.path, cacheDir, config, signal,
      onProgress: (event) => onProgress?.({ ...event, part: part.name }),
    })
    if (!result.cached) cached = false
    billedSeconds += result.billedSeconds ?? 0
    for (const line of result.lines) lines.push({ start: line.start + offset, end: line.end + offset, text: line.text })
  }
  lines.sort((a, b) => a.start - b.start)
  return { lines, billedSeconds: Number(billedSeconds.toFixed(3)), cached }
}
