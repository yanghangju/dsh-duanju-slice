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
      recordResult() {}, perform() {}, editingSession() {}, rememberAdvanced() {}, sendWorkbenchPrompt() {}, installEditingContext: () => () => {},
    }
    else {
      values = { ...await import(name.startsWith('.') ? new URL(name, url).href : name) }
      if (name === './lib/promo/advanced.js') values.prepareAdvanced = async () => { events.push('prepare'); throw new Error('media preparation must not run') }
    }
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await source.evaluate()
  const registered = new Map()
  source.namespace.apply({ effect: callback => callback(), on: () => () => {}, get: () => null, tools: { register: spec => { registered.set(spec.name, spec); return () => {} } } })
  await assert.rejects(registered.get('duanju_slice_cut').execute({ dramaDir: '/新短剧', scriptPath: '/剧本.docx', exportDir: '/成片', direction: '换方向' }, { agent: { id: 's1' } }), /配置已锁定/)
  assert.deepEqual(events, ['check', 'error'])
})
