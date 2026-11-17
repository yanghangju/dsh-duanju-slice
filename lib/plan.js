// Orchestration for one task: 勘察短剧目录 → AI 选段 → 语音识别取台词时间码 → 字幕定位 → 切点 → 首尾帧.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { transcribeEpisode } from './asr.js'
import { findEpisode, listEpisodes } from './drama-source.js'
import { ffmpegPath, verifyFrames } from './frames.js'
import { cutPoints, expandSubtitleRange, matchScriptLines, refineCutByWords, scriptLineText, snapToFrame } from './locate.js'
import { pickFromLines, pickSegment } from './pick.js'
import { parseScript } from './script.js'

const MIN_COVERAGE = 0.6
const MIN_SPAN_SECONDS = 8

function buildWarnings(matching, crossLanguage, notes) {
  const warnings = [...notes]
  if (crossLanguage && !matching.direct) warnings.push('剧本是中文、识别台词是英文，切点由模型按台词语义给出，请人工核对')
  if (matching.coverage < MIN_COVERAGE && !matching.direct) warnings.push(`台词匹配覆盖率只有 ${(matching.coverage * 100).toFixed(0)}%，请人工核对切点`)
  return warnings
}

function scriptEpisodeOf(script, number) {
  return script.episodes.find((item) => item.number === number)
}

const LEAD = 0.1
const TAIL = 0.15

/** 整句边界 → 词级收紧：只收不放，仍在原句范围内。 */
function tightenCut(cut, refined) {
  if (!cut || !refined) return cut
  const start = Number.isFinite(refined.start) ? Math.max(cut.start, snapToFrame(refined.start - LEAD)) : cut.start
  const end = Number.isFinite(refined.end) ? Math.min(cut.end, snapToFrame(refined.end + TAIL, 'ceil')) : cut.end
  if (end - start < 1) return cut
  return { ...cut, start, end, wordRefined: true }
}

function textOfLine(line) {
  return line.zh || (line.en ?? []).map((item) => item.text).join(' ')
}

function hanRatio(text) {
  const han = (String(text ?? '').match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (String(text ?? '').match(/[A-Za-z]/g) ?? []).length
  return han + latin ? han / (han + latin) : 0
}

/** 剧本用来匹配的那一列（优先英文，其次中文）里中文的占比。 */
function scriptRatio(lines) {
  return hanRatio(lines.map((line) => scriptLineText(line)).join(' '))
}

/** 识别台词里中文的占比：几乎为 0 就是英文（或其它拉丁语种）人声。 */
function dialogueRatio(lines) {
  return hanRatio(lines.map((line) => line.text ?? textOfLine(line)).join(' '))
}

/**
 * @param {{dramaDir: string, scriptDocx: string, direction: string, ctx?: any,
 *   provider?: string, model?: string, signal?: AbortSignal, framesDir?: string,
 *   verification?: boolean, ffmpeg?: string, ffprobe?: string, cacheDir: string,
 *   config?: object, onProgress?: (step: string, detail?: any) => void,
 *   manualPick?: {episode: number, lineIds?: number[], reason?: string}}} input
 */
export async function planSlice(input) {
  const { dramaDir, scriptDocx, direction } = input
  const onProgress = input.onProgress ?? (() => {})
  if (!direction || !direction.trim()) throw new Error('缺少内容方向')
  if (!existsSync(scriptDocx)) throw new Error(`剧本不存在：${scriptDocx}`)
  if (!existsSync(dramaDir)) throw new Error(`短剧目录不存在：${dramaDir}`)

  await onProgress('survey')
  const script = parseScript(await readFile(scriptDocx))
  const project = await listEpisodes({ dramaDir, ffprobe: input.ffprobe, signal: input.signal })
  if (!project.episodes.length) throw new Error(`短剧目录里没有认出任何一集：${dramaDir}（文件名或文件夹名要有 ep01/第1集/1 这类集号）`)

  const byNumber = new Map(project.episodes.map((episode) => [episode.episode, episode]))
  const usable = script.episodes
    .map((episode) => byNumber.get(episode.number))
    .filter((episode) => episode && episode.hasAudio && episode.duration >= 3)
  if (!usable.length) throw new Error('没有既能读、又能和剧本配上的集（需要视频带音轨，且剧本里有这一集）')

  const notes = []
  await onProgress('pick')
  let pick
  if (input.manualPick) {
    const target = scriptEpisodeOf(script, Number(input.manualPick.episode))
    if (!target) throw new Error(`剧本里没有第 ${input.manualPick.episode} 集`)
    const ids = input.manualPick.lineIds
    const from = ids ? Number(ids[0]) : Number(input.manualPick.start)
    const to = ids ? Number(ids[1]) : Number(input.manualPick.end)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) throw new Error('手动的行号区间无效')
    pick = {
      episode: target.number,
      start: from - 1,
      end: Math.min(target.lines.length, to) - 1,
      reason: input.manualPick.reason ?? '手动指定行号（离线）',
      match: 'manual',
    }
  } else {
    pick = await pickSegment({
      direction,
      script,
      usableEpisodes: usable.map((episode) => ({ episode: episode.episode, duration: episode.duration })),
      ctx: input.ctx,
      provider: input.provider,
      model: input.model,
      signal: input.signal,
    })
  }

  let episode = findEpisode(project, pick.episode)
  if (!episode) throw new Error(`短剧目录里没有第 ${pick.episode} 集`)
  let scriptEpisode = scriptEpisodeOf(script, episode.episode)
  let chosenLines = scriptEpisode.lines.slice(pick.start, pick.end + 1).map((line, offset) => ({ ...line, index: pick.start + offset }))

  // 这一步要花钱（按音频时长计费），所以只在选定集之后才做，结果按文件指纹缓存。
  await onProgress('asr', { episode: episode.episode, files: episode.parts.length })
  const asr = await transcribeEpisode(episode, {
    ffmpeg: ffmpegPath(input.ffmpeg),
    cacheDir: input.cacheDir,
    config: input.config ?? {},
    signal: input.signal,
    onProgress: (event) => {
      const detail = { episode: episode.episode }
      if (Number.isFinite(event.done) && Number.isFinite(event.total)) {
        detail.done = event.done
        detail.total = event.total
      }
      onProgress('asr', detail)
    },
  })
  const dialogue = asr.lines
  if (!dialogue.length) throw new Error(`第 ${episode.episode} 集语音识别没有识别到台词（可能没人声），请换一集或用 episode + lines 手动指定`)
  notes.push(asr.cached
    ? `台词来自本地缓存（${asr.lines.length} 句），本次没有再花识别费用`
    : `语音识别完成：${asr.lines.length} 句台词、${asr.billedSeconds.toFixed(1)} 秒音频`)

  // 剧本中文、识别文本英文：文本相似度必然为 0，直接走"按台词选段"。
  const crossLanguage = scriptRatio(chosenLines) > 0.7 && dialogueRatio(dialogue) < 0.3
  if (crossLanguage) notes.push('剧本是中文、识别台词是英文，跳过文本比对，改按台词语义选段')
  let matching = crossLanguage
    ? { matches: [], hits: [], coverage: 0, confidence: 0, crossLanguage: true }
    : matchScriptLines(dialogue, chosenLines)
  const matchedCut = tightenCut(
    cutPoints(matching, { videoSegments: episode.videoSegments }),
    crossLanguage || input.manualPick ? undefined : refineCutByWords(matching, chosenLines),
  )
  const matchedDuration = matchedCut ? matchedCut.end - matchedCut.start : 0

  if ((matching.coverage < MIN_COVERAGE || matchedDuration < MIN_SPAN_SECONDS) && !input.manualPick) {
    if (!input.ctx) throw new Error('台词和剧本对不上，离线模式无法按台词语义选段；请在 DSH 里运行（会用模型读台词）')
    await onProgress('pick-subtitles', { episode: episode.episode, coverage: matching.coverage })
    const direct = await pickFromLines({
      direction,
      episode: { ...episode, dialogue },
      ctx: input.ctx,
      provider: input.provider,
      model: input.model,
      signal: input.signal,
      scriptLines: crossLanguage ? chosenLines : undefined,
    })
    const { from, to } = expandSubtitleRange(dialogue, direct.start, direct.end)
    const subtitleRange = dialogue.slice(from, to + 1)
    pick = { ...direct, episode: episode.episode, start: from, end: to, fromSubtitles: true }
    matching = { matches: [], hits: subtitleRange.map((subtitle, offset) => ({ subtitleIndex: from + offset, subtitle })), coverage: 1, confidence: 1, direct: true }
    chosenLines = []
  }

  const cut = tightenCut(
    cutPoints(matching, { videoSegments: episode.videoSegments }),
    matching.direct || input.manualPick ? undefined : refineCutByWords(matching, chosenLines),
  )
  if (!cut) throw new Error('台词定位失败：没有匹配到任何一句台词')
  if (cut.end - cut.start < 3) throw new Error(`定位到的片段只有 ${(cut.end - cut.start).toFixed(1)}s，太短，请换一个方向或确认剧本和素材是否同一部`)

  let frames
  if (input.verification !== false && input.framesDir) {
    await onProgress('frames')
    frames = await verifyFrames({
      ffmpeg: ffmpegPath(input.ffmpeg),
      episode,
      cut: { start: cut.start, end: cut.end },
      outDir: input.framesDir,
      prefix: `EP${String(episode.episode).padStart(3, '0')}`,
    })
  }

  return {
    direction,
    episode: episode.episode,
    name: episode.name,
    files: episode.parts.map((part) => part.name),
    dramaDir,
    scriptDocx,
    pick: { reason: pick.reason, match: pick.match, fromSubtitles: Boolean(pick.fromSubtitles), model: pick.model },
    scriptLines: chosenLines.map((line) => ({ index: line.index + 1, speaker: line.speaker, zh: line.zh, en: (line.en ?? []).map((item) => item.text) })),
    dialogueCount: dialogue.length,
    asr: { lines: dialogue.length, cached: asr.cached, billedSeconds: asr.billedSeconds },
    matches: matching.matches,
    coverage: Number(matching.coverage.toFixed(2)),
    confidence: Number(matching.confidence.toFixed(2)),
    warnings: buildWarnings(matching, crossLanguage, notes),
    crossLanguage,
    notes,
    cut,
    duration: Number((cut.end - cut.start).toFixed(2)),
    frames,
    // 交给切片环节直接用，不写进工具返回值。
    source: episode,
  }
}

export function formatPlan(plan) {
  const lines = []
  lines.push(`# 切片方案：第${plan.episode}集（${plan.name}）`)
  lines.push(`- 方向：${plan.direction}`)
  lines.push(`- 选段理由：${plan.pick.reason || '-'}（匹配度 ${plan.pick.match}${plan.pick.fromSubtitles ? '，按台词兜底' : ''}）`)
  lines.push(`- 时间码：${plan.cut.start.toFixed(2)}s → ${plan.cut.end.toFixed(2)}s（时长 ${plan.duration.toFixed(2)}s${plan.cut.wordRefined ? '，切点按逐词时间码收紧' : ''}）`)
  lines.push(`- 台词匹配：${plan.coverage * 100}% 覆盖，平均相似度 ${plan.confidence}（识别台词 ${plan.dialogueCount} 句）`)
  lines.push(`- 首句台词：${plan.cut.firstText}`)
  lines.push(`- 末句台词：${plan.cut.lastText}`)
  lines.push(`- 语音识别：${plan.asr.cached ? '命中本地缓存（未再计费）' : `${plan.asr.billedSeconds.toFixed(1)} 秒音频`}`)
  if (plan.scriptLines.length) {
    lines.push('')
    lines.push('| 台词 | 中文 | English |')
    lines.push('|---|---|---|')
    for (const line of plan.scriptLines) lines.push(`| ${line.index} | ${line.speaker ?? ''} ${line.zh ?? ''} | ${line.en.join(' ')} |`)
  }
  if (plan.frames) {
    lines.push('')
    lines.push(`- 首帧：${plan.frames.head.outFile}（源 ${plan.frames.head.file.split(/[\\/]/).pop()} @ ${plan.frames.head.seek.toFixed(2)}s）`)
    lines.push(`- 尾帧：${plan.frames.tail.outFile}（源 ${plan.frames.tail.file.split(/[\\/]/).pop()} @ ${plan.frames.tail.seek.toFixed(2)}s）`)
  }
  return lines.join('\n')
}
