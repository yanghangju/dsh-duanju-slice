// 成片渲染：按切片草稿的段拼画面（硬切）、混 对白/音乐/音效，输出 MP4。
// 成片末尾默认接剪映原生片尾：时停定格 + 炫光转场 + 大气片尾声效。
// 源视频大多已带硬字幕，所以这里不再烧字幕；草稿里也没有字幕轨。
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readDraft } from './slice-draft.js'
import { ffmpegPath, ffprobePath } from './frames.js'
import { preferDialogueAudio } from './audio.js'
import { ENDING_SOUND, appendEnding, prepareEnding } from './ending.js'

const E6 = 1e6

function run(command, args, { collect = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout?.on('data', (chunk) => {
      if (collect) out += chunk.toString()
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve({ stdout: out }) : reject(new Error(`${command} 退出码 ${code}：${stderr.slice(-1200)}`))))
  })
}

function probeArgs(file) {
  return ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]
}

async function hasAudioStream(ffprobe, file, cache) {
  if (cache.has(file)) return cache.get(file)
  let result = false
  try {
    const { stdout } = await run(ffprobe, probeArgs(file), { collect: true })
    result = stdout.split(/\s+/).includes('audio')
  } catch {
    result = false
  }
  cache.set(file, result)
  return result
}

function materialIndex(draft) {
  const index = new Map()
  for (const [kind, list] of Object.entries(draft.materials ?? {})) {
    if (!Array.isArray(list)) continue
    for (const material of list) index.set(material.id, material)
  }
  return index
}

/** 草稿里的素材路径：切片草稿写的是绝对路径，相对路径按草稿目录解析。 */
function materialPath(draftDir, path) {
  if (!path) return ''
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
  return join(draftDir, path)
}

function speedOf(segment, materials) {
  for (const ref of segment.extra_material_refs ?? []) {
    const material = materials.get(ref)
    if (material && typeof material.speed === 'number' && material.speed > 0) return material.speed
  }
  return 1
}

function atempoChain(speed) {
  const parts = []
  let value = speed
  while (value > 2) {
    parts.push('atempo=2')
    value /= 2
  }
  while (value < 0.5) {
    parts.push('atempo=0.5')
    value /= 0.5
  }
  parts.push(`atempo=${value.toFixed(4)}`)
  return parts
}

/**
 * @param {{episodeDir: string, cut: {start:number,end:number}, outFile: string,
 *   ffmpeg?: string, ffprobe?: string, crf?: number, fps?: number, signal?: AbortSignal,
 *   ending?: {enabled?: boolean, transitionSeconds?: number, freezeOffsetSeconds?: number,
 *     soundPath?: string, transitionPath?: string},
 *   onProgress?: (step:string)=>void}} input
 */
export async function renderSlice(input) {
  const { episodeDir, cut, outFile } = input
  const ffmpeg = ffmpegPath(input.ffmpeg)
  const ffprobe = ffprobePath(ffmpeg, input.ffprobe)
  const fps = input.fps ?? 30
  const onProgress = input.onProgress ?? (() => {})
  if (!existsSync(episodeDir)) throw new Error(`切片草稿目录不存在：${episodeDir}`)

  const loaded = await readDraft(episodeDir)
  if (!loaded) throw new Error('切片草稿里没有可读的 draft_info.json，无法渲染成片')
  const draft = preferDialogueAudio(loaded)
  const materials = materialIndex(draft)
  const width = draft.canvas_config?.width ?? 1080
  const height = draft.canvas_config?.height ?? 1920

  const videoTracks = draft.tracks.filter((track) => track.type === 'video')
  if (!videoTracks.length) throw new Error('草稿里没有视频轨')
  const mainTrack = videoTracks[0]
  const overlayTracks = videoTracks.slice(1)

  const tag = (index) => `s${index}`
  const inputs = []
  const inputIndex = new Map()
  const inputFor = (path) => {
    if (!inputIndex.has(path)) {
      inputIndex.set(path, inputs.length)
      inputs.push(path)
    }
    return inputIndex.get(path)
  }
  const audioCache = new Map()
  const warnings = []
  const warn = (text) => { if (!warnings.includes(text)) warnings.push(text) }
  const filter = []
  let serial = 0
  const nextTag = (prefix) => `${prefix}${(serial += 1)}`

  // —— 主画面：逐段裁剪、缩放、拼接 ——
  const mainClips = []
  const mainTags = []
  let renderedFrames = 0
  const fillTo = (frame) => {
    if (frame <= renderedFrames) return
    const gap = nextTag('gap')
    filter.push(`color=c=black:s=${width}x${height}:r=${fps},trim=end_frame=${frame - renderedFrames},setpts=PTS-STARTPTS[${gap}]`)
    mainTags.push(gap)
    renderedFrames = frame
  }
  for (const segment of mainTrack.segments) {
    const material = materials.get(segment.material_id)
    const path = material?.path ? materialPath(episodeDir, material.path) : ''
    const source = segment.source_timerange
    const target = segment.target_timerange
    if (!path || !source || material.type === 'photo') continue
    const speed = speedOf(segment, materials)
    const srcStart = (source.start ?? 0) / E6
    const srcDuration = (source.duration ?? 0) / E6
    const startFrame = Math.round(((target.start ?? 0) / E6 - cut.start) * fps)
    const endFrame = Math.round((((target.start ?? 0) + (target.duration ?? 0)) / E6 - cut.start) * fps)
    fillTo(startFrame) // 主轨空窗由叠加轨提供画面，不能从总时间轴中删掉。
    if (!existsSync(path)) {
      warn(`缺画面素材 ${basename(path)}（这段用黑场补位）`)
      fillTo(endFrame)
      continue
    }
    const index = inputFor(path)
    const out = nextTag('v')
    const length = `tpad=stop_mode=clone:stop=-1,trim=end_frame=${Math.max(1, endFrame - startFrame)}`
    const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
    if (Math.abs(speed - 1) > 0.001) {
      filter.push(`[${index}:v]trim=start=${srcStart.toFixed(6)}:end=${(srcStart + srcDuration).toFixed(6)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${scale},fps=${fps},${length}[${out}]`)
    } else {
      filter.push(`[${index}:v]trim=start=${srcStart.toFixed(6)}:end=${(srcStart + srcDuration).toFixed(6)},setpts=PTS-STARTPTS,${scale},fps=${fps},${length}[${out}]`)
    }
    mainTags.push(out)
    renderedFrames = endFrame
    mainClips.push({
      tag: out,
      start: (target.start ?? 0) / E6,
      duration: (target.duration ?? 0) / E6,
      segment,
      material,
      speed,
      path,
      absolute: path,
      srcStart,
      srcDuration,
      volume: segment.volume ?? material.volume ?? 1,
    })
  }
  if (!mainClips.length) throw new Error('切片窗口内没有画面段')
  fillTo(Math.round((cut.end - cut.start) * fps))

  let videoTail
  if (mainTags.length === 1) {
    videoTail = mainTags[0]
  } else {
    const merged = nextTag('cat')
    filter.push(`${mainTags.map(tag => `[${tag}]`).join('')}concat=n=${mainTags.length}:v=1:a=0[${merged}]`)
    videoTail = merged
  }

  // —— 画中画轨：按时间戳叠加在对应位置 ——
  for (const track of overlayTracks) {
    for (const segment of track.segments) {
      const material = materials.get(segment.material_id)
      const path = material?.path ? materialPath(episodeDir, material.path) : ''
      const source = segment.source_timerange
      const target = segment.target_timerange
      if (!path || !source || material.type === 'photo') continue
      if (!existsSync(path)) continue
      const speed = speedOf(segment, materials)
      const srcStart = (source.start ?? 0) / E6
      const srcDuration = (source.duration ?? 0) / E6
      const start = (target.start ?? 0) / E6
      const duration = (target.duration ?? 0) / E6
      const index = inputFor(path)
      const out = nextTag('o')
      const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
      filter.push(`[${index}:v]trim=start=${srcStart.toFixed(6)}:end=${(srcStart + srcDuration).toFixed(6)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${scale},fps=${fps},setpts=PTS+${start.toFixed(6)}/TB[${out}]`)
      const merged = nextTag('ov')
      filter.push(`[${videoTail}][${out}]overlay=enable='between(t,${start.toFixed(3)},${(start + duration).toFixed(3)})':eof_action=pass:shortest=0[${merged}]`)
      videoTail = merged
    }
  }

  // —— 声音：对白（独立轨或视频自带）/ 音乐 / 音效，统一延迟到各自的 target 时间 ——
  const audioSegments = []
  const audioTracks = draft.tracks.filter((track) => track.type === 'audio')
  for (const track of audioTracks) {
    for (const segment of track.segments) {
      const material = materials.get(segment.material_id)
      const source = segment.source_timerange
      const target = segment.target_timerange
      if (!material?.path || !source) continue
      // 片尾声效由本函数自己接在剧情之后；草稿里那条音效轨跳过，避免开头 0.4 秒重复出声。
      if (material.effect_id === ENDING_SOUND.resourceId || material.resource_id === ENDING_SOUND.resourceId) continue
      const start = (target.start ?? 0) / E6
      const duration = (target.duration ?? 0) / E6
      const end = start + duration
      if (end <= cut.start || start >= cut.end) continue
      const audioPath = materialPath(episodeDir, material.path)
      if (!existsSync(audioPath)) {
        warn(`缺音频素材 ${basename(audioPath)}`)
        continue
      }
      audioSegments.push({
        path: audioPath,
        kind: material.type ?? 'sound',
        volume: segment.volume ?? material.volume ?? 1,
        start: Math.max(start, cut.start) - cut.start,
        speed: speedOf(segment, materials),
        srcStart: (source.start ?? 0) / E6 + Math.max(0, cut.start - start) * speedOf(segment, materials),
        srcDuration: (Math.min(end, cut.end) - Math.max(start, cut.start)),
      })
    }
  }
  // 独立对白优先，视频原声只补未被独立对白覆盖的区间。
  let dialogueFromVideo = 0
  for (const clip of mainClips) {
    if (!clip.absolute) continue
    if (Number(clip.volume) === 0) continue
    if (clip.material?.has_audio === false) continue
    if (clip.material?.has_sound_separated) continue
    const start = clip.start - cut.start
    if (start + clip.duration <= 0 || start >= cut.end - cut.start) continue
    if (!(await hasAudioStream(ffprobe, clip.absolute, audioCache))) continue
    audioSegments.push({
      path: clip.absolute,
      kind: 'dialogue',
      start: Math.max(0, start),
      speed: clip.speed,
      volume: clip.volume,
      srcStart: clip.srcStart + Math.max(0, -start) * clip.speed,
      srcDuration: Math.min(clip.srcDuration, clip.duration * clip.speed + Math.max(0, -start) * clip.speed),
    })
    dialogueFromVideo += 1
  }

  if (process.env.DUANJU_ONLY_DIALOGUE) {
    const kept = audioSegments.filter((segment) => segment.kind === 'dialogue' || segment.kind === 'video_original_sound')
    audioSegments.length = 0
    audioSegments.push(...kept)
  }
  const audioTags = []
  for (const segment of audioSegments) {
    if (segment.srcDuration <= 0.02) continue
    if (!(await hasAudioStream(ffprobe, segment.path, audioCache))) continue
    const index = inputFor(segment.path)
    const delay = Math.max(0, Math.round(segment.start * 1000))
    const out = nextTag('a')
    const parts = [`[${index}:a]atrim=start=${segment.srcStart.toFixed(3)}:end=${(segment.srcStart + segment.srcDuration).toFixed(3)}`, 'asetpts=PTS-STARTPTS']
    if (Math.abs(segment.speed - 1) > 0.001) parts.push(...atempoChain(segment.speed))
    if (segment.volume != null && Math.abs(Number(segment.volume) - 1) > 0.001) parts.push(`volume=${Number(segment.volume).toFixed(3)}`)
    parts.push(`adelay=${delay}:all=1`)
    filter.push(`${parts.join(',')}[${out}]`)
    audioTags.push(out)
  }

  let audioOut
  if (audioTags.length) {
    if (audioTags.length === 1) {
      audioOut = audioTags[0]
      const limited = nextTag('ao')
      filter.push(`[${audioOut}]alimiter=limit=0.97[${limited}]`)
      audioOut = limited
    } else {
      const mixed = nextTag('amix')
      filter.push(`${audioTags.map((tagName) => `[${tagName}]`).join('')}amix=inputs=${audioTags.length}:normalize=0:duration=longest[${mixed}]`)
      const limited = nextTag('ao')
      filter.push(`[${mixed}]alimiter=limit=0.97[${limited}]`)
      audioOut = limited
    }
  } else {
    audioOut = nextTag('silence')
    filter.push(`anullsrc=channel_layout=stereo:sample_rate=48000[${audioOut}]`)
  }

  // —— 临时期目录 ——
  // 临时目录放在成片同盘目录下：那里本来就要写 MP4，不依赖系统临时目录的写权限。
  let scratchDir = null
  const scratch = async (prefix) => {
    if (!scratchDir) {
      const parent = input.scratchDir ?? dirname(outFile)
      await mkdir(parent, { recursive: true })
      scratchDir = await mkdtemp(join(parent, '.slice-tmp-'))
    }
    return mkdtemp(join(scratchDir, prefix))
  }
  const videoOut = videoTail

  // —— 片尾：剧情结束后接「时停定格 + 原生炫光 + 完整音效」，与短剧剪辑插件的最后处理一致 ——
  const endingOptions = input.ending ?? {}
  const withEnding = endingOptions.enabled !== false
  const endingDir = withEnding ? await scratch('ending-') : null
  const contentFile = withEnding ? join(endingDir, 'content.mp4') : outFile

  onProgress('render')
  const args = ['-hide_banner', '-loglevel', 'error']
  for (const path of inputs) args.push('-i', path)
  args.push('-filter_complex', filter.join(';'), '-map', `[${videoOut}]`, '-map', `[${audioOut}]`)
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(input.crf ?? 18), '-pix_fmt', 'yuv420p')
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
  args.push('-map_metadata', '-1', '-dn')
  args.push('-movflags', '+faststart', '-shortest', '-y', contentFile)
  if (process.env.DUANJU_DEBUG_ARGS) {
    console.error(JSON.stringify({ inputs, filter }, null, 1))
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true })
    return { outFile, duration: Number((cut.end - cut.start).toFixed(2)), debug: true }
  }

  let ending = null
  try {
    await run(ffmpeg, args)
    if (withEnding) {
      onProgress('ending')
      ending = await prepareEnding(ffmpeg, ffprobe, {
        content: contentFile, tmp: endingDir, width, height, fps,
        transitionSeconds: endingOptions.transitionSeconds,
        freezeOffsetSeconds: endingOptions.freezeOffsetSeconds,
        soundPath: endingOptions.soundPath,
        transitionPath: endingOptions.transitionPath,
        signal: input.signal,
      })
      await appendEnding(ffmpeg, { input: contentFile, output: outFile, ending, width, height, fps, crf: input.crf ?? 18, signal: input.signal })
    }
  } finally {
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true })
  }

  return {
    outFile,
    duration: Number((ending ? ending.totalDuration : cut.end - cut.start).toFixed(2)),
    contentDuration: Number((cut.end - cut.start).toFixed(2)),
    totalDuration: ending ? ending.totalDuration : Number((cut.end - cut.start).toFixed(2)),
    width,
    height,
    videoSegments: mainClips.length,
    overlaySegments: overlayTracks.reduce((sum, track) => sum + track.segments.length, 0),
    audioSegments: audioTags.length,
    warnings,
    dialogueFromVideo,
    ending: ending ? {
      title: ending.title,
      resourceId: ending.resourceId,
      transitionSeconds: ending.transitionSeconds,
      freezeOffsetSeconds: ending.freeze.offsetSeconds,
      freezeSourceSeconds: ending.freeze.sourceSeconds,
      soundSeconds: Number(ending.sound.duration.toFixed(3)),
      addedSeconds: Number(ending.duration.toFixed(3)),
    } : null,
  }
}
