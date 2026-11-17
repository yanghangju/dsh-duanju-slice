#!/usr/bin/env node
// 离线生成切片：node scripts/slice.mjs <短剧目录> <剧本.docx> --episode N --lines a-b [--draft-root 目录] [--render 导出目录] [--json]
// 需要火山语音识别 Key：环境变量 VOLCENGINE_API_KEY，或 --api-key。
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findDraftRoot, safeName } from '../lib/draft-root.js'
import { ffmpegPath, ffprobePath } from '../lib/frames.js'
import { planSlice } from '../lib/plan.js'
import { parseScript } from '../lib/script.js'
import { buildSliceDraft } from '../lib/slice-draft.js'
import { renderSlice } from '../lib/render.js'

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
const [dramaDir, scriptDocx] = args._
if (!dramaDir || !scriptDocx || !args.episode || !args.lines) {
  console.error('用法：node scripts/slice.mjs <短剧目录> <剧本.docx> --episode N --lines a-b [--name 草稿名] [--draft-root 目录] [--render 导出目录] [--api-key KEY] [--json]')
  process.exit(2)
}
const [from, to] = String(args.lines).split('-').map(Number)
const episodeNumber = Number(args.episode)
const ffmpeg = ffmpegPath(args.ffmpeg)
const ffprobe = ffprobePath(ffmpeg)
const config = { volcApiKey: String(args['api-key'] ?? process.env.VOLCENGINE_API_KEY ?? process.env.VOLC_API_KEY ?? '') }
const script = parseScript(await readFile(scriptDocx))

const plan = await planSlice({
  dramaDir,
  scriptDocx,
  direction: String(args.direction ?? '离线切片'),
  manualPick: { episode: episodeNumber, lineIds: [from, to] },
  ffmpeg,
  ffprobe,
  cacheDir: String(args.cache ?? join(process.cwd(), '.duanju-cache')),
  config,
  framesDir: args.frames ? String(args.frames) : undefined,
  verification: Boolean(args.frames),
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
const stem = safeName(`${String(script.title || '未命名').replace(/[（(].*?[)）]/g, '')}_第${episodeNumber}集`, 20)
const name = safeName(String(args.name ?? `${stem}_${plan.cut.start.toFixed(0)}-${plan.cut.end.toFixed(0)}`))

const built = await buildSliceDraft({
  episode: plan.source,
  cut: plan.cut,
  draftRoot,
  name,
  ffmpeg,
})

let video
if (args.render) {
  const exportDir = String(args.render)
  mkdirSync(exportDir, { recursive: true })
  video = await renderSlice({
    episodeDir: built.draftDir,
    cut: { start: 0, end: built.contentDuration },
    outFile: join(exportDir, `${name}.mp4`),
    ffmpeg,
    ffprobe,
  })
}

if (args.json) {
  const { source, ...planView } = plan
  console.log(JSON.stringify({ plan: planView, built, video }, null, 2))
} else {
  console.log(`草稿：${built.draftDir}`)
  console.log(`时长：${built.duration}s / 轨道：${built.tracks.map((track) => `${track.type}×${track.segments}`).join(' ')}`)
  console.log(`封面：${built.cover ?? '（未生成）'}`)
  if (plan.frames) console.log(`首尾帧：${plan.frames.head?.outFile} / ${plan.frames.tail?.outFile}`)
  if (video) console.log(`成片：${video.outFile}（${video.duration}s，${video.width}×${video.height}）`)
  console.log(`切点：${plan.cut.start.toFixed(2)}s – ${plan.cut.end.toFixed(2)}s（识别台词 ${plan.dialogueCount} 句，覆盖 ${Math.round((plan.coverage ?? 0) * 100)}%）`)
}
