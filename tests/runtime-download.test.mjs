import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import vm from 'node:vm'

const code = await readFile(new URL('../lib/promo/runtime-download.js', import.meta.url), 'utf8')

async function checkDownload(env, systemProxy, expectedProxy, bypass) {
  const commands = []
  const secret = 'http://name:password@proxy.example:8080'
  const execFile = Object.assign(() => {}, { [promisify.custom]: async (exe, args, options) => {
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
  } })
  const context = vm.createContext({ process: { env }, URL })
  const source = new vm.SourceTextModule(code, { context })
  await source.link(async (name) => {
    const exports = name === 'node:child_process' ? { execFile } : await import(name)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await source.evaluate()
  await assert.rejects(source.namespace.installMissingRuntime('unused-stage', ['python']), error => {
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
