import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { buildAss } from '../lib/ass.js'
import { ffmpegPath } from '../lib/frames.js'

test('one- and two-line exported subtitles stay centered at the reference height on each canvas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-ass-'))
  try {
    for (const [width, height] of [[1080, 1920], [720, 1280]]) {
      const outFile = join(root, `${width}.ass`)
      await buildAss({ width, height, outFile, cut: { start: 0, end: 4 }, subtitles: [
        { start: 0, end: 2, text: 'Short subtitle' },
        { start: 2, end: 4, text: 'This longer subtitle should wrap into two lines while keeping the same center position in the video' },
      ] })
      const ass = await readFile(outFile, 'utf8')
      const style = ass.split('\n').find(line => line.startsWith('Style: Sub,'))
      assert.equal(style.split(',')[18], '5', 'use a center anchor so wrapping never shifts the subtitle upward')
      const events = ass.split('\n').filter(line => line.startsWith('Dialogue:'))
      assert.equal(events.length, 2)
      for (const event of events) assert.ok(event.includes(`{\\pos(${width / 2},${Math.round(height * 0.78)})}`))
      assert.ok(events[1].includes('\\N'))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FFmpeg renders single- and double-line captions around the same visual anchor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-ass-pixels-'))
  try {
    const outFile = join(root, 'captions.ass')
    await buildAss({ width: 360, height: 640, outFile, cut: { start: 0, end: 2 }, subtitles: [
      { start: 0, end: 1, text: 'A short line' },
      { start: 1, end: 2, text: 'This is a longer subtitle that will wrap into two lines' },
    ] })
    const fontsDir = fileURLToPath(new URL('../assets/fonts', import.meta.url))
    const { stdout } = await promisify(execFile)(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=360x640:r=1:d=2', '-vf', `subtitles=filename='${outFile}':fontsdir='${fontsDir}'`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 2e6 })
    assert.equal(stdout.length, 2 * 360 * 640)
    for (let frame = 0; frame < 2; frame++) {
      let minX = 360, maxX = -1, minY = 640, maxY = -1
      for (let y = 0; y < 640; y++) for (let x = 0; x < 360; x++) {
        if (stdout[frame * 360 * 640 + y * 360 + x] < 200) continue
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      assert.ok(maxX >= minX, 'the exported frame must contain visible subtitles')
      assert.ok(Math.abs((minX + maxX) / 2 - 180) < 7)
      assert.ok(Math.abs((minY + maxY) / 2 - 640 * 0.78) < 10)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
