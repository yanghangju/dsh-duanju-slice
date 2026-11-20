// Use the actual 剪映 sound and 炫光 transition resources, never a generated substitute.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { probe, run } from './media.js'
import { BUNDLED_ENABLED, BUNDLED_ENDING_SOUND, BUNDLED_ENDING_TRANSITION } from './runtime.js'

export const ENDING_SOUND = { title: '大气片尾声效', resourceId: '7023776340713164069' }
export const ENDING_TRANSITION = { title: '炫光', resourceId: '6726707814028284423', duration: 0.8 }
export const FREEZE_OFFSET = 1.5
const EFFECT_ROOT = 'AmazingAuto_out'
const seconds = (value) => value.toFixed(6)
const encoding = (encoder) => ['-c:v', encoder, ...(encoder === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-b:v', '6M']), '-pix_fmt', 'yuv420p']

export async function findEndingSound({ soundPath } = {}) {
  if (soundPath) {
    assert(existsSync(soundPath), `找不到片尾音效：${soundPath}`)
    return { ...ENDING_SOUND, file: resolve(soundPath) }
  }
  // Packaged copy first: a clean machine has no 剪映 download cache yet.
  if (BUNDLED_ENABLED && existsSync(BUNDLED_ENDING_SOUND)) return { ...ENDING_SOUND, file: BUNDLED_ENDING_SOUND }
  const cache = join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Cache', 'music')
  const registry = join(cache, 'downLoadcfg')
  if (existsSync(registry)) {
    const value = JSON.parse(await readFile(registry, 'utf8'))
    for (const entry of value.list ?? []) {
      if (String(entry.resourceId) !== ENDING_SOUND.resourceId || typeof entry.path !== 'string') continue
      assert(entry.path === basename(entry.path) && !/[\\/]/.test(entry.path), '剪映片尾音效缓存路径异常')
      const file = join(cache, entry.path)
      if (existsSync(file)) return { ...ENDING_SOUND, file, registry }
    }
  }
  throw new Error('未找到剪映内置「大气片尾声效」（7023776340713164069）：内置资源与剪映缓存均缺失。请重装带 assets/ending 的插件包，或在剪映音效库下载一次，或配置 ending.soundPath 指向其本地文件；不会用其他音效替代。')
}

/** This renderer follows this specific resource's Lua frame selection and RGB shader. */
export async function findEndingTransition({ transitionPath } = {}) {
  let candidates
  if (transitionPath) {
    candidates = [resolve(transitionPath)]
  } else {
    const cache = join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Cache', 'effect', ENDING_TRANSITION.resourceId)
    candidates = []
    if (BUNDLED_ENABLED && existsSync(join(BUNDLED_ENDING_TRANSITION, EFFECT_ROOT, 'xshader', 'generalEffect.json'))) candidates.push(BUNDLED_ENDING_TRANSITION)
    if (existsSync(cache)) {
      candidates.push(...(await readdir(cache, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(cache, entry.name)))
    }
  }
  const path = candidates.find((candidate) => existsSync(join(candidate, EFFECT_ROOT, 'xshader', 'generalEffect.json')))
  assert(path, '未找到剪映原生转场「炫光」（6726707814028284423）：内置资源与剪映缓存均缺失。请重装带 assets/ending 的插件包，或在剪映下载此转场，或配置 ending.transitionPath；不会用自制光效替代。')
  return validateTransition(path)
}

/** Reject a resource whose shader/Lua no longer matches this renderer. */
async function validateTransition(path) {
  const config = JSON.parse(await readFile(join(path, EFFECT_ROOT, 'xshader', 'generalEffect.json'), 'utf8'))
  const effect = config.effect?.find((entry) => entry.name === 'DazzleLight')
  const uniform = (name) => effect?.fUniforms?.find((entry) => entry.name === name)?.data
  assert(uniform('blendMode')?.[0] === 21 && uniform('alphaFactor')?.[0] === 1 && uniform('clockwise')?.[0] === 1
    && JSON.stringify(uniform('fullBlendTexSize')) === '[640,360]' && uniform('blendTexture')?.length === 23,
  '原生炫光资源参数已变化，不能用不匹配的混合算法导出')
  const vars = await readFile(join(path, EFFECT_ROOT, 'lua', 'Vars.lua'), 'utf8')
  assert(/frameCnt\s*=\s*23\b/.test(vars) && /startFrame\s*=\s*1\b/.test(vars), '原生炫光序列规则已变化')
  for (let index = 1; index <= 23; index++) {
    const file = join(path, EFFECT_ROOT, 'xshader', 'resource1', 'seq16-9', `light${index}.png`)
    const info = await lstat(file)
    assert(info.isFile() && !info.isSymbolicLink(), '原生炫光序列缺失或包含符号链接')
  }
  return { ...ENDING_TRANSITION, path }
}

/** Locate E-1.5 on the unextended story timeline, even across clip/episode boundaries. */
export function freezeSource(clips) {
  assert(Array.isArray(clips) && clips.length, '定格需要原片片段清单')
  const durations = clips.map((clip) => Math.round((clip.end - clip.start) * 1e6))
  assert(durations.every((value) => Number.isSafeInteger(value) && value > 0), '定格片段时长无效')
  const timelineUs = durations.reduce((sum, value) => sum + value, 0) - FREEZE_OFFSET * 1e6
  assert(timelineUs >= 0, '剧情不足 1.5 秒，无法取得剧情结束前 1.5 秒的定格帧')
  let cursor = 0
  for (const [clipIndex, duration] of durations.entries()) {
    if (timelineUs < cursor + duration) {
      const clip = clips[clipIndex]
      return { offsetSeconds: FREEZE_OFFSET, timelineTime: timelineUs / 1e6, clipIndex,
        sourceFile: clip.file, sourceTime: (Math.round(clip.start * 1e6) + timelineUs - cursor) / 1e6 }
    }
    cursor += duration
  }
  throw new Error('无法映射剧情定格帧')
}

/** Decode the whole sound. WAV sample counts avoid MP3 padding/probe rounding. */
export async function prepareEnding(ffmpeg, { source, transition, clips, tmp, targetStart, transitionSeconds = ENDING_TRANSITION.duration, signal }) {
  signal?.throwIfAborted()
  assert(Number.isFinite(transitionSeconds) && transitionSeconds > 0 && transitionSeconds <= 10, '片尾原生转场时长必须是大于 0 且不超过 10 秒的有限数值')
  const freeze = freezeSource(clips)
  assert(Math.round((clips.at(-1).end - clips.at(-1).start) * 1e6) >= Math.round(transitionSeconds / 2 * 1e6), `最后剧情段不足 ${transitionSeconds / 2} 秒，无法容纳完整 ${transitionSeconds} 秒原生转场`)
  const sourceInfo = await probe(ffmpeg, source.file, { signal })
  assert(sourceInfo.hasAudio && sourceInfo.duration <= 60, '片尾音效须是 60 秒以内的有效音频')
  const assetDir = await mkdtemp(join(tmp, 'ending-'))
  const file = join(assetDir, '大气片尾声效.wav')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source.file, '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', file], { signal })
  const wav = await readFile(file)
  assert(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE', '片尾音效解码未生成有效 WAV')
  let bytesPerSecond = 0
  let audioBytes = 0
  for (let offset = 12; offset + 8 <= wav.length;) {
    const tag = wav.toString('ascii', offset, offset + 4)
    const length = wav.readUInt32LE(offset + 4)
    assert(offset + 8 + length <= wav.length, '片尾音效 WAV 数据不完整')
    if (tag === 'fmt ' && length >= 16) bytesPerSecond = wav.readUInt32LE(offset + 16)
    if (tag === 'data') audioBytes += length
    offset += 8 + length + (length % 2)
  }
  const soundDuration = audioBytes / bytesPerSecond
  assert(Number.isFinite(soundDuration) && soundDuration >= transitionSeconds && soundDuration <= 60, `片尾音效不足 ${transitionSeconds} 秒或不是有效完整音频`)
  const frames = Math.ceil((soundDuration - transitionSeconds / 2) * 30)
  const path = join(assetDir, '炫光转场')
  await cp(transition.path, path, { recursive: true, force: false, errorOnExist: true, filter: async (sourcePath) => {
    signal?.throwIfAborted()
    assert(!(await lstat(sourcePath)).isSymbolicLink(), '原生炫光资源不能包含符号链接或目录联接')
    return true
  } })
  return {
    schemaVersion: 2, ...ENDING_SOUND, assetDir, sourceFile: source.file, registry: source.registry,
    file: join(assetDir, '定格.png'), type: 'photo', freeze, targetStart,
    duration: Math.round(frames / 30 * 1e6) / 1e6, frames, transitionSeconds,
    transition: { ...ENDING_TRANSITION, duration: transitionSeconds, path, start: targetStart - transitionSeconds / 2 },
    sound: { ...ENDING_SOUND, file, sourceStart: 0, targetStart: targetStart - transitionSeconds / 2,
      duration: soundDuration, sourceDuration: soundDuration, volume: 1, fadeIn: 0, fadeOut: 0 },
  }
}

/** Only extract the requested source frame; the draft must get a photo, not baked video. */
export async function renderEnding(ffmpeg, { ending, width, height, signal }) {
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', seconds(ending.freeze.sourceTime), '-i', ending.freeze.sourceFile,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    '-frames:v', '1', ending.file], { signal })
  return ending
}

/** Reuse the resource's actual light frames and screen equation for the MP4 export. */
export async function appendEnding(ffmpeg, { input, output, ending, encoder, signal }) {
  const { width, height } = await probe(ffmpeg, input, { signal })
  const sequence = join(ending.assetDir, 'transition-frames')
  await mkdir(sequence)
  const sourceDir = join(ending.transition.path, EFFECT_ROOT, 'xshader', 'resource1', 'seq16-9')
  const signature = await readFile(join(sourceDir, 'light1.png'))
  // Cached files can be WebP despite their .png names; preserve their actual encoding.
  const extension = signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : 'png'
  // Match draft microseconds, then sample the output grid (starts can fall between frames).
  const transitionStartUs = Math.round(ending.transition.start * 1e6)
  const transitionDurationUs = Math.round(ending.transition.duration * 1e6)
  const firstFrame = Math.ceil(transitionStartUs * 30 / 1e6)
  const endFrame = Math.ceil((transitionStartUs + transitionDurationUs) * 30 / 1e6)
  for (let frame = 0; frame < Math.max(1, endFrame - firstFrame); frame++) {
    // SadGE.lua: clamp(floor(progress * frameCnt) + startFrame, 0, frameCnt - 1).
    const progress = transitionDurationUs ? Math.max(0, ((firstFrame + frame) * 1e6 / 30 - transitionStartUs) / transitionDurationUs) : 0
    const index = Math.min(22, Math.floor(progress * 23) + 1)
    await copyFile(join(sourceDir, `light${index + 1}.png`), join(sequence, `f${String(frame).padStart(2, '0')}.${extension}`))
  }
  const start = seconds(ending.targetStart)
  const transitionStart = seconds(transitionStartUs / 1e6)
  const transitionEnd = seconds((transitionStartUs + transitionDurationUs) / 1e6)
  const total = seconds(ending.targetStart + ending.duration)
  const filters = [
    `[0:v]fps=30,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${seconds(ending.duration)},trim=duration=${total}[main]`,
    `[1:v]setpts=PTS-STARTPTS+${start}/TB[photo]`,
    `[main][photo]overlay=format=rgb:eof_action=repeat:enable='gte(t,${start})',format=gbrp[base]`,
    `[2:v]${height > width ? 'transpose=clock,' : ''}scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bilinear,crop=${width}:${height},setsar=1,format=gbrp,setpts=PTS-STARTPTS+${firstFrame}[light]`,
    `[base][light]blend=all_expr='floor(0.5+255-(255-A)*(255-B)/255)':eof_action=pass:enable='gte(t,${transitionStart})*lt(t,${transitionEnd})',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`,
  ].join(';')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-loop', '1', '-framerate', '30', '-i', ending.file,
    '-framerate', '30', '-start_number', '0', '-i', join(sequence, `f%02d.${extension}`),
    '-filter_complex', filters, '-map', '[v]', '-map', '0:a?', ...encoding(encoder),
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'copy',
    '-t', total, '-movflags', '+faststart', output], { signal })
  return output
}
