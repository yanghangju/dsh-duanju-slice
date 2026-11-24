// 原片切片与 Promo 混剪分开：只把一集上的一个连续时间窗交给旧草稿和渲染器。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { findDraftRoot, safeName } from './draft-root.js'
import { findEpisode, listEpisodes } from './drama-source.js'
import { ffmpegPath, ffprobePath } from './frames.js'
import { planSlice } from './plan.js'
import { BUNDLED_ENABLED, BUNDLED_FFMPEG } from './promo/runtime.js'
import { renderSlice } from './render.js'
import { revisionEdit, revisionEpisode } from './revision.js'
import { parseScript } from './script.js'
import { buildSliceDraft } from './slice-draft.js'

const NO_ENDING = { enabled: false }
const ORIGINAL_LEVELS = { dialogue: 1, music: 1, effects: 1 }

function pathFrom(value, required) {
  const path = typeof value === 'string' && value.trim()
  if (required) assert(path, `请指定${required}`)
  return path ? resolve(path) : null
}

function settingsFor(args) {
  return {
    dramaDir: pathFrom(args.dramaDir, '短剧目录 dramaDir'),
    exportDir: pathFrom(args.exportDir, '成片保存目录 exportDir'),
    scriptPath: pathFrom(args.scriptPath),
    direction: args.direction?.trim() ?? '',
    draftRoot: pathFrom(args.draftRoot),
  }
}

function mediaOptions(config) {
  const ffmpeg = ffmpegPath(config.ffmpegPath || (BUNDLED_ENABLED ? BUNDLED_FFMPEG : undefined))
  return { ffmpeg, ffprobe: ffprobePath(ffmpeg, config.ffprobePath) }
}

function progressReporter(onProgress, signal) {
  let previous
  return async (stage, detail) => {
    if (stage === 'pick-subtitles') stage = 'pick'
    if (stage === previous) return // ASR 每个音频包的进度不重复落盘。
    previous = stage
    signal?.throwIfAborted()
    await onProgress?.(stage, detail)
    signal?.throwIfAborted()
  }
}

function cutWindow(start, end, duration = Infinity) {
  assert(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 1 && end <= duration + 1e-6,
    '切点必须是原集内的秒数：0 ≤ start < end，且至少相隔 1 秒、不能超出原集')
  return { start, end: Math.min(end, duration) }
}

async function manualPickFor({ episode, lines }, scriptDocx) {
  assert(Array.isArray(lines) && lines.length === 2 && lines.every(Number.isSafeInteger) && lines[0] >= 1 && lines[1] >= lines[0],
    'lines 须是两个从 1 开始、按先后顺序排列的剧本行号')
  assert(scriptDocx, '按行号切片需要 DOCX 剧本 scriptPath')
  const target = parseScript(await readFile(scriptDocx)).episodes.find((item) => item.number === episode)
  assert(target, `剧本里没有第 ${episode} 集`)
  assert(lines[1] <= target.lines.length, `第 ${episode} 集只有 ${target.lines.length} 行台词，请检查 lines`)
  return { episode, lineIds: lines }
}

async function deliver({ source, cut, settings, config, media, version, signal, progress, note = '', plan }) {
  cut = cutWindow(cut.start, cut.end, source.duration)
  const { exportDir, dramaDir, scriptPath } = settings
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const suffix = randomUUID().slice(0, 8)
  const scriptName = scriptPath ? basename(scriptPath, extname(scriptPath)) : basename(dramaDir)
  const stem = safeName(`第${source.episode}集_${scriptName}`, 20)
  const draftName = `${stem}_v${version}_${suffix.slice(0, 6)}`
  const outFile = join(exportDir, `${stem}_v${version}_${stamp}_${suffix}.mp4`)
  await mkdir(exportDir, { recursive: true })
  await progress('draft', { episode: source.episode })
  const root = await findDraftRoot(settings.draftRoot || config.jianying?.draftRoot || config.draftRoot)
  const draftInput = {
    // Legacy draft materials need full file durations as well as their source timeranges.
    episode: { ...source, videoSegments: source.videoSegments.map((segment) => ({ ...segment, duration: segment.sourceEnd })) },
    cut, name: draftName, ffmpeg: media.ffmpeg, audioLevels: ORIGINAL_LEVELS, ending: NO_ENDING,
  }
  let draft = null
  let draftStatus = '未找到剪映草稿箱，未保存可编辑草稿'
  if (root) {
    try {
      draft = await buildSliceDraft({ ...draftInput, draftRoot: root })
      draftStatus = `剪映草稿：${draft.draftDir}（新草稿可能需要重启剪映才能看到）`
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'ENOSPC', 'ENOENT', 'ENAMETOOLONG'].includes(error?.code)) throw error
      draftStatus = `剪映草稿箱不可写，未保存可编辑草稿（${error.code}）`
    }
  }

  // 没有可用的剪映草稿箱时，也沿用同一套草稿时间线渲染，临时草稿不作为交付物。
  let scratch
  let video
  try {
    if (!draft) scratch = await mkdtemp(join(exportDir, '.slice-draft-'))
    const timeline = draft ?? await buildSliceDraft({ ...draftInput, draftRoot: scratch, cover: false })
    await progress('render', { episode: source.episode })
    video = await renderSlice({ ...media, episodeDir: timeline.draftDir, cut: { start: 0, end: cut.end - cut.start }, outFile, signal, ending: NO_ENDING })
    assert((await stat(outFile)).size > 0, '渲染未生成有效 MP4')
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  }
  signal?.throwIfAborted()

  const result = {
    episode: source.episode, ...cut, sourceDuration: source.duration, duration: video.duration,
    draftName: draft?.name ?? null, draftDir: draft?.draftDir ?? null, draftRoot: settings.draftRoot,
    outFile, sourceDir: source.dir, audioLevels: ORIGINAL_LEVELS, note, settings,
  }
  const summary = [
    `连续原片 · 第 ${result.episode} 集 · V${version} · ${cut.start.toFixed(2)}s–${cut.end.toFixed(2)}s（${video.duration}s）`,
    '按原顺序保留原画面和原声，不另加 BGM、转场或片尾。',
    plan?.pick.reason ? `选段：${plan.pick.reason}` : null,
    draftStatus,
    `成片：${outFile}`,
  ].filter(Boolean).join('\n')
  return { summary, result, draft, video, ...(plan ? { plan } : {}) }
}

export async function cutContiguous({ ctx, args, config = {}, signal, onProgress, version = 1 }) {
  const settings = settingsFor(args)
  const { episode, lines, start, end } = args
  const byTime = start != null || end != null
  const byLine = lines != null
  assert(!(byTime && byLine), '请二选一：lines 剧本行号，或 start/end 原集时间')
  if (byTime || byLine || episode != null) assert(Number.isSafeInteger(episode) && episode > 0, '手动切片需指定正整数集号 episode')
  assert(episode == null || byTime || byLine, '指定 episode 时请同时给出 lines 或 start/end')
  const progress = progressReporter(onProgress, signal)
  const media = mediaOptions(config)
  const delivery = { config, settings, media, version, signal, progress }

  if (byTime) {
    const window = cutWindow(start, end)
    await progress('survey', { episode })
    const project = await listEpisodes({ dramaDir: settings.dramaDir, ffprobe: media.ffprobe, signal })
    const source = findEpisode(project, episode)
    assert(source, `短剧目录里没有第 ${episode} 集`)
    return deliver({ ...delivery, source, cut: window })
  }

  const scriptDocx = settings.scriptPath
  assert(scriptDocx, '按台词切片需要 DOCX 剧本 scriptPath；也可用 episode + start + end 直接裁剪')
  const manualPick = byLine ? await manualPickFor(args, scriptDocx) : undefined
  const direction = settings.direction || (manualPick ? '按指定台词行号切片' : '')
  assert(direction, '自动选段需要内容方向 direction')
  const workRoot = config.workDir || join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice')
  const { source, ...plan } = await planSlice({
    ctx, ...media, dramaDir: settings.dramaDir, scriptDocx, direction, manualPick,
    provider: args.provider, model: args.model, signal, config,
    cacheDir: join(workRoot, 'cache'),
    framesDir: args.verify === false ? undefined : join(workRoot, 'tasks', randomUUID(), 'frames'),
    onProgress: progress,
  })
  if (manualPick) {
    const bounds = [plan.matches[0], plan.matches.at(-1)]
    assert(bounds.every((line) => line?.sentences > 0 && line.sentences === line.matchedSentences),
      `第 ${episode} 集未匹配到指定首尾台词，请检查 lines，或用 episode + start + end 直接裁剪`)
  }
  return deliver({ ...delivery, source, cut: plan.cut, note: direction, plan })
}

export async function reviseContiguous({ current, args, config = {}, signal, onProgress, version = 1 }) {
  assert(current, '当前会话还没有连续切片，请先生成初版')
  assert(args.start != null || args.end != null, '修订连续切片需要提供 start 或 end（相对当前起点的秒数）')
  const settings = settingsFor({ ...current.settings, draftRoot: current.draftRoot || (current.draftDir ? dirname(current.draftDir) : undefined) })
  const progress = progressReporter(onProgress, signal)
  const media = mediaOptions(config)
  await progress('survey', { episode: current.episode })
  const source = await revisionEpisode({ settings, lastResult: current }, media)
  const { cut } = revisionEdit(current, args, source.duration)
  assert(cut.start !== current.start || cut.end !== current.end, '首尾时间没有变化，不生成重复版本')
  return deliver({ source, cut, settings, config, media, version, signal, progress, note: args.note })
}
