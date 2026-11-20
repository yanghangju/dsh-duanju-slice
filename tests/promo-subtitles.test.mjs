import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { locateEpisode } from '../lib/promo/align.js'
import { listSubtitleFiles, locateSubtitleTargets } from '../lib/promo/subtitles.js'
import { cleanup, ffmpeg, hasFfmpeg, makeVideo, tempDir } from './support.mjs'
import { mockAsr } from './support-asr.mjs'

const range = (id, start, end, text) => `${id}\n00:00:${start} --> 00:00:${end}\n${text}`
const line = [range(1, '00,815', '01,000', 'You never'), range(2, '01,100', '01,624', 'told me\nthe truth!')].join('\n\n')
const target = { id: 's1', zh: '你从未告诉我真相。', subtitleQuote: 'You never told me the truth.' }
const noAsr = { get volcApiKey() { throw new Error('ASR called') } }
// One request carries several windows; each starts with its own "窗口 jN｜…" text block.
const windowsIn = (content) => content.filter(({ type, text }) => type === 'text' && text.startsWith('窗口 ')).map(({ text }) => {
  const [, id] = text.match(/^窗口 (j\d+)｜/)
  const [start, end] = text.match(/本窗口([\d.]+)–([\d.]+)秒/).slice(1).map(Number)
  return { id, start, end, text }
})
const reviews = (content, make) => ({ response: JSON.stringify({ reviews: windowsIn(content).map((window) => ({ id: window.id, evidence: '画面覆盖完整台词，原镜头无追加动作', ...make(window) })) }) })

test('字幕目录优先选非副本的EP30，不猜测同优先级冲突', async (t) => {
  const dir = await tempDir('promo-subtitle-list-')
  t.after(() => cleanup(dir))
  const subtitles = join(dir, '字幕')
  await mkdir(subtitles)
  await mkdir(join(subtitles, 'EP44.srt'))
  await Promise.all(['EP01.SRT', 'EP30.srt', 'EP30(1).srt', 'EP31(1).srt', 'EP04.srt', '第4集.srt', 'EP55.txt'].map((name) => writeFile(join(subtitles, name), '')))
  assert.deepEqual(await listSubtitleFiles(subtitles), {
    1: join(subtitles, 'EP01.SRT'), 30: join(subtitles, 'EP30.srt'), 31: join(subtitles, 'EP31(1).srt'),
  })
})

test('只匹配完整连续字幕条，支持英文跨行且不猜条内子句时间', async (t) => {
  const dir = await tempDir('promo-subtitle-cues-')
  t.after(() => cleanup(dir))
  const file = join(dir, 'EP01.srt')
  const srt = [line,
    range(3, '04,100', '04,500', 'Gap'), range(4, '07,000', '07,500', 'Too long.'),
    ...[8, 9, 10, 11].map((value, i) => range(i + 5, `${String(value).padStart(2, '0')},000`, `${String(value).padStart(2, '0')},500`, '再见。')),
    range(9, '14,000', '15,000', 'Outside duration.')].join('\n\n')
  const bytes = Buffer.from('\ufeff' + srt.replaceAll('\n', '\r\n'))
  await writeFile(file, bytes)
  const { sha256, cueCount, anchors } = await locateSubtitleTargets(file, [
    target, { id: 'script-en', en: ['YOU never', 'told me the truth.'] },
    { id: 'bad-override', zh: 'You never told me the truth.', subtitleQuote: 'Wrong' },
    { id: 'phrase', en: ['told me'] }, { id: 'gap', en: ['Gap too long.'] }, { id: 'repeated', zh: '再见' },
    { id: 'outside', en: ['Outside duration'] },
  ], 14.5)
  assert.equal(cueCount, 9)
  assert.equal(sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(anchors[0].candidates, [{ start: 0.815, end: 1.624, text: 'You never told me the truth!', quote: target.subtitleQuote,
    score: 1, timing: 'cue', file, sha256, cueIds: [1, 2] }])
  assert.deepEqual(anchors[1].candidates[0]?.cueIds, [1, 2])
  assert.ok(anchors.slice(2).every(({ candidates }) => candidates.length === 0))
  assert.match(anchors[5].reason, /重复位置/)
})

test('缺失、无效或未命中的字幕自动转语音，同集命中保留字幕及画面核验', { skip: !hasFfmpeg }, async (t) => {
  const dir = await tempDir('promo-subtitle-fallback-')
  t.after(() => cleanup(dir))
  const subtitleFile = join(dir, 'EP01.srt')
  const episode = { number: 1, file: await makeVideo(dir, 'EP01.mp4', { seconds: 4, audio: true }), duration: 4 }
  const missed = { id: 's2', zh: '别动。', subtitleQuote: 'Wrong cue.' }
  const speech = await mockAsr([{ definite: true, start_time: 2500, end_time: 3000, text: 'Do not move.' }])
  t.after(() => speech.close())
  const config = { volcApiKey: 'test-key', volcEndpoint: speech.url, volcPaceMs: 0 }
  const ctx = { get: (key) => key === 'attachments' ? { saveImages: (images) => images.map(({ name }) => name) } : undefined }
  const batches = []
  const requestText = async ({ content }) => {
    assert.ok(content.some(({ type }) => type === 'image'))
    batches.push(windowsIn(content).length)
    return reviews(content, () => ({ ending: 'no-action', confidence: 0.99 }))
  }
  const locate = (targets, options = {}) => locateEpisode(ctx, ffmpeg, episode, targets, join(dir, 'review', 'cache.json'),
    { subtitleFile, config, requestText, minScore: 0.8, ...options })
  const translated = { ...missed, asrQuote: 'Do not move.' }
  const missing = await locate([translated])
  assert.match(missing.subtitle.error, /ENOENT/)
  assert.equal(missing.matches[0].asr_anchor.start, 2.5)
  assert.equal(speech.state.connections, 1)
  await writeFile(subtitleFile, range(1, '01,000', '00,500', 'Invalid bounds'))
  const invalid = await locate([translated])
  assert.match(invalid.subtitle.error, /字幕时间无效/)
  assert.ok(invalid.matches[0].asr_anchor && invalid.asr.cached)

  await writeFile(subtitleFile, line)
  const unmatched = await locate([target, missed])
  assert.ok(unmatched.matches[0].subtitle_anchor)
  assert.equal(unmatched.matches[1].found, false, 'Do not guess timestamps across languages')
  const transcript = JSON.parse(await readFile(unmatched.asr.transcriptFile, 'utf8'))
  const mixed = await locate([target, { ...missed, asrQuote: transcript.lines[0].text }])
  assert.deepEqual(mixed.asr.anchors.map(({ id }) => id), ['s2'])
  assert.deepEqual(mixed.attempts.map(({ stage }) => stage), ['subtitle-refine', 'asr-refine'])
  assert.equal(batches.at(-1), 2, 'One batched request reviews both dialogue windows')
  assert.deepEqual(mixed.matches.map(({ subtitle_anchor, asr_anchor, complete }) => [!!subtitle_anchor, !!asr_anchor, complete]),
    [[true, false, true], [false, true, true]])
  assert.equal(speech.state.connections, 1, 'Retries reuse timed transcript for the same episode')
  const unavailable = await locate([target, missed], { config: noAsr })
  assert.ok(unavailable.matches[0].complete && unavailable.matches[0].subtitle_anchor)
  assert.equal(unavailable.matches[1].found, false)
  assert.match(unavailable.matches[1].evidence, /ASR called/)
  const uncertain = await locate([target], { config: noAsr, requestText: async ({ content }) => reviews(content, () => ({
    ending: 'uncertain', confidence: 0.3, evidence: '未见同镜头动作终点',
  })) })
  assert.equal(uncertain.asr, undefined, 'A subtitle hit with uncertain action is not an ASR miss')
  assert.equal(uncertain.matches[0].found, false)
})

test('SRT锚点沿用5fps真实采帧与同镜头动作验收，缓存依赖字幕路径和文件内容', { skip: !hasFfmpeg }, async (t) => {
  const dir = await tempDir('promo-subtitle-locate-')
  t.after(() => cleanup(dir))
  const video = await makeVideo(dir, 'EP01.mp4', { seconds: 3, audio: true })
  const subtitleFile = join(dir, 'EP01.srt')
  const otherFile = join(dir, 'EP01(1).srt')
  const cache = join(dir, 'cache.json')
  const srt = line + '\n\n' + range(3, '02,300', '02,600', 'Another cue.')
  await writeFile(subtitleFile, srt)
  await writeFile(otherFile, srt)
  let calls = 0
  const stages = []
  const ctx = { get: (key) => key === 'attachments' ? { saveImages: (images) => images.map(({ name, data }) => {
    assert.ok(data.length > 0)
    return name
  }) } : undefined }
  const options = { config: noAsr, minScore: 0.8, onProgress: ({ stage }) => stages.push(stage), requestText: async ({ system, content }) => {
    calls++
    assert.match(system, /字幕锚句和剧本原句须是同一完整对白/)
    assert.match(system, /本次一次请求包含多个互不相关的局部窗口/)
    assert.match(content[0].text, /你从未告诉我真相/)
    assert.ok(content.some((item) => item.type === 'image' && item.attachment === 'video-2.000s.jpg'))
    return reviews(content, () => ({ ending: 'action-complete', end: 2, confidence: 0.9, evidence: '第2.000秒原镜头动作完成' }))
  } }
  const locate = (file) => locateEpisode(ctx, ffmpeg, { number: 1, file: video, duration: 3, has_audio: true }, [target], cache, { ...options, subtitleFile: file })
  const first = await locate(subtitleFile)
  const [match] = first.matches
  assert.deepEqual(stages, ['subtitle', 'matching', 'sampling', 'review'])
  assert.equal(first.asr, undefined)
  assert.equal(first.sampling.fps, 5)
  assert.deepEqual([match.start, match.dialogueEnd, match.end, match.ending], [0.8, 49 / 30, 2, 'action-complete'])
  assert.deepEqual(match.subtitle_anchor, first.subtitle.anchors[0].candidates[0])
  assert.equal(first.attempts[0].stage, 'subtitle-refine')
  assert.deepEqual(first.attempts[0].subtitle_anchor, match.subtitle_anchor)
  assert.equal((await locate(subtitleFile)).cached, true)
  assert.equal(calls, 1)
  const moved = await locate(otherFile)
  assert.notEqual(moved.key, first.key)
  assert.equal(moved.subtitle.sha256, first.subtitle.sha256)
  await writeFile(otherFile, srt.replace('Another cue.', 'Updated cue.'))
  const changed = await locate(otherFile)
  assert.notEqual(changed.key, moved.key)
  assert.notEqual(changed.subtitle.sha256, moved.subtitle.sha256)
  assert.equal(changed.matches[0].end, moved.matches[0].end)
  assert.equal(calls, 3)
})
