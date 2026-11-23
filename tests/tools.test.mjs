// 工具注册面：高级流程、工作台命令与真实只读勘察。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { cleanup, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

async function loadPlugin(overrides = {}) {
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
  const commands = []
  const ctx = {
    effect: (callback) => callback(),
    on: () => () => {},
    get: (key) => key === 'commands' ? { register: (spec) => { commands.push(spec); return () => {} } }
      : key === 'agents' ? { turnBoundaryOf: session => ({ openTurnStartSeq: session.openTurnStartSeq }) } : null,
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => {} } },
  }
  source.namespace.apply(ctx, { ffmpegPath: '' })
  return { tools, commands, version: source.namespace.version }
}

test('注册面：高级剪辑与环境配置用原工作台命令，无旧 ASR 直剪入口', async () => {
  const { tools, commands, version } = await loadPlugin()
  assert.deepEqual([...tools.keys()].sort(), ['duanju_slice_advanced', 'duanju_slice_cut', 'duanju_slice_plan', 'duanju_slice_revise', 'duanju_slice_setup_runtime', 'duanju_slice_survey', 'duanju_slice_versions'])
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

test('配置入口只发普通对话消息，一次授权仅适用于该提示所在回合', async () => {
  let installed = false
  let installs = 0
  let failSetup = false
  const sent = [], events = []
  const { tools, commands } = await loadPlugin({ './lib/promo/runtime-setup.js': {
    configuredRuntime: () => installed ? {} : null,
    runtimeOptions: config => ({ ...config, ffmpegPath: 'saved-path' }),
    configureRuntime: async (config) => {
      assert.equal(config.ffmpegPath, undefined, '复检不会被已保存的路径覆盖')
      installs++
      if (failSetup) throw new Error('配置失败')
      installed = true; return { ready: true }
    },
  } })
  const handler = commands[0].handler
  const signal = new AbortController().signal
  const session = { openTurnStartSeq: 0, snapshotEvents: start => events.slice(start) }
  const agent = { id: 'setup', session, followup: message => { sent.push(message) } }
  const command = async (action, options) => {
    const reply = await handler({ rawInput: JSON.stringify({ action, ...options }), agent, signal })
    assert.equal(reply.kind, 'success', reply.text)
    return JSON.parse(reply.text)
  }
  const tool = tools.get('duanju_slice_setup_runtime')
  const run = () => tool.execute({}, { agent, signal })
  assert.deepEqual(await command('runtime-status'), { ready: false })
  assert.throws(run, /请先.*配置运行环境/)
  assert.deepEqual(await command('runtime-prompt'), { accepted: true })
  assert.equal(installs, 0, '点击只发普通聊天消息，不执行安装')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].role, 'user')
  assert.match(sent[0].content[0].text, /duanju_slice_setup_runtime/)
  assert.match(sent[0].content[0].text, /新建会话/)
  assert.throws(run, /请先/, '仍在排队的提示不能给当前回合授权')
  events.push({ type: 'user/message', data: sent[0] })
  session.openTurnStartSeq = 1
  assert.throws(run, /请先/, '已结束回合里的配置请求不能给后来回合授权')
  assert.deepEqual(await command('runtime-prompt', { reconfigure: true }), { accepted: true })
  assert.match(sent[1].content[0].text, /10 分钟/)
  assert.match(sent[1].content[0].text, /继续原来的剪辑会话/)
  assert.doesNotMatch(sent[1].content[0].text, /新建会话/)
  events.push({ type: 'user/message', data: sent[1] })
  assert.throws(() => tool.execute({}, { agent: { id: 'other', session: { ...session } }, signal }), /请先/)
  assert.deepEqual(await run(), { ready: true })
  assert.throws(run, /请先/, '一次点击只允许调用一次')
  assert.deepEqual(await command('runtime-status', { setup: true }), { ready: true })
  failSetup = true
  assert.deepEqual(await command('runtime-prompt'), { accepted: true })
  assert.deepEqual(await command('runtime-status'), { ready: true })
  assert.deepEqual(await command('runtime-status', { setup: true }), { ready: false })
  events.push({ type: 'user/message', data: sent[2] })
  session.openTurnStartSeq = 2
  await assert.rejects(run(), /配置失败/)
  assert.throws(run, /请先/)
  assert.deepEqual(await command('runtime-status', { setup: true }), { ready: false })
  assert.equal(installs, 2)
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
