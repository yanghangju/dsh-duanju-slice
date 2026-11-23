import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { ffmpegCandidates } from './media.js'
import { installMissingRuntime } from './runtime-download.js'
import { BUNDLED_ENABLED, BUNDLED_FFPROBE, BUNDLED_PYTHON, DEFAULT_MUSIC_DIR, DEFAULT_MUSIC_INDEX, RUNTIME_HOME as ROOT } from './runtime.js'
const STATE = join(ROOT, 'runtime.json')
const WINDOWS = process.platform === 'win32'
const exe = name => WINDOWS ? `${name}.exe` : name
const execute = promisify(execFile)
const ignore = () => {}
let configuring = false

function isFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  try { return statSync(path).isFile() } catch { return false }
}

function savedRuntime() {
  try {
    const { python, ffmpeg, ffprobe } = JSON.parse(readFileSync(STATE, 'utf8'))
    return { python, ffmpeg, ffprobe }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError) && error.code !== 'ENOENT') throw error
    return null
  }
}

function installedBinaries() {
  const saved = savedRuntime()
  return saved && Object.values(saved).every(isFile) ? saved : null
}

export function configuredRuntime() {
  return isFile(DEFAULT_MUSIC_INDEX) ? installedBinaries() : null
}

export function runtimeOptions(config) {
  const installed = installedBinaries()
  return installed ? { ...config, ffmpegPath: installed.ffmpeg, ffprobePath: installed.ffprobe, advanced: { ...config.advanced, pythonPath: installed.python } } : config
}

function commandPaths(name) {
  if (typeof name !== 'string' || !name) return []
  if (isAbsolute(name)) return isFile(name) ? [name] : []
  if (!/^[\w.-]+$/.test(name)) return []
  const file = WINDOWS && !/\.exe$/i.test(name) ? exe(name) : name
  return (process.env.PATH ?? '').split(delimiter).map(dir => dir.trim().replace(/^"|"$/g, ''))
    .filter(isAbsolute).map(dir => join(dir, file)).filter(isFile)
}

async function probe(candidates, args, verify, signal, env = process.env) {
  let reason = '未找到可执行文件'
  for (const path of new Set(candidates.flatMap(commandPaths))) {
    signal?.throwIfAborted()
    try {
      const { stdout } = await execute(path, args, { timeout: 90_000, windowsHide: true, signal, env })
      assert(verify(stdout), '能力检查未通过')
      return { path }
    } catch (error) {
      signal?.throwIfAborted()
      const detail = error.stderr?.trim().split(/\r?\n/).at(-1) || (error.killed ? '能力检查超时' :
        typeof error.code === 'number' ? `退出码 ${error.code}（0x${(error.code >>> 0).toString(16)}），无 stderr` :
          error.code === 'ERR_ASSERTION' ? error.message : error.code ?? error.message)
      reason = `${path}：${detail}`
    }
  }
  return { path: null, reason }
}

const PYTHON_TEST = [
  'import tomllib, librosa, numpy, scipy, llvmlite.binding',
  'from PIL import ImageFont',
  'assert librosa.__version__ == "0.11.0", "需要 librosa==0.11.0"',
  'assert callable(librosa.onset.onset_strength) and callable(librosa.beat.beat_track)',
  'ImageFont.load_default(size=22)',
  'print("slice-python-ok")',
].join('\n')
const TESTS = {
  python: [['-B', '-X', 'utf8', '-c', PYTHON_TEST], out => out.includes('slice-python-ok')],
  ffmpeg: [['-hide_banner', '-encoders'], out => /\blibx264\b/.test(out) && /\baac\b/.test(out)],
  ffprobe: [['-version'], out => /^ffprobe version\b/m.test(out)],
}
const bundledPaths = root => ({ python: join(root, 'python', 'python.exe'), ffmpeg: join(root, 'ffmpeg', 'ffmpeg.exe'), ffprobe: join(root, 'ffmpeg', 'ffprobe.exe') })

export async function configureRuntime(config = {}, signal) {
  assert(!configuring, '另一条会话正在配置运行环境，请等待完成')
  configuring = true
  let stage, installed, pending
  let committed = false
  try {
    signal?.throwIfAborted()
    const previous = savedRuntime()
    // Numba's default cache inside site-packages can exceed Windows path limits.
    const pythonEnv = { ...process.env, NUMBA_CACHE_DIR: join(ROOT, 'numba-cache') }
    const check = (key, candidates) => probe(candidates, ...TESTS[key], signal, key === 'python' ? pythonEnv : undefined)
    const [python, ffmpeg] = await Promise.all([
      check('python', [previous?.python, config.advanced?.pythonPath, process.env.DUANJU_PYTHON, BUNDLED_ENABLED && BUNDLED_PYTHON, 'python3', 'python']),
      check('ffmpeg', [previous?.ffmpeg, ...ffmpegCandidates(config), 'ffmpeg']),
    ])
    const ffprobe = await check('ffprobe', [previous?.ffprobe, config.ffprobePath, process.env.FFPROBE_PATH, ffmpeg.path && join(dirname(ffmpeg.path), exe('ffprobe')), BUNDLED_ENABLED && BUNDLED_FFPROBE, 'ffprobe'])
    const checks = { python, ffmpeg, ffprobe }
    const missing = Object.keys(checks).filter(key => !checks[key].path)
    const paths = Object.fromEntries(Object.entries(checks).map(([key, item]) => [key, item.path]))
    if (missing.length) {
      const failures = missing.map(key => `${key}：${checks[key].reason}`).join('；')
      assert(WINDOWS && process.arch === 'x64', `缺少可用运行环境（${failures}）。自动安装仅支持 Windows x64；请先准备本机 Python 及依赖、FFmpeg 和 FFprobe，再重试。`)
    }
    const needsMusic = !isFile(DEFAULT_MUSIC_INDEX)
    const downloads = needsMusic ? [...missing, 'music'] : missing
    if (downloads.length) {
      signal?.throwIfAborted()
      await mkdir(ROOT, { recursive: true })
      stage = await mkdtemp(join(ROOT, '.runtime-setup-'))
      await installMissingRuntime(stage, downloads, signal)
      signal?.throwIfAborted()
      if (missing.length) {
        const destination = join(ROOT, `runtime-${randomUUID()}`)
        await rename(stage, destination)
        installed = destination
        stage = undefined
        const downloaded = bundledPaths(installed)
        const results = await Promise.all(missing.map(key => check(key, [downloaded[key]])))
        for (const [index, key] of missing.entries()) {
          const result = results[index]
          assert(result.path, `下载后的 ${key} 验证失败：${result.reason}`)
          paths[key] = result.path
        }
      }
      if (needsMusic && !isFile(DEFAULT_MUSIC_INDEX)) {
        signal?.throwIfAborted()
        try { await rename(join(installed ?? stage, 'music'), DEFAULT_MUSIC_DIR) } catch (error) {
          // A separate Skill invocation may have published the same validated library first.
          if (!isFile(DEFAULT_MUSIC_INDEX)) throw new Error(`无法保存默认曲库到 ${DEFAULT_MUSIC_DIR}：${error.message}`, { cause: error })
        }
      }
    }
    signal?.throwIfAborted()
    await mkdir(ROOT, { recursive: true })
    pending = `${STATE}.${randomUUID()}.tmp`
    await writeFile(pending, JSON.stringify(paths, null, 2), { flag: 'wx', signal })
    signal?.throwIfAborted()
    await rename(pending, STATE)
    committed = true
    return { ready: true, downloaded: downloads, paths, musicDir: DEFAULT_MUSIC_DIR, summary: '运行环境和默认曲库已就绪。请回到切片工作台。' }
  } finally {
    if (pending && !committed) await rm(pending, { force: true }).catch(ignore)
    if (stage) await rm(stage, { recursive: true, force: true }).catch(ignore)
    if (installed && !committed) await rm(installed, { recursive: true, force: true }).catch(ignore)
    configuring = false
  }
}
