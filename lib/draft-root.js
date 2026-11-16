// 本机剪映草稿箱位置：配置优先，其次剪映全局设置里自定义的路径，最后默认路径。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

function windowsBase() {
  const local = process.env.LOCALAPPDATA
  return local ? join(local, 'JianyingPro', 'User Data') : undefined
}

const DEFAULT_DRAFT_ROOT =
  process.platform === 'win32'
    ? join(windowsBase() ?? join(homedir(), 'AppData', 'Local', 'JianyingPro', 'User Data'), 'Projects', 'com.lveditor.draft')
    : join(homedir(), 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft')
const GLOBAL_SETTING =
  process.platform === 'win32'
    ? join(windowsBase() ?? join(homedir(), 'AppData', 'Local', 'JianyingPro', 'User Data'), 'Config', 'globalSetting')
    : join(homedir(), 'Movies', 'JianyingPro', 'User Data', 'Config', 'globalSetting')

export async function findDraftRoot(configured) {
  if (configured && existsSync(configured)) return configured
  if (process.env.JIANYING_DRAFT_ROOT && existsSync(process.env.JIANYING_DRAFT_ROOT)) {
    return process.env.JIANYING_DRAFT_ROOT
  }
  try {
    const raw = await readFile(GLOBAL_SETTING, 'utf8')
    const match = /^currentCustomDraftPath=(.+)$/m.exec(raw)
    if (match && existsSync(match[1].trim())) return match[1].trim()
  } catch {}
  if (existsSync(DEFAULT_DRAFT_ROOT)) return DEFAULT_DRAFT_ROOT
  return undefined
}

export function safeName(value, limit = 80) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, limit)
    .trim()
}
