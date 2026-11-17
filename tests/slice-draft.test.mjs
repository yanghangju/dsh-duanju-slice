// 从短剧素材直接拼切片草稿：视频段、时间线归零、元数据、素材路径。
import assert from 'node:assert/strict'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSliceDraft, planSegments, readDraft } from '../lib/slice-draft.js'
import { cleanup, ffmpeg, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

async function episodeFixture(dir, { minutes = 1 } = {}) {
  const drama = join(dir, 'drama')
  await mkdir(drama, { recursive: true })
  const first = await makeVideo(drama, 'a.mp4', { seconds: 2, audio: true, width: 1080, height: 1920 })
  const second = await makeVideo(drama, 'b.mp4', { seconds: 2, audio: true, width: 1080, height: 1920 })
  return {
    episode: 7,
    name: 'ep007',
    dir: drama,
    parts: [
      { path: first, name: 'a.mp4', duration: 2.005, width: 1080, height: 1920, hasAudio: true },
      { path: second, name: 'b.mp4', duration: 2.005, width: 1080, height: 1920, hasAudio: true },
    ],
    duration: 4.01,
    canvas: { width: 1080, height: 1920 },
    hasAudio: true,
    videoSegments: [
      { kind: 'video', name: 'a.mp4', path: first, sourceStart: 0, sourceEnd: 2.005, targetStart: 0, targetEnd: 2.005, width: 1080, height: 1920, hasAudio: true },
      { kind: 'video', name: 'b.mp4', path: second, sourceStart: 0, sourceEnd: 2.005, targetStart: 2.005, targetEnd: 4.01, width: 1080, height: 1920, hasAudio: true },
    ],
  }
}

test('切点跨文件时拆成两段，时间线从 0 开始', () => {
  const episode = {
    videoSegments: [
      { path: 'a.mp4', sourceStart: 0, sourceEnd: 10, targetStart: 0, targetEnd: 10 },
      { path: 'b.mp4', sourceStart: 0, sourceEnd: 10, targetStart: 10, targetEnd: 20 },
    ],
  }
  const segments = planSegments(episode, { start: 8, end: 13 })
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0].source, { start: 8, duration: 2 })
  assert.deepEqual(segments[0].target, { start: 0, duration: 2 })
  assert.deepEqual(segments[1].source, { start: 0, duration: 3 })
  assert.deepEqual(segments[1].target, { start: 2, duration: 3 })
  // 完全在切点之外的段不出现
  assert.deepEqual(planSegments(episode, { start: 1, end: 5 }).length, 1)
})

test('草稿只含视频轨：按切点裁剪、引用原素材绝对路径、元数据是这份切片自己的', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-build-')
  try {
    const fixture = await episodeFixture(root)
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })
    const result = await buildSliceDraft({
      episode: fixture,
      cut: { start: 1.5, end: 3.5 },
      draftRoot,
      name: 'ep007_v1_abc123',
      audioLevels: { dialogue: 1, music: 1, effects: 1 },
      ffmpeg,
      cover: false,
      ending: { enabled: false },
    })

    const draft = await readDraft(result.draftDir)
    assert.equal(draft.tracks.length, 1)
    assert.equal(draft.tracks[0].type, 'video')
    assert.equal(draft.tracks[0].segments.length, 2, '跨文件的切点要拆成两段')
    assert.deepEqual(draft.canvas_config.width, 1080)
    assert.deepEqual(draft.canvas_config.height, 1920)
    assert.equal(draft.duration, 2e6)

    const [first, second] = draft.tracks[0].segments
    assert.deepEqual(first.target_timerange, { start: 0, duration: 0.505 * 1e6 })
    assert.deepEqual(first.source_timerange, { start: 1.5 * 1e6, duration: 0.505 * 1e6 })
    assert.ok(second.target_timerange.start > 0)
    assert.deepEqual(draft.materials.videos.map((material) => material.path), [fixture.parts[0].path, fixture.parts[1].path])
    assert.ok(draft.materials.videos.every((material) => material.type === 'video' && material.has_audio === true))
    assert.equal(draft.materials.texts?.length ?? 0, 0, '不写字幕轨')

    // 三份正文文件内容一致（剪映 11.5 读的是新版正文文件）
    for (const file of ['draft_info.json', 'draft_content.json', 'template.json']) {
      assert.deepEqual(JSON.parse(await readFile(join(result.draftDir, file), 'utf8')), draft)
    }

    const meta = JSON.parse(await readFile(join(result.draftDir, 'draft_meta_info.json'), 'utf8'))
    assert.equal(meta.draft_name, 'ep007_v1_abc123')
    assert.equal(meta.draft_fold_path, result.draftDir)
    assert.equal(meta.tm_duration, 2e6)
    assert.notEqual(meta.draft_id, draft.id)
    const library = meta.draft_materials.flatMap((group) => group.value)
    assert.equal(library.length, 2, '素材库只登记真正引用的文件')
    assert.deepEqual(library.map((item) => item.file_Path), fixture.parts.map((part) => part.path))
    assert.ok(await stat(result.draftDir).then((info) => info.isDirectory()))

    assert.deepEqual(result.tracks, [{ type: 'video', segments: 2 }])
    assert.equal(result.contentDuration, 2)
    assert.equal(result.ending, undefined, '关闭片尾时不接片尾')
  } finally {
    await cleanup(root)
  }
})

test('输出音量倍率作用在画面段的对白上', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-build-gain-')
  try {
    const fixture = await episodeFixture(root)
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })
    const result = await buildSliceDraft({
      episode: fixture,
      cut: { start: 0, end: 2 },
      draftRoot,
      name: 'gain',
      audioLevels: { dialogue: 0.5, music: 1, effects: 1 },
      ffmpeg,
      cover: false,
      ending: { enabled: false },
    })
    const draft = await readDraft(result.draftDir)
    assert.ok(Math.abs(draft.tracks[0].segments[0].volume - 0.5) < 1e-9)
  } finally {
    await cleanup(root)
  }
})

test('同名草稿/非法切点直接报错，不覆盖已有文件', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-build-guard-')
  try {
    const fixture = await episodeFixture(root)
    const draftRoot = join(root, 'drafts')
    await mkdir(join(draftRoot, 'dup'), { recursive: true })
    await assert.rejects(
      buildSliceDraft({ episode: fixture, cut: { start: 0, end: 2 }, draftRoot, name: 'dup', ffmpeg, cover: false, ending: { enabled: false } }),
      /草稿同名已存在/,
    )
    await assert.rejects(
      buildSliceDraft({ episode: fixture, cut: { start: 1, end: 1.2 }, draftRoot, name: 'short', ffmpeg, cover: false, ending: { enabled: false } }),
      /切点区间无效/,
    )
  } finally {
    await cleanup(root)
  }
})
