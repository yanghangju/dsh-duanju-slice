import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAudioLevels, preferDialogueAudio } from '../lib/audio.js'
import { revisionEdit } from '../lib/revision.js'

test('edits are relative to the selected version and preserve earlier gains', () => {
  const first = { start: 31.333333, end: 66.566667 }
  const second = revisionEdit(first, { end: 25, musicGain: 0.5 }, 80)
  assert.deepEqual(second, { cut: { start: 31.333333, end: 56.333333 }, audioLevels: { dialogue: 1, music: 0.5, effects: 1 } })
  const third = revisionEdit({ ...second.cut, audioLevels: second.audioLevels }, { start: 2 }, 80)
  assert.equal(third.cut.start, 33.333333)
  assert.equal(third.audioLevels.music, 0.5)
  assert.deepEqual(first, { start: 31.333333, end: 66.566667 })
  for (const args of [{ start: -50 }, { end: 90 }, { end: 0.5 }, { start: NaN }, { musicGain: -1 }, { musicGain: 'half' }]) assert.throws(() => revisionEdit(first, args, 80))
})

test('music gain preserves original mix and the explicit mute against duplicate dialogue', () => {
  const source = { materials: { videos: [{ id: 'v' }], audios: [{ id: 'd', type: 'video_original_sound' }, { id: 'm', type: 'extract_music' }, { id: 's', type: 'sound' }] }, tracks: [
    { type: 'video', segments: [{ material_id: 'v', volume: 0.7, source_timerange: { duration: 2e6 }, target_timerange: { duration: 2e6 } }] },
    { type: 'audio', segments: ['d', 'm', 's'].map(material_id => ({ material_id, volume: 0.8, target_timerange: { duration: 2e6 } })) },
  ] }
  const output = applyAudioLevels(preferDialogueAudio(source), { music: 0.5 })
  assert.equal(output.tracks[0].segments[0].volume, 0)
  assert.deepEqual(output.tracks[1].segments.map(s => s.volume), [0.8, 0.4, 0.8])
  assert.equal(source.tracks[0].segments[0].volume, 0.7)
})
