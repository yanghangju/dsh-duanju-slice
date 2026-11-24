import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { cleanup, tempDir } from './support.mjs'

const context = vm.createContext({ process: { platform: 'win32', arch: 'x64' }, URL, AbortSignal })

async function loadRuntime(file, env, execFile, overrides = {}) {
  const url = new URL(`../lib/promo/${file}`, import.meta.url)
  context.process.env = env
  const source = new vm.SourceTextModule(await readFile(url, 'utf8'), { context })
  await source.link(async (name) => {
    const exports = name === 'node:child_process' ? { execFile }
      : overrides[name] ?? await import(name.startsWith('.') ? new URL(name, url).href : name)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await source.evaluate()
  return source.namespace
}

const fakeExec = fn => Object.assign(() => {}, { [promisify.custom]: fn })
const fakeError = (code, stderr) => Object.assign(new Error(`mock command failed: ${stderr}`), { code, stderr })
const proxy = 'http://fixture-login:fixture%40secret@proxy.example:8080'
const leaks = /fixture-login|fixture%40secret|fixture@secret|proxy\.example|untrusted\.example/
const nuget = [
  'https://api.nuget.org/v3-flatcontainer/python/3.13.17/python.3.13.17.nupkg',
  'https://www.nuget.org/api/v2/package/python/3.13.17',
]
const pypi = ['https://pypi.tuna.tsinghua.edu.cn/simple', 'https://pypi.org/simple']

function expectNoSecrets(error) {
  assert.doesNotMatch(error.stack, leaks)
  assert.equal(error.cause, undefined)
}

function expectCurlLimits(args, options, size) {
  assert.equal(args[0], '--disable')
  assert.equal(args[args.indexOf('--proto') + 1], '=https')
  assert.equal(args[args.indexOf('--proto-redir') + 1], '=https')
  assert.equal(args[args.indexOf('--max-filesize') + 1], String(size))
  assert.equal(args[args.indexOf('--connect-timeout') + 1], '12')
  assert.equal(args[args.indexOf('--speed-time') + 1], '30')
  assert.equal(options.timeout, 300_000)
}

test('NuGet 路线耗尽后报告具体故障，环境代理优先但直连和诊断均无凭据', async (t) => {
  const stage = await tempDir('slice-download-')
  t.after(() => cleanup(stage))
  const env = { hTtPs_PrOxY: proxy, HTTP_PROXY: 'http://untrusted.example', ALL_PROXY: proxy, no_proxy: 'localhost', PIP_INDEX_URL: 'https://untrusted.example' }
  const commands = []
  const failures = [
    [5, `Unsupported proxy syntax: ${proxy}`],
    [6, 'Could not resolve host; stale proxy user=fixture-login password=fixture@secret'],
    [60, 'Certificate rejected for fixture%40secret'],
    [22, `curl: (22) The requested URL returned error: 503: ${proxy}`],
  ]
  const execFile = fakeExec(async (exe, args, options) => {
    assert.equal(basename(exe), 'curl.exe')
    expectCurlLimits(args, options, 20 * 1024 ** 2)
    for (const key of ['HTTP_PROXY', 'ALL_PROXY', 'hTtPs_PrOxY', 'no_proxy', 'PIP_INDEX_URL']) assert.equal(options.env[key], undefined)
    const failure = failures[commands.length]
    commands.push([args.at(-1), options.env.HTTPS_PROXY, options.env.NO_PROXY])
    throw fakeError(...failure)
  })
  const runtime = await loadRuntime('runtime-download.js', env, execFile)
  await assert.rejects(runtime.installMissingRuntime(stage, ['python']), error => {
    expectNoSecrets(error)
    assert.match(error.message, /下载 python\.3\.13\.17\.nupkg 失败/)
    assert.match(error.message, /api\.nuget\.org.*已配置的代理.*代理地址无效或无法解析/)
    assert.match(error.message, /api\.nuget\.org.*直连.*无法解析下载主机/)
    assert.match(error.message, /www\.nuget\.org.*已配置的代理.*TLS 证书校验失败/)
    assert.match(error.message, /www\.nuget\.org.*直连.*HTTP 503/)
    return true
  })
  assert.deepEqual(commands, nuget.flatMap(url => [[url, proxy, 'localhost'], [url, undefined, '*']]))
  assert.equal(env.hTtPs_PrOxY, proxy)
  assert.equal(env.no_proxy, 'localhost')
  assert.deepEqual(await readdir(stage), [])
})

test('Windows 代理分别按目标查找；查询失败也直连，最终诊断不泄露查询输出', async (t) => {
  const stage = await tempDir('slice-download-')
  t.after(() => cleanup(stage))
  const commands = []
  const execFile = fakeExec(async (exe, args, options) => {
    if (basename(exe) === 'powershell.exe') {
      const url = options.env.DUANJU_DOWNLOAD_URL
      assert.equal(options.timeout, 15_000)
      commands.push(['lookup', url])
      if (url === nuget[0]) throw fakeError(1, `WinHTTP PAC failure ${proxy}`)
      return { stdout: `${proxy}\r\n` }
    }
    assert.equal(basename(exe), 'curl.exe')
    commands.push([args.at(-1), options.env.HTTPS_PROXY, options.env.NO_PROXY])
    throw fakeError(7, `cannot connect ${proxy}`)
  })
  const runtime = await loadRuntime('runtime-download.js', {}, execFile)
  await assert.rejects(runtime.installMissingRuntime(stage, ['python']), error => {
    expectNoSecrets(error)
    assert.match(error.message, /api\.nuget\.org：无法检测 Windows 代理：退出码 1/)
    assert.match(error.message, /api\.nuget\.org.*直连.*无法连接/)
    return true
  })
  assert.deepEqual(commands, [
    ['lookup', nuget[0]], [nuget[0], undefined, '*'],
    ['lookup', nuget[1]], [nuget[1], proxy, undefined], [nuget[1], undefined, '*'],
  ])
})

function pinnedFixture(bytes, expectedHash) {
  return { createHash(algorithm) {
    assert.equal(algorithm, 'sha256')
    const chunks = []
    return {
      update(chunk) { chunks.push(chunk) },
      digest(encoding) {
        assert.equal(encoding, 'hex')
        return Buffer.concat(chunks).equals(Buffer.from(bytes)) ? expectedHash : 'invalid-digest'
      },
    }
  } }
}

for (const exhausted of [false, true]) {
  test(`pip 每个索引使用干净暂存目录；${exhausted ? '耗尽时不安装且不泄密' : 'PyPI 成功后只安装暂存 wheels'}`, async (t) => {
    const stage = await tempDir('slice-python-')
    t.after(() => cleanup(stage))
    const commands = []
    const wheels = join(stage, 'wheels')
    const archive = join(stage, 'python.nupkg')
    const execFile = fakeExec(async (exe, args, options) => {
      const name = basename(exe)
      const fromProxy = Boolean(options.env?.HTTPS_PROXY)
      if (name === 'curl.exe') {
        const url = args.at(-1)
        commands.push([url, fromProxy])
        assert.equal(args.at(-2), archive)
        if (url === nuget[0] && !fromProxy) return { stdout: '' } // must not reuse a prior file
        await writeFile(archive, url === nuget[0] ? 'corrupt' : 'pinned CPython')
        return { stdout: '' }
      }
      if (name === 'tar.exe') {
        commands.push(['extract'])
        assert.equal(await readFile(archive, 'utf8'), 'pinned CPython')
        assert.equal(args.at(-1), 'tools')
        await mkdir(join(stage, 'tools'))
        return { stdout: '' }
      }
      assert.equal(exe, join(stage, 'python', 'python.exe'))
      assert.deepEqual([...args.slice(0, 4)], ['-I', '-B', '-m', 'pip'])
      assert(args.includes('--only-binary=:all:'))
      assert(!args.includes('--trusted-host') && !args.includes('--extra-index-url'))
      assert.equal(options.env.PIP_CONFIG_FILE, 'nul')
      assert.equal(options.env.PIP_EXTRA_INDEX_URL, undefined)
      assert.equal(options.env.pip_trusted_host, undefined)
      assert.equal(options.env.NO_PROXY, fromProxy ? undefined : '*')
      assert.equal(options.timeout, 300_000)
      if (args[4] === 'download') {
        const index = args[args.indexOf('--index-url') + 1]
        commands.push([index, fromProxy])
        assert(args.includes('librosa==0.11.0') && args.includes('Pillow==12.3.0'))
        assert.equal(args[args.indexOf('--dest') + 1], wheels)
        assert.deepEqual(await readdir(wheels), [])
        if (index === pypi[1] && !exhausted) {
          if (!fromProxy) {
            for (const wheel of ['pillow.whl', 'librosa.whl']) await writeFile(join(wheels, wheel), 'fixture wheel')
          } // A zero-output success on the proxy route must still fall back.
        } else {
          await writeFile(join(wheels, 'failed.whl'), '')
          throw fakeError(1, fromProxy ? `ProxyError with decoded password fixture@secret at ${proxy}` :
            `ERROR: No matching distribution found (fixture-login:fixture%40secret from https://untrusted.example)`)
        }
      } else {
        commands.push(['install'])
        assert.equal(args[4], 'install')
        assert(args.includes('--no-index') && args.includes('--no-deps') && args.includes('--no-user') && !args.includes('--index-url'))
        assert.deepEqual([...args.slice(args.indexOf('--no-deps') + 1)].sort(), [join(wheels, 'librosa.whl'), join(wheels, 'pillow.whl')])
      }
      return { stdout: '' }
    })
    const runtime = await loadRuntime('runtime-download.js', {
      https_proxy: proxy, PIP_EXTRA_INDEX_URL: 'https://untrusted.example', pip_trusted_host: 'untrusted.example',
    }, execFile, { 'node:crypto': pinnedFixture('pinned CPython', 'dce409744b088f94c6e37ba41f8100c384c27e029e843237364c602d30d475e5') })
    if (exhausted) {
      await assert.rejects(runtime.installMissingRuntime(stage, ['python']), error => {
        expectNoSecrets(error)
        assert.match(error.message, /pypi\.tuna\.tsinghua\.edu\.cn.*已配置的代理.*代理连接或认证失败/)
        assert.match(error.message, /pypi\.org.*直连.*未找到匹配的 wheel 或版本/)
        return true
      })
    } else {
      await runtime.installMissingRuntime(stage, ['python'])
      assert.deepEqual(await readdir(stage), ['python'])
    }
    assert.deepEqual(commands, [
      [nuget[0], true], [nuget[0], false], [nuget[1], true], ['extract'],
      ...pypi.flatMap(index => [[index, true], [index, false]]), ...exhausted ? [] : [['install']],
    ])
  })
}

test('FFmpeg/FFprobe 从固定 GitHub 备用路线下载，错误大小和摘要仍拒绝', async (t) => {
  const stage = await tempDir('slice-media-')
  t.after(() => cleanup(stage))
  const revision = '533e8e89bc12859fb5a1df4d663e04303926d9f2'
  const lfs = `https://media.githubusercontent.com/media/yanghangju/runtime/${revision}/ffmpeg/ffmpeg.exe`
  const lfsBackup = `https://github.com/yanghangju/runtime/raw/${revision}/ffmpeg/ffmpeg.exe`
  const raw = `https://raw.githubusercontent.com/yanghangju/runtime/${revision}/ffmpeg/ffprobe.exe`
  const api = `https://api.github.com/repos/yanghangju/runtime/contents/ffmpeg/ffprobe.exe?ref=${revision}`
  const downloads = []
  const execFile = fakeExec(async (exe, args, options) => {
    assert.equal(basename(exe), 'curl.exe')
    const url = args.at(-1)
    downloads.push(url)
    expectCurlLimits(args, options, [lfs, lfsBackup].includes(url) ? 105423872 : 209944)
    if (url === lfs) throw fakeError(22, 'curl: (22) The requested URL returned error: 404')
    if (url === lfsBackup) await writeFile(args.at(-2), 'pinned FFmpeg')
    if (url === raw) await writeFile(args.at(-2), Buffer.alloc(209945))
    if (url === api) {
      assert.equal(args[args.indexOf('--header') + 1], 'Accept: application/vnd.github.raw+json')
      await writeFile(args.at(-2), 'not the pinned FFprobe')
    }
    return { stdout: '' }
  })
  const runtime = await loadRuntime('runtime-download.js', { NO_PROXY: '*' }, execFile, {
    'node:crypto': pinnedFixture('pinned FFmpeg', '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec'),
  })
  await assert.rejects(runtime.installMissingRuntime(stage, ['ffmpeg', 'ffprobe']), error => {
    assert.match(error.message, /下载 ffprobe\.exe 失败（raw\.githubusercontent\.com，直连）：超过下载大小上限/)
    assert.match(error.message, /下载 ffprobe\.exe 失败（api\.github\.com，直连）：SHA256 校验失败/)
    return true
  })
  assert.deepEqual(downloads, [lfs, lfsBackup, raw, api])
})

test('旧环境复用已保存工具，只下载曲库；验证失败不发布，成功后不重复下载', async (t) => {
  const root = await tempDir('slice-setup-')
  t.after(() => cleanup(root))
  const runtimePaths = await import('../lib/promo/runtime.js')
  const musicDir = join(root, basename(runtimePaths.DEFAULT_MUSIC_DIR))
  const index = join(musicDir, 'music_library.json')
  const state = join(root, 'runtime.json')
  const bins = { python: join(root, 'python.exe'), ffmpeg: join(root, 'ffmpeg.exe'), ffprobe: join(root, 'ffprobe.exe') }
  const previous = JSON.stringify(bins)
  await Promise.all([...Object.values(bins).map(file => writeFile(file, 'fixture')), writeFile(state, previous)])
  const catalog = [{ directory: '中文曲目', description: '示例描述', library: 'primary' }]
  const proxy = 'http://proxy.example:8080'
  const env = { https_proxy: proxy }
  const revision = runtimePaths.MUSIC_REVISION
  const urls = [
    `https://codeload.github.com/yanghangju/runtime/tar.gz/${revision}`,
    `https://github.com/yanghangju/runtime/archive/${revision}.tar.gz`,
  ]
  const routes = []
  let complete = false
  let missingArchive = false
  let extractFailure = false
  let useBackup = false
  let downloads = 0
  let extracts = 0
  context.AbortSignal = { timeout() { assert.fail('配置不应设置总时限') } }
  t.after(() => { context.AbortSignal = AbortSignal })
  let cancelAt, controller
  function cancel(phase, { signal }) {
    assert.equal(signal, controller?.signal)
    if (phase !== cancelAt) return
    controller.abort(new Error('fixture cancelled'))
    signal.throwIfAborted()
  }
  const execFile = fakeExec(async (exe, args, options) => {
    if (exe === bins.python) {
      cancel('probe', options)
      return { stdout: 'slice-python-ok' }
    }
    if (exe === bins.ffmpeg) return { stdout: 'libx264 aac' }
    if (exe === bins.ffprobe) return { stdout: 'ffprobe version' }
    if (basename(exe) === 'curl.exe') {
      const url = args.at(-1)
      const fromProxy = Boolean(options.env.HTTPS_PROXY)
      routes.push([url, fromProxy])
      assert(urls.includes(url))
      assert.equal(options.env.HTTPS_PROXY, fromProxy ? proxy : undefined)
      assert.equal(options.env.NO_PROXY, fromProxy ? undefined : '*')
      expectCurlLimits(args, options, 200 * 1024 ** 2)
      if (cancelAt === 'direct') {
        if (fromProxy) throw fakeError(5, 'Unsupported proxy syntax')
        options.signal.throwIfAborted()
        controller.abort(new Error('fixture cancelled'))
        return { stdout: '' }
      }
      cancel('download', options)
      if (missingArchive) return { stdout: '' }
      if (useBackup && (url === urls[0] || fromProxy)) throw fakeError(7, 'cannot connect')
      await writeFile(args.at(-2), 'archive fixture')
      downloads++
    } else {
      assert.equal(basename(exe), 'tar.exe')
      extracts++
      assert.equal(args.at(-1), `runtime-${revision}/music`)
      assert(args.includes('--strip-components=1'))
      assert.equal(args[args.indexOf('--options') + 1], 'hdrcharset=UTF-8')
      const directory = join(args[args.indexOf('-C') + 1], 'music')
      const track = join(directory, catalog[0].directory)
      await mkdir(track, { recursive: true })
      await writeFile(join(directory, 'music_library.json'), JSON.stringify(catalog))
      if (extractFailure) throw fakeError(1, 'broken archive after partial extraction')
      if (complete) await writeFile(join(track, '曲目.mp3'), 'audio fixture')
    }
    return { stdout: '' }
  })
  const download = await loadRuntime('runtime-download.js', env, execFile)
  const setup = await loadRuntime('runtime-setup.js', env, execFile, {
    './runtime-download.js': download,
    './runtime.js': { ...runtimePaths, RUNTIME_HOME: root, DEFAULT_MUSIC_DIR: musicDir, DEFAULT_MUSIC_INDEX: index },
  })
  const assertNotPublished = async () => {
    assert.equal(setup.configuredRuntime(), null)
    assert.equal(await readFile(state, 'utf8'), previous)
    assert.deepEqual((await readdir(root)).sort(), ['ffmpeg.exe', 'ffprobe.exe', 'python.exe', 'runtime.json'])
  }
  assert.equal(setup.runtimeOptions({}).ffmpegPath, bins.ffmpeg)
  for (const [phase, expected] of [['probe', []], ['download', [[urls[0], true]]], ['direct', [[urls[0], true], [urls[0], false]]]]) {
    cancelAt = phase
    controller = new AbortController()
    await assert.rejects(setup.configureRuntime({}, controller.signal), /fixture cancelled/)
    assert.deepEqual(routes.splice(0), expected)
    await assertNotPublished()
  }
  cancelAt = controller = undefined
  assert.equal(downloads, 0)
  assert.equal(extracts, 0)

  missingArchive = true
  await assert.rejects(setup.configureRuntime(), /下载 默认曲库 失败.*未收到有效文件/)
  missingArchive = false
  assert.deepEqual(routes.splice(0), urls.flatMap(url => [[url, true], [url, false]]))
  assert.equal(extracts, 0)
  await assertNotPublished()

  extractFailure = true
  await assert.rejects(setup.configureRuntime(), /解压默认曲库失败：退出码 1/)
  extractFailure = false
  assert.deepEqual(routes.splice(0), [[urls[0], true]])
  await assertNotPublished()

  await assert.rejects(setup.configureRuntime(), /必须包含唯一支持音频/)
  assert.deepEqual(routes.splice(0), [[urls[0], true]])
  await assertNotPublished()

  complete = useBackup = true
  const result = await setup.configureRuntime()
  assert.equal(result.ready, true)
  assert.deepEqual([...result.downloaded], ['music'])
  assert.equal(result.musicDir, musicDir)
  assert.deepEqual(JSON.parse(await readFile(index, 'utf8')), catalog)
  assert.equal(setup.configuredRuntime().ffmpeg, bins.ffmpeg)
  assert.equal((await setup.configureRuntime()).downloaded.length, 0)
  assert.deepEqual(routes, urls.flatMap(url => [[url, true], [url, false]]))
  assert.equal(downloads, 3)
  assert.equal(extracts, 3)
  assert.equal(await readFile(state, 'utf8'), JSON.stringify(bins, null, 2))
})
