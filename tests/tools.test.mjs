// 工具注册面：高级流程、工作台命令与真实只读勘察。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { cleanup, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

async function loadPlugin(overrides = {}, config = { ffmpegPath: '' }) {
  const url = new URL('../index.js', import.meta.url)
  const context = vm.createContext({ console, Buffer, process, URL, fetch, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto })
  const source = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, initializeImportMeta: (meta) => { meta.url = url.href } })
  await source.link(async (name) => {
    const values = overrides[name] ?? await import(name.startsWith('.') ? new URL(name, url).href : name)
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await source.evaluate()
  const tools = new Map()
  const commands = [], skills = []
  const ctx = {
    effect: (callback) => callback(),
    on: () => () => {},
    get: (key) => key === 'commands' ? { register: (spec) => { commands.push(spec); return () => {} } } : null,
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => {} } },
    skills: { register: (spec) => { skills.push(spec); return () => {} } },
  }
  source.namespace.apply(ctx, config)
  return { tools, commands, skills, version: source.namespace.version }
}

test('注册面：高级剪辑与环境配置用原工作台命令，无旧 ASR 直剪入口', async () => {
  const { tools, commands, skills, version } = await loadPlugin()
  assert.deepEqual([...tools.keys()].sort(), ['duanju_slice_advanced', 'duanju_slice_cut', 'duanju_slice_plan', 'duanju_slice_revise', 'duanju_slice_survey', 'duanju_slice_versions'])
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'duanju-slice-runtime')
  assert.equal(skills[0].invocation.modelInvocable, true)
  assert.match(skills[0].content, /setup\.mjs[\s\S]*run_in_background: true/)
  assert.match(await readFile(join(skills[0].resourceBase.path, 'setup.mjs'), 'utf8'), /configureRuntime/)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'duanju-slice')
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
  assert.equal(cut.properties.lines, undefined)
  assert.equal(cut.properties.verify, undefined)
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

test('配置入口只发 Skill 请求，需有当前请求的完成回执', async () => {
  let installed = false
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
  }, { ffmpegPath: 'config-path' })
  const handler = commands[0].handler
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
  assert.deepEqual(await command('runtime-prompt'), { accepted: true })
  assert.equal(sent[0].role, 'user')
  assert.match(sent[0].content[0].text, /duanju-slice-runtime Skill.*\n配置请求 ID：request-1/)
  assert.match(sent[0].content[0].text, /新建会话/)
  assert.deepEqual(await status(), { ready: false })
  assert.deepEqual(await command('runtime-prompt', { reconfigure: true }, other), { accepted: true })
  assert.match(sent[1].content[0].text, /配置请求 ID：request-2/)
  assert.match(sent[1].content[0].text, /继续原来的剪辑会话/)
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
