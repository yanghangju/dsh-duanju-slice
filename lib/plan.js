// Orchestration for one task: 勘察 → AI 选段 → 字幕定位 → 切点 → 首尾帧.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { cutPoints, expandSubtitleRange, matchScriptLines, similarity } from './locate.js'
import { resolveDramaGroup, scopeFolders } from './draft.js'
import { ffmpegPath, verifyFrames } from './frames.js'
import { chooseDraft, chooseFamily, pickFromSubtitles, pickSegment } from './pick.js'
import { survey } from './report.js'
import { parseScript } from './script.js'

const MIN_COVERAGE = 0.6

function buildWarnings(matching, crossLanguage, notes) {
  const warnings = [...notes]
  if (crossLanguage && !matching.direct) warnings.push('剧本是中文、字幕是英文，切点由模型按字幕语义给出，请人工核对')
  if (matching.coverage < MIN_COVERAGE && !matching.direct) warnings.push(`字幕匹配覆盖率只有 ${(matching.coverage * 100).toFixed(0)}%，请人工核对切点`)
  return warnings
}

function scriptEpisodeOf(script, number) {
  return script.episodes.find((item) => item.number === number)
}

/** Among several folders for the same episode, prefer the one that really holds that episode. */
function preferCandidate(candidates, scriptEpisode) {
  if (candidates.length === 1) return candidates[0]
  const lines = scriptEpisode.lines
  let best = candidates[0]
  let bestScore = -1
  for (const episode of candidates) {
    if (!episode.dialogue.length) {
      if (bestScore < 0) bestScore = 0
      continue
    }
    let score = 0
    let counted = 0
    for (const line of lines.slice(0, 40)) {
      const text = line.zh ?? (line.en ?? []).map((item) => item.text).join(' ')
      if (!text) continue
      let top = 0
      for (const subtitle of episode.dialogue) top = Math.max(top, similarity(text, subtitle.text))
      score += top
      counted += 1
    }
    const average = counted ? score / counted : 0
    if (average > bestScore) {
      bestScore = average
      best = episode
    }
  }
  return best
}


/** 草稿箱里常混着多部剧：按文件夹命名分成"EPxx"与"纯数字"两组。 */
function familyOf(folder) {
  return /^\s*ep/i.test(String(folder ?? '')) ? 'EP' : '数字'
}

function groupFamilies(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = familyOf(row.folder)
    if (!groups.has(key)) groups.set(key, { key, count: 0, samples: [] })
    const group = groups.get(key)
    group.count += 1
    if (group.samples.length < 6) {
      for (const subtitle of (row.dialogue ?? []).slice(0, 2)) group.samples.push(subtitle.text)
    }
  }
  return [...groups.values()].filter((group) => group.count > 0)
}

function textOfLine(line) {
  return line.zh || (line.en ?? []).map((item) => item.text).join(' ')
}

function scriptRatio(lines) {
  const text = lines.map(textOfLine).join(' ')
  const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return han + latin ? han / (han + latin) : 0
}

async function resolveCandidate(candidates, scriptEpisode, input, notes) {
  if (!candidates.length) throw new Error(`工程里找不到第 ${scriptEpisode.number} 集的草稿`)
  if (candidates.length === 1) return candidates[0]
  if (input.manualDraft) {
    const hit = candidates.find((item) => item.folder === input.manualDraft || item.folder.includes(input.manualDraft))
    if (!hit) throw new Error(`第 ${scriptEpisode.number} 集没有叫 ${input.manualDraft} 的草稿`)
    return hit
  }
  notes.push(`第 ${scriptEpisode.number} 集有 ${candidates.length} 份草稿（${candidates.map((item) => item.folder).join('、')}）`)
  if (!input.ctx) return preferCandidate(candidates, scriptEpisode)
  return chooseDraft({
    episodeNumber: scriptEpisode.number,
    scriptLines: scriptEpisode.lines,
    candidates,
    ctx: input.ctx,
    provider: input.provider,
    model: input.model,
    signal: input.signal,
  })
}

/**
 * @param {{projectDir: string, scriptDocx: string, direction: string, ctx: any,
 *   provider?: string, model?: string, signal?: AbortSignal, framesDir?: string,
 *   verification?: boolean, onProgress?: (step: string, detail?: any) => void}} input
 */
export async function planSlice(input) {
  const { projectDir, scriptDocx, direction } = input
  const onProgress = input.onProgress ?? (() => {})
  if (!direction || !direction.trim()) throw new Error('缺少内容方向')
  if (!existsSync(scriptDocx)) throw new Error(`剧本不存在：${scriptDocx}`)

  await onProgress('survey')
  const report = await survey({ projectDir, scriptDocx })
  const script = parseScript(await readFile(scriptDocx))

  const dialogueEpisodes = report.project.episodes.filter((row) => row.ready && row.inScript)
  const projectReaders = await readableEpisodes(projectDir)
  // Windows：先按剧名落到剪映本地草稿分组，再回草稿箱取这一组的草稿；认不出分组才退回混剧保护 + drafts。
  const group = await resolveDramaGroup({ drama: input.drama ?? script.title, projectDir })
  let scope
  const notes = []
  if (group?.folders.length) {
    scope = new Set(group.folders)
    notes.push(`按剪映分组「${group.folder.name}」取 ${group.folders.length} 个草稿（${group.how === 'draft-id' ? 'draftId 对上' : `草稿文件夹创建时间 ±${group.windowSeconds}s 对上`}）`)
  } else if (group?.unresolved === 'members') {
    throw new Error(`剪映分组「${group.folder.name}」登记了 ${group.memberCount} 个草稿，但草稿文件里读不到它们的 draftId（导入稿被剪映加密），也没能用创建时间对齐。请用 drafts 指定要用的草稿文件夹，或把该剧草稿单独放一个工程目录`)
  } else {
    scope = scopeFolders(report.project.episodes.map((row) => ({ folder: row.folder, episode: row.episode, family: row.family })), input.drafts)
    if (input.drafts?.length) notes.push(`只用指定草稿：${input.drafts.join('、')}（草稿箱里可能混着别的剧）`)
  }
  let usable = dialogueEpisodes
    .filter((row) => scope.has(row.folder))
    .map((row) => projectReaders.find((episode) => episode.folder === row.folder))
    .filter(Boolean)
  if (!usable.length) throw new Error(`工程里没有既能读、又能和剧本配上的集${input.drafts?.length ? `（指定范围内：${input.drafts.join('、')}）` : group?.folder ? `（剪映分组「${group.folder.name}」）` : ''}`)
  const families = groupFamilies(usable)
  if (families.length > 1) {
    if (input.manualFamily) {
      usable = usable.filter((episode) => familyOf(episode.folder) === input.manualFamily)
      notes.push(`按指定只用了「${input.manualFamily}」这组草稿`)
    } else if (input.ctx) {
      await onProgress('family', { families: families.map((family) => family.key) })
      const chosen = await chooseFamily({
        scriptTitle: script.title,
        scriptLines: script.episodes.flatMap((episode) => episode.lines),
        families,
        ctx: input.ctx,
        provider: input.provider,
        model: input.model,
        signal: input.signal,
      })
      usable = usable.filter((episode) => familyOf(episode.folder) === chosen)
      notes.push(`草稿箱里有 ${families.length} 组草稿，按字幕样张判断用「${chosen}」这组`)
    } else {
      notes.push(`草稿箱里有 ${families.length} 组草稿（${families.map((family) => `${family.key} ${family.count} 个`).join('、')}），离线模式没有自动判断`)
    }
  }
  if (!usable.length) throw new Error('筛掉混在草稿箱里的别的剧之后，没有能和剧本配上的集')

  await onProgress('pick')
  let pick
  if (input.manualSubtitle) {
    const episodeNumber = Number(input.manualSubtitle.episode)
    const target = script.episodes.find((item) => item.number === episodeNumber)
    if (!target) throw new Error(`剧本里没有第 ${episodeNumber} 集`)
    const candidates = usable.filter((episode) => episode.episode === episodeNumber)
    const chosen = await resolveCandidate(candidates, target, input, notes)
    const from = Math.max(1, Number(input.manualSubtitle.from)) - 1
    const to = Math.min(chosen.dialogue.length, Number(input.manualSubtitle.to)) - 1
    if (!(to >= from)) throw new Error('手动的字幕区间无效')
    const { from: f2, to: t2 } = expandSubtitleRange(chosen.dialogue, from, to)
    const subtitleRange = chosen.dialogue.slice(f2, t2 + 1)
    const cut = cutPoints({ hits: subtitleRange.map((subtitle, offset) => ({ subtitleIndex: f2 + offset, subtitle })) })
    if (!cut) throw new Error('手动字幕区间定位失败')
    return {
      direction,
      episode: chosen.episode,
      folder: chosen.folder,
      projectDir,
      scriptDocx,
      pick: { reason: '手动指定字幕区间（离线）', match: 'manual', fromSubtitles: true },
      scriptLines: [],
      matches: [],
      coverage: 1,
      confidence: 1,
      warnings: buildWarnings({ coverage: 1, direct: true }, false, notes),
      crossLanguage: false,
      families: families.map((family) => ({ key: family.key, count: family.count })),
      notes,
      cut,
      duration: Number((cut.end - cut.start).toFixed(2)),
      frames: undefined,
    }
  }
  if (input.manualPick) {
    const target = script.episodes.find((item) => item.number === Number(input.manualPick.episode))
    if (!target) throw new Error(`剧本里没有第 ${input.manualPick.episode} 集`)
    const ids = input.manualPick.lineIds
    const from = ids ? Number(ids[0]) : Number(input.manualPick.start)
    const to = ids ? Number(ids[1]) : Number(input.manualPick.end)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) throw new Error('手动的行号区间无效')
    pick = {
      episode: target.number,
      start: from - 1,
      end: Math.min(target.lines.length, to) - 1,
      reason: input.manualPick.reason ?? '手动指定行号（离线测试）',
      match: 'manual',
    }
  } else {
    pick = await pickSegment({ direction, script, usableEpisodes: usable, ctx: input.ctx, provider: input.provider, model: input.model, signal: input.signal })
  }

  let scriptEpisode = scriptEpisodeOf(script, pick.episode)
  let candidates = usable.filter((episode) => episode.episode === pick.episode)
  let episode = await resolveCandidate(candidates, scriptEpisode, input, notes)
  let chosenLines = scriptEpisode.lines.slice(pick.start, pick.end + 1).map((line, offset) => ({ ...line, index: pick.start + offset }))
  // 剧本中文、字幕英文（没做中英对照）时，文本相似度必然为 0，直接走"按字幕选段"。
  const crossLanguage = scriptRatio(chosenLines) > 0.7 && scriptRatio(episode.dialogue) < 0.3
  if (crossLanguage) notes.push('剧本是中文、工程字幕是英文，跳过文本比对，改按字幕语义选段')
  let matching = crossLanguage
    ? { matches: [], hits: [], coverage: 0, confidence: 0, crossLanguage: true }
    : matchScriptLines(episode.dialogue, chosenLines)
  const matchedCut = cutPoints(matching, { videoSegments: episode.videoSegments })
  const matchedDuration = matchedCut ? matchedCut.end - matchedCut.start : 0

  if ((matching.coverage < MIN_COVERAGE || matchedDuration < 8) && !input.manualPick) {
    await onProgress('pick-subtitles', { episode: episode.episode, coverage: matching.coverage })
    if (!input.ctx) throw new Error('剧本和字幕语言不同，离线模式无法按字幕语义选段；请在 DSH 里运行（会用模型读字幕）')
    const direct = await pickFromSubtitles({
      direction,
      episode,
      ctx: input.ctx,
      provider: input.provider,
      model: input.model,
      signal: input.signal,
      scriptLines: crossLanguage ? chosenLines : undefined,
    })
    const directCandidates = usable.filter((item) => item.episode === direct.episode)
    episode = episode.episode === direct.episode && directCandidates.length === 1
      ? episode
      : await resolveCandidate(directCandidates, scriptEpisodeOf(script, direct.episode), input, notes)
    if (episode.episode !== direct.episode) throw new Error('按字幕选段时找不到对应工程的集')
    scriptEpisode = scriptEpisodeOf(script, direct.episode)
    // 过短的误匹配重新按真实时间码选段，约30秒仍由方向和剧情决定。
    const { from, to } = expandSubtitleRange(episode.dialogue, direct.start, direct.end)
    const subtitleRange = episode.dialogue.slice(from, to + 1)
    pick = { ...direct, episode: episode.episode, start: from, end: to, fromSubtitles: true }
    matching = { matches: [], hits: subtitleRange.map((subtitle, offset) => ({ subtitleIndex: from + offset, subtitle })), coverage: 1, confidence: 1, direct: true }
    chosenLines = []
  }

  const cut = cutPoints(matching, { videoSegments: episode.videoSegments })
  if (!cut) throw new Error('字幕定位失败：没有匹配到任何一句台词')
  if (cut.end - cut.start < 3) throw new Error(`定位到的片段只有 ${(cut.end - cut.start).toFixed(1)}s，太短，请换一个方向或确认剧本/工程是否同一部`)

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
    folder: episode.folder,
    projectDir,
    scriptDocx,
    pick: { reason: pick.reason, match: pick.match, fromSubtitles: Boolean(pick.fromSubtitles), model: pick.model },
    scriptLines: chosenLines.map((line) => ({ index: line.index + 1, speaker: line.speaker, zh: line.zh, en: (line.en ?? []).map((item) => item.text) })),
    matches: matching.matches,
    coverage: Number(matching.coverage.toFixed(2)),
    confidence: Number(matching.confidence.toFixed(2)),
    warnings: buildWarnings(matching, crossLanguage, notes),
    crossLanguage,
    families: families.map((family) => ({ key: family.key, count: family.count })),
    notes,
    cut,
    duration: Number((cut.end - cut.start).toFixed(2)),
    frames,
  }
}

async function readableEpisodes(projectDir) {
  const { surveyProject } = await import('./draft.js')
  const project = await surveyProject(projectDir)
  return project.episodes
}

export function formatPlan(plan) {
  const lines = []
  lines.push(`# 切片方案：第${plan.episode}集（${plan.folder}）`)
  lines.push(`- 方向：${plan.direction}`)
  lines.push(`- 选段理由：${plan.pick.reason || '-'}（匹配度 ${plan.pick.match}${plan.pick.fromSubtitles ? '，按字幕兜底' : ''}）`)
  lines.push(`- 时间码：${plan.cut.start.toFixed(2)}s → ${plan.cut.end.toFixed(2)}s（时长 ${plan.duration.toFixed(2)}s）`)
  lines.push(`- 字幕匹配：${plan.coverage * 100}% 覆盖，平均相似度 ${plan.confidence}`)
  lines.push(`- 首句字幕：${plan.cut.firstText}`)
  lines.push(`- 末句字幕：${plan.cut.lastText}`)
  if (plan.scriptLines.length) {
    lines.push('')
    lines.push('| 台词 | 中文 | English |')
    lines.push('|---|---|---|')
    for (const line of plan.scriptLines) lines.push(`| ${line.index} | ${line.speaker ?? ''} ${line.zh ?? ''} | ${line.en.join(' ')} |`)
  }
  if (plan.frames) {
    lines.push('')
    lines.push(`- 首帧：${plan.frames.head.outFile}（源 ${plan.frames.head.file.split('/').pop()} @ ${plan.frames.head.seek.toFixed(2)}s）`)
    lines.push(`- 尾帧：${plan.frames.tail.outFile}（源 ${plan.frames.tail.file.split('/').pop()} @ ${plan.frames.tail.seek.toFixed(2)}s）`)
  }
  return lines.join('\n')
}
