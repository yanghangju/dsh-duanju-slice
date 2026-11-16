import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

test('progress and output survive reopening without losing concurrent settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-studio-'))
  try {
    const launches = []
    let launchError = null
    const context = vm.createContext({ console, Buffer, process, Date, setTimeout, clearTimeout })
    const source = new vm.SourceTextModule(await readFile(new URL('../lib/studio.js', import.meta.url), 'utf8'), { context })
    await source.link(async (name) => {
      const actual = await import(name)
      const values = { ...actual, ...(name === 'node:os' ? { homedir: () => root } : {}), ...(name === 'node:child_process' ? { execFile: (file, args, options, callback) => { launches.push({ file, args, options }); callback(launchError, '', '') } } : {}) }
      return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
    })
    await source.evaluate()
    const api = source.namespace
    assert.equal(typeof api.recordProgress, 'function', 'the real cut needs a durable progress reporter')
    let created = 0
    const ctx = { get: (key) => key === 'sessionController' ? {
      create: async () => ({ sessionId: `s${++created}` }), rename: async () => {},
    } : null }
    const messages = []
    const exec = { agent: { id: 's1', followup: (message) => messages.push(message) } }
    const initial = await api.perform(ctx, { action: 'create' }, exec)
    assert.equal(initial.session.configLocked, false)
    await api.perform(ctx, { action: 'save', settings: { scriptPath: '/剧本.docx', projectDir: '/工程', exportDir: '/成片', direction: '复仇' } }, exec)
    const locked = await api.perform(ctx, { action: 'lock' }, exec)
    assert.equal(locked.session.configLocked, true)
    for (const settings of [{ direction: '亲情' }, { scriptPath: '/新剧本.docx' }, { projectDir: '/新工程' }, { exportDir: '/新成片' }]) {
      await assert.rejects(api.perform(ctx, { action: 'save', settings }, exec), /配置已锁定/)
      await assert.rejects(api.prepareCutSettings('s1', { ...locked.settings, ...settings }), /配置已锁定/)
    }
    await api.perform(ctx, { action: 'save', settings: locked.settings }, exec)
    assert.equal((await api.perform(ctx, { action: 'open' }, exec)).settings.direction, '复仇')
    const launched = await api.perform(ctx, { action: 'open-jianying' }, exec)
    assert.equal(launched.opened, true)
    assert.equal(launches[0].file, '/usr/bin/open')
    assert.equal(JSON.stringify(launches[0].args), JSON.stringify(['-b', 'com.lemon.lvpro']))
    assert.equal(launches[0].options.timeout, 10000)
    launchError = new Error('application missing')
    await assert.rejects(api.perform(ctx, { action: 'open-jianying' }, exec), /打开剪映失败/)
    launchError = null
    await api.perform(ctx, { action: 'generate' }, exec)
    assert.equal((await api.perform(ctx, { action: 'list' }, exec)).sessions[0].task.stage, 'queued')
    await Promise.all([
      api.recordProgress(ctx, 's1', 'render'),
      api.perform(ctx, { action: 'rename', sessionId: 's1', title: '我的切片' }, exec),
    ])
    let reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.task.stage, 'render')
    assert.equal(reopened.session.title, '我的切片')
    assert.equal(reopened.settings.direction, '复仇')
    await api.recordResult(ctx, 's1', { episode: 40, start: 12.8, end: 55.5, outFile: '/成片/out.mp4', draftDir: '/草稿/out', draftName: 'out' })
    reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.task.stage, 'done')
    assert.equal(reopened.session.lastResult.outFile, '/成片/out.mp4')
    const first = reopened.session.lastResult
    assert.equal(reopened.session.results.length, 1)
    await api.perform(ctx, { action: 'generate', text: '保留前25秒' }, exec)
    assert.equal(created, 1, 'continuing editing must keep the same conversation')
    assert.match(messages.at(-1).content[0].text, /保留前25秒/)
    await api.recordProgress(ctx, 's1', 'survey')
    await api.recordResult(ctx, 's1', { episode: 40, start: 12.8, end: 37.8, outFile: '/成片/out-v2.mp4', draftDir: '/草稿/v2', draftName: 'v2', audioLevels: { music: 0.5 } })
    reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.results.length, 2)
    assert.equal(reopened.session.lastResult.version, 2)
    assert.equal(reopened.session.results[0].outFile, first.outFile)
    const selected = await api.perform(ctx, { action: 'select-result', version: 1 }, exec)
    assert.equal(selected.session.lastResult.outFile, first.outFile)
    assert.equal(selected.session.results.length, 2)
    assert.match(await api.editingContext('s1'), /持续剪辑会话/)
    assert.equal(await api.editingContext('another-session'), '')
    let hook
    api.installEditingContext({ on: (event, listener) => { assert.equal(event, 'agent/pre-step'); hook = listener; return () => {} } })
    const decision = { kind: 'enter', messages: [{ id: 'user', role: 'user', content: [{ type: 'text', text: '先聊一聊' }] }] }
    const augmented = await hook({ agent: exec.agent, step: 1 }, async () => decision)
    assert.equal(augmented.messages.length, 2)
    assert.match(augmented.messages[1].content[0].text, /没有明确制作或修改要求时只回答/)
    assert.ok(Object.isFrozen(augmented.messages[1]))
    assert.equal((await hook({ agent: exec.agent, step: 2 }, async () => decision)).messages.length, 1)
    assert.equal((await hook({ agent: { id: 'unrelated' }, step: 1 }, async () => decision)).messages.length, 1)
    await api.recordProgress(ctx, 's1', 'error', '渲染失败')
    reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.task.error, '渲染失败')
    assert.equal(reopened.session.lastResult.outFile, '/成片/out.mp4', 'a failed retry preserves the earlier video')
    const fresh = await api.perform(ctx, { action: 'create' }, exec)
    assert.equal(fresh.settings.scriptPath, '/剧本.docx')
    assert.equal(fresh.settings.direction, '')
    assert.equal(fresh.session.lastResult, null)
    assert.equal(fresh.session.configLocked, false, 'new conversations must not inherit the lock')
    const freshExec = { agent: { id: fresh.sessionId } }
    assert.equal((await api.perform(ctx, { action: 'save', settings: { direction: '亲情' } }, freshExec)).settings.direction, '亲情')
    const file = join(root, '.dsh/plugins/dsh-duanju-slice/sessions.json')
    const legacy = JSON.parse(await readFile(file, 'utf8'))
    delete legacy.sessions.s1.results
    delete legacy.sessions.s1.configLocked
    await writeFile(file, JSON.stringify(legacy))
    const migrated = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(migrated.session.results.length, 1)
    assert.equal(migrated.session.lastResult.outFile, first.outFile)
    assert.equal(migrated.session.lastResult.version, 1)
    assert.equal(migrated.session.configLocked, true, 'older generated conversations migrate to read-only configuration')
  } finally { await rm(root, { recursive: true, force: true }) }
})
