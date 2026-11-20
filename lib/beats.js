// 节拍分析/卡点编排的 Node 侧桥：用系统 Python 运行原有 librosa 分析。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const BEATS_SCRIPT = join(ROOT, 'scripts', 'beats.py')
export const FPS = 30
const CACHE_VERSION = 1

/** 发布包不含解释器：优先显式设置，其次环境变量，再用 PATH。 */
export function pythonPath(configured) {
  return configured || process.env.DUANJU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

function run(command, args, { signal, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`节拍分析超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-4000) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = out.trim().split(/\r?\n/).filter(Boolean).at(-1)
      let parsed
      try {
        parsed = line ? JSON.parse(line) : undefined
      } catch {
        parsed = undefined
      }
      if (code !== 0 || !parsed || parsed.error) {
        reject(new Error(parsed?.error ?? err.trim().slice(-800) ?? `${command} 退出码 ${code}`))
        return
      }
      resolve(parsed)
    })
  })
}

async function call(python, request, options) {
  const dir = await mkdtemp(join(tmpdir(), 'duanju-beats-'))
  const file = join(dir, 'request.json')
  try {
    await writeFile(file, JSON.stringify(request), 'utf8')
    return await run(python, ['-B', '-X', 'utf8', BEATS_SCRIPT, file], options)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function hashFile(file) {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 分析一首 BGM：拍点、起音、重音事件、节奏段落、能量包络。
 * 结果按文件内容哈希缓存，同一首歌第二次直接读缓存。
 */
export async function analyzeMusic({ python, ffmpeg, file, cacheDir, signal }) {
  if (!existsSync(file)) throw new Error(`BGM 文件不存在：${file}`)
  const sha = await hashFile(file)
  const dir = join(cacheDir, 'beats')
  const cacheFile = join(dir, `${CACHE_VERSION}-${sha.slice(0, 32)}.json`)
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (cached?.method === 'librosa-beat-track' && Array.isArray(cached.events)) return { ...cached, cached: true }
    } catch {
      // 缓存坏了就重算
    }
  }
  const analysis = await call(python, { action: 'analyze', file, ffmpeg }, { signal })
  if (!Array.isArray(analysis.events) || !analysis.events.length) throw new Error('BGM 分析没有返回节拍事件')
  await mkdir(dir, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(analysis), 'utf8')
  return { ...analysis, cached: false }
}

/**
 * 把一组快切镜头的落点排到真实拍点上（动态规划评分与高级模式一致）。
 * @param {{python:string, analysis:object, start?:number, total:number, minDuration?:number,
 *   shots:Array<{available:number, ideal?:number}>, signal?:AbortSignal}} input
 */
export async function arrangeMontage({ python, analysis, start = 0, total, shots, minDuration = 0.2, signal }) {
  // BGM 从正文 0 秒持续播放。只平移事件坐标，DP 与重音优先的算法保持原样。
  const mapped = { events: analysis.events.map((event) => ({ ...event, time: event.time - start })) }
  const result = await call(python, { action: 'arrange', analysis: mapped, total, shots, min_duration: minDuration }, { signal })
  for (const cut of result.cuts) if (cut.beat) cut.beat.time += start
  return result
}

/** 在实测起音密集的乐段里找一段 5–10s，给前后原声留足同一首歌的连续时间。 */
export function pickMusicWindow(analysis, { before, after, low = 5, high = 10, target, duration = analysis.duration }) {
  if (high < low - 1e-6) return undefined
  const events = analysis.events
  const sections = analysis.rhythm_sections ?? []
  const candidates = []
  for (const [i, section] of sections.entries()) {
    if (section.end - section.start < low || !(section.onsets_per_second > 0)) continue
    // 相邻的同等快段合并，允许从较长的乐句中截取一段，不按固定秒点切。
    let end = section.end
    for (const next of sections.slice(i + 1)) {
      if (next.start > end + 0.001 || next.onsets_per_second < section.onsets_per_second * 0.85) break
      end = next.end
    }
    end = Math.min(end, duration - after)
    for (const start of events.filter((event) => event.time >= Math.max(section.start, before) && event.time <= end - low)) {
      const tail = events.filter((event) => event.time <= end && event.time - start.time >= low - 1e-8 && event.time - start.time <= high + 1e-8)
      for (const stop of tail) {
        const length = Math.round((stop.time - start.time) * FPS) / FPS
        if (length < low - 1e-6 || length > high + 1e-6 || start.time + length + after > duration + 1e-6) continue
        candidates.push({ start: start.time, end: stop.time, length, first: start, section: { start: section.start, end, density: section.onsets_per_second },
          score: section.onsets_per_second + (stop.level === 'major' ? 0.35 : 0) + (start.level === 'major' ? 0.15 : 0) - 0.4 * Math.abs(length - target) })
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]
}
