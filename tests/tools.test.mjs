// 工具注册面：宿主侧确实注册了这四个工具 / 一条命令，参数名对得上，勘察工具能真的跑。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { cleanup, hasFfmpeg, makeVideo, tempDir } from './support.mjs'

async function loadPlugin() {
  const url = new URL('../index.js', import.meta.url)
  const context = vm.createContext({ console, Buffer, process, URL, fetch, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto })
  const source = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, initializeImportMeta: (meta) => { meta.url = url.href } })
  await source.link(async (name) => {
    const values = await import(name.startsWith('.') ? new URL(name, url).href : name)
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
    get: (key) => (key === 'commands' ? { register: (spec) => { commands.push(spec); return () => {} } } : null),
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => {} } },
  }
  source.namespace.apply(ctx, { ffmpegPath: '' })
  return { tools, commands, version: source.namespace.version }
}

test('注册面：四个工具 + 一条工作台命令，参数用短剧目录而不是剪映工程目录', async () => {
  const { tools, commands, version } = await loadPlugin()
  assert.deepEqual([...tools.keys()].sort(), ['duanju_slice_cut', 'duanju_slice_plan', 'duanju_slice_revise', 'duanju_slice_survey', 'duanju_slice_versions'])
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'duanju-slice')
  assert.match(version, /^0\.2\./)

  for (const name of ['duanju_slice_survey', 'duanju_slice_plan', 'duanju_slice_cut']) {
    const parameters = tools.get(name).parameters
    assert.ok(parameters.properties.dramaDir, `${name} 必须收短剧目录`)
    assert.ok(parameters.required.includes('dramaDir'), `${name} 的短剧目录是必填`)
    assert.equal(parameters.properties.projectDir, undefined)
    assert.equal(parameters.properties.drafts, undefined, '草稿箱分组参数已随旧模式移除')
  }
  const cut = tools.get('duanju_slice_cut').parameters
  assert.deepEqual([...cut.required], ['dramaDir', 'scriptPath', 'direction', 'exportDir'])
  assert.match(tools.get('duanju_slice_plan').description, /语音识别/)
  assert.match(tools.get('duanju_slice_cut').description, /片尾/)
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
