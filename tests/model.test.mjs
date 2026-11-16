import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateText } from '../lib/model.js'

function host(reasoning) {
  const selection = { provider: 'test-provider', model: 'selected-model' }
  const received = []
  async function* stream(request) {
    received.push(request)
    if (reasoning && request.reasoningEffort !== 'brief-json') {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
      return
    }
    yield { type: 'text-delta', text: '{"episode":40,"lineIds":[3,8]}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const llm = {
    stream,
    async prepareCall(config, signal, configure) {
      signal?.throwIfAborted()
      const { provider, model, ...controls } = config
      const configured = configure(controls, reasoning ? { reasoning: { efforts: [{ id: 'brief-json' }, { id: 'long-reasoning' }], defaultEffort: 'long-reasoning' } } : {})
      return { config: { provider, model, ...configured }, stream }
    },
  }
  return { selection, received, ctx: { get: (key) => key === 'llm' ? llm : key === 'agentDefaultModel' ? { currentSelection: () => selection } : null } }
}

test('structured selection completes without spending its output cap on default long reasoning', async () => {
  const fixture = host(true)
  const signal = new AbortController().signal
  const result = await generateText(fixture.ctx, { system: '只返回JSON', user: '选一段', maxTokens: 4000, signal })
  assert.equal(JSON.parse(result.response).episode, 40)
  assert.equal(fixture.received.length, 1, 'one selection must remain one model call')
  assert.equal(fixture.received[0].reasoningEffort, 'brief-json')
  assert.equal(fixture.received[0].maxTokens, 4000)
  assert.equal(fixture.received[0].model, 'selected-model')
  assert.equal(fixture.received[0].signal, signal)
  assert.deepEqual(fixture.selection, { provider: 'test-provider', model: 'selected-model' })
})

test('models without selectable reasoning receive no invented effort', async () => {
  const fixture = host(false)
  const result = await generateText(fixture.ctx, { user: '选一段', maxTokens: 2000 })
  assert.equal(JSON.parse(result.response).episode, 40)
  assert.equal(fixture.received[0].reasoningEffort, undefined)
  assert.equal(fixture.received[0].maxTokens, 2000)
})

test('cancelled selections do not dispatch a model call', async () => {
  const fixture = host(true)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(generateText(fixture.ctx, { user: '选一段', signal: controller.signal }), { name: 'AbortError' })
  assert.equal(fixture.received.length, 0)
})
