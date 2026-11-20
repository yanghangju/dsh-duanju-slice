// ffmpeg plumbing: discovery, probing, full-frame video sampling, clip cutting and
// concatenation. Every command is spawned without a shell so paths with
// spaces and CJK characters survive intact.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BUNDLED_ENABLED, BUNDLED_FFMPEG, BUNDLED_FFPROBE } from './runtime.js'

const WINDOWS_DEFAULTS = [
  'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Users\\Public\\ffmpeg\\bin\\ffmpeg.exe',
]

/** Explicit path, development runtime, then known system installs. */
export function ffmpegCandidates(config = {}) {
  return [
    config.ffmpegPath, BUNDLED_ENABLED && BUNDLED_FFMPEG, process.env.FFMPEG_PATH,
    ...WINDOWS_DEFAULTS,
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    join(process.env.USERPROFILE ?? '', 'scoop', 'shims', 'ffmpeg.exe'),
    join(process.env.ProgramData ?? '', 'chocolatey', 'bin', 'ffmpeg.exe'),
  ].filter(Boolean)
}

export function findFfmpeg(config = {}) {
  return ffmpegCandidates(config).find(existsSync) ?? 'ffmpeg'
}

/** Same order for FFprobe: explicit config -> packaged runtime -> FFPROBE_PATH -> PATH. */
export function findFfprobe(config = {}) {
  const candidates = [config.ffprobePath]
  if (BUNDLED_ENABLED && existsSync(BUNDLED_FFPROBE)) candidates.push(BUNDLED_FFPROBE)
  candidates.push(process.env.FFPROBE_PATH ?? 'ffprobe')
  for (const candidate of candidates.filter(Boolean)) if (candidate === 'ffprobe' || existsSync(candidate)) return candidate
  return 'ffprobe'
}

/** @returns {Promise<{stdout: string, stderr: string, code: number|null}>} */
export function run(exe, args, { timeoutMs = 30 * 60_000, signal, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, signal })
    const limit = 200_000
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-limit)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-limit)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`${exe} 无法启动: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 || okCodes.includes(code)) resolve({ stdout, stderr, code })
      else reject(new Error(`${exe} 退出码 ${code}\n${stderr.trim().split('\n').slice(-8).join('\n')}`))
    })
  })
}

export function parseProbe(stderr) {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const size = /Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
  return {
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : undefined,
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined,
    hasAudio: /Audio:/.test(stderr),
  }
}

/** `ffmpeg -i` always exits 1 after printing the banner, so its stderr is the probe result. */
export async function probe(ffmpeg, file, { signal, ffprobe } = {}) {
  if (ffprobe) {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { signal })
    const value = JSON.parse(stdout)
    const video = value.streams?.find((stream) => stream.codec_type === 'video')
    const duration = Number(value.format?.duration)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`无法读取精确媒体时长：${file}`)
    return { duration, width: video?.width, height: video?.height, hasAudio: value.streams?.some((stream) => stream.codec_type === 'audio') ?? false }
  }
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file], { okCodes: [0, 1], signal })
  const info = parseProbe(stderr)
  if (!info.duration) throw new Error(`无法解析视频信息: ${file}\n${stderr.trim().split('\n').slice(-4).join('\n')}`)
  return info
}

export async function pickVideoEncoder(ffmpeg) {
  const { stdout } = await run(ffmpeg, ['-hide_banner', '-encoders'])
  for (const encoder of ['libx264', 'h264_nvenc', 'h264_mf', 'h264_qsv']) {
    if (new RegExp(`\\b${encoder}\\b`).test(stdout)) return encoder
  }
  throw new Error('未找到可用的 H.264 编码器（libx264 / h264_nvenc / h264_mf）')
}

/** Sample the whole picture; each label is an absolute time in the source video. */
export async function sampleVideoFrames(ffmpeg, file, outDir, { start, end, fps, maxFrames = 20, signal }) {
  if (![start, end, fps].every(Number.isFinite) || start < 0 || end <= start || fps <= 0) throw new Error('视频采样时间或帧率无效')
  await mkdir(outDir, { recursive: true })
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', start.toFixed(3), '-i', file, '-t', (end - start).toFixed(3),
    '-vf', `fps=${fps}:start_time=0:round=up,scale=540:-2`,
    '-frames:v', String(maxFrames), '-q:v', '3', join(outDir, 'f%05d.jpg'),
  ], { signal })
  const names = (await readdir(outDir)).filter((name) => /^f\d{5}\.jpg$/.test(name)).sort()
  if (!names.length) throw new Error(`视频采样没有生成画面：${file}`)
  return names.map((name, index) => ({ file: join(outDir, name), time: Number((start + index / fps).toFixed(3)) })).filter((frame) => frame.time < end)
}

export async function cut(ffmpeg, { input, start, duration, output, width, height, encoder, signal }) {
  const video = [
    'fps=30',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    'setsar=1',
  ].join(',')
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', start.toFixed(3), '-i', input, '-t', duration.toFixed(3),
    '-vf', video,
    '-c:v', encoder, ...(encoder === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-b:v', '6M']),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    output,
  ]
  await run(ffmpeg, args, { signal })
  return output
}

export async function concat(ffmpeg, clips, output, workDir, { signal } = {}) {
  const listFile = join(workDir, 'concat.txt')
  const body = clips.map((clip) => `file '${clip.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listFile, `${body}\n`, 'utf8')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output], { signal })
  return output
}

function musicFilters(args, segments, inputOffset = 1) {
  const seconds = (value) => value.toFixed(6)
  const filters = segments.map((segment, index) => {
    args.push('-ss', seconds(segment.sourceStart), '-t', seconds(segment.duration), '-i', segment.file)
    return [
      `[${index + inputOffset}:a]atrim=duration=${seconds(segment.duration)}`,
      'asetpts=PTS-STARTPTS', 'aformat=sample_rates=44100:channel_layouts=stereo',
      `apad=whole_dur=${seconds(segment.duration)}`, `atrim=duration=${seconds(segment.duration)}`,
      `volume=${segment.volume}`,
      ...(segment.fadeIn > 0 ? [`afade=t=in:st=0:d=${seconds(segment.fadeIn)}`] : []),
      ...(segment.fadeOut > 0 ? [`afade=t=out:st=${seconds(segment.duration - segment.fadeOut)}:d=${seconds(segment.fadeOut)}`] : []),
      `adelay=${Math.round(segment.targetStart * 44100)}S:all=1[m${index}]`,
    ].join(',')
  })
  return { filters, labels: segments.map((_, index) => `[m${index}]`).join('') }
}

/** Render only music, without source audio, using the same range/fade plumbing as export. */
export async function renderMusicBed(ffmpeg, { output, segments, duration, signal }) {
  if (!segments.length || !Number.isFinite(duration) || duration <= 0) throw new Error('音乐床缺少有效时间线')
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  const { filters, labels } = musicFilters(args, segments, 0)
  filters.push(`${labels}amix=inputs=${segments.length}:duration=longest:dropout_transition=0:normalize=0,apad[bed]`)
  args.push('-filter_complex', filters.join(';'), '-map', '[bed]', '-c:a', 'pcm_f32le', '-ar', '44100', '-ac', '2', '-t', duration.toFixed(6), output)
  await run(ffmpeg, args, { signal })
  return output
}

/** Music ranges are compiled/validated by bgm.js; never normalize away dialogue. */
export async function mixBgm(ffmpeg, { input, output, segments, duration, hasAudio, originalDuration = duration, signal }) {
  if (!segments.length || !Number.isFinite(duration) || duration <= 0) throw new Error('BGM 混音缺少有效时间线')
  const seconds = (value) => value.toFixed(6)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]
  const filters = [hasAudio
    ? `[0:a]aresample=44100,atrim=duration=${seconds(originalDuration)},asetpts=PTS-STARTPTS,apad=whole_dur=${seconds(duration)},atrim=duration=${seconds(duration)}[original]`
    : `anullsrc=r=44100:cl=stereo,atrim=duration=${seconds(duration)}[original]`]
  const { filters: music, labels } = musicFilters(args, segments)
  filters.push(...music)
  filters.push(`[original]${labels}amix=inputs=${segments.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true[mix]`)
  args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-t', seconds(duration), '-movflags', '+faststart', output)
  await run(ffmpeg, args, { signal })
  return output
}
