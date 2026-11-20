import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { transcribeWav, volcSettings } from '../lib/asr.js'
import { matchAsrTargets } from '../lib/promo/asr-locate.js'
import { mockAsr } from './support-asr.mjs'

const match = (lines, zh, en) => matchAsrTargets(lines, [{ id: 's1', zh, en }], 120)[0]

test('锚句来自真实ASR分句时间；缺词、过长停顿或无词级时间的子句不冒充完整句', () => {
  const lines = [
    { start: 31.21, end: 32.87, text: '你从来没有告诉过我。' },
    { start: 33.26, end: 34.31, text: '事情的真相。' },
    { start: 38, end: 40, text: 'I never wanted to see you again.' },
  ]
  assert.deepEqual(match(lines, '你从来没有告诉过我事情的真相').candidates.map(({ start, end, score }) => [start, end, score]), [[31.21, 34.31, 1]])
  assert.deepEqual(match(lines, '不想再见到你', ['I never wanted to see you again.']).candidates.map(({ start, end }) => [start, end]), [[38, 40]])
  assert.deepEqual(match(lines, '你从来没有告诉过我另一个完全不同的秘密').candidates, [])
  assert.deepEqual(match(lines, '你从来没有告诉过我 I never wanted to see you again').candidates, [])
  assert.deepEqual(match(lines, 'tell me', ['never wanted to see you']).candidates, [])
  assert.deepEqual(match([...lines, { start: 41, end: 42, text: 'overlong' }, { start: 44, end: 45, text: 'gap' }], 'overlong gap').candidates, [])
  assert.deepEqual(match([20, 30, 40, 50].map((start) => ({ start, end: start + 1, text: '再见。' })), '再见').candidates, [])
})

test('真实协议保留逐词绝对时间；提前断开即使收到definite也不可用于定位', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'promo-asr-'))
  const wav = join(dir, 'audio.wav')
  const sample = Buffer.alloc(44 + 64_000)
  sample.write('RIFF', 0); sample.writeUInt32LE(sample.length - 8, 4); sample.write('WAVEfmt ', 8)
  sample.writeUInt32LE(16, 16); sample.writeUInt16LE(1, 20); sample.writeUInt16LE(1, 22)
  sample.writeUInt32LE(16_000, 24); sample.writeUInt32LE(32_000, 28); sample.writeUInt16LE(2, 32); sample.writeUInt16LE(16, 34)
  sample.write('data', 36); sample.writeUInt32LE(sample.length - 44, 40)
  const utterances = [{ definite: true, start_time: 500, end_time: 1800, text: '别说，我相信你。', words: [
    { start_time: 500, end_time: 870, text: '别说' },
    { start_time: 910, end_time: 1010, text: '我' },
    { start_time: 1010, end_time: 1500, text: '相信' },
    { start_time: 1500, end_time: 1800, text: '你' },
  ] }]
  try {
    await writeFile(wav, sample)
    for (const finish of [true, false]) {
      const server = await mockAsr(utterances, { finish })
      try {
        const result = transcribeWav({ wav, settings: volcSettings({ volcApiKey: 'fixture', volcEndpoint: server.url, volcPaceMs: 0 }) })
        if (!finish) await assert.rejects(result, /未返回最终识别结果/)
        else {
          const { lines } = await result
          assert.deepEqual(match(lines, '我相信你').candidates.map(({ start, end, timing }) => [start, end, timing]), [[0.91, 1.8, 'word']])
          assert.equal(server.state.connections, 1)
          assert.ok(server.state.packets > 0)
        }
      } finally { await server.close() }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})
