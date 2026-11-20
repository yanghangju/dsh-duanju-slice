// 测试公用：ffmpeg 定位与临时素材生成。没有 ffmpeg 的环境里相关用例会自动跳过。
// 临时目录固定在工作区内：DSH 沙箱只对工作区放行子进程写文件，系统临时目录下 ffmpeg 会写不进去。
import { execFile, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { findFfmpeg, findFfprobe } from '../lib/promo/media.js'

const exec = promisify(execFile)

export const ffmpeg = findFfmpeg() ?? 'ffmpeg'
export const ffprobe = findFfprobe() ?? 'ffprobe'
export const hasFfmpeg = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0
export const TEMP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')

/** 生成一段测试视频（可选带正弦音轨）。 */
export async function makeVideo(dir, name, { seconds = 1, width = 160, height = 96, audio = false, fps = 30 } = {}) {
  const file = join(dir, name)
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=red:s=${width}x${height}:r=${fps}:d=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  args.push('-y', file)
  await exec(ffmpeg, args)
  return file
}

export async function tempDir(prefix) {
  await mkdir(TEMP_ROOT, { recursive: true })
  return mkdtemp(join(TEMP_ROOT, prefix))
}

export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true })
}

export { exec }
