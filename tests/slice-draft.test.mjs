import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSliceDraft } from '../lib/slice-draft.js'

for (const encrypted of [false, true]) test(`a slice gets its own home identity and duration (encrypted source: ${encrypted})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-home-'))
  try {
    const source = join(root, 'EP43'); await mkdir(source)
    await mkdir(join(source, 'materials/video'), { recursive: true })
    await writeFile(join(source, 'materials/video/original.mp4'), 'fixture media')
    const draft = { id: 'source-timeline', duration: 60e6, tracks: [{ type: 'video', segments: [{ id: 'clip', material_id: 'video', source_timerange: { duration: 60e6 }, target_timerange: { duration: 60e6 } }] }], materials: { videos: [{ id: 'video', local_material_id: 'local-video', type: 'video', path: '##_draftpath_placeholder_test_##/materials/video/original.mp4' }] } }
    const oldMeta = { draft_id: 'source-draft', draft_name: 'EP43', tm_duration: 60e6, tm_draft_create: 123, tm_draft_modified: 456, tm_draft_cloud_user_id: 999 }
    await writeFile(join(source, 'draft_info.json'), JSON.stringify(draft))
    const oldBytes = encrypted ? 'encrypted-source-metadata' : JSON.stringify(oldMeta)
    await writeFile(join(source, 'draft_meta_info.json'), oldBytes)
    await writeFile(join(root, 'root_meta_info.json'), JSON.stringify({ all_draft_store: [{ ...oldMeta, draft_fold_path: source }] }))
    await writeFile(join(source, 'draft_virtual_store.json'), JSON.stringify({ draft_materials: [{ type: 0, value: [{ id: 'local-video', file_Path: 'missing-old-name.mp4' }, { id: 'unused', file_Path: 'missing-unused.mp4' }] }] }))
    const before = Date.now() * 1000
    const result = await buildSliceDraft({ episodeDir: source, cut: { start: 10, end: 45 }, draftRoot: root, name: 'test-slice', cover: false, ending: { enabled: false } })
    const meta = JSON.parse(await readFile(join(result.draftDir, 'draft_meta_info.json'), 'utf8'))
    const content = JSON.parse(await readFile(join(result.draftDir, 'draft_info.json'), 'utf8'))
    assert.notEqual(meta.draft_id, oldMeta.draft_id)
    assert.notEqual(content.id, draft.id)
    assert.equal(meta.draft_name, 'test-slice')
    assert.equal(meta.draft_fold_path, result.draftDir)
    assert.equal(meta.draft_root_path, root)
    assert.equal(meta.tm_duration, 35e6)
    assert.ok(meta.tm_draft_create >= before && meta.tm_draft_modified >= before)
    assert.equal(meta.tm_draft_cloud_user_id, undefined)
    const library = meta.draft_materials.flatMap(group => group.value)
    assert.equal(library.length, 1)
    assert.equal(library[0].file_Path, join(result.draftDir, 'materials/video/original.mp4'))
    assert.equal(library[0].id, 'local-video')
    const virtual = JSON.parse(await readFile(join(result.draftDir, 'draft_virtual_store.json'), 'utf8'))
    assert.deepEqual(virtual.draft_materials, meta.draft_materials)
    assert.equal(await readFile(join(source, 'draft_meta_info.json'), 'utf8'), oldBytes)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('all slice captions share the reference position without moving picture or changing the source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-subtitles-'))
  try {
    const source = join(root, 'EP43'); await mkdir(source)
    const media = join(source, 'picture.mp4'); await writeFile(media, 'fixture media')
    const clip = { scale: { x: 0.9, y: 0.9 }, transform: { x: 0.3, y: -0.2 }, rotation: 0 }
    const draft = {
      duration: 4e6, canvas_config: { width: 1080, height: 1920 },
      materials: { videos: [{ id: 'video', type: 'video', path: media }], texts: [{ id: 'sub', type: 'subtitle', content: JSON.stringify({ text: 'A subtitle', styles: [] }) }] },
      tracks: [{ type: 'text', segments: [
        { id: 'one', material_id: 'sub', clip, target_timerange: { start: 0, duration: 2e6 }, common_keyframes: [{ property_type: 'KFTypePositionY' }, { property_type: 'KFTypeAlpha' }] },
        { id: 'two', material_id: 'sub', target_timerange: { start: 2e6, duration: 2e6 } },
      ] }, { type: 'video', segments: [{ id: 'picture', material_id: 'video', clip, target_timerange: { start: 0, duration: 4e6 }, source_timerange: { start: 0, duration: 4e6 } }] }],
    }
    const bytes = JSON.stringify(draft)
    await writeFile(join(source, 'draft_info.json'), bytes)
    const result = await buildSliceDraft({ episodeDir: source, cut: { start: 0, end: 4 }, draftRoot: root, name: 'positioned', cover: false, ending: { enabled: false } })
    const content = JSON.parse(await readFile(join(result.draftDir, 'draft_info.json'), 'utf8'))
    const captions = content.tracks[0].segments
    assert.equal(captions.length, 2)
    for (const caption of captions) assert.deepEqual(caption.clip.transform, { x: 0, y: -0.56 })
    assert.deepEqual(captions[0].clip.scale, clip.scale)
    assert.deepEqual(content.tracks[1].segments[0].clip, clip)
    assert.deepEqual(captions[0].common_keyframes, [{ property_type: 'KFTypeAlpha' }])
    assert.equal(await readFile(join(source, 'draft_info.json'), 'utf8'), bytes)
  } finally { await rm(root, { recursive: true, force: true }) }
})
