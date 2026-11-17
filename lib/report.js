// 只读勘察：把短剧目录里的集数、时长、画面和剧本分集对上，让操作者先确认两侧，再动刀。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { listEpisodes } from './drama-source.js'
import { parseScript } from './script.js'

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value
}

function timecode(seconds) {
  if (!Number.isFinite(seconds)) return '--:--'
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

function quote(text, limit = 46) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * @param {{dramaDir: string, scriptDocx?: string, script?: object, project?: object, ffprobe: string, signal?: AbortSignal}} input
 */
export async function survey({ dramaDir, scriptDocx, script, project: listed, ffprobe, signal }) {
  if (typeof dramaDir !== 'string' || !dramaDir.trim()) throw new Error('缺少短剧目录')
  if (!existsSync(dramaDir)) throw new Error(`短剧目录不存在：${dramaDir}`)

  let parsed = script
  if (!parsed && scriptDocx) {
    if (!existsSync(scriptDocx)) throw new Error(`剧本不存在：${scriptDocx}`)
    parsed = parseScript(await readFile(scriptDocx))
  }

  const project = listed ?? await listEpisodes({ dramaDir, ffprobe, signal })
  const scripted = new Set((parsed?.episodes ?? []).map((episode) => episode.number))

  const rows = project.episodes.map((episode) => {
    const scriptEpisode = (parsed?.episodes ?? []).find((item) => item.number === episode.episode)
    return {
      episode: episode.episode,
      name: episode.name,
      from: episode.from,
      parts: episode.parts.length,
      files: episode.parts.map((part) => part.name),
      duration: round(episode.duration),
      canvas: `${episode.canvas.width}x${episode.canvas.height}`,
      hasAudio: episode.hasAudio,
      inScript: parsed ? scripted.has(episode.episode) : undefined,
      scriptLines: scriptEpisode?.lines.length,
      ready: episode.hasAudio && episode.duration >= 3,
    }
  })

  const available = new Set(project.episodes.map((episode) => episode.episode))
  const scriptOnly = (parsed?.episodes ?? [])
    .filter((episode) => !available.has(episode.number))
    .map((episode) => ({ episode: episode.number, lines: episode.lines.length }))

  return {
    dramaDir,
    dramaName: project.dramaName,
    script: parsed
      ? {
          docx: scriptDocx,
          title: parsed.title,
          englishTitle: parsed.englishTitle,
          episodeCount: parsed.episodes.length,
          lineCount: parsed.episodes.reduce((sum, episode) => sum + episode.lines.length, 0),
          episodes: parsed.episodes.map((episode) => ({ number: episode.number, lines: episode.lines.length })),
        }
      : undefined,
    project: {
      episodeCount: project.episodes.length,
      episodes: rows,
      skipped: project.skipped,
      duplicates: project.duplicates,
    },
    pairing: {
      availableEpisodes: [...available].sort((a, b) => a - b),
      paired: [...new Set(rows.filter((row) => row.inScript === true && row.ready).map((row) => row.episode))],
      scriptOnly,
    },
  }
}

export function formatSurvey(report) {
  const lines = []
  lines.push(`# 短剧勘察：${report.dramaDir}`)
  lines.push(`- 识别到 ${report.project.episodeCount} 集（一集可以是单个视频，也可以是文件夹里的多个视频按名字拼接）`)
  if (report.script) {
    lines.push(`- 剧本：${report.script.title || basename(report.script.docx)}（${report.script.episodeCount} 集 / ${report.script.lineCount} 条台词）`)
  }
  for (const row of report.project.skipped) lines.push(`  - 跳过 ${row.name}：${row.reason}`)
  for (const row of report.project.duplicates) lines.push(`  - 第 ${row.episode} 集重复：用 ${row.kept}，忽略 ${row.ignored}`)
  lines.push('')
  lines.push('| 集 | 素材 | 时长 | 画面 | 音轨 | 段数 | 剧本 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const row of report.project.episodes) {
    const scriptFlag = report.script ? (row.inScript ? `有(${row.scriptLines})` : '无') : '-'
    lines.push(`| ${row.episode} | ${quote(row.name, 30)} | ${timecode(row.duration)} | ${row.canvas} | ${row.hasAudio ? '有' : '无'} | ${row.parts} | ${scriptFlag} |`)
  }
  lines.push('')
  const pairing = report.pairing
  lines.push(`- 素材可用集：${pairing.availableEpisodes.join(', ') || '无'}`)
  if (report.script) {
    lines.push(`- 两边都有（可做）：${pairing.paired.join(', ') || '无'}`)
    lines.push(`- 只有剧本没素材：${pairing.scriptOnly.map((item) => item.episode).join(', ') || '无'}`)
  }
  return lines.join('\n')
}
