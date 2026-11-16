import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

export function normalizeAudioLevels(value = {}) {
  return Object.fromEntries(['dialogue', 'music', 'effects'].map(key => {
    const gain = value[key] ?? 1
    assert(typeof gain === 'number' && Number.isFinite(gain) && gain >= 0 && gain <= 4, `${key} 音量倍率需要在 0–4 之间`)
    return [key, gain]
  }))
}

export function applyAudioLevels(draft, value) {
  const levels = normalizeAudioLevels(value)
  const materials = new Map(Object.values(draft.materials ?? {}).filter(Array.isArray).flat().map(item => [item.id, item]))
  return { ...draft, tracks: (draft.tracks ?? []).map(track => {
    if (!['audio', 'video'].includes(track.type)) return track
    return { ...track, segments: (track.segments ?? []).map(segment => {
      const material = materials.get(segment.material_id)
      const kind = track.type === 'video' || material?.type === 'video_original_sound' ? 'dialogue' : ['extract_music', 'music'].includes(material?.type) ? 'music' : 'effects'
      return { ...segment, volume: (segment.volume ?? material?.volume ?? 1) * levels[kind] }
    }) }
  }) }
}

// 独立对白已经是声音来源时，底层画面不能再叠一份原声；草稿和MP4使用同一规则。
export function preferDialogueAudio(draft) {
  const materials = new Map(Object.values(draft.materials ?? {}).filter(Array.isArray).flat().map(item => [item.id, item]))
  const coverage = (draft.tracks ?? []).filter(track => track.type === 'audio').flatMap(track => (track.segments ?? []).filter(segment => {
    const material = materials.get(segment.material_id)
    return material?.type === 'video_original_sound' && (segment.volume ?? material.volume ?? 1) > 0
  }).map(segment => [segment.target_timerange?.start ?? 0, (segment.target_timerange?.start ?? 0) + (segment.target_timerange?.duration ?? 0)]))
  if (!coverage.length) return draft
  const tracks = draft.tracks.map(track => {
    if (track.type !== 'video') return track
    const segments = (track.segments ?? []).flatMap(segment => {
      const material = materials.get(segment.material_id)
      if (!segment.source_timerange || material?.has_audio === false || (segment.volume ?? material?.volume ?? 1) === 0) return [segment]
      const start = segment.target_timerange?.start ?? 0
      const end = start + (segment.target_timerange?.duration ?? 0)
      const overlaps = coverage.filter(([from, to]) => from < end && to > start)
      if (!overlaps.length) return [segment]
      const points = [...new Set([start, end, ...overlaps.flatMap(([from, to]) => [Math.max(start, from), Math.min(end, to)])])].sort((a, b) => a - b)
      const rate = (segment.source_timerange.duration ?? end - start) / (end - start)
      return points.slice(0, -1).map((from, index) => {
        const to = points[index + 1]
        const covered = overlaps.some(([left, right]) => from < right && to > left)
        return {
          ...segment,
          id: points.length > 2 ? randomUUID() : segment.id,
          volume: covered ? 0 : segment.volume ?? material?.volume ?? 1,
          target_timerange: { start: from, duration: to - from },
          source_timerange: { ...segment.source_timerange, start: Math.round((segment.source_timerange.start ?? 0) + (from - start) * rate), duration: Math.round((to - from) * rate) },
        }
      })
    })
    return { ...track, segments }
  })
  return { ...draft, tracks }
}
