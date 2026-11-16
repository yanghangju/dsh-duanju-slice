import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { renderSlice } from '../lib/render.js'
import { ffmpegPath, ffprobePath } from '../lib/frames.js'
import { ENDING_SOUND, ENDING_TRANSITION } from '../lib/ending.js'

const exec = promisify(execFile)
const ffmpeg = ffmpegPath()
const ffprobe = ffprobePath(ffmpeg)

const duration = async (file) => {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number(stdout.trim())
}

const frame = async (file, at) => {
  const { stdout } = await exec(ffmpeg, ['-v', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

const meanAbsDiff = (a, b) => {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index++) sum += Math.abs(a[index] - b[index])
  return sum / length
}

const audioRms = async (file, from) => {
  const { stdout } = await exec(ffmpeg, ['-v', 'error', '-ss', from.toFixed(3), '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4)
  if (!samples.length) return 0
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
}

async function draftOf(dir, seconds) {
  const media = join(dir, 'motion.mp4')
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=160x96:r=30:d=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', media])
  await writeFile(join(dir, 'draft_info.json'), JSON.stringify({
    duration: seconds * 1e6, canvas_config: { width: 160, height: 96 },
    materials: { videos: [{ id: 'video', type: 'video', path: media }] },
    tracks: [{ type: 'video', segments: [{ id: 'main', material_id: 'video', source_timerange: { start: 0, duration: seconds * 1e6 }, target_timerange: { start: 0, duration: seconds * 1e6 } }] }],
  }))
  return media
}

test('slice export ends with freeze + native 炫光 + full 大气片尾声效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slice-ending-'))
  try {
    await draftOf(dir, 3)
    const outFile = join(dir, 'with-ending.mp4')
    const result = await renderSlice({ episodeDir: dir, cut: { start: 0, end: 3 }, outFile, burnSubtitles: false, ffmpeg })

    assert.ok(result.ending, '默认必须接片尾')
    assert.equal(result.ending.title, ENDING_SOUND.title)
    assert.equal(result.ending.resourceId, ENDING_SOUND.resourceId)
    assert.equal(result.ending.transitionSeconds, ENDING_TRANSITION.duration)
    assert.equal(result.ending.freezeOffsetSeconds, 1.5)
    assert.ok(result.ending.soundSeconds > 4 && result.ending.soundSeconds < 5, `音效时长 ${result.ending.soundSeconds}`)
    assert.equal(result.contentDuration, 3)
    assert.ok(Math.abs(result.ending.addedSeconds - 4.2) < 0.05, `新增时长 ${result.ending.addedSeconds}`)
    assert.ok(Math.abs(result.totalDuration - 7.2) < 0.05, `成片时长 ${result.totalDuration}`)

    const total = await duration(outFile)
    assert.ok(Math.abs(total - result.totalDuration) <= 0.08, `实际时长 ${total} 应等于 ${result.totalDuration}`)

    // 音效必须真的响：剧情结束后仍然有声音。
    const tailRms = await audioRms(outFile, 3.2)
    assert.ok(tailRms > 0.01, `片尾音效没有声音（RMS ${tailRms}）`)

    // 时停：片尾定格画面必须等于剧情结束前 1.5 秒那一帧。
    const frozen = await frame(outFile, result.totalDuration - 0.2)
    const sourceFrame = await frame(outFile, 1.5)
    const frozenDiff = meanAbsDiff(frozen, sourceFrame)
    assert.ok(frozenDiff < 12, `定格画面应与剧情 E−1.5 帧一致，实际差异 ${frozenDiff.toFixed(2)}`)

    // 炫光：转场窗口内的画面要明显区别于同一张定格图。
    const flashed = await frame(outFile, 3.25)
    const flashDiff = meanAbsDiff(flashed, frozen)
    assert.ok(flashDiff > 8, `炫光转场窗口应改变画面，实际差异 ${flashDiff.toFixed(2)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ending can be disabled to export only the story part', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slice-no-ending-'))
  try {
    await draftOf(dir, 2)
    const outFile = join(dir, 'no-ending.mp4')
    const result = await renderSlice({ episodeDir: dir, cut: { start: 0, end: 2 }, outFile, burnSubtitles: false, ffmpeg, ending: { enabled: false } })
    assert.equal(result.ending, null)
    assert.equal(result.totalDuration, 2)
    const total = await duration(outFile)
    assert.ok(Math.abs(total - 2) <= 0.08, `实际时长 ${total}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
