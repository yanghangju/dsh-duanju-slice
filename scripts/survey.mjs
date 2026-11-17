#!/usr/bin/env node
// 只读勘察：node scripts/survey.mjs <短剧目录> [剧本.docx] [--json]
import { ffprobePath } from '../lib/frames.js'
import { formatSurvey, survey } from '../lib/report.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const [dramaDir, scriptDocx] = args.filter((item) => !item.startsWith('--'))
if (!dramaDir) {
  console.error('用法：node scripts/survey.mjs <短剧目录> [剧本.docx] [--json]')
  process.exit(2)
}
const report = await survey({ dramaDir, scriptDocx, ffprobe: ffprobePath() })
if (json) console.log(JSON.stringify(report, null, 2))
else console.log(formatSurvey(report))
