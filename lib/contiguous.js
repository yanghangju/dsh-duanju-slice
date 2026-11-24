// 原片切片与 Promo 混剪分开：只把一集上的一个连续时间窗交给旧草稿和渲染器。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { findDraftRoot, safeName } from './draft-root.js'
import { findEpisode, listEpisodes } from './drama-source.js'
import { ffmpegPath, ffprobePath, grabTimelineFrame, verifyFrames } from './frames.js'
import { planSlice } from './plan.js'
import { generateText, parseModelJson, selectModel } from './promo/model.js'
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

const COVER_FPS = 3
const COVER_WINDOW = 2
const COVER_BATCH = COVER_FPS * COVER_WINDOW
const COVER_PROMPT = '检查单集切片开头的抽帧，按时间顺序逐张判断是否为应剔除的独立封面或片头标题卡。海报、静态宣传封面、大字标题卡属于封面；正常剧情画面即使有字幕、角标、标题叠字或短时间静止也不是封面。只判断提供的帧，不猜未提供的画面。只返回 JSON，例如 {"covers":[true,false]}：数组须与图片数量和顺序完全一致，true 为封面，false 为非封面，无法判断时用 null。'

async function openingStart({ ctx, source, cut, ffmpeg, exportDir, modelOptions, signal }) {
  const attachments = ctx?.get('attachments')
  assert(attachments?.saveImages, '切片开头封面检查需要图片附件服务')
  const route = await selectModel(ctx, { ...modelOptions, signal })
  const info = await ctx.get('llm').resolveModelInfo(route.provider, route.model, signal)
  assert(info?.inputModalities?.includes('image'), `当前模型 ${route.provider}/${route.model} 不支持图片，请切换到支持图片输入的模型`)
  const outDir = await mkdtemp(join(exportDir, '.slice-cover-'))
  try {
    // 先完整检查前两秒；只有最后一帧仍是封面，才延续同一抽帧节奏找新的起点。
    for (let offset = 0; ; offset += COVER_BATCH) {
      const times = Array.from({ length: COVER_BATCH }, (_, i) => cut.start + (offset + i) / COVER_FPS)
        .filter(at => offset === 0 ? at < cut.end : cut.end - at >= 1)
      if (!times.length) break
      const frames = []
      for (const at of times) {
        const name = `${at.toFixed(6)}s.jpg`
        const file = join(outDir, name)
        await grabTimelineFrame({ ffmpeg, episode: source, timelineSeconds: at, outFile: file, signal })
        frames.push({ name, data: await readFile(file), mediaType: 'image/jpeg' })
      }
      const refs = await attachments.saveImages(frames)
      assert(refs?.length === frames.length && frames.every((_, i) => refs[i]), '未收到全部抽样帧')
      const content = refs.flatMap((attachment, i) => [
        { type: 'text', text: `原片 ${times[i].toFixed(6)} 秒` }, { type: 'image', attachment },
      ])
      const { response } = await generateText(ctx, { ...route, signal, system: COVER_PROMPT, content, maxTokens: 1500 })
      const { covers } = parseModelJson(response)
      assert(Array.isArray(covers) && covers.length === times.length && covers.every(value => typeof value === 'boolean'), '视觉模型未能明确判定全部抽样帧')
      const lastCover = covers.lastIndexOf(true)
      if (offset === 0 && lastCover < 0) return cut.start
      const firstClear = offset === 0 ? lastCover + 1 : covers.indexOf(false)
      if (firstClear < 0 || firstClear >= times.length) continue
      const start = times[firstClear]
      if (cut.end - start >= 1) return start
      break
    }
    throw new Error('剔除封面后无法保留至少 1 秒的片段，请调整切片范围')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

async function deliver({ ctx, source, cut, settings, config, media, version, signal, progress, note = '', plan, framesDir, modelOptions }) {
  cut = cutWindow(cut.start, cut.end, source.duration)
  const { exportDir, dramaDir, scriptPath } = settings
  const originalStart = cut.start
  await mkdir(exportDir, { recursive: true })
  if (originalStart <= COVER_WINDOW) {
    await progress('frames', { episode: source.episode })
    try {
      cut.start = await openingStart({ ctx, source, cut, ...media, exportDir, modelOptions, signal })
    } catch (error) {
      signal?.throwIfAborted()
      throw new Error(`切片开头封面检查失败：${error.message}`, { cause: error })
    }
  }
  if (plan) {
    let frames
    if (framesDir) {
      await progress('frames')
      frames = await verifyFrames({ ...media, episode: source, cut, outDir: framesDir, prefix: `EP${String(source.episode).padStart(3, '0')}`, signal })
    }
    plan = { ...plan, cut: { ...plan.cut, ...cut }, duration: Number((cut.end - cut.start).toFixed(2)), frames }
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const suffix = randomUUID().slice(0, 8)
  const scriptName = scriptPath ? basename(scriptPath, extname(scriptPath)) : basename(dramaDir)
  const stem = safeName(`第${source.episode}集_${scriptName}`, 20)
  const draftName = `${stem}_v${version}_${suffix.slice(0, 6)}`
  const outFile = join(exportDir, `${stem}_v${version}_${stamp}_${suffix}.mp4`)
  await progress('draft', { episode: source.episode })
  const draftInput = {
    // Legacy draft materials need full file durations as well as their source timeranges.
    episode: { ...source, videoSegments: source.videoSegments.map((segment) => ({ ...segment, duration: segment.sourceEnd })) },
    cut, name: draftName, ffmpeg: media.ffmpeg, audioLevels: ORIGINAL_LEVELS, ending: NO_ENDING,
  }
  // Publish the MP4 only after rendering succeeds; the temporary draft isn't registered with Jianying.
  const scratch = await mkdtemp(join(exportDir, '.slice-draft-'))
  let video
  try {
    const timeline = await buildSliceDraft({ ...draftInput, draftRoot: scratch, cover: false })
    const pending = join(scratch, '切片.mp4')
    await progress('render', { episode: source.episode })
    video = await renderSlice({ ...media, episodeDir: timeline.draftDir, cut: { start: 0, end: cut.end - cut.start }, outFile: pending, signal, ending: NO_ENDING })
    signal?.throwIfAborted()
    await rename(pending, outFile)
    video.outFile = outFile
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }

  let draft = null
  let draftStatus = '未找到剪映草稿箱，未保存可编辑草稿'
  const root = await findDraftRoot(settings.draftRoot || config.jianying?.draftRoot || config.draftRoot)
  if (root) {
    try {
      draft = await buildSliceDraft({ ...draftInput, draftRoot: root })
      draftStatus = `剪映草稿：${draft.draftDir}（新草稿可能需要重启剪映才能看到）`
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'ENOSPC', 'ENOENT', 'ENAMETOOLONG'].includes(error?.code)) throw error
      draftStatus = `剪映草稿箱不可写，未保存可编辑草稿（${error.code}）`
    }
  }

  const result = {
    episode: source.episode, ...cut, sourceDuration: source.duration, duration: video.duration,
    draftName: draft?.name ?? null, draftDir: draft?.draftDir ?? null, draftRoot: settings.draftRoot,
    outFile, sourceDir: source.dir, audioLevels: ORIGINAL_LEVELS, note, settings,
  }
  const summary = [
    `连续原片 · 第 ${result.episode} 集 · V${version} · ${cut.start.toFixed(2)}s–${cut.end.toFixed(2)}s（${video.duration}s）`,
    '按原顺序保留原画面和原声，不另加 BGM、转场或片尾。',
    originalStart < cut.start ? `已剔除开头封面与其前段（${(cut.start - originalStart).toFixed(2)} 秒）。` : null,
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
  const modelOptions = { provider: args.provider, model: args.model }
  const delivery = { ctx, config, settings, media, version, signal, progress, modelOptions }

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
    ...modelOptions, signal, config,
    cacheDir: join(workRoot, 'cache'),
    onProgress: progress,
  })
  if (manualPick) {
    const bounds = [plan.matches[0], plan.matches.at(-1)]
    assert(bounds.every((line) => line?.sentences > 0 && line.sentences === line.matchedSentences),
      `第 ${episode} 集未匹配到指定首尾台词，请检查 lines，或用 episode + start + end 直接裁剪`)
  }
  const framesDir = args.verify === false ? undefined : join(workRoot, 'tasks', randomUUID(), 'frames')
  return deliver({ ...delivery, source, cut: plan.cut, note: direction, plan, framesDir })
}

export async function reviseContiguous({ ctx, current, args, config = {}, signal, onProgress, version = 1 }) {
  assert(current, '当前会话还没有连续切片，请先生成初版')
  assert(args.start != null || args.end != null, '修订连续切片需要提供 start 或 end（相对当前起点的秒数）')
  const settings = settingsFor({ ...current.settings, draftRoot: current.draftRoot || (current.draftDir ? dirname(current.draftDir) : undefined) })
  const progress = progressReporter(onProgress, signal)
  const media = mediaOptions(config)
  await progress('survey', { episode: current.episode })
  const source = await revisionEpisode({ settings, lastResult: current }, media)
  const { cut } = revisionEdit(current, args, source.duration)
  assert(cut.start !== current.start || cut.end !== current.end, '首尾时间没有变化，不生成重复版本')
  return deliver({ ctx, source, cut, settings, config, media, version, signal, progress, note: args.note })
}
