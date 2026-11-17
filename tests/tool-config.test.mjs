import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

test('the cut tool rejects configuration changes before selection or media writes', async () => {
  const url = new URL('../index.js', import.meta.url)
  const events = []
  const context = vm.createContext({ console, Buffer, process, URL })
  const source = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, initializeImportMeta: meta => { meta.url = url.href } })
  await source.link(async name => {
    let values
    if (name === './lib/studio.js') values = {
      normalize: value => value,
      prepareCutSettings: async () => { events.push('check'); throw new Error('配置已锁定') },
      recordProgress: async (_ctx, _id, stage) => { events.push(stage) },
      recordResult() {}, perform() {}, editingSession() {}, installEditingContext: () => () => {},
    }
    else if (name === './lib/plan.js') values = { formatPlan() {}, planSlice: async () => { events.push('plan'); throw new Error('selection must not run') } }
    else {
      values = { ...await import(name.startsWith('.') ? new URL(name, url).href : name) }
      if (name === 'node:fs/promises') values.mkdir = async () => { events.push('write') }
    }
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await source.evaluate()
  const registered = new Map()
  source.namespace.apply({ effect: callback => callback(), on: () => () => {}, get: () => null, tools: { register: spec => { registered.set(spec.name, spec); return () => {} } } })
  await assert.rejects(registered.get('duanju_slice_cut').execute({ dramaDir: '/新短剧', scriptPath: '/剧本.docx', exportDir: '/成片', direction: '换方向' }, { agent: { id: 's1' } }), /配置已锁定/)
  assert.deepEqual(events, ['check', 'error'])
})
