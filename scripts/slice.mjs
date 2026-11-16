#!/usr/bin/env node
// 离线生成切片草稿（不调模型）：node scripts/slice.mjs <工程目录> <剧本.docx> --episode N --lines a-b --name 草稿名 [--draft-root 目录] [--font 字体路径] [--json]
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listEpisodeFolders } from '../lib/draft.js'
import { findDraftRoot, safeName } from '../lib/draft-root.js'
import { ffmpegPath } from '../lib/frames.js'
import { splitSentences } from '../lib/locate.js'
import { planSlice } from '../lib/plan.js'
import { parseScript } from '../lib/script.js'
import { buildSliceDraft } from '../lib/slice-draft.js'
import { renderSlice } from '../lib/render.js'

const DEFAULT_FONT = '/Users/chongqingzhiyingkeji/Downloads/TikTokSansDisplayDark-Bold..ttf'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (!value.startsWith('--')) {
      args._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const [projectDir, scriptDocx] = args._
if (!projectDir || !scriptDocx) {
  console.error('用法：node scripts/slice.mjs <工程目录> <剧本.docx> --episode N (--lines a-b | --subtitles a-b) --name 草稿名 [--folder 草稿文件夹] [--draft-root 目录] [--font 字体] [--render 导出目录] [--json]')
  process.exit(2)
}
if (!args.episode || (!args.lines && !args.subtitles)) {
  console.error('缺 --episode 与 --lines 或 --subtitles')
  process.exit(2)
}
const range = String(args.subtitles ?? args.lines).split('-').map(Number)
const [from, to] = range
const episodeNumber = Number(args.episode)

const script = parseScript(await readFile(scriptDocx))
const episodes = (await listEpisodeFolders(projectDir))
  .filter((entry) => entry.episode === episodeNumber && (!args.folder || entry.folder === args.folder))
if (!episodes.length) {
  console.error(`工程目录里没有第 ${episodeNumber} 集`)
  process.exit(2)
}
const episodeDir = episodes[0].dir

// 用同一套定位逻辑算出切点（离线模式只接受行号，不需要模型）
const direction = String(args.direction ?? '离线切片')
const plan = await planSlice({
  projectDir,
  scriptDocx,
  direction,
  ...(args.subtitles
    ? { manualSubtitle: { episode: episodeNumber, from, to } }
    : { manualPick: { episode: episodeNumber, lineIds: [from, to] } }),
  ffmpeg: ffmpegPath(args.ffmpeg),
  verification: args.frames ? { outDir: String(args.frames) } : undefined,
})
if (!plan?.cut) {
  console.error('定位失败：', plan?.warnings?.join('；') || '未知原因')
  process.exit(1)
}

if (args['draft-root']) mkdirSync(String(args['draft-root']), { recursive: true })
const draftRoot = await findDraftRoot(args['draft-root'])
if (!draftRoot) {
  console.error('找不到剪映草稿箱，请用 --draft-root 指定')
  process.exit(2)
}
const title = safeName(script.title || '未命名')
const episodeText = `第${episodeNumber}集`
const clock = String(args['time-code'] ?? `${plan.cut.start.toFixed(1)}-${plan.cut.end.toFixed(1)}`)
const name = safeName(String(args.name ?? `${title}_${episodeText}_${direction}_${clock}`))
const font = args.font ? String(args.font) : existsSync(DEFAULT_FONT) ? DEFAULT_FONT : undefined

const built = await buildSliceDraft({
  episodeDir,
  cut: plan.cut,
  draftRoot,
  name,
  fontPath: font,
  ffmpeg: ffmpegPath(args.ffmpeg),
})

let video
if (args.render) {
  const exportDir = String(args.render)
  mkdirSync(exportDir, { recursive: true })
  const outFile = join(exportDir, `${name}.mp4`)
  video = await renderSlice({
    episodeDir: built.draftDir,
    cut: { start: 0, end: built.duration },
    outFile,
    ffmpeg: ffmpegPath(args.ffmpeg),
    fontPath: font,
  })
}

if (args.json) {
  console.log(JSON.stringify({ plan: { episode: plan.episode, cut: plan.cut, coverage: plan.coverage, frames: plan.frames }, built, video }, null, 2))
} else {
  console.log(`草稿：${built.draftDir}`)
  console.log(`时长：${built.duration}s / 轨道：${built.tracks.map((t) => `${t.type}×${t.segments}`).join(' ')} / 字幕 ${built.subtitleCount} 条`)
  console.log(`封面：${built.cover ?? '（未生成）'}`)
  console.log(`清理：${built.removed.join(', ') || '无'}`)
  if (plan.frames) console.log(`首尾帧：${plan.frames.head?.outFile} / ${plan.frames.tail?.outFile}`)
  if (video) console.log(`成片：${video.outFile}（${video.duration}s，${video.width}×${video.height}，字幕 ${video.subtitleCount} 条）`)
  console.log(`切点：${plan.cut.start.toFixed(2)}s – ${plan.cut.end.toFixed(2)}s（覆盖 ${Math.round((plan.coverage ?? 0) * 100)}%）`)
}
