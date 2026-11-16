import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { buildSliceDraft } from '../lib/slice-draft.js'

const E6 = 1e6

async function writeFake(path, text) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

test('切片草稿自带素材：跨草稿素材收进草稿、缺文件片段移除、不残留外部路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-media-'))
  try {
    const project = join(root, 'project')
    const episode = join(project, 'EP002-副本')
    const sibling = join(project, 'EP007-副本')
    const own = join(episode, 'materials', 'video', 'own.mp4')
    const cross = join(sibling, 'materials', 'video', '7-2.mp4')
    await mkdir(episode, { recursive: true })
    await writeFake(own, 'own-video-bytes')
    await writeFake(cross, 'cross-draft-bytes')
    // 新版剪映会把原始时间轴写在 template.json，生成时不能带过去。
    await writeFile(join(episode, 'template.json'), '{"tracks":[]}')

    const segment = (id, material, extra = []) => ({
      id, material_id: material, extra_material_refs: extra,
      source_timerange: { start: 0, duration: 1 * E6 }, target_timerange: { start: 0, duration: 1 * E6 },
    })
    await writeFile(join(episode, 'draft_info.json'), JSON.stringify({
      duration: 2 * E6,
      canvas_config: { width: 1080, height: 1920 },
      materials: {
        videos: [
          { id: 'v1', type: 'video', path: 'materials/video/own.mp4', material_name: '本集素材', has_audio: false, duration: 1 * E6 },
          { id: 'v2', type: 'video', path: 'materials/video/7-2.mp4', material_name: '别集素材', has_audio: false, duration: 1 * E6 },
        ],
        audios: [{ id: 'a1', type: 'sound', path: 'C:/Users/x/JianyingPro/User Data/Cache/music/缺.mp3', name: '片头音效' }],
        effects: [{ id: 'fx', type: 'video_effect', path: 'C:/Users/x/JianyingPro/User Data/Cache/effect/abc/effect.json', name: '滤镜' }],
        speeds: [{ id: 'sp', type: 'speed', speed: 1 }],
        canvases: [{ id: 'cv', type: 'canvas' }],
        stickers: [{ id: 'st', type: 'sticker', path: 'materials/sticker/unused.png' }],
      },
      tracks: [
        { type: 'video', segments: [
          { ...segment('s1', 'v1', ['sp', 'fx']), target_timerange: { start: 1 * E6, duration: 1 * E6 } },
          { ...segment('s2', 'v2'), target_timerange: { start: 0, duration: 1 * E6 } },
        ] },
        { type: 'audio', segments: [segment('s3', 'a1')] },
      ],
    }))

    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })
    const result = await buildSliceDraft({ episodeDir: episode, cut: { start: 0, end: 2 }, draftRoot, name: 'EP002 切片-test', cover: false, ending: { enabled: false } })

    assert.equal(result.media.linked, 1, '本集素材应复用整目录复制的结果')
    assert.equal(result.media.copied, 1, '别集素材应拷进草稿目录')
    assert.equal(result.media.missing.length, 1, '缺文件的音效应记为缺口')

    const draft = JSON.parse(await readFile(join(result.draftDir, 'draft_info.json'), 'utf8'))
    const materials = Object.entries(draft.materials).flatMap(([kind, list]) => (Array.isArray(list) ? list.map((material) => ({ kind, ...material })) : []))
    const withPath = materials.filter((material) => typeof material.path === 'string' && material.path)
    assert.ok(withPath.length >= 2, `应有带路径的素材，实际 ${withPath.length}`)
    for (const material of withPath) {
      assert.ok(isAbsolute(material.path), `${material.id} 必须是绝对路径：${material.path}`)
      assert.ok(!/^[A-Za-z]:/.test(material.path) || material.path.startsWith(result.draftDir), `${material.id} 不能指向草稿目录外：${material.path}`)
      assert.ok(existsSync(material.path), `${material.id} 的素材文件不存在：${material.path}`)
    }
    assert.equal(await readFile(join(result.draftDir, 'materials', 'video', 'own.mp4'), 'utf8'), 'own-video-bytes')
    assert.equal(await readFile(withPath.find((material) => material.id === 'v2').path, 'utf8'), 'cross-draft-bytes')
    assert.ok(withPath.some((material) => material.id === 'v2' && material.path.includes(join('materials', '_slice'))), '别集素材应落在 materials/_slice')

    // 缺文件的音效段被移除，整条音频轨随之消失；视频轨两段都在。
    assert.deepEqual(draft.tracks.map((track) => track.type), ['video'])
    assert.equal(draft.tracks[0].segments.length, 2)
    assert.ok(!materials.some((material) => material.id === 'a1'), '缺文件的素材不应留在草稿里')

    // 外部缓存特效清空 path（剪映用默认效果），仍被引用所以保留；没被引用的贴纸被剪掉。
    assert.equal(materials.find((material) => material.id === 'fx').path, '')
    assert.ok(materials.some((material) => material.id === 'sp'), '速度素材仍被引用，要保留')
    assert.ok(materials.some((material) => material.id === 'cv'), 'canvases 是工程级设置，始终保留')
    assert.ok(!materials.some((material) => material.id === 'st'), '没被引用的素材应被剪掉')

    // 剪映 11.5 读的是新版正文文件：template.json 不能留着原集，必须是这次切片的时间线。
    const template = JSON.parse(await readFile(join(result.draftDir, 'template.json'), 'utf8'))
    assert.equal(template.tracks.length, draft.tracks.length, 'template.json 必须写成本次切片的时间线')
    assert.equal(template.duration, draft.duration)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
