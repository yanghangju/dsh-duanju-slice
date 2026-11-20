import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

test('progress and output survive reopening without losing concurrent settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-studio-'))
  try {
    const launches = []
    let launchError = null
    const context = vm.createContext({ console, Buffer, process, Date, setTimeout, clearTimeout })
    const studioUrl = new URL('../lib/studio.js', import.meta.url)
    const source = new vm.SourceTextModule(await readFile(studioUrl, 'utf8'), { context })
    await source.link(async (name) => {
      const actual = await import(name.startsWith('.') ? new URL(name, studioUrl).href : name)
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
    const requiredSettings = { scriptPath: resolve('/剧本.docx'), dramaDir: resolve('/短剧'), exportDir: resolve('/成片'), direction: '复仇' }
    const subtitleDir = join(root, 'The Deadly Wedding Ring', '字幕')
    assert.equal((await api.perform(ctx, { action: 'save', settings: requiredSettings }, exec)).settings.subtitleDir, '')
    assert.match(await api.editingContext('s1'), /先用语音识别定位台词；再在命中时间附近抽帧核验动作/)
    await assert.rejects(api.perform(ctx, { action: 'save', settings: { subtitleDir: '字幕' } }, exec), /subtitleDir 必须是绝对路径/)
    await api.perform(ctx, { action: 'save', settings: { subtitleDir: ` ${subtitleDir} ` } }, exec)
    assert.equal((await api.perform(ctx, { action: 'list' }, exec)).sessions[0].subtitleDir, subtitleDir)
    assert.equal((await api.perform(ctx, { action: 'save', settings: { dramaDir: requiredSettings.dramaDir } }, exec)).settings.subtitleDir, subtitleDir)
    assert.equal((await api.prepareCutSettings('s1', { ...requiredSettings, dramaDir: join(root, '另一部短剧') }, false)).settings.subtitleDir, '')
    assert.equal((await api.prepareCutSettings('s1', { ...requiredSettings, subtitleDir }, false)).settings.subtitleDir, subtitleDir)
    const cleared = await api.perform(ctx, { action: 'save', settings: { subtitleDir: '' } }, exec)
    assert.equal(cleared.settings.subtitleDir, '')
    assert.equal((await api.perform(ctx, { action: 'open' }, exec)).settings.subtitleDir, '')
    await api.perform(ctx, { action: 'save', settings: { subtitleDir } }, exec)
    const locked = await api.perform(ctx, { action: 'lock' }, exec)
    assert.equal(locked.session.configLocked, true, 'An unavailable subtitle folder does not block automatic ASR fallback')
    assert.equal(locked.settings.subtitleDir, subtitleDir)
    assert.equal((await api.prepareCutSettings('s1', requiredSettings)).settings.subtitleDir, subtitleDir, 'Tool mode preserves the same subtitle preference')
    for (const settings of [{ direction: '亲情' }, { scriptPath: resolve('/新剧本.docx') }, { dramaDir: resolve('/新短剧') }, { exportDir: resolve('/新成片') }, { subtitleDir: join(root, '其他字幕') }, { subtitleDir: '' }]) {
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
    assert.equal(messages.length, 0, 'locking settings does not start an edit')
    const generation = await api.perform(ctx, { action: 'generate', text: '请按这些设置调用 duanju_slice_cut，生成当前会话的一个新版本。' }, exec)
    assert.equal(generation.accepted, true)
    assert.equal((await api.perform(ctx, { action: 'list' }, exec)).sessions[0].task.stage, 'queued')
    const generated = messages.at(-1)
    assert.equal(generated.source.kind, 'plugin:duanju-slice')
    const prompt = generated.content[0].text
    assert.match(prompt, /请立即用以下设置调用 duanju_slice_cut 启动或继续剪辑/)
    assert.equal(JSON.parse(prompt.split('\n')[1]).subtitleDir, subtitleDir)
    assert.match(prompt, /同一轮直接 locate（字幕优先，缺失、无效或未匹配到完整台词时自动用语音识别，不询问用户；再在命中时间附近抽帧核验动作）/)
    assert.match(prompt, /交付 plan\.json、MP4 和剪映草稿，不生成 Word，不等待方案审批。宿主要求的确认或回复照常处理。/)
    assert.doesNotMatch(prompt, /本次附加制作要求/)
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
    const workDir = join(root, 'advanced-v2')
    await api.rememberAdvanced('s1', { workDir, status: 'editing' })
    reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.task.stage, 'survey', 'an active edit retains progress without a preliminary Word file')
    assert.equal(reopened.session.lastResult.outFile, first.outFile)
    assert.equal((await api.editingSession('s1')).advanced.docxFile, undefined)
    const planFile = join(workDir, 'plan.json')
    const oldDocxFile = join(workDir, '剪辑记录.docx')
    const advancedResult = { episode: 40, start: 12.8, end: 37.8, outFile: '/成片/out-v2.mp4', draftDir: '/草稿/v2', draftName: 'v2', audioLevels: { music: 10 ** (-5 / 20) }, workDir, planFile, docxFile: oldDocxFile }
    await api.recordResult(ctx, 's1', advancedResult)
    const completed = (await api.editingSession('s1')).advanced
    assert.equal(completed.status, 'complete')
    assert.equal(completed.planFile, planFile)
    assert.equal(completed.docxFile, undefined)
    reopened = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(reopened.session.results.length, 2)
    assert.equal(reopened.session.lastResult.version, 2)
    assert.equal(reopened.session.lastResult.planFile, planFile)
    assert.equal(reopened.session.lastResult.docxFile, undefined)
    assert.equal(reopened.session.lastResult.settings.subtitleDir, subtitleDir, 'revisions retain the version source mode')
    assert.equal(reopened.session.results[0].outFile, first.outFile)
    const selected = await api.perform(ctx, { action: 'select-result', version: 1 }, exec)
    assert.equal(selected.session.lastResult.outFile, first.outFile)
    assert.equal(selected.session.results.length, 2)
    assert.equal((await api.recordResult(ctx, 's1', advancedResult)).version, 2)
    assert.equal((await api.editingSession('s1')).lastResult.version, 1, 'retry neither duplicates a result nor resets version selection')
    const editingContext = await api.editingContext('s1')
    assert.match(editingContext, /持续剪辑会话/)
    assert.match(editingContext, /BGM 固定 −5 dB/)
    assert.match(editingContext, /用 duanju_slice_revise 直接开始剪新版本/)
    assert.match(editingContext, /仅请求出方案时用 duanju_slice_plan，只交 plan\.json，不定位或剪辑/)
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
    assert.equal(fresh.settings.scriptPath, resolve('/剧本.docx'), '新会话继承素材路径')
    assert.equal(fresh.settings.subtitleDir, subtitleDir)
    assert.equal(fresh.settings.direction, '')
    assert.equal(fresh.session.lastResult, null)
    assert.equal(fresh.session.configLocked, false, 'new conversations must not inherit the lock')
    const freshExec = { agent: { id: fresh.sessionId } }
    assert.equal((await api.perform(ctx, { action: 'save', settings: { direction: '亲情' } }, freshExec)).settings.direction, '亲情')
    const planOnlyDir = join(root, 'plan-only')
    await api.rememberAdvanced(fresh.sessionId, { workDir: planOnlyDir, status: 'plan_only', planFile: join(planOnlyDir, 'plan.json') })
    const planOnly = await api.editingSession(fresh.sessionId)
    assert.equal(planOnly.advanced.planFile, join(planOnlyDir, 'plan.json'))
    assert.equal(planOnly.task, null)
    assert.equal(planOnly.results.length, 0)

    const file = join(root, '.dsh/plugins/dsh-duanju-slice/sessions.json')
    const legacy = JSON.parse(await readFile(file, 'utf8'))
    const legacyEntry = legacy.sessions.s1
    delete legacyEntry.results
    delete legacyEntry.configLocked
    delete legacyEntry.settings.subtitleDir
    delete legacyEntry.lastResult.settings.subtitleDir
    legacyEntry.lastResult.docxFile = oldDocxFile
    await writeFile(file, JSON.stringify(legacy))
    const migrated = await api.perform(ctx, { action: 'open' }, exec)
    assert.equal(migrated.session.results.length, 1)
    assert.equal(migrated.session.lastResult.outFile, first.outFile)
    assert.equal(migrated.session.lastResult.version, 1)
    assert.equal(migrated.session.lastResult.docxFile, oldDocxFile)
    assert.equal(migrated.session.lastResult.settings.subtitleDir, undefined, 'historical version settings remain untouched')
    assert.equal(migrated.settings.subtitleDir, '')
    assert.equal(migrated.session.configLocked, true, 'older generated conversations migrate to read-only configuration')
  } finally { await rm(root, { recursive: true, force: true }) }
})
