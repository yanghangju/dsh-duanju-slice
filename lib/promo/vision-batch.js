// Batched visual review over Host model requests: frames travel as image attachments, nothing spawns an agent.
import assert from 'node:assert/strict'
import { generateText } from './model.js'

/** Evidence kind recorded for dialogue windows reviewed by batched Host model requests. */
export const BATCH_REVIEWER = 'llm-batch'

/**
 * Build the reviewer locateEpisode calls once per batch of windows.
 * A batch is one ordinary image request to the caller-selected model, so no child agent, tool gate or depth exists.
 */
export function visionReviewer(ctx) {
  const llm = ctx.get('llm')
  assert(llm?.stream, '批量画面验收需要可用的 llm 服务；不会回退为逐窗手动定位')
  return async ({ provider, model, system, content, signal, maxTokens = 8000 }) => {
    const { response } = await generateText(ctx, { provider, model, system, content, signal, maxTokens })
    return { response, provider, model }
  }
}

/** Bound parallel episodes; drain cancelled siblings before the caller can publish state. */
export async function parallelEpisodes(items, concurrency = 6, signal, operation) {
  assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8, '定位并发数必须为1–8，默认6')
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const results = new Array(items.length)
  let cursor = 0
  let failure
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!combined.aborted && cursor < items.length) {
      const i = cursor++
      try { results[i] = await operation(items[i], combined) }
      catch (error) { failure ??= error; controller.abort(error) }
    }
  }))
  if (failure) throw failure
  signal?.throwIfAborted()
  return results
}
