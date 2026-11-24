import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadLibraryIndex, resolveLibraryTracks } from './music-library.js'
import { MUSIC_REVISION } from './runtime.js'

const execute = promisify(execFile)
const system32 = (...parts) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...parts)
const systemTool = (name) => process.platform === 'win32' ? system32(`${name}.exe`) : name
const REPO = 'yanghangju/runtime'
const MUSIC_ARCHIVES = [
  `https://codeload.github.com/${REPO}/tar.gz/${MUSIC_REVISION}`,
  `https://github.com/${REPO}/archive/${MUSIC_REVISION}.tar.gz`,
]
const CPYTHON = '3.13.17'
const NUGET = [
  `https://api.nuget.org/v3-flatcontainer/python/${CPYTHON}/python.${CPYTHON}.nupkg`,
  `https://www.nuget.org/api/v2/package/python/${CPYTHON}`,
]
const CPYTHON_SHA256 = 'dce409744b088f94c6e37ba41f8100c384c27e029e843237364c602d30d475e5'
const PYPI = ['https://pypi.tuna.tsinghua.edu.cn/simple', 'https://pypi.org/simple']
const MEDIA_REVISION = '533e8e89bc12859fb5a1df4d663e04303926d9f2'
const MEDIA_PATH = `${REPO}/${MEDIA_REVISION}/ffmpeg`
const MEDIA_RAW = `https://raw.githubusercontent.com/${MEDIA_PATH}`
const MEDIA_LFS = `https://media.githubusercontent.com/media/${MEDIA_PATH}`
// Match the original FFprobe and its private DLLs at the pinned media revision.
const FFPROBE_FILES = [
  ['ffprobe.exe', 209944, 'efdbf532876e2630f59a7eb462fc654b93aa15ec71e764144815877f824c0065'],
  ['avcodec-61.dll', 19721752, '0b06f047384fc3ef692837414cc9f8815d2793007b23b990a0c43851761fa6d3'],
  ['avdevice-61.dll', 177176, '32e71a7d096153c26682363ea35eec9fc422fecfb6085c4fc3b334b80f041ef4'],
  ['avfilter-10.dll', 5626904, 'e804e95ff84bbc827981fdb3081c10c15678bb4bc4e3a09c4d698587b31281d6'],
  ['avformat-61.dll', 3368472, '96964e285da20d4e4e45647bad4bcb1b46b1a936848b5328e43d4ae1e915c561'],
  ['avutil-59.dll', 1449496, '0d2810a18b1e424349de4e5c334f31c55717514fd963d89d097b085876abdf41'],
  ['brotlicommon.dll', 157208, '976befaa15bd7c98d2693f90390198b7ab615fe109591ba0600e14aff992a725'],
  ['brotlienc.dll', 689176, '04f92ccdfe5e826bc6a334f7209e99d2a9a474ca4e7caf34ad095b88efeb6306'],
  ['D3DCOMPILER_47.dll', 4486168, '69d88acbb25e5ba6c8e55a4e893cb403995ca895b48e8900c9de031907c33ba4'],
  ['dav1d.dll', 1031704, '6cff1d53b402327d4bba7da94c4c0b7a331fb3fa3cce29879eaf96cf48970043'],
  ['jxl.dll', 3261976, '62f16715acda14fdc527867361ebde471365e8ee6ee0eb98e384d0de3eb376a8'],
  ['jxl_cms.dll', 159768, '72c21419cb0a64e0308c20f0fefd6791fb4ad83b731d41877236536b5fab41c4'],
  ['jxl_threads.dll', 42520, '5c507b0450f51b99dcd7c05448031bddc4359e3fec2998a31704a69dc5cee6eb'],
  ['MSVCP140.dll', 549912, '65b89f7cc68f28e65ced4191950c02ec5ae87609e2e13cf227a61f0915b2c1cd'],
  ['swresample-5.dll', 200728, '3996990655b60ed8908799a563fdffe4dbe374a0ab9cc0db025f3514c9de21fd'],
  ['swscale-8.dll', 854552, '367476cf1755dcf151aac63c846f64af318022aa9cf43230fe3cb0650150f14f'],
  ['VCRUNTIME140.dll', 116760, '8bf7444851876d7b1f475f2f52ba0e08d186921d2426cccec50cabac41980b39'],
  ['VCRUNTIME140_1.dll', 42008, 'e173de59127d19b6f55f59fc19d273da74fc7bc6e764df878d0c853c0a1f8112'],
]

class RouteError extends Error {}

const CURL_FAILURES = {
  1: '协议不可用或不允许', 3: '地址或代理格式无效', 5: '代理地址无效或无法解析', 6: '无法解析下载主机',
  7: '无法连接', 18: '下载不完整', 22: '服务器返回 HTTP 错误', 23: '无法写入下载文件', 26: '无法读取本地文件',
  28: '连接或传输超时', 35: 'TLS 握手失败', 47: '重定向过多', 51: 'TLS 证书校验失败',
  52: '服务器未响应', 55: '发送数据失败', 56: '接收数据或建立代理隧道失败', 60: 'TLS 证书校验失败',
  63: '超过下载大小上限', 77: '无法读取 TLS CA 证书', 97: '代理握手失败',
}

function curlFailure({ code, stderr }) {
  const status = stderr?.match(/(?:returned error:|response) ([45]\d\d)\b/)?.[1]
  return status ? `HTTP ${status}` : CURL_FAILURES[code]
}

function pipFailure({ stderr = '' }) {
  if (/CERTIFICATE_VERIFY_FAILED|SSLError/i.test(stderr)) return 'TLS 证书校验或握手失败'
  if (/ProxyError|invalid proxy|cannot connect to proxy/i.test(stderr)) return '代理连接或认证失败'
  if (/getaddrinfo failed|name resolution|NameResolutionError/i.test(stderr)) return '无法解析下载主机'
  if (/timed?\s*out|(?:Connect|Read)Timeout/i.test(stderr)) return '连接或传输超时'
  if (/NewConnectionError|ConnectionError|connection refused/i.test(stderr)) return '无法连接'
  const status = stderr.match(/\b([45]\d\d) (?:Client|Server) Error\b/i)?.[1]
  if (status) return `HTTP ${status}`
  if (/no space left|not enough space|WinError 112/i.test(stderr)) return '暂存盘空间不足'
  if (/permission denied|access is denied|WinError 5\b/i.test(stderr)) return '暂存文件访问被拒绝'
  if (/do not match the hashes|hash mismatch/i.test(stderr)) return '依赖包哈希校验失败'
  if (/no matching distribution|could not find a version/i.test(stderr)) return '未找到匹配的 wheel 或版本'
  if (/invalid wheel|wheel.+ is invalid/i.test(stderr)) return 'wheel 无效'
}

async function run(label, exe, args, { signal, env, timeout, describe }) {
  signal?.throwIfAborted()
  try {
    const result = await execute(exe, args, { signal, env, timeout, windowsHide: true })
    signal?.throwIfAborted()
    return result
  } catch (error) {
    signal?.throwIfAborted()
    const code = error.code
    const exit = Number.isInteger(code) ? `退出码 ${code}` : '未知退出码'
    const local = { EACCES: '访问被拒绝', EPERM: '操作不被允许', ENOENT: '找不到命令或文件', ENOSPC: '暂存盘空间不足' }[code]
    // Never include raw command output/arguments, which can echo decoded or partial proxy credentials.
    const detail = local || (error.killed ? '命令超时' : describe?.(error) || exit)
    const fatalWrite = describe === curlFailure && [23, 26].includes(code)
      || describe === pipFailure && /暂存/.test(detail)
    const Failure = describe && !local && !fatalWrite ? RouteError : Error
    throw new Failure(`${label}：${detail}`)
  }
}

function downloadNetwork(signal) {
  const entries = Object.entries(process.env)
  const vars = Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), value]))
  const configured = vars.https_proxy?.trim() || vars.http_proxy?.trim() || vars.all_proxy?.trim()
  const env = Object.fromEntries(entries.filter(([key]) => !/^(https?_proxy|all_proxy|no_proxy|pip_.*)$/i.test(key)))
  const direct = { ...env, NO_PROXY: '*' }
  return {
    direct,
    async trySources(urls, attempt) {
      const failures = []
      for (const url of urls) {
        signal?.throwIfAborted()
        const host = new URL(url).hostname
        let proxy = configured
        if (!proxy && vars.no_proxy?.trim() !== '*' && process.platform === 'win32') {
          try {
            // Use the current Windows user's proxy settings for this destination, including PAC bypass rules.
            const { stdout } = await run('无法检测 Windows 代理', system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
              '-NoProfile', '-NonInteractive', '-Command',
              "$ErrorActionPreference = 'Stop'; $u = [uri]$env:DUANJU_DOWNLOAD_URL; $p = [Net.WebRequest]::GetSystemWebProxy().GetProxy($u); if ($p -and $p -ne $u) { $p.AbsoluteUri }",
            ], { signal, timeout: 15_000, env: { ...env, DUANJU_DOWNLOAD_URL: url } })
            proxy = stdout.trim()
          } catch (error) {
            signal?.throwIfAborted()
            failures.push(`${host}：${error.message}`)
          }
        }
        const routes = proxy && vars.no_proxy?.trim() !== '*' ? [
          [{ ...env, HTTPS_PROXY: proxy, ...(vars.no_proxy && { NO_PROXY: vars.no_proxy }) }, '使用已配置的代理（遵循绕过规则）'],
          [direct, '直连'],
        ] : [[direct, '直连']]
        for (const [childEnv, mode] of routes) {
          signal?.throwIfAborted()
          try {
            return await attempt(url, childEnv, `${host}，${mode}`)
          } catch (error) {
            signal?.throwIfAborted()
            if (!(error instanceof RouteError)) throw error
            failures.push(error.message)
          }
        }
      }
      throw new Error(failures.join('\n'))
    },
  }
}

async function download({ urls, file, limit, hash, name, network, signal }) {
  await network.trySources(urls, async (url, env, route) => {
    const label = `下载 ${name} 失败（${route}）`
    // A later route must not inspect or reuse a partial/invalid file from a failed route.
    await rm(file, { force: true })
    await run(label, systemTool('curl'), [
      '--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
      '--connect-timeout', '12', '--speed-limit', '1024', '--speed-time', '30',
      '--max-filesize', String(limit),
      ...(new URL(url).hostname === 'api.github.com' ? ['--header', 'Accept: application/vnd.github.raw+json'] : []),
      '--output', file, url,
    ], { signal, env, timeout: 300_000, describe: curlFailure })
    const archive = await lstat(file).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    if (!archive?.isFile() || archive.size === 0) throw new RouteError(`${label}：未收到有效文件`)
    if (archive.size > limit) throw new RouteError(`${label}：超过下载大小上限`)
    if (hash) {
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(file, { signal })) digest.update(chunk)
      if (digest.digest('hex') !== hash) throw new RouteError(`${label}：SHA256 校验失败`)
    }
    signal?.throwIfAborted()
  })
}

async function installPython(stage, network, signal) {
  const archive = join(stage, 'python.nupkg')
  await download({ urls: NUGET, file: archive, limit: 20 * 1024 ** 2, hash: CPYTHON_SHA256, name: `python.${CPYTHON}.nupkg`, network, signal })
  await run('解压 CPython 失败', system32('tar.exe'), ['-xf', archive, '-C', stage, 'tools'], { signal })
  const python = join(stage, 'python')
  await rename(join(stage, 'tools'), python)
  await unlink(archive)

  const wheels = join(stage, 'wheels')
  const common = ['--disable-pip-version-check', '--no-input', '--no-cache-dir', '--only-binary=:all:']
  const pip = (label, command, args, env) => run(label, join(python, 'python.exe'), [
    '-I', '-B', '-m', 'pip', command, ...common, ...args,
  ], { signal, env: { ...env, PIP_CONFIG_FILE: 'nul' }, timeout: 300_000, describe: pipFailure })
  // Resolve/download from one index at a time, discarding incomplete results before retrying.
  const wheelFiles = await network.trySources(PYPI, async (url, env, route) => {
    const label = `下载 Python 依赖失败（${route}）`
    await rm(wheels, { recursive: true, force: true })
    await mkdir(wheels)
    await pip(label, 'download', [
      '--dest', wheels, '--index-url', url, '--retries', '1', '--timeout', '25', 'librosa==0.11.0', 'Pillow==12.3.0',
    ], env)
    const files = await readdir(wheels, { withFileTypes: true })
    if (!files.length || files.some(file => !file.isFile() || !file.name.endsWith('.whl'))) {
      throw new RouteError(`${label}：未收到有效的 wheel 文件`)
    }
    return files.map(file => join(wheels, file.name))
  })
  // The download resolved dependencies; install exactly those files without resolving URLs again.
  await pip('安装已下载的 Python 依赖失败', 'install', ['--no-user', '--no-index', '--no-deps', ...wheelFiles], network.direct)
  await rm(wheels, { recursive: true })
}

async function installMedia(stage, missing, network, signal) {
  const dir = join(stage, 'ffmpeg')
  await mkdir(dir)
  if (missing.includes('ffmpeg')) {
    await download({
      urls: [`${MEDIA_LFS}/ffmpeg.exe`, `https://github.com/${REPO}/raw/${MEDIA_REVISION}/ffmpeg/ffmpeg.exe`],
      file: join(dir, 'ffmpeg.exe'), limit: 105423872, name: 'ffmpeg.exe', network, signal,
      hash: '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec',
    })
  }
  if (missing.includes('ffprobe')) {
    for (const [file, size, hash] of FFPROBE_FILES) {
      await download({
        urls: [`${MEDIA_RAW}/${file}`, `https://api.github.com/repos/${REPO}/contents/ffmpeg/${file}?ref=${MEDIA_REVISION}`],
        file: join(dir, file), limit: size, hash, name: file, network, signal,
      })
    }
  }
}

async function installMusic(stage, network, signal) {
  const archive = join(stage, 'music.tar.gz')
  await download({ urls: MUSIC_ARCHIVES, file: archive, limit: 200 * 1024 ** 2, name: '默认曲库', network, signal })
  // The pinned snapshot has other runtime files; extract only music/. Windows bsdtar needs UTF-8 for track names.
  const charset = process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : []
  await run('解压默认曲库失败', systemTool('tar'), [
    ...charset, '-xf', archive, '-C', stage, '--strip-components=1', `runtime-${MUSIC_REVISION}/music`,
  ], { signal })
  await unlink(archive)
  const library = await loadLibraryIndex(join(stage, 'music'), signal, { createIfMissing: false })
  await resolveLibraryTracks(library, library.tracks, signal)
}

export async function installMissingRuntime(stage, missing, signal) {
  signal?.throwIfAborted()
  const network = downloadNetwork(signal)
  if (missing.includes('python')) await installPython(stage, network, signal)
  if (missing.includes('ffmpeg') || missing.includes('ffprobe')) await installMedia(stage, missing, network, signal)
  if (missing.includes('music')) await installMusic(stage, network, signal)
}
