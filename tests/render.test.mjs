import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { renderSlice } from '../lib/render.js'
import { ffmpegPath, ffprobePath } from '../lib/frames.js'

const exec = promisify(execFile)

test('picture-in-picture windows and frame rounding do not shorten the exported timeline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slice-render-'))
  const ffmpeg = ffmpegPath()
  try {
    const media = join(dir, 'red.mp4')
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x96:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', media])
    const segment = (id, start, duration) => ({ id, material_id: 'video', target_timerange: { start, duration }, source_timerange: { start: 33333, duration } })
    await writeFile(join(dir, 'draft_info.json'), JSON.stringify({
      duration: 1e6, canvas_config: { width: 160, height: 96 },
      materials: { videos: [{ id: 'video', type: 'video', path: media, has_audio: false }] },
      tracks: [
        { type: 'video', segments: [segment('main1', 0, 233333), segment('main2', 466666, 533334)] },
        { type: 'video', segments: [segment('overlay', 233333, 233333)] },
      ],
    }))
    const outFile = join(dir, 'slice.mp4')
    await renderSlice({ episodeDir: dir, cut: { start: 0, end: 1 }, outFile, burnSubtitles: false, ffmpeg, ending: { enabled: false } })
    const { stdout } = await exec(ffprobePath(ffmpeg), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,duration', '-of', 'json', outFile])
    const video = JSON.parse(stdout).streams[0]
    assert.equal(Number(video.nb_frames), 30)
    assert.equal(Number(video.duration), 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('video sound is not mixed again when a separate dialogue track already supplies it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slice-dialogue-'))
  const ffmpeg = ffmpegPath()
  try {
    const media = join(dir, 'voice.mp4')
    await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x96:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-y', media])
    const segment = (id, material_id) => ({ id, material_id, source_timerange: { duration: 1e6 }, target_timerange: { duration: 1e6 } })
    await writeFile(join(dir, 'draft_info.json'), JSON.stringify({ duration: 1e6, canvas_config: { width: 160, height: 96 }, materials: { videos: [{ id: 'video', type: 'video', path: media }], audios: [{ id: 'voice', type: 'video_original_sound', path: media }] }, tracks: [{ type: 'video', segments: [segment('picture', 'video')] }, { type: 'audio', segments: [segment('dialogue', 'voice')] }] }))
    const outFile = join(dir, 'slice.mp4')
    const result = await renderSlice({ episodeDir: dir, cut: { start: 0, end: 1 }, outFile, burnSubtitles: false, ffmpeg, ending: { enabled: false } })
    const rms = async file => {
      const { stdout } = await exec(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { encoding: 'buffer' })
      const samples = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4)
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    }
    assert.equal(result.audioSegments, 1)
    assert.equal(result.dialogueFromVideo, 0)
    const gain = await rms(outFile) / await rms(media)
    assert.ok(gain > 0.9 && gain < 1.1, `dialogue gain ${gain} must remain one copy`)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
