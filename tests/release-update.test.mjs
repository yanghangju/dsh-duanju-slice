import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createReleaseUpdate } from '../lib/release-update.js'
import { writeZip } from '../lib/zip.js'

const name = 'dsh-duanju-slice'
const currentVersion = '0.3.9'
const next = '0.3.10'
const latest = `https://api.github.com/repos/yanghangju/${name}/releases/latest`
const zipURL = `https://codeload.github.com/yanghangju/${name}/zip/refs/tags/v${next}`
const filename = `${name}-${next}.tgz`
const notes = '## 更新内容\n- 修复问题\n<img src=x onerror=alert(1)>'
const previous = { name, installed: true, removable: true, version: currentVersion, source: `link:${join(tmpdir(), name)}`, enabled: true }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const release = (version) => ({ draft: false, prerelease: false, tag_name: `v${version}`, body: notes, assets: [] })
const status = async (response) => (await response).json()
const get = (route) => route.fetch(new Request(`http://localhost${route.path}`))
const post = (route, token) => route.fetch(new Request(`http://localhost${route.path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }))

async function fixture(t, { packageName = name, live = true, editing, invalidBytes = false, unsafePath = false, installFailure, removalFailure } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'duanju-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prefix = `${name}-${next}/`
  const manifest = { name: packageName, version: currentVersion, dsh: { bundle: { patch: './cordis.patch.yml' } } }
  const bytes = writeZip([
    { name: prefix, data: '' },
    { name: prefix + 'package.json', data: JSON.stringify(manifest) },
    ...['index.js', 'client.js', 'cordis.patch.yml', 'assets/ending/片尾.mp3'].map(file => ({ name: prefix + file, data: 'fixture' })),
    ...(unsafePath ? [{ name: prefix + '../escape.js', data: '' }] : []),
  ])
  const events = []
  let installed = previous
  const manager = {
    listBundles: async () => installed ? [installed] : [],
    removeBundle: async (target) => {
      assert.equal(target, name)
      events.push('remove')
      if (removalFailure) {
        installed = { ...installed, enabled: false }
        return { application: 'failed' }
      }
      installed = undefined
      return { application: 'applied' }
    },
    setBundleEnabled: async (target, enabled) => {
      assert.equal(target, name)
      installed = { ...installed, enabled }
      events.push('re-enable')
      return { application: 'applied' }
    },
    installBundle: async (spec, options) => {
      assert.deepEqual(options, { enabled: true, saveExact: true, expected: { name, version: options.expected.version } })
      if (options.expected.version === currentVersion) {
        assert.equal(spec, previous.source)
        installed = previous
        events.push('restore')
        return { application: 'applied' }
      }
      assert.equal(options.expected.version, next)
      assert.equal(spec, join(root, 'updates', digest(bytes), filename))
      const extract = (file) => execFileSync('tar', ['-xOzf', spec, `package/${file}`], { encoding: 'utf8' })
      assert.deepEqual(JSON.parse(extract('package.json')), { ...manifest, version: next })
      assert.equal(extract('client.js'), 'fixture')
      assert.equal(installed?.version, live ? undefined : currentVersion)
      events.push('install')
      if (installFailure === 'install') return { application: 'failed', stage: 'install' }
      installed = { ...previous, version: next, source: `file:${spec}` }
      if (installFailure === 'enable') return { application: 'failed', stage: 'enable' }
      return { application: live ? 'applied' : 'restart-required' }
    },
  }
  const route = createReleaseUpdate({ manager, live: () => live, editing, currentVersion, log: { warn() {} }, cacheDir: join(root, 'updates'),
    async fetcher(url) {
      if (url === latest) return Response.json(release(next))
      assert.equal(url, zipURL)
      events.push('download')
      return new Response(invalidBytes ? Buffer.alloc(bytes.length) : bytes)
    },
  })
  return { route, events, installed: () => installed }
}

test('按数值版本比较；没有上传安装包也能用 GitHub 源码 ZIP 更新', async () => {
  const { token, ...details } = await status(get(createReleaseUpdate({ currentVersion, fetcher: async (url) => {
    assert.equal(url, latest)
    return Response.json(release(next))
  } })))
  assert.deepEqual(details, { status: 'available', currentVersion, version: next, notes })
  assert.match(token, /^[a-f0-9-]{36}$/)
  for (const version of ['0.3.8', currentVersion]) {
    const route = createReleaseUpdate({ currentVersion, fetcher: async () => Response.json(release(version)) })
    const response = await get(route)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await status(response), { status: 'current', currentVersion })
  }
})

test('确认前不下载；确认后用标签版本重打包，卸载并安装', async (t) => {
  const { route, events, installed } = await fixture(t)
  const offer = await status(get(route))
  assert.equal(offer.version, next)
  assert.equal(offer.notes, notes)
  assert.match(offer.token, /^[a-f0-9-]{36}$/)
  assert.equal(offer.url, undefined)
  assert.deepEqual(await status(post(route, 'forged')), { status: 'error', code: 'changed' })
  assert.deepEqual(events, [])
  assert.deepEqual(await status(post(route, offer.token)), { status: 'applied', version: next })
  assert.deepEqual(events, ['download', 'remove', 'install'])
  assert.deepEqual(await status(post(route, offer.token)), { status: 'error', code: 'changed' })
  assert.equal(installed().version, next)
})

test('ZIP 损坏、插件不对或包含非法路径时，不改动旧安装', async (t) => {
  for (const invalid of [{ invalidBytes: true }, { packageName: 'another-plugin' }, { unsafePath: true }]) {
    const { route, events, installed } = await fixture(t, invalid)
    const offer = await status(get(route))
    assert.deepEqual(await status(post(route, offer.token)), { status: 'error', code: 'download' })
    assert.deepEqual(events, ['download'])
    assert.equal(installed(), previous)
  }
})

test('正在剪辑时拒绝替换；无 HMR 时通过 DSH 原位安装并提示重启', async (t) => {
  const editing = await fixture(t, { editing: () => true })
  const blocked = await status(get(editing.route))
  assert.deepEqual(await status(post(editing.route, blocked.token)), { status: 'error', code: 'editing' })
  assert.deepEqual(editing.events, [])
  const { route, events } = await fixture(t, { live: false })
  const offer = await status(get(route))
  assert.deepEqual(await status(post(route, offer.token)), { status: 'restart-required', version: next })
  assert.deepEqual(events, ['download', 'install'])
})

test('新版安装或启用失败后，从原来源恢复旧版', async (t) => {
  for (const installFailure of ['install', 'enable']) {
    const { route, events, installed } = await fixture(t, { installFailure })
    const offer = await status(get(route))
    assert.deepEqual(await status(post(route, offer.token)), { status: 'error', code: 'restored' })
    assert.deepEqual(events, ['download', 'remove', 'install', ...(installFailure === 'enable' ? ['remove'] : []), 'restore'])
    assert.equal(installed(), previous)
  }
})

test('卸载失败但旧包仍在时，恢复其启用状态，不装新版', async (t) => {
  const { route, events, installed } = await fixture(t, { removalFailure: true })
  const offer = await status(get(route))
  assert.deepEqual(await status(post(route, offer.token)), { status: 'error', code: 'remove' })
  assert.deepEqual(events, ['download', 'remove', 're-enable'])
  assert.deepEqual(installed(), previous)
})
