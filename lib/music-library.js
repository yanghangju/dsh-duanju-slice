// BGM 曲库：目录结构与曲目说明沿用 dsh-duanju-promo 的内置曲库，原样读取，不改文件。
// music_library.json 里的中文说明在旧版本被按 GBK 写成乱码，所以风格说明一律读同目录的
// description.txt（UTF-8），JSON 只取 primary/secondary 分级。
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { generateJson } from './model.js'

export const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.opus'])
export const PRIMARY = 'primary'
export const SECONDARY = 'secondary'

const SYSTEM = `你是短剧投流剪辑的选曲师。只从给定曲库里挑一首背景音乐，输出 JSON。
曲风说明是人工标注，按情绪与适用场景判断，不要按标签、BPM 或曲名关键词打分。
优先级：与内容方向和这段台词的情绪一致 > 有清晰稳定的节拍（快切卡点要用） > 主库曲目（primary）。
不要选人声演唱明显、会抢台词或情绪与剧情相反的曲目。
只输出 JSON：{"directory":"曲目目录名","reason":"不超过40字的中文理由"}`

export function libraryDir(pluginDir, configured) {
  return configured || process.env.DUANJU_MUSIC_DIR || join(pluginDir, 'assets', 'music')
}

function styleOf(text) {
  const clean = String(text ?? '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  // 中文段落在前，英文说明对选曲没有额外信息，截断到前几行。
  const picked = clean.slice(0, 8).join('；')
  return picked.slice(0, 220)
}

async function audioIn(dir) {
  const files = await readdir(dir, { withFileTypes: true })
  for (const file of files) {
    if (!file.isFile()) continue
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (AUDIO_EXT.has(ext)) return join(dir, file.name)
  }
  return undefined
}

/** 读曲库：每个子目录一首曲，目录名即曲名，description.txt 是人工标注。 */
export async function loadLibrary(dir) {
  if (!dir || !existsSync(dir)) throw new Error(`BGM 曲库不存在：${dir}`)
  const levels = new Map()
  for (const file of ['music_library.json', 'music-library.json']) {
    const path = join(dir, file)
    if (!existsSync(path)) continue
    try {
      const list = JSON.parse(await readFile(path, 'utf8'))
      for (const entry of Array.isArray(list) ? list : []) {
        if (entry?.directory) levels.set(entry.directory, entry.library === PRIMARY ? PRIMARY : SECONDARY)
      }
    } catch {
      // 索引坏了不影响选曲：全部按副库处理，照样能扫目录读说明。
    }
    break
  }
  const tracks = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folder = join(dir, entry.name)
    const file = await audioIn(folder)
    if (!file) continue
    let style = ''
    const description = join(folder, 'description.txt')
    if (existsSync(description)) style = styleOf(await readFile(description, 'utf8'))
    const info = await stat(file)
    tracks.push({
      directory: entry.name,
      title: entry.name,
      file,
      bytes: info.size,
      library: levels.get(entry.name) ?? SECONDARY,
      style,
    })
  }
  if (!tracks.length) throw new Error(`BGM 曲库里没有可用曲目：${dir}`)
  tracks.sort((a, b) => (a.library === b.library ? a.directory.localeCompare(b.directory) : a.library === PRIMARY ? -1 : 1))
  return { dir, tracks }
}

/** 喂给模型看的曲库摘要：曲名 + 分级 + 人工标注。 */
export function libraryDigest(tracks, limit = 40) {
  return tracks.slice(0, limit).map((track) => {
    const tag = track.library === PRIMARY ? '主库' : '副库'
    return `- ${track.directory}｜${tag}｜${track.style || '（无说明）'}`
  }).join('\n')
}

export function resolveTrack(tracks, name) {
  if (!name) return undefined
  const wanted = String(name).trim()
  return tracks.find((track) => track.directory === wanted)
    ?? tracks.find((track) => track.directory.toLowerCase() === wanted.toLowerCase())
    ?? tracks.find((track) => track.directory.includes(wanted))
}

// 模型没给出可用答案时的确定性兜底：方向里提到的情绪词与曲目说明重合度越高越优先，
// 同分先主库。不引入 BPM/标签打分，和模型选曲的口径保持一致。
const EMOTIONS = [
  '紧张', '悬疑', '压抑', '冲突', '反转', '压迫', '危机', '黑暗', '恐怖', '惊悚',
  '温情', '浪漫', '暖', '治愈', '悲伤', '催泪', '孤独', '家庭', '青春',
  '搞笑', '轻松', '欢快', '俏皮', '热血', '激昂', '史诗', '燃', '宏大',
  '都市', '复古', '科技', '希望', '愤怒', '复仇', '自由', '节奏',
]

export function pickByKeyword(tracks, direction) {
  const text = String(direction ?? '')
  let best = tracks[0]
  let bestScore = -Infinity
  for (const track of tracks) {
    let score = track.library === PRIMARY ? 1 : 0
    for (const word of EMOTIONS) if (text.includes(word) && track.style.includes(word)) score += 2
    if (score > bestScore) {
      best = track
      bestScore = score
    }
  }
  return best
}

/**
 * 选一首 BGM。direction 决定情绪，dialogue 是这段台词（帮助判断情绪走向）。
 * @returns {Promise<{directory:string,file:string,title:string,library:string,style:string,reason:string,by:string}>}
 */
export async function pickTrack({ tracks, direction, dialogue, ctx, provider, model, signal, prefer }) {
  const manual = resolveTrack(tracks, prefer)
  if (manual) return { ...manual, reason: '按参数指定', by: 'manual' }
  if (ctx && tracks.length > 1) {
    try {
      const parsed = await generateJson(ctx, {
        provider,
        model,
        signal,
        system: SYSTEM,
        maxTokens: 800,
        user: [
          `内容方向：${direction || '（未指定，按台词判断）'}`,
          `这段台词：${String(dialogue || '').slice(0, 600) || '（未取到）'}`,
          '',
          '曲库（曲名｜分级｜风格说明）：',
          libraryDigest(tracks),
          '',
          '输出 JSON，directory 必须逐字取自上面的曲名。',
        ].join('\n'),
      })
      const chosen = resolveTrack(tracks, parsed?.directory)
      if (chosen) {
        return { ...chosen, reason: String(parsed?.reason ?? '').slice(0, 80) || '模型选择', by: 'model' }
      }
      const fallback = pickByKeyword(tracks, direction)
      return { ...fallback, reason: '模型给的曲名不在曲库里，按方向关键词兜底', by: 'fallback' }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      const fallback = pickByKeyword(tracks, direction)
      return { ...fallback, reason: `选曲失败（${error.message}），按方向关键词兜底`, by: 'fallback' }
    }
  }
  const fallback = pickByKeyword(tracks, direction)
  return { ...fallback, reason: '曲库只有一首或缺模型', by: 'fallback' }
}

export function trackName(track) {
  return track?.directory ? basename(track.directory) : ''
}
