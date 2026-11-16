import assert from 'node:assert/strict'
import { normalizeAudioLevels } from './audio.js'
import { listEpisodeFolders } from './draft.js'

export async function revisionSource(entry) {
  const current = entry?.lastResult
  assert(current, '当前会话还没有成片，请先生成初版')
  if (current.sourceDir) return current.sourceDir
  const folders = (await listEpisodeFolders(entry.settings.projectDir)).filter(item => item.episode === current.episode)
  assert(folders.length === 1, '无法唯一定位当前版本的原集，请先重新选段生成一版')
  return folders[0].dir
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
