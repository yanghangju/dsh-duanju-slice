import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickStory, storyCandidates, timedSentences } from '../lib/story.js'

const timelines = new Map([
  [48, [
    { start: 3.4, end: 5.4, text: 'Who hid the recording?' },
    { start: 9, end: 11, text: 'We need the original.' },
  ]],
  [46, [
    { start: 3.4, end: 5.4, text: 'I kept an uncut copy.' },
    { start: 9, end: 11, text: 'Listen to the end.' },
  ]],
  [51, [
    { start: 0.3, end: 0.9, text: 'Play it now.' },
    { start: 1.3, end: 3.8, text: 'Yes, I hid it to cover up the missing deed.' },
  ]],
].map(([episode, lines]) => [episode, {
  episode: { episode, contentStart: 0, contentEnd: 30 }, lines,
  script: { lines: ['剧本铺垫', '录音重现', '剧本第三行，未识别'].map((zh) => ({ speaker: '艾米', zh })) },
}]))
const edit = { hook: [[48, 1, 1]], climax: [[46, 1, 1], [51, 2, 2]], reason: '质问谁藏了录音，用原件与当事人承认兑现', match: 'strong' }

test('各集真实 ASR 独立编号；按原声钩子、原件、承认铺排，不按集号或源秒数重排', async () => {
  const requests = []
  const replies = [{ edits: [{ ...edit, climax: [[46, 3, 3]] }] }, { edits: [edit] }]
  const llm = { prepareCall: async () => ({
    config: {},
    async *stream(request) {
      requests.push(request)
      yield { type: 'text-delta', text: JSON.stringify(replies[requests.length - 1]) }
    },
  }) }
  const ctx = { get: (key) => key === 'llm' ? llm : undefined }
  const result = await pickStory({ ctx, provider: 'p', model: 'm', timelines, budget: 8, direction: '揭开录音真相' })
  assert.equal(requests.length, 2)
  const prompt = requests[0].messages[0].content[0].text
  assert.match(prompt, /第 48 集真实 ASR：\n1\. 3\.40–5\.40s Who hid the recording\?/)
  assert.match(prompt, /第 46 集真实 ASR：\n1\. 3\.40–5\.40s I kept an uncut copy\./)
  assert.match(prompt, /第 51 集真实 ASR：\n1\. [^\n]+\n2\. 1\.30–3\.80s Yes, I hid it/)
  assert.match(prompt, /剧本第三行，未识别/)
  assert.match(requests[1].messages[0].content[0].text, /无效的台词引用 \[46,3,3\]/)
  assert.deepEqual(result.cuts.map(({ group, episode, from, to }) => [group, episode, from, to]), [
    ['hook', 48, 1, 1], ['climax', 46, 1, 1], ['climax', 51, 2, 2],
  ])
  assert.equal(result.cuts[0].start, result.cuts[1].start, '相同秒点但不同源集可同时采用')
  assert.ok(result.cuts[2].start < result.cuts[0].start, '高潮即使源秒点更早也放在钩子后')
  assert.equal(result.dialogueText, 'Who hid the recording? I kept an uncut copy. Yes, I hid it to cover up the missing deed.')
  assert.equal(result.reason, edit.reason)
})

test('先按内容方向匹配度，再偏好多集覆盖，不因单集版更短而换掉', () => {
  const one = { ...edit, climax: [[48, 2, 2]], reason: '单集继续追问原件' }
  const partial = { ...edit, match: 'partial', reason: '跨集但没有完全兑现' }
  const choices = storyCandidates([partial, one, edit], { timelines, budget: 8 })
  assert.deepEqual(choices.map(({ reason, coverage }) => [reason, coverage]), [[edit.reason, 3], [one.reason, 1], [partial.reason, 3]])
  assert.ok(choices[0].duration > choices[1].duration && choices[0].duration <= 8)
  assert.ok(Math.abs(choices[0].duration - choices[0].cuts.reduce((sum, { start, end }) => sum + end - start, 0)) < 1e-6)
})

test('拒绝缺少高潮、错集引用、同源镜头重叠及超过对白预算', () => {
  const rejected = []
  assert.deepEqual(storyCandidates([
    { ...edit, climax: [] },
    { ...edit, climax: [[49, 1, 1]] },
    { ...edit, climax: [[48, 1, 2]] },
    edit,
  ], { timelines, budget: 6, rejected }), [])
  assert.equal(rejected.length, 4)
  assert.match(rejected[0], /原声钩子.*原声高潮/)
  assert.match(rejected[1], /无效的台词引用 \[49,1,1\]/)
  assert.match(rejected[2], /第 48 集.*重叠/)
  assert.match(rejected[3], /不在 3–6 秒预算内/)
})

test('在安全帧上保留不足一秒的短反问，不吞字、不重复源画面', () => {
  const lines = [
    { start: 3, end: 6, text: 'You said you would have proof.' },
    { start: 6.02, end: 6.55, text: 'Got proof?' },
    { start: 15, end: 16.7, text: 'I recorded everything.' },
  ]
  const local = new Map([[48, { ...timelines.get(48), lines }]])
  const candidate = { ...edit, hook: [[48, 1, 1], [48, 2, 2]], climax: [[48, 3, 3]] }
  const [story] = storyCandidates([candidate], { timelines: local, budget: 8 })
  const [first, question] = story.cuts
  assert.equal(first.end, question.start)
  assert.ok(question.start <= lines[1].start && question.end >= lines[1].end)
  assert.ok(question.end - question.start < 1)
  const rejected = []
  assert.deepEqual(storyCandidates([{ ...candidate, hook: [[48, 2, 2]] }], { timelines: local, budget: 8, rejected }), [])
  assert.match(rejected[0], /不在 3–8 秒预算内/)
})

test('只有精确词级时间码才拆完整句，对不齐就保留原识别段', () => {
  const line = { start: 4, end: 11, text: 'I paid. You lied.', words: [
    { text: 'I', start: 4.5, end: 4.8 }, { text: 'paid', start: 5, end: 5.9 },
    { text: 'You', start: 7.3, end: 7.6 }, { text: 'lied', start: 8, end: 9 },
  ] }
  assert.deepEqual(timedSentences([line]), [
    { text: 'I paid.', start: 4.5, end: 5.9, wordRefined: true },
    { text: 'You lied.', start: 7.3, end: 9, wordRefined: true },
  ])
  const incomplete = { ...line, words: line.words.slice(1) }
  assert.deepEqual(timedSentences([incomplete]), [incomplete])
})
