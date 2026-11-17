// 短剧素材目录：一部剧一个文件夹（如 D:\海外短剧\艾米莉的混乱房车），
// 每集可能是一个视频文件，也可能是一个文件夹（文件夹里再放视频，按文件名顺序拼成这一集）。
// 这里只做只读扫描与 ffprobe 探测，产出的结构供定位、抽帧、建草稿和渲染共用。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const VIDEO_EXT_RE = /\.(?:mp4|mov|m4v|mkv|webm)$/i
// 本插件自己产出的切片（…_v1_20261116054226_678c90fe.mp4）不是素材。
const PRODUCED_RE = /_v\d+_\d{14}_[0-9a-f]{6,8}/i

const EPISODE_PATTERNS = [
  /(?:^|[^a-z])ep(?:isode)?[\s_.\-]*0*(\d{1,3})(?!\d)/i,
  /第\s*0*(\d{1,3})\s*[集话]/,
  /(?:^|[^\d])0*(\d{1,3})\s*[-_－—·]?\s*(?:副本|拷贝|copy|切片)/i,
]
const LEADING_NUMBER_RE = /^\s*0*(\d{1,3})(?!\d)/
const PURE_NUMBER_RE = /^\s*0*(\d{1,3})\s*(?:[（(][^)）]*[)）])?\s*$/
// 「10月13日 (1) (1)」这类日期名里的数字不是集号。
const DATE_NAME_RE = /^\s*\d{1,4}\s*月\s*\d{1,2}\s*日/

/**
 * 从文件名/文件夹名里认集号：`ep025（英文字幕版）.mp4`、`第7集`、`07`、`2-副本` 都算。
 * 认不出返回 undefined，不猜。
 */
export function episodeOfName(name) {
  const text = String(name ?? '')
  if (!text || DATE_NAME_RE.test(text)) return undefined
  for (const pattern of EPISODE_PATTERNS) {
    const match = pattern.exec(text)
    if (match) return Number(match[1])
  }
  const stem = text.replace(VIDEO_EXT_RE, '')
  const pure = PURE_NUMBER_RE.exec(stem)
  if (pure) return Number(pure[1])
  const leading = LEADING_NUMBER_RE.exec(stem)
  if (leading) return Number(leading[1])
  return undefined
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { out += chunk.toString() })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${basename(command)} 退出码 ${code}：${stderr.slice(-600)}`))))
  })
}

const probeCache = new Map()

/** ffprobe 一个视频：时长、显示宽高（已算旋转）、有没有音轨。 */
export async function probeVideo(ffprobe, file) {
  const info = await stat(file).catch(() => null)
  if (!info) throw new Error(`视频不存在：${file}`)
  const key = `${file}|${info.size}|${info.mtimeMs}`
  if (probeCache.has(key)) return probeCache.get(key)
  const raw = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`ffprobe 读不出视频信息：${file}`)
  }
  const video = (data.streams ?? []).find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error(`这个文件没有视频轨：${file}`)
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio')
  const rotation = Math.round(Number(
    (video.side_data_list ?? []).find((entry) => entry.rotation !== undefined)?.rotation
      ?? video.tags?.rotate
      ?? 0,
  )) || 0
  const rawWidth = Number(video.width) || 0
  const rawHeight = Number(video.height) || 0
  const swapped = Math.abs(rotation) % 180 === 90
  const duration = Number(data.format?.duration) || Number(video.duration) || Number(audio?.duration) || 0
  const result = {
    path: file,
    name: basename(file),
    duration: Number.isFinite(duration) ? duration : 0,
    width: swapped ? rawHeight : rawWidth,
    height: swapped ? rawWidth : rawHeight,
    rotation,
    hasAudio: Boolean(audio),
    size: info.size,
    mtimeMs: info.mtimeMs,
  }
  probeCache.set(key, result)
  return result
}

/** 名字里的数字按自然序比较（第2集排在第10集前面）。 */
function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'zh', { numeric: true, sensitivity: 'base' })
}

async function videosUnder(dir, depth = 0) {
  if (depth > 3) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries.sort((a, b) => naturalCompare(a.name, b.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await videosUnder(path, depth + 1))
      continue
    }
    if (!entry.isFile() || !VIDEO_EXT_RE.test(entry.name) || PRODUCED_RE.test(entry.name)) continue
    files.push(path)
  }
  return files
}

/** 一集的多个视频按时间线首尾相接：source 是本文件内偏移，target 是这一集的偏移。 */
function timelineOf(parts) {
  let cursor = 0
  const videoSegments = []
  for (const part of parts) {
    const start = cursor
    const end = cursor + part.duration
    videoSegments.push({
      kind: 'video',
      name: part.name,
      path: part.path,
      sourceStart: 0,
      sourceEnd: part.duration,
      targetStart: start,
      targetEnd: end,
      width: part.width,
      height: part.height,
      hasAudio: part.hasAudio,
    })
    cursor = end
  }
  return videoSegments
}

function makeEpisode({ episode, name, dir, from, parts }) {
  const duration = parts.reduce((sum, part) => sum + part.duration, 0)
  const first = parts[0]
  return {
    episode,
    name,
    folder: name,
    dir,
    from,
    parts,
    files: parts.map((part) => part.path),
    duration,
    canvas: { width: first.width || 1080, height: first.height || 1920 },
    hasAudio: parts.some((part) => part.hasAudio),
    videoSegments: timelineOf(parts),
    contentStart: 0,
    contentEnd: duration,
    sequence: parts.length,
  }
}

/**
 * 扫描一部短剧的素材目录。
 * @param {{dramaDir: string, ffprobe: string, signal?: AbortSignal}} input
 */
export async function listEpisodes({ dramaDir, ffprobe, signal }) {
  if (!dramaDir || !existsSync(dramaDir)) throw new Error(`短剧目录不存在：${dramaDir}`)
  let entries
  try {
    entries = await readdir(dramaDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`读不了短剧目录：${dramaDir}（${error.message}）`)
  }
  const episodes = []
  const skipped = []

  for (const entry of entries.sort((a, b) => naturalCompare(a.name, b.name))) {
    signal?.throwIfAborted()
    if (entry.name.startsWith('.')) continue
    const path = join(dramaDir, entry.name)

    if (entry.isFile()) {
      if (!VIDEO_EXT_RE.test(entry.name) || PRODUCED_RE.test(entry.name)) continue
      const episode = episodeOfName(entry.name)
      if (episode === undefined) {
        skipped.push({ name: entry.name, reason: '文件名里认不出集号' })
        continue
      }
      const part = await probeVideo(ffprobe, path)
      if (!(part.duration > 0)) {
        skipped.push({ name: entry.name, reason: '读不出时长' })
        continue
      }
      episodes.push(makeEpisode({ episode, name: entry.name, dir: dramaDir, from: 'file', parts: [part] }))
      continue
    }

    if (!entry.isDirectory()) continue
    const files = await videosUnder(path)
    if (!files.length) {
      skipped.push({ name: entry.name, reason: '文件夹里没有视频' })
      continue
    }
    const parts = []
    for (const file of files) {
      signal?.throwIfAborted()
      const part = await probeVideo(ffprobe, file)
      if (part.duration > 0) parts.push(part)
    }
    if (!parts.length) {
      skipped.push({ name: entry.name, reason: '视频读不出时长' })
      continue
    }
    const fromFolderName = episodeOfName(entry.name)
    const fromVideoName = episodeOfName(parts[0].name)
    const episode = fromFolderName ?? fromVideoName
    if (episode === undefined) {
      skipped.push({ name: entry.name, reason: '文件夹名和视频名里都认不出集号' })
      continue
    }
    episodes.push(makeEpisode({ episode, name: entry.name, dir: path, from: 'folder', parts }))
  }

  episodes.sort((a, b) => a.episode - b.episode || naturalCompare(a.name, b.name))

  // 同一集有多份（例如 ep007.mp4 和 ep007 文件夹同时存在）：留时长更长的那份，并记下来。
  const duplicates = []
  const unique = []
  for (const episode of episodes) {
    const kept = unique.find((item) => item.episode === episode.episode)
    if (!kept) {
      unique.push(episode)
      continue
    }
    const winner = episode.duration > kept.duration ? episode : kept
    const loser = winner === episode ? kept : episode
    unique[unique.indexOf(kept)] = winner
    duplicates.push({ episode: episode.episode, kept: winner.name, ignored: loser.name })
  }
  unique.sort((a, b) => a.episode - b.episode)

  return {
    dramaDir,
    dramaName: basename(dramaDir),
    episodes: unique,
    duplicates,
    skipped,
  }
}

export function findEpisode(project, episodeNumber) {
  return project.episodes.find((episode) => episode.episode === Number(episodeNumber))
}

/** 排练一集里某一段落在哪个文件、对应文件内多少秒（抽帧、封面用）。 */
export function partAt(episode, timelineSeconds) {
  for (const segment of episode.videoSegments) {
    if (timelineSeconds >= segment.targetStart && timelineSeconds < segment.targetEnd) {
      return {
        path: segment.path,
        seek: segment.sourceStart + (timelineSeconds - segment.targetStart),
        name: segment.name,
      }
    }
  }
  return undefined
}


