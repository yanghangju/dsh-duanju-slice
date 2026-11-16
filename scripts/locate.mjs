#!/usr/bin/env node
// 离线定位：node scripts/locate.mjs <工程目录> <剧本.docx> "<方向>" [--episode N --lines a-b] [--frames 目录] [--json]
// 没有 --episode/--lines 时需要模型（在 DSH 会话里用 duanju_slice_plan 工具），CLI 只做离线验证。
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
  else positional.push(item)
}
const [projectDir, scriptDocx, direction = ''] = positional
if (!projectDir || !scriptDocx) {
  console.error('用法：node scripts/locate.mjs <工程目录> <剧本.docx> "<方向>" [--episode N --lines a-b] [--frames 目录] [--json]')
  process.exit(2)
}
let manualPick
if (flags.episode && flags.lines) {
  const [start, end] = String(flags.lines).split('-').map(Number)
  manualPick = { episode: Number(flags.episode), start, end }
} else {
  console.error('CLI 离线模式必须给 --episode N --lines a-b；要 AI 选段请在 DSH 里调用 duanju_slice_plan 工具')
  process.exit(2)
}
const plan = await planSlice({ projectDir, scriptDocx, direction, manualPick, framesDir: flags.frames })
if (flags.json) console.log(JSON.stringify(plan, null, 2))
else console.log(formatPlan(plan))
