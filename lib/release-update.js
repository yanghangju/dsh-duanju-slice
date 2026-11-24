import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { readZip } from './zip.js'

const NAME = 'dsh-duanju-slice'
const REPO = `yanghangju/${NAME}`
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const MAX_BYTES = 64 * 1024 * 1024
const OFFER_TTL = 15 * 60_000
const tar = promisify(execFile)
const versionParts = (version) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)?.slice(1).map(BigInt)

function isNewer(remote, current) {
  const a = versionParts(remote), b = versionParts(current)
  if (!a || !b) throw new Error('Invalid stable version')
  const index = a.findIndex((value, i) => value !== b[i])
  return index >= 0 && a[index] > b[index]
}

async function latestRelease(fetcher, currentVersion) {
  const response = await fetcher(LATEST, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': NAME },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`)
  const release = await response.json()
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') throw new Error('Unexpected GitHub release')
  const tag = release.tag_name, version = tag.replace(/^v/, '')
  if (!isNewer(version, currentVersion)) return { status: 'current', currentVersion }
  return { status: 'available', currentVersion, version, tag, notes: typeof release.body === 'string' ? release.body : '' }
}

async function download(fetcher, { tag, version }, cacheDir) {
  const url = `https://codeload.github.com/${REPO}/zip/refs/tags/${tag}`
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' })
  if (!response.ok || !response.body) throw new Error(`GitHub ZIP: HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_BYTES) throw new Error('Release ZIP too large')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks, size)
  const files = readZip(bytes, { maxBytes: MAX_BYTES, maxEntries: 4096 })
  const prefix = files.has('package.json') ? '' : `${files.keys().next().value?.split('/')[0]}/`
  const manifest = JSON.parse(files.get(prefix + 'package.json')?.toString('utf8') ?? 'null')
  if (manifest?.name !== NAME || manifest.dsh?.bundle?.patch !== './cordis.patch.yml' ||
      !['index.js', 'client.js', 'cordis.patch.yml'].every(file => files.has(prefix + file))) {
    throw new Error('Release ZIP is not the expected DSH bundle')
  }
  // The release tag determines the installed version, even if the source manifest was not bumped.
  files.set(prefix + 'package.json', JSON.stringify({ ...manifest, version }, null, 2) + '\n')

  // pnpm installs a tarball (not a ZIP) and retains its file: path for later use.
  const dir = join(cacheDir, createHash('sha256').update(bytes).digest('hex'))
  await mkdir(dir, { recursive: true })
  const stage = await mkdtemp(join(dir, 'stage-'))
  try {
    for (const [name, data] of files) {
      if (prefix && name === prefix && !data.length) continue
      const parts = name.slice(prefix.length).replace(/\/$/, '').split('/')
      if (!name.startsWith(prefix) || parts.some(part => !part || /[<>:"\\|?*\x00-\x1f]|[ .]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\s*\.|$)/i.test(part))) throw new Error('Unsafe path in release ZIP')
      if (name.endsWith('/')) continue
      const file = join(stage, 'package', ...parts)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, data, { flag: 'wx' })
    }
    const scratch = join(stage, 'bundle.tgz')
    await tar('tar', ['-czf', scratch, '-C', stage, 'package'], { timeout: 15_000, windowsHide: true })
    const archive = join(dir, `${NAME}-${version}.tgz`)
    await rename(scratch, archive)
    return archive
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}

const usable = (result) => result?.application === 'applied' || result?.application === 'restart-required'

export function createReleaseUpdate({ currentVersion, manager, live, editing = () => false, log = console, fetcher = globalThis.fetch,
  cacheDir = join(homedir(), '.dsh', 'plugins', NAME, 'updates') }) {
  const offers = new Map()
  let updating = false
  const installedBundle = async () => (await manager.listBundles()).find(bundle => bundle.name === NAME)
  const settled = async (operation) => {
    try { return await operation() } catch (error) { return { application: 'failed', error } }
  }

  async function update(release) {
    if (editing()) return { status: 'error', code: 'editing' }
    const bundle = await installedBundle()
    if (!bundle?.installed || !bundle.removable || !bundle.source || !bundle.version) return { status: 'error', code: 'managed' }
    if (bundle.version !== currentVersion) return { status: 'error', code: 'changed' }
    let archive
    try { archive = await download(fetcher, release, cacheDir) }
    catch (error) { log.warn('Slice plugin release download failed', error); return { status: 'error', code: 'download' } }
    const fresh = await installedBundle()
    if (!fresh?.installed || !fresh.removable || fresh.version !== bundle.version || fresh.source !== bundle.source || fresh.enabled !== bundle.enabled) {
      return { status: 'error', code: 'changed' }
    }
    if (editing()) return { status: 'error', code: 'editing' }
    const install = (spec, version) => settled(() => manager.installBundle(spec, { expected: { name: NAME, version }, enabled: bundle.enabled, saveExact: true }))
    // A started bundle cannot be unloaded without HMR. DSH supports replacing it in place for the next restart.
    if (!live()) {
      const result = await install(archive, release.version)
      if (usable(result)) return { status: 'restart-required', version: release.version }
      log.warn('Slice plugin release install failed', result)
      return { status: 'error', code: 'install' }
    }
    // DSH unloads the plugin, removes its package/link, then extracts and installs the verified archive.
    const removed = await settled(() => manager.removeBundle(NAME))
    if (removed.application !== 'applied') {
      log.warn('Slice plugin release removal failed', removed)
      const remaining = await installedBundle()
      if (!remaining?.installed) return restore()
      if (bundle.enabled && !remaining.enabled) {
        const recovered = await settled(() => manager.setBundleEnabled(NAME, true))
        if (!usable(recovered)) return { status: 'error', code: 'restoreFailed' }
      }
      return { status: 'error', code: 'remove' }
    }
    const result = await install(archive, release.version)
    if (usable(result)) return { status: result.application, version: release.version }
    log.warn('Slice plugin release install failed', result)
    return restore()

    async function restore() {
      const remaining = await installedBundle()
      if (remaining?.installed) {
        if (remaining.version === bundle.version && remaining.source === bundle.source) {
          const result = await settled(() => manager.setBundleEnabled(NAME, bundle.enabled))
          return { status: 'error', code: usable(result) ? 'restored' : 'restoreFailed' }
        }
        if (remaining.version !== release.version) return { status: 'error', code: 'restoreFailed' }
        const cleanup = await settled(() => manager.removeBundle(NAME))
        if (cleanup.application !== 'applied') return { status: 'error', code: 'restoreFailed' }
      }
      const previous = bundle.source.startsWith(`${NAME}@`) ? `${NAME}@${bundle.version}` : bundle.source
      const result = await install(previous, bundle.version)
      if (!usable(result)) log.warn('Slice plugin release rollback failed', result)
      return { status: 'error', code: usable(result) ? 'restored' : 'restoreFailed' }
    }
  }

  return {
    path: '/api/duanju-slice/release-update', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      const send = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
      if (updating) return send({ status: 'error', code: 'busy' }, 409)
      try {
        if (request.method === 'GET') {
          const release = await latestRelease(fetcher, currentVersion)
          if (release.status !== 'available') return send(release)
          const now = Date.now()
          for (const [token, offer] of offers) if (offer.expires < now) offers.delete(token)
          if (offers.size >= 32) offers.delete(offers.keys().next().value)
          const token = randomUUID()
          offers.set(token, { release, expires: now + OFFER_TTL })
          return send({ status: 'available', currentVersion, version: release.version, notes: release.notes, token })
        }
        if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') return send({ status: 'error', code: 'changed' }, 400)
        const input = await request.json().catch(() => null)
        const offer = offers.get(input?.token)
        if (!offer || offer.expires < Date.now()) return send({ status: 'error', code: 'changed' }, 409)
        if (updating) return send({ status: 'error', code: 'busy' }, 409)
        offers.delete(input.token)
        updating = true
        try { return send(await update(offer.release)) }
        finally { updating = false }
      } catch (error) {
        log.warn('Slice plugin release operation failed', error)
        return send({ status: 'error', code: request.method === 'GET' ? 'check' : 'install' }, 500)
      }
    },
  }
}
