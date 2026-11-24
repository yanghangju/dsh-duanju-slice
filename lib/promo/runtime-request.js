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

export async function runRuntimeRequest(id, configure, signal) {
  const path = file(id)
  let request, config
  try {
    request = await readFile(path, { encoding: 'utf8', signal })
    config = JSON.parse(request)
    signal?.throwIfAborted()
    // Claim the request so two runners cannot use it at once.
    await unlink(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error('环境配置请求不可用：可能仍在运行、已完成或在强制中止时失效', { cause: error })
  }
  try {
    const result = await configure(config, signal)
    signal?.throwIfAborted()
    assert(result?.ready === true, '运行环境未通过验证')
    await writeFile(file(id, 'ready'), '', { flag: 'wx' })
    return result
  } catch (error) {
    // Ordinary failures and graceful cancellation let the same chat try again.
    try { await writeFile(path, request, { flag: 'wx' }) }
    catch (restoreError) {
      throw new Error(`${error.message}；无法恢复本次配置请求（${restoreError.code ?? '写入失败'}），请在工作台重新发起配置`, { cause: error })
    }
    throw error
  }
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
