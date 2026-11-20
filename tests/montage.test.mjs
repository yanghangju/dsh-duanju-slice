import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reviewMontage, reviewedWindows } from '../lib/montage.js'
import { cleanup, ffmpeg, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

test('核验只收同组实际格、足够连续的有证据画面，并拒绝重叠源窗', () => {
  let index = 0
  const groups = [[1.01, 1.21, 1.61], [1.4, 1.8, 2.4], [4.2, 4.6]].map((times) => ({
    cells: times.map((at) => ({ at, index: ++index })),
  }))
  const windows = reviewedWindows({ windows: [
    { group: 1, from: 1, to: 4, evidence: '末格来自另一组' },
    { group: 1, from: 1, to: 99, evidence: '不存在的格' },
    { group: 1, from: 1, to: 2, evidence: '太短' },
    { group: 1, from: 1, to: 3, evidence: '  ' },
    { group: 1, from: 1, to: 3, evidence: '  从抽屉取出录音笔  ' },
    { group: 2, from: 4, to: 6, evidence: '和上一段重叠' },
    { group: 3, from: 8, to: 7, evidence: '倒置末格' },
    { group: 3, from: 7, to: 8, evidence: '按下播放' },
  ] }, groups, 48)
  assert.deepEqual(windows, [
    { episode: 48, group: 1, start: 31 / 30, end: 1.6, evidence: '从抽屉取出录音笔' },
    { episode: 48, group: 3, start: 4.2, end: 4.6, evidence: '按下播放' },
  ])
})

test('从实际抽到的格选静音画面：同集避开对白，视觉独立集先各取一个', { skip: !hasFfmpeg }, async (t) => {
  const workDir = await tempDir('slice-montage-')
  t.after(() => cleanup(workDir))
  const byNumber = new Map()
  const episodes = [48, 7, 51]
  for (const episode of episodes) {
    const path = await makeVideo(workDir, `ep-${episode}.mp4`, { seconds: 9 })
    byNumber.set(episode, { episode, duration: 9, contentStart: 0, contentEnd: 9,
      videoSegments: [{ path, targetStart: 0, targetEnd: 9, sourceStart: 0, sourceEnd: 9 }] })
  }
  const cuts = [
    { episode: 48, group: 'hook', start: 2, end: 6, lastText: '谁藏了录音？' },
    { episode: 51, group: 'climax', start: 2, end: 6, firstText: '我留了原件。' },
  ]
  const attachments = {
    async saveImages([{ data, name, mediaType }]) {
      assert.equal(mediaType, 'image/jpeg')
      assert.deepEqual([...data.subarray(0, 2)], [0xff, 0xd8], '送到模型的是 ffmpeg 实际抽帧联络表')
      return [{ name }]
    },
  }
  const cells = (text) => [...text.matchAll(/(\d+)=([\d.]+)s/g)].map(([, id, time]) => ({ id: Number(id), time: Number(time) }))
  const llm = { prepareCall: async () => ({ config: {}, async *stream({ messages: [{ content: [{ text }, image] }] }) {
    let answer
    assert.match(text, /快切前最后一句：谁藏了录音？\n快切后第一句：我留了原件。/)
    if (!image) {
      assert.deepEqual(text.split('\n').filter((line) => /^\d+\./.test(line)), [
        '1. 第48集 物证 48-1', '2. 第7集 物证 7-1', '3. 第51集 物证 51-1', '4. 第48集 物证 48-2',
      ])
      answer = { order: [2, 3, 1, 4] }
    } else {
      const [, id, phase] = /^ep-(\d+)-(coarse|detail)\.jpg$/.exec(image.attachment.name)
      const available = cells(text)
      if (id !== '7') assert.ok(available.every(({ time }) => time < 2 || time > 6), `第 ${id} 集不得复用对白秒区`)
      if (phase === 'coarse') {
        answer = { cells: id === '48' ? [available[0].id, available.at(-1).id] : [available[Math.floor(available.length / 2)].id] }
      } else {
        answer = { windows: [...text.matchAll(/^组 (\d+)：(.+)$/gm)].map(([, group, line]) => {
          const detail = cells(line)
          return { group: Number(group), from: detail[0].id, to: detail[3].id, evidence: `物证 ${id}-${group}` }
        }) }
      }
    }
    yield { type: 'text-delta', text: JSON.stringify(answer) }
  } }) }
  const services = { llm, attachments }
  const result = await reviewMontage({ ctx: { get: (key) => services[key] }, provider: 'p', model: 'm',
    visualEpisodes: episodes.map((episode) => ({ episode })), byNumber, workDir, ffmpeg,
    direction: '揭穿藏录音的真相', reason: '疑问与原件前后相扣' }, cuts)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.windows.map(({ episode, group }) => [episode, group]), [[7, 1], [51, 1], [48, 1], [48, 2]])
  assert.ok(result.windows[0].start > 2 && result.windows[0].end < 6, '视觉独立集可用其他集对白占用的同一源秒点')
  for (const window of result.windows) {
    assert.ok(!cuts.some((cut) => cut.episode === window.episode && cut.start < window.end && window.start < cut.end))
  }
})
