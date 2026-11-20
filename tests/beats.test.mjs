import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeMusic, arrangeMontage, FPS, pickMusicWindow, pythonPath } from '../lib/beats.js'
import { cleanup, ffmpeg, hasFfmpeg, tempDir } from './support.mjs'

const python = pythonPath()
const hasPython = spawnSync(python, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0
const hasLibrosa = hasFfmpeg && hasPython && spawnSync(python, ['-c', 'import librosa'], { stdio: 'ignore', windowsHide: true }).status === 0

test('取连续密集乐段可跨等速分段，仍给前后原声和画面容量留足时间', () => {
  const analysis = {
    duration: 34,
    rhythm_sections: [0, 1, 7, 6].map((density, i) => ({ start: i * 8, end: (i + 1) * 8, onsets_per_second: density })),
    events: [1.25, 6.25, 8.25, 14.25, 18.25, 24.25, 25.25, 30.25].map((time) => ({ time, level: time === 25.25 ? 'major' : 'minor' })),
  }
  const limits = { before: 5, after: 9, low: 5, high: 7, target: 6.5 }
  const picked = pickMusicWindow(analysis, limits)
  assert.deepEqual([picked.start, picked.end, picked.length], [18.25, 24.25, 6])
  assert.deepEqual(picked.section, { start: 16, end: 25, density: 7 })
  assert.equal(pickMusicWindow(analysis, { ...limits, after: 0 }).end, 25.25, '有足够尾部时间才用更后面的大重音')
  assert.equal(pickMusicWindow(analysis, { ...limits, before: 20 }), undefined)
  assert.equal(pickMusicWindow(analysis, { ...limits, high: 4.99 }), undefined)
  assert.equal(pickMusicWindow({ ...analysis, rhythm_sections: [] }, limits), undefined)
})

test('固定动态规划先取大重音，再取拍点数、强度与理想时长', { skip: !hasPython }, async () => {
  const start = 18.37
  const accent = { time: start + 0.201, level: 'major', strength: 0.1 }
  const analysis = { events: [accent, ...[0.202, 1, 2, 3].map((offset) => ({ time: start + offset, level: 'minor', strength: 1 }))] }
  const shots = Array.from({ length: 3 }, () => ({ available: 1.5, ideal: 1 }))
  const arranged = await arrangeMontage({ python, analysis, start, total: 3, shots })
  assert.deepEqual(arranged.cuts.map(({ end, beat }) => [end, beat?.level ?? null]), [[0.2, 'major'], [1.6, null], [3, 'minor']])
  assert.equal(arranged.major_hits, 1)
  assert.ok(Math.abs(arranged.cuts[0].beat.time - accent.time) < 1e-9, '返回 BGM 原始秒点而非切片相对秒点')
  await assert.rejects(arrangeMontage({ python, analysis, start, total: 3, shots: [{ available: 0.19 }, ...shots.slice(1)] }), /可用素材不足/)
})

test('从真实曲库分析并缓存 BGM，从非零源偏移命中实测拍点', { skip: !hasLibrosa }, async (t) => {
  const root = await tempDir('slice-beats-')
  t.after(() => cleanup(root))
  const file = fileURLToPath(new URL('../assets/music/Epic Drums Stomp Percussion (No Copyright) - MiroMaxMusic/Epic Drums Stomp Percussion (No Copyright) [628251].mp3', import.meta.url))
  const input = { python, ffmpeg, file, cacheDir: join(root, 'cache') }
  const analysis = await analyzeMusic(input)
  assert.equal(analysis.method, 'librosa-beat-track')
  assert.equal(analysis.fallback, false)
  assert.equal(analysis.cached, false)
  assert.ok(analysis.beats.length > 20, `只找到 ${analysis.beats.length} 个拍点`)
  const cached = await analyzeMusic(input)
  assert.equal(cached.cached, true)
  assert.deepEqual(cached.events, analysis.events)

  const before = 5.2
  const after = 7.25
  const window = pickMusicWindow(analysis, { before, after, low: 5, high: 8, target: 6 })
  assert.ok(window, '内置鼓点应有至少 5 秒的实测密集段')
  const sourceStart = window.start - before
  assert.ok(sourceStart > 0)
  assert.ok(window.start >= window.section.start && window.end <= window.section.end)
  assert.ok(window.section.density > analysis.rhythm_sections[0].onsets_per_second)
  assert.ok(window.length >= 5 && window.length <= 8 && window.start + window.length + after <= analysis.duration)
  assert.ok(analysis.events.some(({ time }) => time === window.start))
  assert.ok(analysis.events.some(({ time }) => time === window.end))

  const shots = Array.from({ length: 8 }, () => ({ available: 1.2, ideal: window.length / 8 }))
  const arranged = await arrangeMontage({ python, analysis, start: window.start, total: window.length, shots })
  assert.equal(arranged.cuts.length, shots.length)
  assert.ok(Math.abs(arranged.total - window.length) < 1e-6)
  assert.ok(arranged.major_hits > 0)
  assert.ok(arranged.cuts.at(-1).beat, '末刀应落在真实拍点上')
  for (const [i, cut] of arranged.cuts.entries()) {
    assert.equal(cut.start, arranged.cuts[i - 1]?.end ?? 0)
    assert.ok(cut.duration >= 0.2 - 1e-6 && cut.duration <= shots[i].available + 1e-6)
    if (cut.beat) {
      assert.ok(analysis.events.some(({ time, level }) => level === cut.beat.level && Math.abs(time - cut.beat.time) < 1e-9))
      assert.ok(Math.abs(sourceStart + before + cut.end - cut.beat.time) <= 0.5 / FPS + 1e-6)
    }
  }
})
