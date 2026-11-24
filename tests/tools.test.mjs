// 工具注册面：高级流程、工作台命令与真实只读勘察。
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { cleanup, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

async function loadModule(url, overrides) {
  const context = vm.createContext({ console, Buffer, process, URL, fetch, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto })
  const source = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, initializeImportMeta: (meta) => { meta.url = url.href } })
  await source.link(async (name) => {
    const values = overrides[name] ?? await import(name.startsWith('.') ? new URL(name, url).href : name)
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await source.evaluate()
  return source.namespace
}

async function loadPlugin(overrides = {}, config = { ffmpegPath: '' }, credentials) {
  const plugin = await loadModule(new URL('../index.js', import.meta.url), overrides)
  const tools = new Map()
  const commands = [], skills = []
  const ctx = {
    effect: (callback) => callback(),
    on: () => () => {},
    get: (key) => key === 'commands' ? { register: (spec) => { commands.push(spec); return () => {} } } : key === 'credentials' ? credentials : null,
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => {} } },
    skills: { register: (spec) => { skills.push(spec); return () => {} } },
  }
  plugin.apply(ctx, config)
  return { tools, commands, skills, version: plugin.version }
}

test('注册面：同一剪辑工具区分混剪与切片，密钥走独立且不记录输入的命令', async () => {
  const { tools, commands, skills, version } = await loadPlugin()
  assert.deepEqual([...tools.keys()].sort(), ['duanju_slice_advanced', 'duanju_slice_cut', 'duanju_slice_plan', 'duanju_slice_revise', 'duanju_slice_survey', 'duanju_slice_versions'])
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'duanju-slice-runtime')
  assert.equal(skills[0].invocation.modelInvocable, true)
  assert.match(skills[0].content, /setup\.mjs[\s\S]*run_in_background: true/)
  assert.match(skills[0].content, /同一配置对话[\s\S]*沿用工作台之前发来的配置请求 ID/)
  assert.match(await readFile(join(skills[0].resourceBase.path, 'setup.mjs'), 'utf8'), /runRuntimeRequest\(id, configureRuntime, cancel\.signal\)/)
  assert.equal(commands.length, 2)
  assert.equal(commands.find(spec => spec.name === 'duanju-slice').recordInput, true)
  assert.equal(commands.find(spec => spec.name === 'duanju-slice-store-asr-key').recordInput, false)
  assert.match(version, /^0\.3\./)

  for (const name of ['duanju_slice_survey', 'duanju_slice_plan', 'duanju_slice_cut']) {
    const parameters = tools.get(name).parameters
    assert.ok(parameters.properties.dramaDir, `${name} 必须收短剧目录`)
    assert.ok(parameters.required.includes('dramaDir'), `${name} 的短剧目录是必填`)
    assert.equal(parameters.properties.projectDir, undefined)
    assert.equal(parameters.properties.drafts, undefined, '草稿箱分组参数已随旧模式移除')
  }
  const cut = tools.get('duanju_slice_cut').parameters
  assert.deepEqual([...cut.required], ['dramaDir', 'scriptPath', 'direction', 'exportDir'])
  assert.deepEqual([...cut.properties.mode.enum], ['mix', 'slice'])
  assert.equal(cut.properties.lines.items.type, 'integer')
  assert.equal(cut.properties.start.type, 'number')
  assert.equal(tools.get('duanju_slice_plan').parameters.properties.mode, undefined)
  assert.match(tools.get('duanju_slice_plan').description, /plan\.json.*不会定位、抽帧/)
  assert.match(tools.get('duanju_slice_cut').description, /优先用分集字幕定位.*自动使用现有语音识别.*不停下来询问用户.*抽帧核验动作.*不生成 Word/)
  assert.equal(cut.properties.subtitleDir.type, 'string')
  assert.equal(tools.get('duanju_slice_plan').parameters.properties.subtitleDir.type, 'string')
  const revise = tools.get('duanju_slice_revise').parameters
  for (const schema of [cut, tools.get('duanju_slice_plan').parameters, revise]) {
    assert.equal(schema.properties.bgmVolume, undefined)
    assert.equal(schema.properties.musicGain, undefined)
  }
  const staged = tools.get('duanju_slice_advanced')
  assert.ok(!staged.parameters.properties.action.enum.includes('confirm'))
  assert.ok(staged.parameters.properties.action.enum.includes('proposal'))
  assert.ok(staged.parameters.properties.action.enum.includes('render'))
  assert.ok(!staged.parameters.properties.action.enum.includes('prepare'))
  assert.match((await staged.execute({ action: 'guide' }, {})).summary, /duanju_slice_cut/)
})

test('配置入口先检查密钥，安全保存后只发 Skill 请求且需要本次回执', async (t) => {
  for (const name of ['VOLCENGINE_API_KEY', 'VOLC_API_KEY']) {
    const previous = process.env[name]
    delete process.env[name]
    t.after(() => { if (previous !== undefined) process.env[name] = previous })
  }
  let installed = false
  let stored
  const sent = [], receipts = new Set(), revoked = []
  const signal = new AbortController().signal
  const { commands } = await loadPlugin({
    './lib/promo/runtime-setup.js': {
      configuredRuntime: () => installed ? {} : null,
      runtimeOptions: config => ({ ...config, ffmpegPath: 'saved-path' }),
    },
    './lib/promo/runtime-request.js': {
      createRuntimeRequest: async (config, inputSignal) => {
        assert.equal(config.ffmpegPath, 'config-path', '复检仍接收显式配置，而不是已保存的路径')
        assert.equal(inputSignal, signal)
        return `request-${sent.length + 1}`
      },
      consumeRuntimeReceipt: async id => receipts.delete(id),
      discardRuntimeRequest: async id => { revoked.push(id) },
    },
  }, { ffmpegPath: 'config-path' }, {
    readRecord: async () => stored,
    modifyRecord: async (_key, mutate) => { stored = await mutate(stored) },
  })
  const handler = commands.find(spec => spec.name === 'duanju-slice').handler
  const keyHandler = commands.find(spec => spec.name === 'duanju-slice-store-asr-key').handler
  const agent = { id: 'setup', session: {}, followup: message => { sent.push(message) } }
  const other = { ...agent, id: 'reconfigure', session: {} }
  const invoke = (action, options, target) => handler({ rawInput: JSON.stringify({ action, ...options }), agent: target, signal })
  const command = async (action, options, target = agent) => {
    const reply = await invoke(action, options, target)
    assert.equal(reply.kind, 'success', reply.text)
    return JSON.parse(reply.text)
  }
  const status = (target) => command('runtime-status', { setup: true }, target)
  assert.deepEqual(await status(), { ready: false })
  assert.deepEqual(await command('asr-status'), { configured: false })
  assert.deepEqual(await command('runtime-prompt'), { accepted: false, needsAsrKey: true })
  assert.equal(sent.length, 0)
  const badKey = 'fixture-key\nnot-a-header'
  const rejected = await keyHandler({ rawInput: badKey, signal })
  assert.equal(rejected.kind, 'error')
  assert.ok(!rejected.text.includes('fixture-key'))
  assert.deepEqual({ ...await keyHandler({ rawInput: 'fixture-key', signal }) }, { kind: 'success' })
  assert.deepEqual(await command('asr-status'), { configured: true })
  assert.deepEqual(await command('runtime-prompt'), { accepted: true })
  assert.equal(sent[0].role, 'user')
  assert.match(sent[0].content[0].text, /duanju-slice-runtime Skill.*\n配置请求 ID：request-1/)
  assert.match(sent[0].content[0].text, /新建会话/)
  assert.deepEqual(await status(), { ready: false })
  assert.deepEqual(await command('runtime-prompt', {}, other), { accepted: true })
  assert.match(sent[1].content[0].text, /配置请求 ID：request-2/)
  assert.doesNotMatch(JSON.stringify(sent), /fixture-key/)
  installed = true
  assert.deepEqual(await command('runtime-status'), { ready: true })
  assert.deepEqual(await status(), { ready: false }, '旧环境不能冒充本次结果')
  receipts.add('request-2')
  assert.deepEqual(await status(), { ready: false }, '不能读取另一会话的回执')
  assert.deepEqual(await status(other), { ready: true })
  assert.deepEqual(await status(other), { ready: true }, '回执消费后仍保持已完成')
  assert.equal(receipts.size, 0)
  const failed = { ...agent, session: {}, followup: () => { throw new Error('send failed') } }
  assert.deepEqual({ ...await invoke('runtime-prompt', {}, failed) }, { kind: 'error', text: 'send failed' })
  assert.deepEqual(revoked, ['request-3'])
})

test('配置失败和取消均不发回执，原会话可用同一请求继续', async (t) => {
  const root = await tempDir('runtime-request-')
  t.after(() => cleanup(root))
  const requests = await loadModule(new URL('../lib/promo/runtime-request.js', import.meta.url), { './runtime.js': { RUNTIME_HOME: root } })
  const { runRuntimeRequest } = requests
  // An installed runtime by itself is not proof this request succeeded.
  const { commands } = await loadPlugin({
    './lib/promo/runtime-setup.js': { configuredRuntime: () => ({}), runtimeOptions: config => config },
    './lib/promo/runtime-request.js': requests,
  }, { ffmpegPath: 'fixture-ffmpeg', volcApiKey: 'fixture-not-a-real-key' })
  const handler = commands.find(spec => spec.name === 'duanju-slice').handler
  const prompts = []
  const agent = { id: 'fixture-setup', session: {}, followup: message => { prompts.push(message) } }
  const command = async (action) => {
    const result = await handler({ rawInput: JSON.stringify({ action, setup: true }), agent })
    assert.equal(result.kind, 'success', result.text)
    return JSON.parse(result.text)
  }
  assert.deepEqual(await command('runtime-prompt'), { accepted: true })
  const { id } = prompts[0]
  assert.match(prompts[0].content[0].text, /继续配置或重试.*用这个请求 ID 继续/)

  await assert.rejects(runRuntimeRequest(id, async config => {
    assert.equal(config.ffmpegPath, 'fixture-ffmpeg')
    assert.equal(config.volcApiKey, undefined)
    await assert.rejects(runRuntimeRequest(id, () => assert.fail('同一请求不能并发执行')), /请求不可用/)
    throw new Error('fixture download failed')
  }), /fixture download failed/)
  assert.deepEqual(await command('runtime-status'), { ready: false })

  const controller = new AbortController()
  await assert.rejects(runRuntimeRequest(id, async () => {
    controller.abort(new Error('fixture stopped'))
    return { ready: true }
  }, controller.signal), /fixture stopped/)
  assert.deepEqual(await command('runtime-status'), { ready: false })

  // A follow-up in the same native chat reuses the workbench's ID, not runtime-prompt.
  assert.deepEqual(await runRuntimeRequest(id, async () => ({ ready: true })), { ready: true })
  assert.deepEqual(await command('runtime-status'), { ready: true })
  assert.deepEqual(await command('runtime-status'), { ready: true })
  await assert.rejects(runRuntimeRequest(id, () => assert.fail('已成功的请求不能再次执行')), /请求不可用/)
  assert.equal(prompts.length, 1)
})

test('勘察工具：真的扫短剧目录并返回清单', { skip: !hasFfmpeg }, async () => {
  const root = await tempDir('slice-tool-survey-')
  try {
    const drama = join(root, '测试短剧')
    await mkdir(drama, { recursive: true })
    await makeVideo(drama, 'ep001.mp4', { seconds: 1, audio: true })
    await makeVideo(drama, 'ep002 (英文字幕版）.mp4', { seconds: 1, audio: true })
    const { tools } = await loadPlugin()
    const result = await tools.get('duanju_slice_survey').execute({ dramaDir: drama }, {})
    assert.match(result.summary, /识别到 2 集/)
    assert.equal(result.report.project.episodeCount, 2)
    assert.deepEqual([...result.report.pairing.availableEpisodes], [1, 2])
    assert.ok(result.report.project.episodes.every((row) => row.hasAudio))
  } finally {
    await cleanup(root)
  }
})
