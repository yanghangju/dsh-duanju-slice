import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadLibraryIndex, resolveLibraryTracks } from './music-library.js'
import { MUSIC_REVISION } from './runtime.js'

const execute = promisify(execFile)
const system32 = (...parts) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...parts)
const systemTool = (name) => process.platform === 'win32' ? system32(`${name}.exe`) : name
const MUSIC_ARCHIVE = `https://codeload.github.com/yanghangju/runtime/tar.gz/${MUSIC_REVISION}`
const CPYTHON = '3.13.17'
const NUGET = `https://api.nuget.org/v3-flatcontainer/python/${CPYTHON}/python.${CPYTHON}.nupkg`
const CPYTHON_SHA256 = 'dce409744b088f94c6e37ba41f8100c384c27e029e843237364c602d30d475e5'
const PYPI = 'https://pypi.tuna.tsinghua.edu.cn/simple'
const MEDIA_PATH = 'yanghangju/runtime/533e8e89bc12859fb5a1df4d663e04303926d9f2/ffmpeg'
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

async function run(label, exe, args, { signal, env, timeout = 240_000 }) {
  try {
    return await execute(exe, args, { signal, env, timeout, windowsHide: true })
  } catch (error) {
    signal?.throwIfAborted()
    let detail = error.stderr?.trim().split(/\r?\n/).slice(-2).join('\n') || (error.killed ? '命令超时' : `退出码 ${error.code ?? '未知'}`)
    // Do not expose proxy credentials if a command includes a proxy address in its diagnostics.
    if (env?.HTTPS_PROXY) detail = detail.replaceAll(env.HTTPS_PROXY, '[代理地址]')
    throw new Error(`${label}：${detail.replace(/(\w+:\/\/)[^\s/@]+@/g, '$1***@')}`)
  }
}

async function downloadEnv(url, signal) {
  const vars = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), value]))
  let proxy = vars.https_proxy?.trim() || vars.http_proxy?.trim() || vars.all_proxy?.trim()
  if (!proxy && process.platform === 'win32') {
    // Use the current Windows user's proxy settings for the download destination (including bypass rules).
    const { stdout } = await run('无法检测 Windows 代理', system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; $u = [uri]$env:DUANJU_DOWNLOAD_URL; $p = [Net.WebRequest]::GetSystemWebProxy().GetProxy($u); if ($p -and $p -ne $u) { $p.AbsoluteUri }",
    ], { signal, timeout: 15_000, env: { ...process.env, DUANJU_DOWNLOAD_URL: url } })
    proxy = stdout.trim()
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(https?_proxy|all_proxy|no_proxy|pip_.*)$/i.test(key)))
  if (proxy) {
    env.HTTPS_PROXY = proxy
    if (vars.no_proxy) env.NO_PROXY = vars.no_proxy
  } else {
    env.NO_PROXY = '*'
  }
  return { env, mode: proxy ? '使用已配置的代理' : '直连' }
}

async function download(url, file, limit, signal, { env, mode }, expectedHash, name = new URL(url).pathname.split('/').at(-1)) {
  await run(`下载 ${name} 失败（${mode}）`, systemTool('curl'), [
    '--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '12', '--retry', '1', '--max-filesize', String(limit), '--output', file, url,
  ], { signal, env })
  const { size } = await stat(file)
  assert(size > 0 && size <= limit, `下载文件大小不符合预期：${url}`)
  if (expectedHash) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
    assert.equal(hash.digest('hex'), expectedHash, `下载文件校验失败：${url}`)
  }
}

async function installPython(stage, signal) {
  const network = await downloadEnv(NUGET, signal)
  const archive = join(stage, 'python.nupkg')
  await download(NUGET, archive, 20 * 1024 ** 2, signal, network, CPYTHON_SHA256)
  await run('解压 CPython 失败', system32('tar.exe'), ['-xf', archive, '-C', stage, 'tools'], { signal })
  const python = join(stage, 'python')
  await rename(join(stage, 'tools'), python)
  await unlink(archive)
  const { env, mode } = await downloadEnv(PYPI, signal)
  await run(`从清华 PyPI 镜像安装 Python 依赖失败（${mode}）`, join(python, 'python.exe'), [
    '-I', '-B', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-cache-dir',
    '--no-user', '--only-binary=:all:', '--index-url', PYPI, '--retries', '2', '--timeout', '25',
    'librosa==0.11.0', 'Pillow==12.3.0',
  ], { signal, timeout: 10 * 60_000, env: { ...env, PIP_CONFIG_FILE: 'nul' } })
}

async function installMedia(stage, missing, signal) {
  const dir = join(stage, 'ffmpeg')
  await mkdir(dir)
  if (missing.includes('ffmpeg')) {
    await download(`${MEDIA_LFS}/ffmpeg.exe`, join(dir, 'ffmpeg.exe'), 105423872, signal, await downloadEnv(MEDIA_LFS, signal),
      '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec')
  }
  if (missing.includes('ffprobe')) {
    const network = await downloadEnv(MEDIA_RAW, signal)
    for (const [file, size, hash] of FFPROBE_FILES) {
      await download(`${MEDIA_RAW}/${file}`, join(dir, file), size, signal, network, hash)
    }
  }
}

async function installMusic(stage, signal) {
  const archive = join(stage, 'music.tar.gz')
  await download(MUSIC_ARCHIVE, archive, 200 * 1024 ** 2, signal, await downloadEnv(MUSIC_ARCHIVE, signal), undefined, '默认曲库')
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
  if (missing.includes('python')) await installPython(stage, signal)
  if (missing.includes('ffmpeg') || missing.includes('ffprobe')) await installMedia(stage, missing, signal)
  if (missing.includes('music')) await installMusic(stage, signal)
}
