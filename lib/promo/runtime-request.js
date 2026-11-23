import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RUNTIME_HOME } from './runtime.js'

const root = join(RUNTIME_HOME, 'runtime-requests')
function file(id, suffix = 'json') {
  assert(typeof id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(id), '请使用工作台发来的环境配置请求 ID')
  return join(root, `${id}.${suffix}`)
}

export async function createRuntimeRequest(config, signal) {
  const id = randomUUID()
  signal?.throwIfAborted()
  await mkdir(root, { recursive: true })
  await writeFile(file(id), JSON.stringify({ ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath, advanced: { pythonPath: config.advanced?.pythonPath } }), { flag: 'wx', signal })
  return id
}

export async function takeRuntimeRequest(id, signal) {
  const path = file(id)
  try {
    const config = JSON.parse(await readFile(path, { encoding: 'utf8', signal }))
    signal?.throwIfAborted()
    // Only one runner can unlink the request. The completion receipt has a separate path.
    await unlink(path)
    return config
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error('环境配置请求不存在或已使用，请在切片工作台点击「重新配置环境」', { cause: error })
  }
}

export function finishRuntimeRequest(id) {
  return writeFile(file(id, 'ready'), '', { flag: 'wx' })
}

export async function consumeRuntimeReceipt(id) {
  try {
    await unlink(file(id, 'ready'))
    return true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return false
  }
}

export async function discardRuntimeRequest(id) {
  try { await unlink(file(id)) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
