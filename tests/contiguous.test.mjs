import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { transcribeEpisode, volcSettings } from '../lib/asr.js'
import { cutContiguous, reviseContiguous } from '../lib/contiguous.js'
import { buildDocx } from '../lib/docx.js'
import { planSegments, readDraft } from '../lib/slice-draft.js'
import { cleanup, exec, ffmpeg, ffprobe, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

// Seed only the same version/fingerprint as transcribeFile; no service or network calls.
const configFor = (workDir) => ({
  ffmpegPath: ffmpeg, ffprobePath: ffprobe, workDir,
  volcEndpoint: 'ws://127.0.0.1:1/contiguous-cache-test',
  getAsrApiKey: () => { throw new Error('fixture transcript cache miss') },
})

async function seedTranscript(file, config, duration, lines) {
  const { endpoint, resourceId } = volcSettings(config)
  const { size, mtimeMs: mtime } = await stat(file)
  const version = 3
  const key = createHash('sha1').update(JSON.stringify({ file, size, mtime, version, endpoint, resourceId })).digest('hex')
  const cache = join(config.workDir, 'cache', 'asr')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, `${key}.json`), JSON.stringify({ version, duration, lines }))
}

test('切片参数必须只指定一种选法；修订必须有时间边界', async () => {
  const args = { dramaDir: 'material', exportDir: 'output' }
  for (const [selection, message] of [
    [{ episode: 1, start: 0, end: 2, lines: [1, 2] }, /二选一/],
    [{ start: 0, end: 2 }, /正整数集号/],
    [{ episode: 1 }, /请同时给出/],
    [{ episode: 1, start: 0 }, /必须是原集内/],
    [{ episode: 1, start: -1, end: 2 }, /必须是原集内/],
    [{ episode: 1, scriptPath: 'script.docx', lines: [2, 1] }, /按先后顺序/],
    [{ direction: '复仇' }, /DOCX 剧本/],
  ]) await assert.rejects(cutContiguous({ args: { ...args, ...selection } }), message)
  await assert.rejects(reviseContiguous({ current: {}, args: { note: '换剧情' } }), /需要提供 start 或 end/)
})

test('已缓存的逐词时间码随分段偏移；静音文件不用识别', async (t) => {
  const dir = await tempDir('slice-cache-')
  t.after(() => cleanup(dir))
  const config = configFor(dir)
  const first = join(dir, 'first.mp4')
  const second = join(dir, 'second.mp4')
  const silent = join(dir, 'silent.mp4')
  for (const file of [first, second]) {
    await writeFile(file, '')
    await seedTranscript(file, config, 5, [{ start: 1, end: 3, text: '台词', words: [{ start: 1.5, end: 2.5, text: '台词' }] }])
  }
  const result = await transcribeEpisode({
    parts: [{ path: first }, { path: silent, hasAudio: false }, { path: second }],
    videoSegments: [{ path: first, targetStart: 0 }, { path: second, targetStart: 8, sourceStart: 0.5 }],
  }, { cacheDir: join(dir, 'cache'), config })
  assert.equal(result.cached, true)
  assert.equal(result.billedSeconds, 0)
  assert.deepEqual(result.lines.map(({ start, end, words }) => [start, end, words[0].start, words[0].end]), [[1, 3, 1.5, 2.5], [8.5, 10.5, 9, 10]])
})

test('草稿规划保留跨文件的一帧，并将时间线归零', () => {
  const first = { path: 'ep1-part-2.mp4', targetStart: 0, targetEnd: 12, sourceStart: 0 }
  const second = { path: 'ep1-part-10.mp4', targetStart: 12, targetEnd: 16, sourceStart: 0 }
  const start = 12 - 1 / 30
  const parts = planSegments({ videoSegments: [first, second] }, { start, end: start + 2 })
  assert.deepEqual(parts.map(({ part }) => part), [first, second])
  assert.equal(parts[0].source.start, start)
  assert.equal(parts[0].target.start, 0)
  assert.equal(Math.round(parts[1].target.start * 30), 1)
  assert.equal(parts[1].source.start, 0)
})

test('连续窗跨同集文件保留原顺序、边界一帧和静音尾；可离线选段并非破坏性修订', { skip: !hasFfmpeg }, async (t) => {
  const dir = await tempDir('slice-media-')
  t.after(() => cleanup(dir))
  const dramaDir = join(dir, 'source')
  const episodeDir = join(dramaDir, 'EP01')
  const draftRoot = join(dir, 'drafts')
  const exportDir = join(dir, 'exports')
  await mkdir(episodeDir, { recursive: true })
  await mkdir(draftRoot)
  const first = await makeVideo(episodeDir, 'part-2.mp4', { seconds: 12, audio: true })
  const second = join(episodeDir, 'part-10.mp4')
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=160x96:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', second])
  const distractor = await makeVideo(dramaDir, 'EP02.mp4', { seconds: 4, audio: true })
  const config = configFor(join(dir, 'work'))
  const args = { dramaDir, exportDir, draftRoot }
  const start = 12 - 1 / 30
  const end = start + 2
  let picks = 0
  const ctx = { get(key) {
    if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
    if (key === 'llm') return {
      async prepareCall() {
        picks += 1
        return { async *stream() { yield { type: 'text-delta', text: '{"episode":1,"lineIds":[1,2],"reason":"揭穿谎言","match":"strong"}' } } }
      },
    }
  } }
  const clip = await cutContiguous({ args: { ...args, episode: 1, start, end }, config })
  assert.equal(clip.result.sourceDuration, 16)
  assert.equal(clip.video.audioSegments, 1)
  assert.equal(clip.video.ending, null)
  const draft = await readDraft(clip.result.draftDir)
  assert.equal(draft.duration, 2_000_000)
  assert.deepEqual(draft.tracks.map(({ type }) => type), ['video'])
  assert.deepEqual(draft.materials.videos.map(({ path, duration }) => [path, duration]), [[first, 12_000_000], [second, 4_000_000]])
  assert.deepEqual(draft.tracks[0].segments.map(({ source_timerange, target_timerange, volume }) => [source_timerange, target_timerange, volume]), [
    [{ start: 11_966_667, duration: 33_333 }, { start: 0, duration: 33_333 }, 1],
    [{ start: 0, duration: 1_966_667 }, { start: 33_333, duration: 1_966_667 }, 1],
  ])
  const readPixel = async (at) => (await exec(ffmpeg, ['-v', 'error', '-ss', at, '-i', clip.result.outFile, '-frames:v', '1', '-vf', 'scale=2:2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' })).stdout
  const [r0, , b0] = await readPixel('0')
  const [r1, , b1] = await readPixel('1.5')
  assert.ok(r0 > 220 && b0 < 35 && b1 > 220 && r1 < 35, '第一帧来自 part-2，静音尾来自 part-10')
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', clip.result.outFile])
  for (const kind of ['video', 'audio']) assert.ok(Number(JSON.parse(stdout).streams.find(({ codec_type }) => codec_type === kind)?.duration) >= 1.966)
  await assert.rejects(cutContiguous({ args: { ...args, episode: 1, start: 14, end: 17 }, config }), /不能超出原集/)

  const unusableRoot = join(dir, 'not-a-draft-directory')
  await writeFile(unusableRoot, '')
  const next = await reviseContiguous({ current: { ...clip.result, draftRoot: unusableRoot }, args: { start: 3 - start, end: 6 - start }, config, version: 2 })
  assert.equal(next.result.episode, 1)
  assert.equal(next.result.start, 3)
  assert.equal(next.result.end, 6)
  assert.equal(next.draft, null)
  assert.equal(next.result.draftDir, null)
  assert.match(next.summary, /未保存可编辑草稿/)
  assert.notEqual(next.result.outFile, clip.result.outFile)
  assert.ok((await stat(clip.result.outFile)).size > 0)
  assert.equal((await readdir(exportDir)).some((name) => name.startsWith('.slice-draft-')), false)

  const lines = ['你必须告诉大家所有真相。', '这一次我绝不会再次原谅你。', '明天再去远方旅行。']
  const scriptPath = join(dir, 'script.docx')
  const paragraphs = ['第1集', ...lines.map((line) => `主角：${line}`), '第2集', '旁白：这不是选中的一集。']
  await writeFile(scriptPath, buildDocx(paragraphs.map((text) => ({ type: 'p', text }))))
  await seedTranscript(first, config, 12, [
    { start: 0.2, end: 3, text: lines[0], words: [{ start: 1.2, end: 2.5, text: lines[0] }] },
    { start: 8, end: 11.5, text: lines[1], words: [{ start: 8.8, end: 10.8, text: lines[1] }] },
  ])
  const progress = []
  const planned = await cutContiguous({ ctx, config, args: { ...args, scriptPath, direction: '揭穿谎言', verify: false }, onProgress: (stage) => progress.push(stage) })
  assert.deepEqual(progress, ['survey', 'pick', 'asr', 'draft', 'render'])
  assert.equal(picks, 1)
  assert.equal(planned.result.episode, 1)
  assert.equal(planned.plan.cut.wordRefined, true)
  assert.ok(planned.result.start >= 1 && planned.result.end <= 11)
  assert.deepEqual(planned.draft.media.files, [first])
  assert.ok(!planned.draft.media.files.includes(distractor))
  assert.equal(planned.plan.asr.cached, true)
  await assert.rejects(cutContiguous({ args: { ...args, scriptPath, episode: 1, lines: [1, 4], verify: false }, config }), /只有 3 行台词/)
  await assert.rejects(cutContiguous({ args: { ...args, scriptPath, episode: 1, lines: [1, 3], verify: false }, config }), /未匹配到指定首尾台词/)
})
