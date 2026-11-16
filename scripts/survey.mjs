#!/usr/bin/env node
// Read-only survey CLI: node scripts/survey.mjs <工程目录> [剧本.docx] [--json]
import { formatSurvey, survey } from '../lib/report.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const [projectDir, scriptDocx] = args.filter((item) => !item.startsWith('--'))
if (!projectDir) {
  console.error('用法：node scripts/survey.mjs <工程目录> [剧本.docx] [--json]')
  process.exit(2)
}
const report = await survey({ projectDir, scriptDocx })
if (json) console.log(JSON.stringify(report, null, 2))
else console.log(formatSurvey(report))
