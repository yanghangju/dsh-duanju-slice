// Validated structured selections → exact media ranges shared by MP4 and editor drafts.
import assert from 'node:assert/strict'
import { parseProbe, run } from './media.js'

const MICRO = 1_000_000
export const BGM_VOLUME_SCALE = 2.8

/** Public 0–1 slider value → actual gain; saved audio segments already contain gains. */
export function bgmGain(volume = 0.12) {
  assert(Number.isFinite(volume) && volume >= 0 && volume <= 1, 'BGM 音量刻度必须在 [0, 1] 内')
  return volume * BGM_VOLUME_SCALE
}

export function timedBeats(cutlist) {
  assert(Array.isArray(cutlist?.beats) && cutlist.beats.length > 0, 'BGM 选曲需要非空剪辑节拍')
  const indexes = new Set()
  return cutlist.beats.map((beat) => {
    assert(Number.isInteger(beat?.index) && beat.index > 0 && !indexes.has(beat.index), 'BGM 节拍编号无效或重复')
    indexes.add(beat.index)
    assert(Array.isArray(beat.clips) && beat.clips.length > 0, `BGM 第${beat.index}拍没有片段`)
    let durationUs = 0
    const clips = beat.clips.map((clip) => {
      assert(Number.isFinite(clip?.start) && Number.isFinite(clip.end) && clip.start >= 0 && clip.end > clip.start, `BGM 第${beat.index}拍片段时间无效`)
      const micros = Math.round((clip.end - clip.start) * MICRO)
      assert(Number.isSafeInteger(micros) && micros > 0, 'BGM 片段时长必须是有效的正微秒数')
      durationUs += micros
      assert(Number.isSafeInteger(durationUs), 'BGM 节拍时长过大')
      return { zh: typeof clip.zh === 'string' ? clip.zh : '', duration: micros / MICRO }
    })
    return { beat: beat.index, label: beat.label ?? '', visual: beat.visual ?? '', clips, durationUs }
  })
}

/** Validate an optional music track before rendering or importing a saved timeline. */
export function validateMusicSegments(segments, totalDuration) {
  assert(Array.isArray(segments), 'BGM segments 必须是数组')
  assert(Number.isFinite(totalDuration) && totalDuration >= 0, 'BGM 成片总时长无效')
  let previousStart = 0
  let previousEnd = 0
  for (const segment of segments) {
    assert(segment && typeof segment.file === 'string' && segment.file.trim(), 'BGM 素材路径必须是非空字符串')
    for (const field of ['sourceStart', 'targetStart', 'duration', 'sourceDuration', 'fadeIn', 'fadeOut']) {
      assert(Number.isFinite(segment[field]) && segment[field] >= 0, `BGM ${field} 必须是非负有限数值`)
    }
    assert(segment.duration > 0, 'BGM duration 必须大于 0')
    assert(segment.sourceStart + segment.duration <= segment.sourceDuration + 0.000001, 'BGM 源区间超出音乐时长')
    assert(segment.targetStart + segment.duration <= totalDuration + 0.06, 'BGM 目标区间超出成片时长')
    const epsilon = Number.EPSILON * Math.max(1, previousEnd) * 4
    assert(segment.targetStart >= previousStart && previousEnd - segment.targetStart <= epsilon, 'BGM segments 必须按 targetStart 有序且不能重叠')
    assert(Number.isFinite(segment.volume) && segment.volume >= 0 && segment.volume <= BGM_VOLUME_SCALE, `BGM volume（实际增益）必须在 [0, ${BGM_VOLUME_SCALE}] 内`)
    assert(segment.fadeIn + segment.fadeOut <= segment.duration, 'BGM 淡入淡出合计不能超过片段时长')
    previousStart = segment.targetStart
    previousEnd = segment.targetStart + segment.duration
  }
  return segments
}

/** End added music before an independent SFX; both export and editor use these same ranges/fades. */
export function finishMusicBefore(segments, targetEnd) {
  assert(Array.isArray(segments), 'BGM segments 必须是数组')
  const endUs = Math.round(targetEnd * MICRO)
  assert(Number.isFinite(targetEnd) && targetEnd >= 0 && Number.isSafeInteger(endUs), 'BGM 收尾时间必须是有效的非负微秒时间')
  validateMusicSegments(segments, segments.reduce((end, segment) => Math.max(end, segment?.targetStart + segment?.duration), targetEnd))
  const finished = segments.flatMap((segment) => {
    const startUs = Math.round(segment.targetStart * MICRO)
    const sourceEndUs = Math.round((segment.targetStart + segment.duration) * MICRO)
    assert(Number.isSafeInteger(startUs) && Number.isSafeInteger(sourceEndUs), 'BGM 收尾片段超出有效微秒时间范围')
    const durationUs = Math.min(sourceEndUs, endUs) - startUs
    return durationUs > 0 ? [{ ...segment, targetStart: startUs / MICRO, duration: durationUs / MICRO }] : []
  })
  for (const [index, segment] of finished.entries()) {
    const durationUs = Math.round(segment.duration * MICRO)
    const fadeOutUs = index === finished.length - 1
      ? Math.min(Math.max(Math.round(segment.fadeOut * MICRO), 500_000), Math.floor(durationUs / 2))
      : Math.min(Math.round(segment.fadeOut * MICRO), durationUs)
    segment.fadeOut = fadeOutUs / MICRO
    segment.fadeIn = Math.min(Math.round(segment.fadeIn * MICRO), durationUs - fadeOutUs) / MICRO
  }
  validateMusicSegments(finished, endUs / MICRO)
  return finished
}

/** Shared microsecond timeline compiler; hooks are program-chosen, never model paths/times. */
export async function compileMusicSegments({ selection, beats, tracks, ffmpeg, signal, volume = 0.12, fadeSeconds = 0.5, hooks = new Map() }) {
  signal?.throwIfAborted()
  assert(Number.isFinite(volume) && volume >= 0 && volume <= BGM_VOLUME_SCALE, `BGM volume（实际增益）必须在 [0, ${BGM_VOLUME_SCALE}] 内`)
  assert(Number.isFinite(fadeSeconds) && fadeSeconds >= 0, 'BGM fadeSeconds 必须为非负有限数值')
  const ids = new Set(tracks.map((track) => track.trackId))
  assert(Array.isArray(selection) && selection.length === beats.length && selection.every((item, index) => item?.beat === beats[index].beat && ids.has(item.trackId)), 'BGM selection 必须按顺序覆盖真实节拍和曲库 ID')
  const totalUs = beats.reduce((sum, beat) => sum + beat.durationUs, 0)
  assert(Number.isSafeInteger(totalUs) && totalUs > 0, 'BGM 成片时长无效')
  const blocks = []
  let targetUs = 0
  for (const [index, item] of selection.entries()) {
    const durationUs = beats[index].durationUs
    const previous = blocks.at(-1)
    if (previous?.trackId === item.trackId) {
      previous.durationUs += durationUs
      previous.reasons.push(item.reason)
    } else blocks.push({ trackId: item.trackId, targetUs, durationUs, reasons: [item.reason] })
    targetUs += durationUs
  }
  const byId = new Map(tracks.map((track) => [track.trackId, track]))
  const durations = new Map()
  const segments = []
  let looped = false
  for (const block of blocks) {
    signal?.throwIfAborted()
    const track = byId.get(block.trackId)
    if (!durations.has(track.trackId)) {
      const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', track.file], { signal, okCodes: [0, 1] })
      signal?.throwIfAborted()
      const { duration, hasAudio } = parseProbe(stderr)
      assert(hasAudio, `BGM 素材没有可读取的音轨：${track.trackId}`)
      assert(Number.isFinite(duration) && duration > 0 && Number.isSafeInteger(Math.floor(duration * MICRO)) && Math.floor(duration * MICRO) > 0, `无法读取 BGM 有效时长：${track.trackId}`)
      durations.set(track.trackId, duration)
    }
    const sourceDuration = durations.get(track.trackId)
    const hook = hooks.get(track.trackId) ?? [0, sourceDuration]
    assert(Array.isArray(hook) && hook.length === 2 && hook.every(Number.isFinite) && hook[0] >= 0 && hook[1] > hook[0] && hook[1] <= sourceDuration + 0.000001, 'BGM hook 超出音乐时长')
    const sourceStartUs = Math.round(hook[0] * MICRO)
    const sourceUs = Math.min(Math.floor(sourceDuration * MICRO), Math.round(hook[1] * MICRO)) - sourceStartUs
    assert(sourceUs > 0, 'BGM hook 时长无效')
    // ponytail: bound FFmpeg inputs/Windows command length; use a looped stem if over 32 pieces are needed.
    assert(segments.length + Math.ceil(block.durationUs / sourceUs) <= 32, 'BGM 过短，重复片段超过 32 段，请使用更长的音乐')
    looped ||= block.durationUs > sourceUs
    let remaining = block.durationUs
    let position = block.targetUs
    while (remaining > 0) {
      const micros = Math.min(remaining, sourceUs)
      const duration = micros / MICRO
      const fade = Math.min(fadeSeconds, duration / 2)
      segments.push({
        trackId: track.trackId, title: track.title, file: track.file,
        sourceStart: sourceStartUs / MICRO, targetStart: position / MICRO, duration, sourceDuration,
        volume, fadeIn: fade, fadeOut: fade, reason: [...new Set(block.reasons)].join('；'),
      })
      remaining -= micros
      position += micros
    }
  }
  validateMusicSegments(segments, totalUs / MICRO)
  signal?.throwIfAborted()
  return { segments, looped }
}
