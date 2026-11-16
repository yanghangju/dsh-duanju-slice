import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadDraftJson, parseDraft } from '../lib/draft.js'
import { cutPoints, frameAt } from '../lib/locate.js'

test('compound clips keep their picture and separated dialogue at the parent timeline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slice-compound-'))
  try {
    const child = {
      tracks: [
        { type: 'video', segments: [{ id: 'child-video', material_id: 'video', source_timerange: { start: 10e6, duration: 6e6 }, target_timerange: { start: 0, duration: 6e6 } }] },
        { type: 'audio', segments: [{ id: 'child-audio', material_id: 'voice', volume: 0.5, source_timerange: { start: 10e6, duration: 6e6 }, target_timerange: { start: 0, duration: 6e6 } }] },
      ],
      materials: { videos: [{ id: 'video', path: '/video.mp4', has_sound_separated: true }], audios: [{ id: 'voice', path: '/video.mp4', type: 'video_original_sound' }] },
    }
    const nested = {
      tracks: [{ type: 'video', segments: [{ id: 'nested', material_id: 'inner-wrapper', extra_material_refs: ['shared-child'], source_timerange: { duration: 6e6 }, target_timerange: { duration: 6e6 } }] }],
      materials: { videos: [{ id: 'inner-wrapper', path: '' }] },
    }
    const draft = {
      tracks: [{ type: 'video', segments: [
        { id: 'parent', material_id: 'wrapper', volume: 0.8, extra_material_refs: ['compound'], source_timerange: { start: 1e6, duration: 4e6 }, target_timerange: { start: 18e6, duration: 2e6 } },
        { id: 'reused', material_id: 'wrapper', extra_material_refs: ['compound'], source_timerange: { start: 0, duration: 1e6 }, target_timerange: { start: 22e6, duration: 1e6 } },
      ] }],
      materials: { videos: [{ id: 'wrapper', path: '' }], drafts: [{ id: 'compound', draft: nested }, { id: 'shared-child', draft: child }] },
    }
    const original = JSON.stringify(draft)
    await writeFile(join(dir, 'draft_info.json'), original)
    const loaded = await loadDraftJson(dir)
    const parsed = parseDraft(loaded.draft, dir)
    assert.equal(parsed.videoSegments.length, 2)
    assert.deepEqual(parsed.videoSegments.map(v => [v.targetStart, v.targetEnd, v.sourceStart, v.sourceEnd]), [[18, 20, 11, 15], [22, 23, 10, 11]])
    assert.deepEqual(parsed.audioSegments.map(v => [v.targetStart, v.targetEnd, v.sourceStart, v.sourceEnd, v.volume]), [[18, 20, 11, 15, 0.4], [22, 23, 10, 11, 0.5]])
    assert.equal(frameAt(parsed.videoSegments, 18.5).seek, 12)
    assert.equal(new Set(loaded.draft.tracks.flatMap(t => t.segments.map(s => s.id))).size, 4)
    assert.equal(loaded.draft.materials.videos.find(v => v.id === 'video').has_sound_separated, true)
    assert.equal(await readFile(join(dir, 'draft_info.json'), 'utf8'), original)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sentence padding stays within real video and excludes the closing photo card', () => {
  const cut = cutPoints({ hits: [{ subtitle: { start: 0.04, end: 54.766666, text: 'I will not go to prison' } }] }, {
    videoSegments: [{ kind: 'photo', targetStart: 0, targetEnd: 0.033333 }, { kind: 'video', targetStart: 0.033333, targetEnd: 54.833333 }, { kind: 'photo', targetStart: 54.833333, targetEnd: 56.366666 }],
  })
  assert.equal(cut.start, 0.033333)
  assert.equal(cut.end, 54.833333)
  assert.equal(cut.subtitleEnd, 54.766666)
})
