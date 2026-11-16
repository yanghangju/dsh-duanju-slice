// 片尾：沿用短剧剪辑插件的最后处理——剪映原生「大气片尾声效」+ 原生「炫光」转场 + 时停定格。
// 只用剪映真实资源，不自制光效、不换别的音效；成片在剧情结束后继续播放定格画面与光效。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENDING_SOUND = { title: '大气片尾声效', resourceId: '7023776340713164069' }
export const ENDING_TRANSITION = { title: '炫光', resourceId: '6726707814028284423', duration: 0.8 }
export const FREEZE_OFFSET_SECONDS = 1.5

const ASSETS_DIR = fileURLToPath(new URL('../assets/ending/', import.meta.url))
const BUNDLED_SOUND = join(ASSETS_DIR, '大气片尾声效.mp3')
const BUNDLED_TRANSITION = join(ASSETS_DIR, '炫光转场')
const EFFECT_ROOT = 'AmazingAuto_out'
const LIGHT_FRAMES = 23
const seconds = (value) => value.toFixed(6)

function run(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], signal })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}：${stderr.slice(-1200)}`))))
  })
}

async function probeDuration(ffprobe, file, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let out = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { out += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe 退出码 ${code}：${stderr.slice(-400)}`))
      const value = Number(out.trim())
      if (!Number.isFinite(value) || value <= 0) return reject(new Error(`读不到有效时长：${file}`))
      resolve(value)
    })
  })
}

/** 剪映「大气片尾声效」：内置资源优先，其次剪映下载缓存，最后才是显式配置。 */
export async function findEndingSound({ soundPath } = {}) {
  if (soundPath) {
    assert(existsSync(soundPath), `找不到片尾音效：${soundPath}`)
    return { ...ENDING_SOUND, file: soundPath }
  }
  if (existsSync(BUNDLED_SOUND)) return { ...ENDING_SOUND, file: BUNDLED_SOUND }
  const cache = join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Cache', 'music')
  const registry = join(cache, 'downLoadcfg')
  if (existsSync(registry)) {
    const value = JSON.parse(await readFile(registry, 'utf8'))
    for (const entry of value.list ?? []) {
      if (String(entry.resourceId) !== ENDING_SOUND.resourceId || typeof entry.path !== 'string') continue
      assert(entry.path === entry.path.split(/[\\/]/).pop(), '剪映片尾音效缓存路径异常')
      const file = join(cache, entry.path)
      if (existsSync(file)) return { ...ENDING_SOUND, file, registry }
    }
  }
  throw new Error('未找到剪映内置「大气片尾声效」（7023776340713164069）：插件内置资源与剪映缓存均缺失。请重装带 assets/ending 的插件包，或在剪映音效库下载一次，或配置 ending.soundPath；不会用其他音效替代。')
}

/** 剪映原生「炫光」转场：只接受与本地渲染算法完全一致的那一版资源。 */
export async function findEndingTransition({ transitionPath } = {}) {
  let candidates
  if (transitionPath) {
    candidates = [transitionPath]
  } else {
    candidates = []
    if (existsSync(join(BUNDLED_TRANSITION, EFFECT_ROOT, 'xshader', 'generalEffect.json'))) candidates.push(BUNDLED_TRANSITION)
    const cache = join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Cache', 'effect', ENDING_TRANSITION.resourceId)
    if (existsSync(cache)) {
      candidates.push(...(await readdir(cache, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(cache, entry.name)))
    }
  }
  const path = candidates.find((candidate) => existsSync(join(candidate, EFFECT_ROOT, 'xshader', 'generalEffect.json')))
  assert(path, '未找到剪映原生转场「炫光」（6726707814028284423）：插件内置资源与剪映缓存均缺失。请重装带 assets/ending 的插件包，或在剪映下载此转场，或配置 ending.transitionPath；不会用自制光效替代。')
  return validateTransition(path)
}

async function validateTransition(path) {
  const config = JSON.parse(await readFile(join(path, EFFECT_ROOT, 'xshader', 'generalEffect.json'), 'utf8'))
  const effect = config.effect?.find((entry) => entry.name === 'DazzleLight')
  const uniform = (name) => effect?.fUniforms?.find((entry) => entry.name === name)?.data
  assert(uniform('blendMode')?.[0] === 21 && uniform('alphaFactor')?.[0] === 1 && uniform('clockwise')?.[0] === 1
    && JSON.stringify(uniform('fullBlendTexSize')) === '[640,360]' && uniform('blendTexture')?.length === LIGHT_FRAMES,
  '原生炫光资源参数已变化，不能用不匹配的混合算法导出')
  const vars = await readFile(join(path, EFFECT_ROOT, 'lua', 'Vars.lua'), 'utf8')
  assert(new RegExp(`frameCnt\\s*=\\s*${LIGHT_FRAMES}\\b`).test(vars) && /startFrame\s*=\s*1\b/.test(vars), '原生炫光序列规则已变化')
  for (let index = 1; index <= LIGHT_FRAMES; index++) {
    const info = await lstat(join(path, EFFECT_ROOT, 'xshader', 'resource1', 'seq16-9', `light${index}.png`))
    assert(info.isFile() && !info.isSymbolicLink(), '原生炫光序列缺失或包含符号链接')
  }
  return { ...ENDING_TRANSITION, path }
}

/** 整段音效解码成 WAV，用采样数算时长，避开 MP3 填充与探测取整带来的误差。 */
async function decodeSound(ffmpeg, file, outFile, { signal } = {}) {
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outFile], { signal })
  const wav = await readFile(outFile)
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
  assert(bytesPerSecond > 0 && audioBytes > 0, '片尾音效 WAV 缺少有效数据块')
  return audioBytes / bytesPerSecond
}

/**
 * 片尾预算：音效整段完整播放，转场与音效都从 E−t/2 同时开始；画面定格取 E−1.5 的那一帧。
 * 返回的 duration 是剧情结束后新增的时长（向上取整到整帧）。
 */
export async function prepareEnding(ffmpeg, ffprobe, input) {
  const { content, tmp, width, height, fps = 30, signal } = input
  const transitionSeconds = input.transitionSeconds ?? ENDING_TRANSITION.duration
  const freezeOffsetSeconds = input.freezeOffsetSeconds ?? FREEZE_OFFSET_SECONDS
  assert(Number.isFinite(transitionSeconds) && transitionSeconds > 0 && transitionSeconds <= 10, '片尾炫光转场时长必须是大于 0 且不超过 10 秒的有限数值')
  assert(Number.isFinite(freezeOffsetSeconds) && freezeOffsetSeconds >= 0 && freezeOffsetSeconds <= 30, '片尾时停取帧位置无效')
  const sound = await findEndingSound({ soundPath: input.soundPath })
  const transition = await findEndingTransition({ transitionPath: input.transitionPath })
  const contentDuration = await probeDuration(ffprobe, content, { signal })

  const assetDir = await mkdtemp(join(tmp, 'ending-'))
  const soundFile = join(assetDir, '大气片尾声效.wav')
  const soundDuration = await decodeSound(ffmpeg, sound.file, soundFile, { signal })
  assert(soundDuration >= transitionSeconds, `片尾音效只有 ${soundDuration.toFixed(3)} 秒，短于 ${transitionSeconds} 秒转场`)
  const frames = Math.ceil((soundDuration - transitionSeconds / 2) * fps - 1e-9)
  assert(frames >= 1, '片尾音效过短，无法生成定格画面')
  const duration = frames / fps
  const totalDuration = Math.round((contentDuration + duration) * 1e6) / 1e6

  // 时停：从成片实际画面（含叠轨画面与已烧字幕）取 E−1.5 那一帧，保证定格与剧情末尾完全一致。
  const freezeAt = Math.max(0, Math.round((contentDuration - Math.min(freezeOffsetSeconds, Math.max(0, contentDuration - 1 / fps))) * 1e6) / 1e6)
  const photo = join(assetDir, '定格.png')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', seconds(freezeAt), '-i', content,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    '-frames:v', '1', photo], { signal })

  const path = join(assetDir, '炫光转场')
  await cp(transition.path, path, { recursive: true, force: false, errorOnExist: true, filter: async (sourcePath) => {
    signal?.throwIfAborted()
    assert(!(await lstat(sourcePath)).isSymbolicLink(), '原生炫光资源不能包含符号链接或目录联接')
    return true
  } })

  return {
    title: sound.title, resourceId: sound.resourceId, assetDir, soundFile, photo,
    contentDuration, totalDuration, duration, frames,
    freeze: { offsetSeconds: freezeOffsetSeconds, sourceSeconds: freezeAt },
    transitionSeconds, transitionStart: Math.max(0, Math.round((contentDuration - transitionSeconds / 2) * 1e6) / 1e6),
    transition: { ...transition, path, duration: transitionSeconds },
    sound: { ...sound, duration: soundDuration, start: Math.max(0, Math.round((contentDuration - transitionSeconds / 2) * 1e6) / 1e6), volume: 1 },
  }
}

/** 草稿也要带片尾：把音效解码进草稿目录、复制原生炫光资源，算出片尾时长（与成片同一套算法）。 */
export async function prepareDraftEnding(ffmpeg, { draftDir, soundPath, transitionSeconds = ENDING_TRANSITION.duration, fps = 30, signal } = {}) {
  assert(Number.isFinite(transitionSeconds) && transitionSeconds > 0 && transitionSeconds <= 10, '片尾炫光转场时长必须是大于 0 且不超过 10 秒的有限数值')
  const sound = await findEndingSound({ soundPath })
  const transition = await findEndingTransition()
  const dir = join(draftDir, 'materials', '_ending')
  await mkdir(dir, { recursive: true })
  const soundFile = join(dir, '大气片尾声效.wav')
  const soundDuration = await decodeSound(ffmpeg, sound.file, soundFile, { signal })
  assert(soundDuration >= transitionSeconds, `片尾音效只有 ${soundDuration.toFixed(3)} 秒，短于 ${transitionSeconds} 秒转场`)
  const frames = Math.ceil((soundDuration - transitionSeconds / 2) * fps - 1e-9)
  assert(frames >= 1, '片尾音效过短，无法生成定格画面')
  const transitionPath = join(dir, '炫光转场')
  await cp(transition.path, transitionPath, { recursive: true, force: true })
  return {
    title: sound.title,
    resourceId: sound.resourceId,
    soundFile,
    soundDuration,
    duration: frames / fps,
    transitionSeconds,
    transition: { ...transition, path: transitionPath, duration: transitionSeconds },
    start: transitionSeconds / 2,
    dir,
  }
}

/** 为成片拼上片尾：时停画面 + 原生炫光序列 + 完整音效，音效不裁切、不淡入淡出。 */
export async function appendEnding(ffmpeg, { input, output, ending, width, height, fps = 30, crf = 18, signal }) {
  const sequence = join(ending.assetDir, 'transition-frames')
  await mkdir(sequence, { recursive: true })
  const sourceDir = join(ending.transition.path, EFFECT_ROOT, 'xshader', 'resource1', 'seq16-9')
  const signature = await readFile(join(sourceDir, 'light1.png'))
  // 剪映缓存里的 .png 可能是 WebP 容器，按真实编码给出扩展名。
  const extension = signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : 'png'

  const startUs = Math.round(ending.transitionStart * 1e6)
  const durationUs = Math.round(ending.transitionSeconds * 1e6)
  const firstFrame = Math.ceil(startUs * fps / 1e6 - 1e-9)
  const endFrame = Math.ceil((startUs + durationUs) * fps / 1e6 - 1e-9)
  const count = Math.max(1, endFrame - firstFrame)
  for (let frame = 0; frame < count; frame++) {
    // SadGE.lua：clamp(floor(progress * frameCnt) + startFrame, 0, frameCnt - 1)。
    const progress = durationUs ? Math.max(0, (((firstFrame + frame) * 1e6 / fps) - startUs) / durationUs) : 0
    const index = Math.min(LIGHT_FRAMES - 1, Math.floor(progress * LIGHT_FRAMES) + 1)
    await copyFile(join(sourceDir, `light${index + 1}.png`), join(sequence, `f${String(frame).padStart(2, '0')}.${extension}`))
  }

  const contentEnd = seconds(ending.contentDuration)
  const total = seconds(ending.totalDuration)
  const transitionStart = seconds(ending.transitionStart)
  const transitionEnd = seconds(ending.transitionStart + ending.transitionSeconds)
  const lightStart = seconds(firstFrame / fps)
  const soundDelay = Math.max(0, Math.round(ending.sound.start * 1000))
  const filters = [
    `[0:v]fps=${fps},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${seconds(ending.duration)},trim=duration=${total}[main]`,
    `[1:v]setpts=PTS-STARTPTS+${contentEnd}/TB[photo]`,
    `[main][photo]overlay=format=rgb:eof_action=repeat:enable='gte(t,${contentEnd})',format=gbrp[base]`,
    `[2:v]${height > width ? 'transpose=clock,' : ''}scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bilinear,crop=${width}:${height},setsar=1,format=gbrp,setpts=PTS-STARTPTS+${lightStart}/TB[light]`,
    `[base][light]blend=all_expr='floor(0.5+255-(255-A)*(255-B)/255)':eof_action=pass:enable='gte(t,${transitionStart})*lt(t,${transitionEnd})',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`,
    `[0:a]asetpts=PTS-STARTPTS,apad,atrim=0:${total}[content]`,
    `[3:a]adelay=${soundDelay}:all=1,atrim=0:${total},asetpts=PTS-STARTPTS[sfx]`,
    `[content][sfx]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.97[a]`,
  ].join(';')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-loop', '1', '-framerate', String(fps), '-i', ending.photo,
    '-framerate', String(fps), '-start_number', '0', '-i', join(sequence, `f%02d.${extension}`),
    '-i', ending.soundFile,
    '-filter_complex', filters, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-map_metadata', '-1', '-dn', '-t', total, '-movflags', '+faststart', output], { signal })
  return output
}
