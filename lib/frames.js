// First/last frame extraction so the operator can see whether the cut is right.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { frameAt } from './locate.js'

const WINDOWS_FFMPEG = [
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
  join(process.env.USERPROFILE ?? '', 'scoop', 'shims', 'ffmpeg.exe'),
  join(process.env.ProgramData ?? '', 'chocolatey', 'bin', 'ffmpeg.exe'),
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
]

/** 同机已装的短剧剪辑插件自带便携 ffmpeg；没有系统 ffmpeg 时直接用它的运行时。 */
function siblingRuntime() {
  const profiles = [process.env.DSH_PROFILE_DIR, ...safeList(join(homedir(), '.dsh', 'profiles')).map((name) => join(homedir(), '.dsh', 'profiles', name))]
  for (const profile of profiles.filter(Boolean)) {
    for (const name of ['dsh-duanju-promo', 'dsh-duanju-slice']) {
      for (const dir of [join(profile, 'node_modules', '@local', name), join(profile, 'node_modules', name)]) {
        const candidate = join(dir, 'runtime', 'ffmpeg', 'ffmpeg.exe')
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

function safeList(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

export function ffmpegPath(configured) {
  const candidates = [configured, process.env.DUANJU_FFMPEG, process.env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', ...WINDOWS_FFMPEG]
  const sibling = siblingRuntime()
  if (sibling) candidates.push(sibling)
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  return 'ffmpeg'
}

export function ffprobePath(ffmpeg, configured) {
  const candidates = [configured, process.env.DUANJU_FFPROBE, process.env.FFPROBE_PATH]
  if (ffmpeg && /ffmpeg(\.exe)?$/i.test(ffmpeg)) {
    candidates.push(join(dirname(ffmpeg), ffmpeg.endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'))
  }
  candidates.push('/opt/homebrew/bin/ffprobe', ...WINDOWS_FFMPEG.map((path) => path.replace(/ffmpeg\.exe$/, 'ffprobe.exe')))
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  return 'ffprobe'
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 抽帧失败（${code}）：${stderr.slice(-400)}`))))
  })
}

/** One JPEG at a timeline moment, resolved to its source file + seek time. */
export async function grabTimelineFrame({ ffmpeg, episode, timelineSeconds, outFile, width = 540 }) {
  const frame = frameAt(episode.videoSegments, timelineSeconds)
  if (!frame) throw new Error(`时间码 ${timelineSeconds.toFixed(2)}s 落在空档，没有画面（可能落在片头卡/黑场）`)
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', frame.seek.toFixed(3), '-i', frame.file,
    '-frames:v', '1', '-vf', `scale=${width}:-2`,
    '-q:v', '3', '-y', outFile,
  ])
  return { outFile, file: frame.file, seek: frame.seek, timelineSeconds, segment: frame.name }
}

/** Head/tail verification frames for a planned cut. */
export async function verifyFrames({ ffmpeg, episode, cut, outDir, prefix = 'slice' }) {
  await mkdir(outDir, { recursive: true })
  const headAt = cut.start + 0.1
  const tailAt = Math.max(cut.start + 0.2, cut.end - 0.1)
  const headFile = join(outDir, `${prefix}-head.jpg`)
  const tailFile = join(outDir, `${prefix}-tail.jpg`)
  const head = await grabTimelineFrame({ ffmpeg, episode, timelineSeconds: headAt, outFile: headFile })
  const tail = await grabTimelineFrame({ ffmpeg, episode, timelineSeconds: tailAt, outFile: tailFile })
  return { head, tail }
}
