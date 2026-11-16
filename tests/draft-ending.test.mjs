import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { buildSliceDraft } from '../lib/slice-draft.js'
import { ffmpegPath } from '../lib/frames.js'
import { ENDING_SOUND, ENDING_TRANSITION } from '../lib/ending.js'

const exec = promisify(execFile)
const E6 = 1e6

test('切片草稿末尾自带片尾：时停定格 + 原生炫光转场 + 独立音效轨，三份正文一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-draft-ending-'))
  try {
    const project = join(root, 'project')
    const episode = join(project, 'EP007-副本')
    await mkdir(join(episode, 'materials', 'video'), { recursive: true })
    const media = join(episode, 'materials', 'video', 'EP007.mp4')
    await exec(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=30:d=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', media])
    await writeFile(join(episode, 'draft_info.json'), JSON.stringify({
      duration: 6 * E6, canvas_config: { width: 160, height: 96 },
      materials: { videos: [{ id: 'v1', type: 'video', path: 'materials/video/EP007.mp4', has_audio: true, material_name: 'EP007' }] },
      tracks: [{ type: 'video', segments: [{ id: 's1', material_id: 'v1', source_timerange: { start: 0, duration: 6 * E6 }, target_timerange: { start: 0, duration: 6 * E6 } }] }],
    }))
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })

    const draft = await buildSliceDraft({ episodeDir: episode, cut: { start: 0, end: 4 }, draftRoot, name: 'EP007-v1-abc123', cover: false, ending: {} })
    assert.ok(draft.ending, '默认要在草稿里接片尾')
    assert.equal(draft.contentDuration, 4)
    assert.ok(Math.abs(draft.duration - (4 + draft.ending.addedSeconds)) < 0.01)

    const info = JSON.parse(await readFile(join(draft.draftDir, 'draft_info.json'), 'utf8'))
    for (const file of ['draft_content.json', 'template.json']) {
      const other = JSON.parse(await readFile(join(draft.draftDir, file), 'utf8'))
      assert.equal(other.duration, info.duration, `${file} 必须与 draft_info.json 是同一份切片时间线`)
      assert.equal(other.tracks.length, info.tracks.length)
    }
    assert.ok(Math.abs(info.duration / E6 - draft.duration) < 0.01, `草稿时长 ${info.duration / E6} 应等于 ${draft.duration}`)

    const transition = (info.materials.transitions ?? []).find((item) => item.resource_id === ENDING_TRANSITION.resourceId)
    assert.ok(transition, '要有剪映原生「炫光」转场素材')
    assert.equal(transition.name, ENDING_TRANSITION.title)
    assert.equal(transition.duration, Math.round(ENDING_TRANSITION.duration * E6))
    assert.ok(existsSync(transition.path), `转场资源要落在草稿目录里：${transition.path}`)

    const photo = (info.materials.videos ?? []).find((item) => item.type === 'photo')
    assert.ok(photo && existsSync(photo.path), '定格照片要落在草稿目录里')
    const videoTrack = info.tracks.find((track) => track.type === 'video')
    const last = videoTrack.segments.at(-1)
    assert.equal(last.material_id, photo.id, '画面最后一段应是定格照片')
    assert.equal(last.target_timerange.start, 4 * E6)
    assert.ok(Math.abs(last.target_timerange.duration - draft.ending.addedSeconds * E6) <= 1000)

    const sound = (info.materials.audios ?? []).find((item) => item.resource_id === ENDING_SOUND.resourceId)
    assert.ok(sound && existsSync(sound.path), '片尾声效要落在草稿目录里')
    assert.equal(sound.name, ENDING_SOUND.title)
    const sfxTrack = info.tracks.find((track) => track.name === '片尾声效')
    assert.ok(sfxTrack, '音效要独立成轨')
    const segment = sfxTrack.segments[0]
    assert.ok(Math.abs(segment.target_timerange.start - (4 - ENDING_TRANSITION.duration / 2) * E6) <= 1000)
    assert.ok(Math.abs(segment.target_timerange.duration - sound.duration) <= 1000)
    assert.equal(segment.volume, 1)

    // 草稿里所有素材都在草稿目录内，剪映打开不会媒体丢失。
    for (const list of Object.values(info.materials)) {
      if (!Array.isArray(list)) continue
      for (const material of list) {
        if (typeof material.path === 'string' && material.path) assert.ok(existsSync(material.path), `缺素材：${material.path}`)
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
