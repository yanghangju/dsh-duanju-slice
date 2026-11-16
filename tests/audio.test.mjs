import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preferDialogueAudio } from '../lib/audio.js'

for (const separated of [false, true]) test(`independent dialogue explicitly mutes covered video audio (separated flag: ${separated})`, () => {
  const original = {
    materials: { videos: [{ id: 'video', path: '/picture.mp4', has_sound_separated: separated }], audios: [{ id: 'voice', type: 'video_original_sound' }, { id: 'bgm', type: 'extract_music' }] },
    tracks: [
      { type: 'video', segments: [{ id: 'picture', material_id: 'video', volume: 0.7, source_timerange: { start: 10e6, duration: 8e6 }, target_timerange: { start: 0, duration: 4e6 } }] },
      { type: 'audio', segments: [{ id: 'dialogue', material_id: 'voice', target_timerange: { start: 1e6, duration: 2e6 } }] },
      { type: 'audio', segments: [{ id: 'music', material_id: 'bgm', target_timerange: { start: 0, duration: 4e6 } }] },
    ],
  }
  const result = preferDialogueAudio(original)
  assert.deepEqual(result.tracks[0].segments.map(s => [s.target_timerange.start, s.target_timerange.duration, s.source_timerange.start, s.source_timerange.duration, s.volume]), [[0, 1e6, 10e6, 2e6, 0.7], [1e6, 2e6, 12e6, 4e6, 0], [3e6, 1e6, 16e6, 2e6, 0.7]])
  assert.equal(original.tracks[0].segments.length, 1, 'source must remain untouched')
  assert.deepEqual(result.tracks.slice(1), original.tracks.slice(1), 'keep dialogue, music and timing')
  assert.deepEqual(preferDialogueAudio(result), result, 'reopening must not split the video again')
})

test('muted dialogue and BGM alone do not suppress a video voice', () => {
  const draft = { materials: { audios: [{ id: 'voice', type: 'video_original_sound' }, { id: 'music', type: 'extract_music' }] }, tracks: [
    { type: 'video', segments: [{ id: 'video', material_id: 'picture', volume: 1, source_timerange: { duration: 2e6 }, target_timerange: { duration: 2e6 } }] },
    { type: 'audio', segments: [{ material_id: 'voice', volume: 0, target_timerange: { duration: 2e6 } }, { material_id: 'music', target_timerange: { duration: 2e6 } }] },
  ] }
  assert.deepEqual(preferDialogueAudio(draft), draft)
})
