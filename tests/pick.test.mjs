import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickSegment } from '../lib/pick.js'

function input(lineIds) {
  const stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify({ episode: 46, lineIds, reason: '录音揭穿密谋', match: 'strong' }) }
  }
  return {
    direction: '复仇反转，约30秒',
    script: { episodes: [{ number: 46, lines: Array.from({ length: 12 }, (_, i) => ({ zh: `台词${i + 1}` })) }] },
    usableEpisodes: [{ episode: 46, duration: 55 }],
    ctx: { get: key => key === 'llm' ? { prepareCall: async () => ({ config: {}, stream }) } : { currentSelection: () => ({ provider: 'test', model: 'test' }) } },
  }
}

test('line references copied from the digest do not silently select line one', async () => {
  const pick = await pickSegment(input(['[46-4]', '46-10']))
  assert.equal(pick.start, 3)
  assert.equal(pick.end, 9)
})

test('plain numeric line numbers retain their original meaning', async () => {
  const pick = await pickSegment(input([4, 10]))
  assert.equal(pick.start, 3)
  assert.equal(pick.end, 9)
})

test('invalid or mismatched references never fall back to the opening line', async () => {
  for (const ids of [[], ['bad', 10], ['45-4', '46-10'], [10, 4], [4, 99]]) {
    await assert.rejects(pickSegment(input(ids)), /行号/)
  }
})
