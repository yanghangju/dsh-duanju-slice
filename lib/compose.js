// 原声钩子 → 一组经抽帧核验的多集静音卡点 → 原声高潮。片尾由草稿和渲染共用。
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAction } from './action-check.js'
import { analyzeMusic, arrangeMontage, FPS, pickMusicWindow, pythonPath } from './beats.js'
import { probeDuration } from './ending.js'
import { ffprobePath } from './frames.js'
import { reviewMontage } from './montage.js'
import { libraryDir, loadLibrary, pickTrack } from './music-library.js'
import { MONTAGE_SETTINGS, contentDuration, dialogueShot, montageShots } from './shots.js'

export const ADVANCED_BODY_LIMIT = 45.8 // 原生转场/完整声效还要占约 4.17 秒。
const PLUGIN_DIR = fileURLToPath(new URL('../', import.meta.url))
const duration = (cut) => cut.end - cut.start

export async function composeEdit(input) {
  const { byNumber, config = {}, cacheDir, workDir, ffmpeg, signal, onProgress, advanced, budget = Infinity } = input
  const warnings = []
  const actions = []
  const cuts = [...input.cuts]
  let extra = Math.max(0, budget - cuts.reduce((sum, cut) => sum + duration(cut), 0) - (advanced ? MONTAGE_SETTINGS.minSeconds : 0))
  await onProgress?.('action')
  // 检查各集 ASR 尾部；不能把下一个未选的台词或另一个已选镜头吞进去。
  for (let offset = 0; offset < cuts.length; offset += 3) {
    const checked = await Promise.all(cuts.slice(offset, offset + 3).map((initial, i) => {
      const index = offset + i
      const next = Math.min(Infinity, ...input.cuts.filter((cut) => cut.episode === initial.episode && cut.start > initial.start).map((cut) => cut.start))
      return verifyAction({ ctx: input.verification !== false ? input.ctx : undefined, episode: byNumber.get(initial.episode), cut: initial, ffmpeg,
        outDir: workDir && join(workDir, `action-${index + 1}`), provider: input.provider, model: input.model, signal,
        endLimit: Math.min(initial.endLimit ?? Infinity, next, initial.end + extra),
      })
    }))
    for (const [i, { cut, check }] of checked.entries()) {
      const index = offset + i
      const delta = cut.end - cuts[index].end
      if (delta > extra + 1e-6) {
        actions.push({ skipped: '时长预算不足以保留已核验的完整动作，保留 ASR 句尾' })
      } else {
        cuts[index] = cut
        actions.push(check)
        extra = Math.max(0, extra - delta)
      }
    }
  }
  if (input.verification !== false) {
    const skipped = actions.filter((check) => check?.skipped)
    if (skipped.length) warnings.push(`${skipped.length} 段收尾未完成视觉核验，保留 ASR 原切点：${skipped[0].skipped}`)
  }
  const shots = cuts.map((cut) => dialogueShot(cut.episode, cut))
  const first = cuts[0]
  const last = cuts.at(-1)
  const cut = {
    start: first.start, end: last.end, startEpisode: first.episode, endEpisode: last.episode,
    firstText: first.firstText, lastText: last.lastText, subtitleStart: first.subtitleStart, subtitleEnd: last.subtitleEnd,
    dialogueEnd: last.dialogueEnd, wordRefined: Boolean(first.wordRefined || last.wordRefined),
  }
  let bgm
  let montage
  if (config.bgm?.enabled !== false && config.music?.enabled !== false) {
    try {
      await onProgress?.('music')
      const { tracks } = await loadLibrary(libraryDir(PLUGIN_DIR, config.musicDir))
      const track = await pickTrack({ tracks, direction: input.direction, dialogue: input.dialogueText, ctx: input.ctx,
        provider: input.provider, model: input.model, signal, prefer: input.bgm || config.bgm?.track })
      const mediaDuration = await probeDuration(input.ffprobe ?? ffprobePath(ffmpeg), track.file, { signal })
      bgm = { ...track, title: track.directory, duration: mediaDuration }
    } catch (error) {
      signal?.throwIfAborted()
      if (advanced) throw new Error(`高级剪辑无法添加 BGM：${error.message}`, { cause: error })
      warnings.push(`未能添加 BGM：${error.message}`)
    }
  }
  if (advanced) {
    const split = cuts.findIndex((piece) => piece.group === 'climax')
    const start = contentDuration(shots.slice(0, split))
    const spoken = contentDuration(shots)
    await onProgress?.('beats')
    const python = pythonPath(config.pythonPath)
    let analysis
    try {
      analysis = await analyzeMusic({ python, ffmpeg, file: bgm.file, cacheDir, signal })
    } catch (error) {
      signal?.throwIfAborted()
      throw new Error(`无法分析 BGM 拍点：${error.message}（依赖系统 Python 的 librosa，未随插件打包）`, { cause: error })
    }
    await onProgress?.('montage')
    const { windows, warnings: reviewWarnings } = await reviewMontage(input, cuts)
    warnings.push(...reviewWarnings)
    const capacity = windows.reduce((sum, item) => sum + item.end - item.start, 0)
    const high = Math.min(capacity, budget - spoken, MONTAGE_SETTINGS.maxSeconds)
    const music = pickMusicWindow(analysis, { before: start, after: spoken - start, duration: bgm.duration,
      low: MONTAGE_SETTINGS.minSeconds, high, target: Math.max(MONTAGE_SETTINGS.minSeconds, Math.min(high, windows.length * 0.52)) })
    if (!music) throw new Error('已核验画面或选定曲目没有足够的 5–10 秒快段，不能生成无卡点的高级剪辑；请换内容方向或 BGM')
    const arranged = await arrangeMontage({ python, analysis, start: music.start, total: music.length, minDuration: MONTAGE_SETTINGS.minDuration,
      shots: windows.map((item) => ({ available: item.end - item.start + 1e-8, ideal: music.length / windows.length })), signal })
    const inserted = montageShots(undefined, windows, arranged.cuts.map((item) => item.duration))
    shots.splice(split, 0, ...inserted)
    bgm.tempo = analysis.tempo
    bgm.sourceStart = Math.max(0, music.start - start)
    const episodes = [...new Set(inserted.map((item) => item.episode))]
    montage = { start, total: arranged.total, count: inserted.length, episodes, source: 'advanced',
      majorHits: arranged.major_hits + Number(music.first.level === 'major'), freeCuts: arranged.cuts.filter((item) => !item.beat).length,
      musicStart: music.start, musicEnd: music.end, rhythmSection: music.section,
      cuts: [{ time: start, beat: { time: music.start, level: music.first.level } }, ...arranged.cuts.map((item, i) => ({
        duration: item.duration, time: Number((start + item.end).toFixed(6)), beat: item.beat, episode: inserted[i].episode, evidence: windows[i].evidence,
      }))],
    }
  } else if (cuts.length > 1) {
    warnings.push('显式关闭了视觉核验或 BGM，本次只输出原声钩子与高潮，不是完整卡点版')
  }
  return { cut, cuts, shots, total: contentDuration(shots), duration: cuts.reduce((sum, piece) => sum + duration(piece), 0), bgm, montage, actions, warnings }
}
