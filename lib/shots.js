// 每个镜头用原集的绝对秒数。草稿和成片按同一张有序清单铺轨。
export const MIN_SHOT_SECONDS = 0.2
export const MONTAGE_SETTINGS = { minSeconds: 5, maxSeconds: 10, minShots: 3, maxShots: 16, minDuration: MIN_SHOT_SECONDS }

export function shot({ kind, episode, sourceStart, sourceEnd, volume }) {
  const start = Number(sourceStart)
  const end = Number(sourceEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start <= 0.1) throw new Error('镜头源区间无效')
  return { kind, episode, sourceStart: start, sourceEnd: end, duration: Number((end - start).toFixed(6)), volume }
}

export function dialogueShot(episode, cut) {
  if (cut.end - cut.start < MIN_SHOT_SECONDS - 1e-6) throw new Error(`切点区间无效：对白镜头只有 ${(cut.end - cut.start).toFixed(2)}s，至少 ${MIN_SHOT_SECONDS} 秒`)
  return shot({ kind: 'dialogue', episode, sourceStart: cut.start, sourceEnd: cut.end, volume: 1 })
}

export function timeline(shots) {
  let at = 0
  const list = shots.map((item, index) => {
    const entry = { ...item, index, targetStart: Number(at.toFixed(6)), targetEnd: Number((at + item.duration).toFixed(6)) }
    at += item.duration
    return entry
  })
  return { shots: list, total: Number(at.toFixed(6)) }
}

export function contentDuration(shots) {
  return Number(shots.reduce((sum, item) => sum + item.duration, 0).toFixed(6))
}

/** 将节拍时长逐一应用到已看过的、互不重叠的画面。素材不足时拒绝，而不是偷改拍点。 */
export function montageShots(episode, windows, durations) {
  if (windows.length !== durations.length) throw new Error('快切画面数与拍点编排不一致')
  const shots = []
  for (const [index, window] of windows.entries()) {
    const { start, end, episode: source = episode } = window
    const duration = durations[index]
    if (!Number.isFinite(duration) || duration < MONTAGE_SETTINGS.minDuration - 1e-6 || start + duration > end + 1e-6) throw new Error('快切镜头超出已核验的画面')
    const item = shot({ kind: 'montage', episode: source, sourceStart: start, sourceEnd: start + duration, volume: 0 })
    if (shots.some((other) => other.episode === source && start < other.sourceEnd - 1e-6 && item.sourceEnd > other.sourceStart + 1e-6)) throw new Error('快切镜头重复用同一源画面')
    shots.push(item)
  }
  return shots
}

/** 将成片时间映射回原集；跨跳剪处不能用最后一个源切点直接倒减。 */
export function sourceTimeAt(shots, seconds) {
  let offset = Math.max(0, seconds)
  for (const item of shots) {
    const duration = item.sourceEnd - item.sourceStart
    if (offset < duration - 1e-6) return item.sourceStart + Math.max(0, offset)
    offset -= duration
  }
  return shots.at(-1)?.sourceEnd
}

export function formatShots(shots) {
  return shots.map((item, index) => {
    const label = item.kind === 'montage' ? '快切' : '对白'
    const range = `${item.sourceStart.toFixed(2)}–${item.sourceEnd.toFixed(2)}s`
    return `${index + 1}. ${label} 第${item.episode}集 ${range}${item.volume === 0 ? '（静音卡点）' : ''}`
  }).join('\n')
}
