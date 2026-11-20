// 直接剪辑链路：镜头清单 → 选曲 → 草稿（快切静音 + 完整对白 + 固定 −5 dB BGM）→ 成片。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { BGM_GAIN } from '../lib/audio.js'
import { listEpisodes } from '../lib/drama-source.js'
import { generateText } from '../lib/model.js'
import { libraryDigest, loadLibrary, pickTrack, resolveTrack } from '../lib/music-library.js'
import { contentDuration, dialogueShot, formatShots, montageShots, shot, sourceTimeAt, timeline } from '../lib/shots.js'
import { buildSliceDraft, readDraft } from '../lib/slice-draft.js'
import { renderSlice } from '../lib/render.js'
import { cleanup, exec, ffmpeg, ffprobe, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

test('镜头清单累加时间线，快切静音，可保留不足一秒的完整短句', () => {
  const shots = [
    shot({ kind: 'montage', episode: 2, sourceStart: 10, sourceEnd: 10.5, volume: 0 }),
    dialogueShot(2, { start: 12, end: 20 }),
  ]
  const { shots: list, total } = timeline(shots)
  assert.equal(total, 8.5)
  assert.deepEqual(list.map((item) => [item.targetStart, item.targetEnd]), [[0, 0.5], [0.5, 8.5]])
  assert.equal(contentDuration(shots), 8.5)
  assert.match(formatShots(shots), /快切 第2集.*静音卡点/)
  assert.equal(dialogueShot(2, { start: 5, end: 5.5 }).duration, 0.5)
  assert.throws(() => dialogueShot(2, { start: 5, end: 5.1 }), /切点区间无效/)
})

test('曲库按目录读 description.txt，主库优先', async () => {
  const root = await tempDir('slice-music-')
  try {
    const music = join(root, 'music')
    for (const [directory, library, text] of [['Warm Story', 'primary', '情绪：温暖\n适用场景：家庭重聚'], ['Dark Trailer', 'secondary', '情绪：压迫\n适用场景：报复']]) {
      await mkdir(join(music, directory), { recursive: true })
      await writeFile(join(music, directory, 'track.mp3'), 'fake')
      await writeFile(join(music, directory, 'description.txt'), text, 'utf8')
    }
    await writeFile(join(music, 'music_library.json'), JSON.stringify([{ directory: 'Warm Story', library: 'primary' }, { directory: 'Dark Trailer', library: 'secondary' }]), 'utf8')
    const { tracks } = await loadLibrary(music)
    assert.equal(tracks.length, 2)
    assert.equal(tracks[0].library, 'primary')
    assert.match(tracks[0].style, /温暖/)
    assert.match(libraryDigest(tracks), /Warm Story/)
    assert.equal(resolveTrack(tracks, 'Dark Trailer').directory, 'Dark Trailer')
  } finally {
    await cleanup(root)
  }
})

test('选曲把模型的文本答案交给 JSON 解析（回归：曾把 {response} 整个对象丢进去）', async () => {
  const tracks = [
    { directory: 'Warm Story', library: 'primary', style: '情绪：温暖；适用场景：家庭重聚' },
    { directory: 'Dark Trailer', library: 'secondary', style: '情绪：压迫；适用场景：报复' },
  ]
  const answer = '```json\n{"directory":"Dark Trailer","reason":"报复戏要压迫感"}\n```'
  const llm = {
    prepareCall: async () => ({
      config: {},
      stream: async function* () {
        yield { type: 'text-delta', text: answer }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const ctx = { get: (key) => (key === 'llm' ? llm : undefined) }
  const picked = await pickTrack({ tracks, direction: '复仇：当众揭穿', ctx, provider: 'p', model: 'm' })
  assert.equal(picked.directory, 'Dark Trailer')
  assert.equal(picked.by, 'model')
  assert.match(picked.reason, /压迫/)

  // 模型不可用时也不能抛错，按方向关键词兜底。
  const failed = { get: (key) => (key === 'llm' ? { prepareCall: async () => { throw new Error('额度用完') } } : undefined) }
  const backup = await pickTrack({ tracks, direction: '温暖的家庭重聚', ctx: failed, provider: 'p', model: 'm' })
  assert.equal(backup.by, 'fallback')
  assert.match(backup.reason, /额度用完/)
})

test('generateText 只返回文本（避免调用方把整个返回对象丢进 JSON 解析）', async () => {
  const llm = {
    prepareCall: async () => ({
      config: {},
      stream: async function* () {
        yield { type: 'text-delta', text: '{"ok":true}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const ctx = { get: (key) => (key === 'llm' ? llm : undefined) }
  const text = await generateText(ctx, { provider: 'p', model: 'm', system: 's', user: 'u' })
  assert.equal(typeof text, 'string')
  assert.deepEqual(JSON.parse(text), { ok: true })
})

test('快切不得截短拍点时长；定格从剪后时间回查源时间', () => {
  const windows = [{ start: 42, end: 44 }, { start: 45, end: 47 }, { start: 50, end: 53 }]
  const montage = montageShots(3, windows, [1.5, 1.5, 2.5])
  assert.deepEqual(montage.map((item) => item.sourceEnd), [43.5, 46.5, 52.5])
  assert.ok(montage.every((item) => item.volume === 0 && item.episode === 3))
  assert.throws(() => montageShots(3, windows, [2.1, 1.5, 2.5]), /超出已核验/)
  const shots = [dialogueShot(3, { start: 21, end: 40 }), ...montage, dialogueShot(3, { start: 54, end: 55 })]
  assert.equal(sourceTimeAt(shots, contentDuration(shots) - 1.5), 52)
})

test('写草稿前拒绝未知集、越界、画面空档和重复源镜头', async () => {
  const root = await tempDir('slice-invalid-shots-')
  try {
    const path = join(root, 'ep007.mp4')
    await writeFile(path, '')
    const episode = { episode: 7, contentStart: 1, contentEnd: 80, parts: [{ path }], videoSegments: [
      { path, targetStart: 0, targetEnd: 20, sourceStart: 0, sourceEnd: 20 },
      { path, targetStart: 30, targetEnd: 80, sourceStart: 30, sourceEnd: 80 },
    ] }
    const other = { ...episode, episode: 8, contentEnd: 16 }
    const input = { episode, draftRoot: root, name: 'invalid' }
    const first = dialogueShot(7, { start: 12, end: 18 })
    await assert.rejects(buildSliceDraft({ ...input, shots: [first, { ...first, episode: 8 }] }), /未知原集：第 8 集/)
    await assert.rejects(buildSliceDraft({ ...input, episodes: [other], shots: [{ ...first, episode: 8 }] }), /超出第 8 集/)
    await assert.rejects(buildSliceDraft({ ...input, shots: [{ ...first, sourceStart: 0 }] }), /超出第 7 集/)
    await assert.rejects(buildSliceDraft({ ...input, shots: [{ ...first, sourceEnd: 35 }] }), /没有完整的源画面/)
    await assert.rejects(buildSliceDraft({ ...input, shots: [first, { ...first, kind: 'montage', volume: 0 }] }), /重复使用了相同的源画面/)
  } finally {
    await cleanup(root)
  }
})

test('草稿按镜头铺画面并挂固定 −5 dB BGM 轨', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-edit-')
  try {
    const fixture = await episodeFixture(root)
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })
    const bgmFile = await makeMusic(join(root, 'bgm.mp3'))
    const shots = [
      shot({ kind: 'montage', episode: 7, sourceStart: 0.2, sourceEnd: 0.6, volume: 0 }),
      shot({ kind: 'montage', episode: 7, sourceStart: 1.0, sourceEnd: 1.4, volume: 0 }),
      dialogueShot(7, { start: 1.6, end: 3.4 }),
    ]
    const result = await buildSliceDraft({
      episode: fixture, shots, bgm: { title: '测试曲', file: bgmFile }, draftRoot, name: 'edit', ffmpeg, cover: false, ending: { enabled: false },
    })
    assert.equal(result.contentDuration, 2.6)
    // 第三个镜头跨了两个源文件，所以画面段比镜头多一段
    assert.equal(result.tracks[0].segments, 4)
    const draft = await readDraft(result.draftDir)
    assert.equal(draft.tracks[0].segments.filter((segment) => segment.volume === 0).length, 2)
    const audio = draft.tracks.find((track) => track.type === 'audio')
    assert.ok(audio, '草稿里应有 BGM 音轨')
    assert.ok(Math.abs(audio.segments[0].volume - BGM_GAIN) < 1e-6)
    const music = draft.materials.audios.find((material) => material.type === 'extract_music')
    assert.equal(music.path, bgmFile)
    // BGM 在片尾前收掉：留出转场半步，淡出 0.6s
    assert.ok(Math.abs(audio.segments[0].target_timerange.duration / 1e6 - 2.2) < 0.01)
    const fadeRef = audio.segments[0].extra_material_refs
      .map((ref) => draft.materials.audio_fades.find((item) => item.id === ref))
      .find(Boolean)
    assert.ok(fadeRef, 'BGM 片段应挂 audio_fade 材质')
    assert.ok(Math.abs(fadeRef.fade_out_duration / 1e6 - 0.6) < 1e-6)
  } finally {
    await cleanup(root)
  }
})

test('成片：快切 + 对白 + BGM 混在一起，按时长渲染', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-render-edit-')
  try {
    const fixture = await episodeFixture(root)
    const draftRoot = join(root, 'drafts')
    await mkdir(draftRoot, { recursive: true })
    const bgmFile = await makeMusic(join(root, 'bgm.mp3'))
    const shots = [
      shot({ kind: 'montage', episode: 7, sourceStart: 0.2, sourceEnd: 0.6, volume: 0 }),
      dialogueShot(7, { start: 1.6, end: 3.4 }),
    ]
    const draft = await buildSliceDraft({
      episode: fixture, shots, bgm: { title: '测试曲', file: bgmFile }, draftRoot, name: 'render', ffmpeg, cover: false, ending: { enabled: false },
    })
    const outFile = join(root, 'out.mp4')
    const video = await renderSlice({
      episodeDir: draft.draftDir,
      cut: { start: 0, end: draft.contentDuration },
      outFile, ffmpeg, ffprobe, ending: { enabled: false },
    })
    assert.ok(Math.abs(video.duration - 2.2) < 0.2, `成片时长 ${video.duration}`)
    assert.equal(video.audioSegments, 3)
    const probed = await probeDuration(ffprobe, outFile)
    assert.ok(Math.abs(probed - 2.2) < 0.25, `实测时长 ${probed}`)
  } finally {
    await cleanup(root)
  }
})

test('跨集草稿及成片遵循编排顺序，封面、时停、BGM 偏移命中实际素材', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-render-multiep-')
  try {
    const dramaDir = join(root, 'sources')
    await mkdir(dramaDir)
    for (const [number, base, changed, at] of [
      [47, 'red', 'lime', 0.4], [7, 'blue', 'magenta', 1.3], [10, 'white', 'yellow', 1.7], [48, 'cyan', 'cyan', 0],
    ]) {
      await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${base}:s=160x96:r=30:d=3`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-vf', `drawbox=color=${changed}:t=fill:enable='gte(t,${at})'`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', join(dramaDir, `ep${number}.mp4`)])
    }
    const { episodes } = await listEpisodes({ dramaDir, ffprobe })
    const shots = [
      { kind: 'montage', episode: 47, sourceStart: 0.5, sourceEnd: 1.1, volume: 0 },
      dialogueShot(7, { start: 1.4, end: 2.4 }),
      { kind: 'montage', episode: 7, sourceStart: 0.5, sourceEnd: 1.5, volume: 0 },
      dialogueShot(10, { start: 1.4, end: 2.3 }),
      dialogueShot(48, { start: 1, end: 2 }),
    ]
    const bgm = { file: join(root, 'music.wav'), duration: 6, sourceStart: 1.5 }
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=320:duration=6',
      '-af', "volume=0:enable='lt(t,1.2)'", '-y', bgm.file])
    const canvas = { width: 90, height: 160 }
    const result = await buildSliceDraft({ episode: episodes.find((item) => item.episode === 7), episodes, shots,
      draftRoot: root, name: 'multiep', canvas, bgm, ffmpeg })
    assert.equal(result.contentDuration, 4.5)
    assert.deepEqual(result.shots.map((item) => item.episode), [47, 7, 7, 10, 48])
    assert.deepEqual(result.media.files, [47, 7, 10, 48].map((number) => join(dramaDir, `ep${number}.mp4`)))

    const draft = await readDraft(result.draftDir)
    assert.deepEqual(draft.canvas_config, { ...canvas, ratio: 'original' })
    const music = draft.tracks.find((track) => track.name === '剧情 BGM').segments[0]
    assert.deepEqual(music.source_timerange, { start: 1_500_000, duration: 4_100_000 })
    assert.deepEqual(music.target_timerange, { start: 0, duration: 4_100_000 })
    assert.equal(music.speed, 1)
    assert.equal(music.volume, BGM_GAIN)
    assert.equal(result.bgm.sourceStart, 1.5)
    assert.deepEqual(await frameColor(result.cover), [0, 1, 0])  // 第 47 集 0.6s，而不是主集或第 47 集片头
    const photo = draft.materials.videos.find((item) => item.type === 'photo')
    assert.deepEqual(await frameColor(photo.path), [1, 1, 0])  // E−1.5s 回跨到第 10 集 1.8s
    assert.equal(draft.tracks.find((track) => track.name === '片尾声效').segments[0].target_timerange.start, 4_100_000)

    const outFile = join(root, 'out.mp4')
    const video = await renderSlice({ episodeDir: result.draftDir, cut: { start: 0, end: result.contentDuration },
      outFile, ffmpeg, ffprobe, ending: { enabled: false } })
    assert.equal(video.videoSegments, 5)
    assert.equal(video.dialogueFromVideo, 3)
    assert.ok(Math.abs(await probeDuration(ffprobe, outFile) - 4.5) < 0.1)
    for (const [at, color] of [[0.2, [0, 1, 0]], [0.8, [1, 0, 1]], [2, [0, 0, 1]], [3.1, [1, 1, 0]], [4, [0, 1, 1]]]) {
      assert.deepEqual(await frameColor(outFile, at), color, `成片 ${at}s 画面`)
    }
    // 首个镜头静音，只有音乐；如果忽略音乐偏移，这里仍是曲目开头的静音。
    const { stderr } = await exec(ffmpeg, ['-hide_banner', '-ss', '0.1', '-t', '0.3', '-i', outFile, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    assert.ok(Number(/max_volume:\s*(-?[\d.]+) dB/.exec(stderr)?.[1]) > -40, 'BGM 从偏移位置开始，不是曲首静音')
  } finally {
    await cleanup(root)
  }
})

async function frameColor(file, at = 0) {
  const { stdout } = await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', file,
    '-vf', 'crop=2:2,format=rgb24', '-frames:v', '1', '-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' })
  assert.equal(stdout.length, 12, `实测 ${at}s RGB 帧`)
  return [...stdout.subarray(0, 3)].map((value) => Number(value > 128))
}

async function episodeFixture(dir) {
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

async function makeMusic(outFile) {
  await exec(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=320:duration=6', '-ac', '2', '-ar', '48000', outFile])
  return outFile
}

async function probeDuration(bin, file) {
  const { stdout } = await exec(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  return Number(stdout.trim())
}
