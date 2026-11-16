// Read-only survey: pair what the 剪映 project folder offers with what the
// script docx knows, so the operator can confirm both sides before any cut.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { isDraftFolder, readEpisode, resolveDramaGroup, surveyProject } from './draft.js'
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

async function loadProject(dir) {
  if (await isDraftFolder(dir)) {
    const episode = await readEpisode({ episode: undefined, folder: basename(dir), dir, draftFile: `${dir}/draft_info.json` })
    return { projectDir: dir, episodes: episode ? [episode] : [], unreadable: [] }
  }
  return surveyProject(dir)
}

/**
 * @param {{projectDir: string, scriptDocx?: string}} input
 */
export async function survey({ projectDir, scriptDocx }) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('缺少工程目录')
  if (!existsSync(projectDir)) throw new Error(`工程目录不存在：${projectDir}`)

  let script
  if (scriptDocx) {
    if (!existsSync(scriptDocx)) throw new Error(`剧本不存在：${scriptDocx}`)
    script = parseScript(await readFile(scriptDocx))
  }

  const project = await loadProject(projectDir)
  const group = script ? await resolveDramaGroup({ drama: script.title, projectDir }) : undefined
  const scripted = new Set((script?.episodes ?? []).map((episode) => episode.number))

  const rows = project.episodes.map((episode) => {
    const first = episode.dialogue[0]
    const last = episode.dialogue[episode.dialogue.length - 1]
    const scriptEpisode = (script?.episodes ?? []).find((item) => item.number === episode.episode)
    return {
      episode: episode.episode,
      folder: episode.folder,
      group: episode.group,
      family: episode.family,
      foundBy: episode.from,
      duration: round(episode.duration),
      inScript: script ? scripted.has(episode.episode) : undefined,
      scriptLines: scriptEpisode?.lines.length,
      subtitles: episode.counts.subtitles,
      titleCards: episode.counts.titleCards,
      draftSource: episode.draftSource,
      firstSubtitle: first ? { start: round(first.start, 2), text: quote(first.text) } : undefined,
      lastSubtitle: last ? { start: round(last.start, 2), text: quote(last.text) } : undefined,
      contentStart: round(episode.contentStart, 2),
      contentEnd: round(episode.contentEnd, 2),
      video: episode.counts.videoSegments,
      photos: episode.counts.photos,
      audio: { dialogue: episode.counts.dialogue, music: episode.counts.music, sound: episode.counts.sound },
      canvas: episode.canvas,
      missingMedia: episode.missingMedia.length,
      missingVideo: (episode.missingVideo ?? []).length,
      missingAudio: (episode.missingAudio ?? []).length,
      ready: episode.counts.subtitles > 0 && episode.counts.videoSegments > 0,
    }
  })

  const available = new Set(project.episodes.map((episode) => episode.episode))
  const foldersByEpisode = new Map()
  for (const episode of project.episodes) {
    foldersByEpisode.set(episode.episode, [...(foldersByEpisode.get(episode.episode) ?? []), episode.folder])
  }
  const duplicates = [...foldersByEpisode.entries()]
    .filter(([, folders]) => folders.length > 1)
    .map(([episode, folders]) => ({ episode, folders }))
  const scriptOnly = (script?.episodes ?? [])
    .filter((episode) => !available.has(episode.number))
    .map((episode) => ({ episode: episode.number, lines: episode.lines.length }))

  return {
    projectDir,
    script: script
      ? {
          docx: scriptDocx,
          title: script.title,
          englishTitle: script.englishTitle,
          episodeCount: script.episodes.length,
          lineCount: script.episodes.reduce((sum, episode) => sum + episode.lines.length, 0),
          episodes: script.episodes.map((episode) => ({ number: episode.number, lines: episode.lines.length })),
        }
      : undefined,
    project: {
      draftCount: project.episodes.length,
      episodes: rows,
      unreadable: project.unreadable,
      source: project.resolution,
      group: group?.folder
        ? { name: group.folder.name, memberCount: group.memberCount, matched: group.folders.length, how: group.how, windowSeconds: group.windowSeconds, unresolved: group.unresolved }
        : group?.unresolved === 'members'
          ? { name: group.folder?.name, memberCount: group.memberCount, matched: 0, how: undefined, unresolved: group.unresolved }
          : undefined,
    },
    pairing: {
      availableEpisodes: [...available].sort((a, b) => a - b),
      paired: [...new Set(rows.filter((row) => row.inScript === true).map((row) => row.episode))],
      duplicates,
      scriptOnly,
    },
  }
}

export function formatSurvey(report) {
  const lines = []
  lines.push(`# 工程勘察：${report.projectDir}`)
  lines.push(`- 可读草稿：${report.project.draftCount} 集；不可读：${report.project.unreadable.length} 个`)
  const foundBy = { 'folder-name': '文件夹名（EPxx / 纯数字）', 'virtual-folder': '剪映虚拟文件夹（本地草稿分组）', 'draft-media': '草稿素材文件名里的 EPxxx', mixed: '多种来源', none: '未识别到' }
  const source = report.project.source
  const group = report.project.group
  if (group?.name) {
    const how = group.unresolved
      ? `登记 ${group.memberCount} 份，但本机读不到这些草稿的 draftId，也没能用创建时间对齐`
      : `登记 ${group.memberCount} 份，已对上 ${group.matched} 个草稿（${group.how === 'draft-id' ? 'draftId' : `草稿文件夹创建时间 ±${group.windowSeconds}s`}）`
    lines.push(`- 剪映分组「${group.name}」：${how}`)
  }
  if (source) {
    lines.push(`- 集数来源：${foundBy[source.mode] ?? source.mode}`)
    if (source.mode === 'virtual-folder' || source.mode === 'draft-media') {
      lines.push(`  剪映草稿箱是扁平目录，分组名只存在配置里：${source.configDir}`)
    }
    for (const group of source.groups ?? []) {
      lines.push(`- 虚拟文件夹「${group.name}」= ${group.members.join(' / ')}`)
    }
    const unclaimed = (source.folders ?? []).filter((folder) => !(source.groups ?? []).some((group) => group.name === folder.name) && folder.drafts > 0)
    if (unclaimed.length) {
      lines.push(`- 剪映本地草稿分组：${unclaimed.map((folder) => `${folder.name}（${folder.drafts} 个草稿）`).join('、')}；分组内的 draftId 与本机草稿文件对不上（多为从别的电脑导入），所以按素材文件名识别集数`)
    }
    const families = source.families ?? []
    if (families.length) {
      const labels = { copy: '「N-副本」', ep: '「EPxx/纯数字」', date: '日期名', other: '其它' }
      lines.push(`- 草稿命名族：${families.map((item) => `${labels[item.family] ?? item.family} ${item.drafts} 份（第 ${item.episodes.join(',') || '-'} 集）`).join('；')}`)
      if (families.length > 1) lines.push('  ⚠ 草稿箱里混着多部剧：自动选集会停下来，需要用 drafts 指定要用的草稿文件夹')
    }
  }
  if (report.project.unreadable.length) {
    for (const item of report.project.unreadable) lines.push(`  - ${item.folder}：${item.reason}`)
  }
  if (report.script) {
    lines.push(`- 剧本：${report.script.title || basename(report.script.docx)}（${report.script.episodeCount} 集 / ${report.script.lineCount} 条台词）`)
  }
  lines.push('')
  lines.push('| 集 | 文件夹 | 时长 | 字幕 | 首句字幕 | 末句字幕 | 画面段 | 音频(对白/BGM/音效) | 剧本 | 缺素材 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const row of report.project.episodes) {
    const first = row.firstSubtitle ? `${row.firstSubtitle.start}s ${row.firstSubtitle.text}` : '-'
    const last = row.lastSubtitle ? `${row.lastSubtitle.start}s ${row.lastSubtitle.text}` : '-'
    const scriptFlag = report.script ? (row.inScript ? `有(${row.scriptLines})` : '无') : '-'
    lines.push(
      `| ${row.episode} | ${row.folder} | ${timecode(row.duration)} | ${row.subtitles} | ${quote(first, 26)} | ${quote(last, 26)} | ${row.video} | ${row.audio.dialogue}/${row.audio.music}/${row.audio.sound} | ${scriptFlag} | ${row.missingMedia} |`,
    )
  }
  lines.push('')
  const pairing = report.pairing
  lines.push(`- 工程可用集：${pairing.availableEpisodes.join(', ') || '无'}`)
  if (report.script) {
    lines.push(`- 两边都有（可做）：${pairing.paired.join(', ') || '无'}`)
    lines.push(`- 只有剧本没工程：${pairing.scriptOnly.map((item) => item.episode).join(', ') || '无'}`)
  }
  if (pairing.duplicates?.length) {
    lines.push(`- 同集多份工程（需用户确认取哪份）：${pairing.duplicates.map((item) => `EP${item.episode}=${item.folders.join(' / ')}`).join('；')}`)
  }
  const backupRows = report.project.episodes.filter((row) => row.draftSource !== 'draft_info.json')
  if (backupRows.length) {
    lines.push(`- 明文来自备份（原文件已被剪映加密）：${backupRows.map((row) => `${row.folder}←${row.draftSource}`).join('；')}`)
  }
  return lines.join('\n')
}
