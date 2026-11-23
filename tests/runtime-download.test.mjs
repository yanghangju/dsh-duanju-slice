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

async function checkDownload(env, systemProxy, expectedProxy, bypass) {
  const commands = []
  const secret = 'http://name:password@proxy.example:8080'
  const execFile = fakeExec(async (exe, args, options) => {
    const name = basename(exe)
    commands.push(name)
    if (name === 'powershell.exe') {
      assert.match(options.env.DUANJU_DOWNLOAD_URL, /^https:\/\/api\.nuget\.org\//)
      return { stdout: `${systemProxy}\r\n` }
    }
    assert.equal(name, 'curl.exe')
    assert.match(args.at(-1), /^https:\/\/api\.nuget\.org\/v3-flatcontainer\/python\//)
    assert.equal(options.env.HTTPS_PROXY, expectedProxy)
    assert.equal(options.env.NO_PROXY, bypass)
    assert.equal(options.env.PIP_INDEX_URL, undefined)
    const error = new Error('curl failed')
    error.stderr = `Invalid proxy: ${secret}`
    throw error
  })
  const runtime = await loadRuntime('runtime-download.js', env, execFile)
  await assert.rejects(runtime.installMissingRuntime('unused-stage', ['python']), error => {
    assert.match(error.message, /下载 python\..*失败/)
    assert.doesNotMatch(error.message, /password/)
    return true
  })
  return commands
}

test('Python 安装从官方 NuGet 开始，环境代理优先且保留绕过规则', async () => {
  const proxy = 'http://name:password@proxy.example:8080'
  const commands = await checkDownload({ https_proxy: proxy, HTTP_PROXY: 'http://unused.example', no_proxy: 'localhost', PIP_INDEX_URL: 'https://unused.example' }, '', proxy, 'localhost')
  assert.deepEqual(commands, ['curl.exe'])
})

test('没有环境代理时按目的地址查询 Windows 代理，否则直连', async () => {
  const proxy = 'http://proxy.example:8080/'
  assert.deepEqual(await checkDownload({}, proxy, proxy, undefined), ['powershell.exe', 'curl.exe'])
  assert.deepEqual(await checkDownload({}, '', undefined, '*'), ['powershell.exe', 'curl.exe'])
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
  let complete = false
  let downloads = 0
  const execFile = fakeExec(async (exe, args, options) => {
    if (exe === bins.python) return { stdout: 'slice-python-ok' }
    if (exe === bins.ffmpeg) return { stdout: 'libx264 aac' }
    if (exe === bins.ffprobe) return { stdout: 'ffprobe version' }
    const revision = runtimePaths.MUSIC_REVISION
    if (basename(exe) === 'curl.exe') {
      assert.equal(args.at(-1), `https://codeload.github.com/yanghangju/runtime/tar.gz/${revision}`)
      assert.equal(options.env.HTTPS_PROXY, proxy)
      await writeFile(args.at(-2), 'archive fixture')
      downloads++
    } else {
      assert.equal(basename(exe), 'tar.exe')
      assert.equal(args.at(-1), `runtime-${revision}/music`)
      assert(args.includes('--strip-components=1'))
      assert.equal(args[args.indexOf('--options') + 1], 'hdrcharset=UTF-8')
      const directory = join(args[args.indexOf('-C') + 1], 'music')
      const track = join(directory, catalog[0].directory)
      await mkdir(track, { recursive: true })
      await writeFile(join(directory, 'music_library.json'), JSON.stringify(catalog))
      if (complete) await writeFile(join(track, '曲目.mp3'), 'audio fixture')
    }
    return { stdout: '' }
  })
  const download = await loadRuntime('runtime-download.js', env, execFile)
  const setup = await loadRuntime('runtime-setup.js', env, execFile, {
    './runtime-download.js': download,
    './runtime.js': { ...runtimePaths, RUNTIME_HOME: root, DEFAULT_MUSIC_DIR: musicDir, DEFAULT_MUSIC_INDEX: index },
  })
  assert.equal(setup.configuredRuntime(), null)
  assert.equal(setup.runtimeOptions({}).ffmpegPath, bins.ffmpeg)
  await assert.rejects(setup.configureRuntime(), /必须包含唯一支持音频/)
  assert.equal(setup.configuredRuntime(), null)
  assert.equal(await readFile(state, 'utf8'), previous)
  assert.deepEqual((await readdir(root)).sort(), ['ffmpeg.exe', 'ffprobe.exe', 'python.exe', 'runtime.json'])

  complete = true
  const result = await setup.configureRuntime()
  assert.equal(result.ready, true)
  assert.deepEqual([...result.downloaded], ['music'])
  assert.equal(result.musicDir, musicDir)
  assert.deepEqual(JSON.parse(await readFile(index, 'utf8')), catalog)
  assert.equal(setup.configuredRuntime().ffmpeg, bins.ffmpeg)
  assert.equal((await setup.configureRuntime()).downloaded.length, 0)
  assert.equal(downloads, 2)
})
