import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alignLineToWords, cutPoints, expandSubtitleRange, matchScriptLines, refineCutByWords, snapToFrame } from '../lib/locate.js'

test('切点吸附到画面范围：片头片尾卡不吞进成片', () => {
  const cut = cutPoints({ hits: [{ subtitle: { start: 0.04, end: 54.766666, text: 'I will not go to prison' } }] }, {
    videoSegments: [
      { kind: 'photo', targetStart: 0, targetEnd: 0.033333 },
      { kind: 'video', targetStart: 0.033333, targetEnd: 54.833333 },
      { kind: 'photo', targetStart: 54.833333, targetEnd: 56.366666 },
    ],
  })
  assert.equal(cut.start, 0.033333)
  assert.equal(cut.end, 54.833333)
  assert.equal(cut.subtitleEnd, 54.766666)
})

test('剧本行 → 识别台词按顺序匹配，跨语言时覆盖率自然为 0', () => {
  const dialogue = [
    { start: 0, end: 2, text: 'You broke everything.' },
    { start: 2, end: 4, text: 'I never lied to you.' },
    { start: 4, end: 6, text: 'Then why did you hide it?' },
  ]
  const lines = [
    { index: 0, zh: '你毁了一切。', en: [{ text: 'You broke everything.' }] },
    { index: 1, zh: '我从没骗过你。', en: [{ text: 'I never lied to you.' }] },
  ]
  const matching = matchScriptLines(dialogue, lines)
  assert.equal(matching.coverage, 1)
  assert.deepEqual(matching.hits.map((hit) => [hit.from, hit.to]), [[0, 0], [1, 1]])

  const cross = matchScriptLines(dialogue, [{ index: 0, zh: '你毁了一切。', en: [] }])
  assert.equal(cross.coverage, 0, '中文剧本对英文台词不可能按字面命中')
})

test('兜底区间会撑到最短时长并压到最长时长', () => {
  const dialogue = Array.from({ length: 10 }, (_, index) => ({ start: index * 2, end: index * 2 + 2, text: `line ${index}` }))
  const short = expandSubtitleRange(dialogue, 4, 4, { minSpan: 8 })
  assert.ok(short.span >= 8)
  const long = Array.from({ length: 60 }, (_, index) => ({ start: index * 2, end: index * 2 + 2, text: `line ${index}` }))
  const trimmed = expandSubtitleRange(long, 0, 59, { maxSpan: 60 })
  assert.ok(trimmed.span <= 60)
})

test('帧对齐：向下/向上取整到 1/30 秒', () => {
  assert.equal(snapToFrame(1.01), 1)
  assert.equal(snapToFrame(1.01, 'ceil'), 1.0333333333333334)
})

/** 一句话里的逐词时间码（配乐满铺时一句话可能很长，切点要靠词级收紧）。 */
function words(list) {
  return list.map(([text, start, end]) => ({ text, start, end }))
}

test('词级对齐：剧本行只落在识别分句的后半段时，切点跟着往后收', () => {
  const utteranceWords = words([
    ['Relax', 0.44, 0.68],
    ['baby', 0.68, 0.92],
    ["I've", 1.4, 1.56],
    ['been', 1.56, 1.8],
    ['married', 1.8, 2.1],
    ['to', 2.1, 2.2],
    ['her', 2.2, 2.4],
    ['dad', 2.4, 2.7],
  ])
  const line = { index: 0, zh: '我嫁给了她爸爸。', en: [{ text: "I've been married to her dad." }] }
  const hit = alignLineToWords(line, utteranceWords)
  assert.ok(hit)
  assert.equal(hit.start, 1.4)
  assert.equal(hit.end, 2.7)
  assert.ok(hit.matched > 0.9)
})

test('词级对齐：识别文本里没有这行台词就不硬对', () => {
  const line = { index: 0, zh: '把合同还给我。', en: [{ text: 'Give me the contract back.' }] }
  assert.equal(alignLineToWords(line, words([['Hello', 0, 1], ['there', 1, 2]])), undefined)
  assert.equal(alignLineToWords(line, []), undefined)
})

test('收紧切点：首句取第一个词、末句取最后一个词，且不超出原句范围', () => {
  const dialogue = [
    { start: 0.4, end: 2.7, text: 'Relax, baby, I have been married to her dad.', words: words([['Relax', 0.44, 0.68], ['baby,', 0.68, 0.92], ['I', 1.4, 1.5], ['have', 1.5, 1.6], ['been', 1.56, 1.8], ['married', 1.8, 2.1], ['to', 2.1, 2.2], ['her', 2.2, 2.4], ['dad.', 2.4, 2.7]]) },
    { start: 3, end: 6, text: 'For six months, I know how the Jones Group moves money.', words: words([['For', 3, 3.2], ['six', 3.2, 3.4], ['months,', 3.4, 3.9], ['I', 4, 4.1], ['know', 4.1, 4.3], ['how', 4.3, 4.5], ['the', 4.5, 4.6], ['Jones', 4.6, 4.9], ['Group', 4.9, 5.2], ['moves', 5.2, 5.4], ['money.', 5.4, 5.9]]) },
  ]
  const scriptLines = [
    { index: 0, zh: '我已经嫁给她爸了。', en: [{ text: "I've been married to her dad." }] },
    { index: 1, zh: '六个月来我知道琼斯集团怎么走账。', en: [{ text: 'For six months, I know how the Jones Group moves money.' }] },
  ]
  const matched = matchScriptLines(dialogue, scriptLines)
  assert.equal(matched.hits.length, 2)

  const refined = refineCutByWords(matched, scriptLines)
  assert.ok(refined)
  assert.equal(refined.start, 1.4, '首句对齐到 I 这个词')
  assert.equal(refined.end, 5.9, '末句对齐到 money 这个词')

  const cut = cutPoints(matched, { videoSegments: [{ kind: 'video', targetStart: 0, targetEnd: 10 }] })
  assert.equal(cut.start, 0.3, '整句边界前留 0.1 秒余量（吸附到帧）')
  assert.ok(refined.start > cut.start && refined.end < cut.end)
})
