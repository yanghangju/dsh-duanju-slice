import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ffmpegCandidates } from './media.js'
import { BUNDLED_ENABLED, BUNDLED_FFPROBE, BUNDLED_PYTHON } from './runtime.js'

const ROOT = join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice')
const STATE = join(ROOT, 'runtime.json')
// Pin the user-specified repository to a known revision before running its binaries.
const REPO = 'yanghangju/runtime'
const REV = '533e8e89bc12859fb5a1df4d663e04303926d9f2'
const ZIP = `https://codeload.github.com/${REPO}/zip/${REV}`
const LFS = [
  ['ffmpeg/ffmpeg.exe', 105423872, '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec'],
  ['python/Lib/site-packages/llvmlite/binding/llvmlite.dll', 120369664, 'a3500f4ffd7c4b47ec785c5964af7ed01fb95dd125c0d7efcdb680920821da6f'],
]
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

export function configuredRuntime() {
  const saved = savedRuntime()
  return saved && Object.values(saved).every(isFile) ? saved : null
}

export function runtimeOptions(config) {
  const installed = configuredRuntime()
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
      reason = `${path}：${String(error.stderr || error.message).trim().split(/\r?\n/).at(-1)}`
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

async function download(url, file, { signal, limit, sha256 }) {
  const response = await fetch(url, { signal, redirect: 'error' })
  assert(response.ok && response.body, `运行时下载失败（HTTP ${response.status}）：${url}`)
  let bytes = 0
  const hash = sha256 && createHash('sha256')
  const meter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length
    if (bytes > limit) return done(new Error('运行时下载超过预期大小'))
    hash?.update(chunk)
    done(null, chunk)
  } })
  await pipeline(response.body, meter, createWriteStream(file, { flags: 'wx' }), { signal })
  if (sha256) assert(bytes === limit && hash.digest('hex') === sha256, `运行时文件校验失败：${url}`)
}

async function hydrate(root, [relative, size, sha256], signal) {
  const file = join(root, relative)
  if (statSync(file).size !== size) {
    const pending = `${file}.download`
    await download(`https://media.githubusercontent.com/media/${REPO}/${REV}/${relative}`, pending, { signal, limit: size, sha256 })
    await rename(pending, file)
    return
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  assert(hash.digest('hex') === sha256, `运行时文件校验失败：${relative}`)
}

async function unpack(stage, signal) {
  const archive = join(stage, 'runtime.zip')
  // Use the OS ZIP-capable tar with its default safe extraction rules, into an owned staging directory.
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  assert(isFile(tar), '无法解压运行时：需要 Windows 自带的 tar.exe')
  await download(ZIP, archive, { signal, limit: 600 * 1024 * 1024 })
  const name = `runtime-${REV}`
  await execute(tar, ['-xf', archive, '-C', stage, name], { timeout: 5 * 60_000, windowsHide: true, signal })
  const root = join(stage, name)
  // GitHub source archives can contain LFS pointers. Fetch only these pinned, hashed objects over HTTPS.
  for (const member of LFS) await hydrate(root, member, signal)
  await rm(archive)
  return root
}

export async function configureRuntime(config = {}, signal) {
  assert(!configuring, '另一条会话正在配置运行环境，请等待完成')
  configuring = true
  let stage, installed, pending
  let committed = false
  try {
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
      assert(WINDOWS && process.arch === 'x64', `缺少可用运行环境（${failures}）。GitHub 便携运行时仅支持 Windows x64；请先准备本机 Python 及依赖、FFmpeg 和 FFprobe，再重试。`)
      const transfer = AbortSignal.timeout(20 * 60_000)
      const downloadSignal = signal ? AbortSignal.any([signal, transfer]) : transfer
      await mkdir(ROOT, { recursive: true })
      stage = await mkdtemp(join(ROOT, '.runtime-setup-'))
      const root = await unpack(stage, downloadSignal)
      downloadSignal.throwIfAborted()
      installed = join(ROOT, `runtime-${randomUUID()}`)
      await rename(root, installed)
      const downloaded = bundledPaths(installed)
      const results = await Promise.all(missing.map(key => check(key, [downloaded[key]])))
      for (const [index, key] of missing.entries()) {
        const result = results[index]
        assert(result.path, `下载后的 ${key} 验证失败：${result.reason}`)
        paths[key] = result.path
      }
    }
    signal?.throwIfAborted()
    await mkdir(ROOT, { recursive: true })
    pending = `${STATE}.${randomUUID()}.tmp`
    await writeFile(pending, JSON.stringify(paths, null, 2), { flag: 'wx', signal })
    signal?.throwIfAborted()
    await rename(pending, STATE)
    committed = true
    return { ready: true, downloaded: missing, paths, summary: '运行环境已配置并验证通过。请回到切片工作台点击「新建会话」，在新对话开始剪辑。' }
  } finally {
    if (pending && !committed) await rm(pending, { force: true }).catch(ignore)
    if (stage) await rm(stage, { recursive: true, force: true }).catch(ignore)
    if (installed && !committed) await rm(installed, { recursive: true, force: true }).catch(ignore)
    configuring = false
  }
}
