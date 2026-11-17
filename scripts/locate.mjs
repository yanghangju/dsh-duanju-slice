#!/usr/bin/env node
// 离线定位：node scripts/locate.mjs <短剧目录> <剧本.docx> --episode N --lines a-b [--direction "方向"] [--frames 目录] [--api-key KEY] [--json]
// 没有 --episode/--lines 时需要模型（在 DSH 会话里用 duanju_slice_plan 工具），CLI 只做离线验证。
import { join } from 'node:path'
import { ffmpegPath, ffprobePath } from '../lib/frames.js'
import { formatPlan, planSlice } from '../lib/plan.js'

const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let index = 0; index < argv.length; index += 1) {
  const item = argv[index]
  if (item === '--json') flags.json = true
  else if (item === '--episode') flags.episode = argv[++index]
  else if (item === '--lines') flags.lines = argv[++index]
  else if (item === '--frames') flags.frames = argv[++index]
  else if (item === '--direction') flags.direction = argv[++index]
  else if (item === '--api-key') flags.apiKey = argv[++index]
  else if (item === '--cache') flags.cache = argv[++index]
  else positional.push(item)
}
const [dramaDir, scriptDocx] = positional
if (!dramaDir || !scriptDocx) {
  console.error('用法：node scripts/locate.mjs <短剧目录> <剧本.docx> --episode N --lines a-b [--direction "方向"] [--frames 目录] [--json]')
  process.exit(2)
}
if (!flags.episode || !flags.lines) {
  console.error('CLI 离线模式必须给 --episode N --lines a-b；要 AI 选段请在 DSH 里调用 duanju_slice_plan 工具')
  process.exit(2)
}
const [from, to] = String(flags.lines).split('-').map(Number)
const ffmpeg = ffmpegPath(flags.ffmpeg)
const plan = await planSlice({
  dramaDir,
  scriptDocx,
  direction: String(flags.direction ?? '离线切片'),
  manualPick: { episode: Number(flags.episode), lineIds: [from, to] },
  ffmpeg,
  ffprobe: ffprobePath(ffmpeg),
  cacheDir: String(flags.cache ?? join(process.cwd(), '.duanju-cache')),
  config: { volcApiKey: String(flags.apiKey ?? process.env.VOLCENGINE_API_KEY ?? process.env.VOLC_API_KEY ?? '') },
  framesDir: flags.frames ? String(flags.frames) : undefined,
  verification: Boolean(flags.frames),
})
const { source, ...planView } = plan
if (flags.json) console.log(JSON.stringify(planView, null, 2))
else console.log(formatPlan(planView))
