import assert from 'node:assert/strict'
import { normalizeAudioLevels } from './audio.js'
import { findEpisode, listEpisodes } from './drama-source.js'

/** 当前版本对应的原集（短剧目录里的那一集）。 */
export async function revisionEpisode(entry, { ffprobe }) {
  const current = entry?.lastResult
  assert(current, '当前会话还没有成片，请先生成初版')
  const dramaDir = entry.settings?.dramaDir
  assert(dramaDir, '当前会话没有短剧目录')
  const project = await listEpisodes({ dramaDir, ffprobe })
  const episode = findEpisode(project, current.episode)
  assert(episode, `短剧目录里找不到第 ${current.episode} 集了（文件被移动或改名？）`)
  return episode
}

export function revisionEdit(current, args, sourceDuration) {
  const duration = current.end - current.start
  const start = args.start ?? 0
  const end = args.end ?? duration
  assert(typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end), '首尾时间必须是秒数')
  const cut = { start: Math.round((current.start + start) * 1e6) / 1e6, end: Math.round((current.start + end) * 1e6) / 1e6 }
  assert(cut.start >= 0 && cut.end <= sourceDuration + 0.000001 && end - start >= 1, '裁剪范围超出原集或不足1秒，请调整首尾时间')
  const audioLevels = normalizeAudioLevels({ ...current.audioLevels, ...Object.fromEntries(['dialogue', 'music', 'effects'].filter(key => args[`${key}Gain`] != null).map(key => [key, args[`${key}Gain`]])) })
  return { cut, audioLevels }
}
