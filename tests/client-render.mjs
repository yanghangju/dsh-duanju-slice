import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const require = createRequire(process.env.DSH_REACT_ROOT ? resolve(process.env.DSH_REACT_ROOT, 'package.json') : import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let plugin
vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load({ factory }) { plugin = factory(() => React) } } },
  AbortController, DOMException, console,
})
const captured = new Map()
let dictionary
let locale = 'zh'
plugin.apply({
  effect: (fn) => fn(), get: () => ({}),
  locale: {
    register: (_ns, dict) => { dictionary = dict },
    bind: () => (key, values = {}) => (dictionary[locale][key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match),
    subscribe: () => () => {}, getSnapshot: () => locale,
  },
  slots: { inject: (_name, fn) => fn(), register: (spec, component) => { captured.set(spec.name, component) } },
})
const settings = { scriptPath: '', dramaDir: '', exportDir: '', direction: '' }
const noop = () => {}
const model = {
  settings, status: 'saved', saving: false, sending: false, busy: false,
  notice: null, failure: null, sessionId: 'session-1', sessionTitle: '切片 1', item: {},
  change: noop, commit: noop, lockConfiguration: noop, openJianying: noop, generate: noop, selectVersion: noop, browse: noop, onNew: noop, refresh: noop,
  dismissNotice: noop, reportNotice: noop,
}
function render(patch = {}, running = false) {
  return renderToStaticMarkup(React.createElement(captured.get('duanju.slice.conversation'), {
    model: { ...model, ...patch }, useSession: (select) => select({ running, blank: true }),
    useSessionStatus: (select) => select(new Map()),
    renderFactorySlot: () => React.createElement('textarea', { 'aria-label': '原生聊天输入' }),
  }))
}

test('the workbench checks the saved runtime before opening any editing conversation', () => {
  const html = renderToStaticMarkup(React.createElement(captured.get('main'), {
    SessionProvider: ({ children }) => children, renderSlot: () => null,
  }))
  assert.match(html, /role="status"[^>]*><span>正在读取运行环境状态…/)
  assert.doesNotMatch(html, /<aside[^>]*aria-label="会话列表"|class="wb-form"/)
})

test('setup keeps native chat, with a new conversation action only after verification', () => {
  const setup = (patch, pendingInteraction) => renderToStaticMarkup(React.createElement(captured.get('duanju.slice.conversation'), {
    setup: { sessionId: 'setup', ...patch },
    useSession: select => select({ running: false }),
    useSessionStatus: select => select(new Map([['setup', { pendingInteraction }]])),
    renderFactorySlot: (slot, props) => {
      assert.equal(slot, 'conversation.content')
      assert.equal(props.variant, 'embedded')
      return React.createElement('textarea', { 'aria-label': '原生聊天输入' })
    },
  }))
  const waiting = setup({})
  assert.match(waiting, /重新检查状态/)
  assert.match(waiting, /重新发送配置请求/)
  assert.doesNotMatch(waiting, /新建会话|class="wb-form"/)
  assert.match(setup({}, { key: 'confirmation' }), /请在下方对话确认或回复后继续/)
  const complete = setup({ complete: true, failure: '任务操作失败：无法新建会话' })
  assert.match(complete, /aria-label="原生聊天输入"/)
  assert.match(complete, />新建会话<\/button>/)
  assert.match(complete, /role="alert">任务操作失败：无法新建会话/)
  assert.doesNotMatch(complete, /重新发送配置请求|环境配置操作失败/)
})

test('the editor toolbar exposes reconfiguration as a separate conversation action', () => {
  const button = /<button\b[^>]*class="wb-secondary wb-runtime-reconfigure"[^>]*>/
  const ready = render().match(button)?.[0]
  assert.match(ready, /aria-label="重新配置环境"/)
  assert.match(ready, /新建独立会话.*不影响当前剪辑会话/)
  assert.doesNotMatch(ready, /disabled=/)
  const opening = render({ busy: true, reconfiguring: true })
  assert.match(opening.match(button)?.[0], /disabled=/)
  assert.match(opening, /role="status"[^>]*>.*正在打开配置对话…/)
})

test('new conversations explain subtitle priority and automatic fallback while settings are editable', () => {
  const html = render()
  assert.match(html, /<textarea[^>]*id="[^"]*"[^>]*>/)
  const lockButton = html.match(/<button\b[^>]*class="wb-primary"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.match(lockButton, />锁定配置<\/button>/)
  assert.match(lockButton, /disabled=/)
  assert.doesNotMatch(html, /<textarea[^>]*disabled/)
  assert.match(html, /请先选择剧本/)
  const helpId = html.match(/<button\b[^>]*aria-label="字幕目录（可选） · 选择"[^>]*aria-describedby="([^"]+)"/)?.[1]
  assert.ok(helpId)
  assert.ok(html.includes(`id="${helpId}" class="wb-field-hint"`))
  assert.match(html, /按集号命名的 \.srt（如 EP01\.srt）。缺少可用字幕或未可靠匹配到完整台词时，自动对未定位的台词使用语音识别。留空则直接用语音识别。两种方式定位后均抽帧核验完整动作。/)
  assert.doesNotMatch(html, /aria-label="原生聊天输入"|aria-label="清除字幕目录"/)
})

test('ready conversations can lock sources and direction without a plan approval', () => {
  const html = render({ settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' } })
  const lockButton = html.match(/<button\b[^>]*class="wb-primary"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.match(lockButton, />锁定配置<\/button>/)
  assert.doesNotMatch(lockButton, /disabled=/)
  assert.match(html, /复仇<\/textarea>/)
  assert.match(html, /锁定后不能更改素材、字幕目录、保存位置或方向；需要更改请新建会话。/)
  assert.doesNotMatch(html, /<input\b[^>]*\btype="(?:range|number)"/)
})

test('subtitle selection is editable until locking; both paths show the same locate progress', () => {
  const subtitleDir = String.raw`D:\海外短剧\The Deadly Wedding Ring\字幕`
  const selected = { ...settings, subtitleDir }
  const editable = render({ settings: selected })
  assert.ok(editable.includes(`title="${subtitleDir}" aria-label="字幕目录（可选） · 字幕"`))
  const clear = editable.match(/<button\b[^>]*aria-label="清除字幕目录"/)[0]
  assert.doesNotMatch(clear, /disabled=/)
  assert.match(editable, /自动对未定位的台词使用语音识别/)

  const item = { task: { stage: 'asr' } }
  const locked = render({ settings: selected, item }, true)
  assert.ok(locked.includes(`title="字幕目录（可选）：${subtitleDir}"`))
  assert.match(locked, />字幕优先：字幕<\/span>/)
  const noSubtitles = render({ item }, true)
  assert.match(noSubtitles, />台词：语音识别<\/span>/)
  for (const html of [locked, noSubtitles]) {
    assert.match(html, /配置已锁定/)
    assert.match(html, />正在定位台词<\/div>/)
    assert.doesNotMatch(html, /class="wb-form"|清除字幕目录|正在用语音识别|正在按字幕时间/)
  }
})

test('English copy explains subtitle fallback and locking without claiming the locate method', (t) => {
  locale = 'en'
  t.after(() => { locale = 'zh' })
  const ready = { scriptPath: '/script.docx', dramaDir: '/drama', exportDir: '/output', direction: 'Revenge' }
  const editable = render({ settings: ready })
  assert.match(editable, /speech recognition runs automatically for unmatched lines only\. Leave empty to use speech recognition from the start\. Either way, frames are checked after locating dialogue to verify the full action\./)
  assert.match(editable, /Once locked, start a new conversation to change the sources, subtitle folder, export folder, or direction\./)
  const item = { task: { stage: 'asr-cached' } }
  const locked = render({ settings: { ...ready, subtitleDir: '/subtitles' }, item }, true)
  const noSubtitles = render({ settings: ready, item }, true)
  assert.match(locked, />Subtitles first: subtitles<\/span>/)
  assert.match(noSubtitles, />Dialogue: speech recognition<\/span>/)
  for (const html of [locked, noSubtitles]) {
    assert.match(html, /Settings locked/)
    assert.match(html, />Locating dialogue<\/div>/)
  }
})

test('a generated conversation defaults to compact settings, video and chat', () => {
  const html = render({ item: { task: { stage: 'done' }, lastResult: { episode: 40, start: 12.8, end: 55.5, outFile: '/成片/复仇.mp4', draftDir: '/草稿/复仇', draftName: '复仇切片' } } })
  assert.ok(html.includes('data-started="true"'), 'generated conversations must enter the editing layout')
  assert.ok(html.includes('data-locked="true"'))
  assert.doesNotMatch(html, /class="wb-form"|class="wb-file-choice"|修改配置/)
  assert.match(html, /打开成片/)
  assert.match(html, /草稿目录/)
  assert.match(html, /42\.7/)
  assert.ok(html.includes('aria-label="原生聊天输入"'), 'chat is a primary surface after generation')
  assert.doesNotMatch(html, /class="wb-deliverables"/)
})

test('a delivered video stays complete while the agent writes its final summary', () => {
  const html = render({ item: { task: { stage: 'done' }, lastResult: { episode: 40, start: 12.8, end: 55.5, outFile: '/成片/复仇.mp4' } } }, true)
  assert.match(html, /data-state="done"/)
  assert.doesNotMatch(html, /class="wb-progress\b/)
  assert.match(html, /aria-label="原生聊天输入"/)
  assert.match(html, /aria-label="收起对话"/)
})

test('failed and interrupted runs never claim a completed video', () => {
  const failed = render({ item: { task: { stage: 'error', error: '工程里没有可用集' } } })
  assert.match(failed, /工程里没有可用集/)
  assert.match(failed, /role="alert"/)
  assert.ok(failed.includes('data-started="true"'))
  assert.ok(failed.includes('data-locked="true"'))
  assert.doesNotMatch(failed, /class="wb-form"/)
  const interrupted = render({ item: { task: { stage: 'render', startedAt: 1 } } })
  assert.match(interrupted, /已停止/)
  assert.doesNotMatch(interrupted, />切片完成</)
})

test('a running cut locks inputs and cannot be started twice', () => {
  const html = render({ settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' }, item: { task: { stage: 'render' } } }, true)
  assert.doesNotMatch(html, /class="wb-form"|class="wb-file-choice"/)
  assert.match(html, /正在渲染成片/)
  assert.match(html, /<button[^>]*class="wb-secondary wb-generate"[^>]*disabled=""/)
})

test('a finished conversation keeps immutable settings and retained versions', () => {
  const results = [{ id: 'v1', version: 1, start: 10, end: 45 }, { id: 'v2', version: 2, start: 10, end: 35 }]
  const html = render({ item: { task: { stage: 'done' }, results, lastResult: { ...results[1], episode: 43, outFile: '/成片/v2.mp4' } } })
  assert.doesNotMatch(html, /<textarea[^>]*disabled/)
  assert.match(html, /<select[^>]*aria-label="切换剪辑版本"/)
  assert.match(html, /V1 · 35秒/)
  assert.match(html, /<option value="2" selected="">V2 · 25秒/)
  assert.match(html, /素材与方向配置/)
  assert.match(html, /配置已锁定/)
  assert.doesNotMatch(html, /class="wb-form"|修改配置/)
})

test('locked configuration remains read-only when generation is submitted', () => {
  const html = render({ sending: true, item: { configLocked: true }, settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' } })
  assert.ok(html.includes('data-started="true"'))
  assert.ok(html.includes('data-locked="true"'))
  assert.doesNotMatch(html, /class="wb-form"/)
  assert.match(html, /aria-label="原生聊天输入"/)
})

test('discussion does not show a fictitious render pipeline', () => {
  const html = render({}, true)
  assert.match(html, /对话中/)
  assert.doesNotMatch(html, /class="wb-progress\b|正在制作这条切片|正在渲染成片/)
})

test('a genuine host interaction remains discoverable without opening chat automatically', () => {
  const html = renderToStaticMarkup(React.createElement(captured.get('duanju.slice.conversation'), {
    model, useSession: (select) => select({ running: false, blank: false }),
    useSessionStatus: (select) => select(new Map([['session-1', { pendingInteraction: { key: 'approval-1', kind: 'approval', sessionId: 'session-1' } }]])),
    renderFactorySlot: () => React.createElement('textarea', { 'aria-label': '原生聊天输入' }),
  }))
  assert.match(html, /剪辑助手需要你的回复/)
  assert.match(html, /需要回复/)
  assert.doesNotMatch(html, /aria-label="原生聊天输入"/)
})

test('once settings are locked, Generate is enabled and chat explains fixed BGM', () => {
  const html = render({ item: { configLocked: true }, settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' } })
  assert.match(html, /配置已锁定/)
  assert.doesNotMatch(html, /class="wb-form"|class="wb-file-choice"|修改配置|wb-pending|审核方案|确认方案/)
  const generateButton = html.match(/<button\b[^>]*class="wb-secondary wb-generate"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.match(generateButton, />生成初版<\/button>/)
  assert.doesNotMatch(generateButton, /disabled=/)
  assert.match(html, /aria-label="原生聊天输入"/)
  assert.match(html, /BGM 固定为 −5 dB/)
  assert.doesNotMatch(html, /音乐减半|<input\b[^>]*\btype="(?:range|number)"/)
})

test('open Jianying is available before and after configuration is locked', () => {
  for (const item of [{ configLocked: false }, { configLocked: true }]) {
    const html = render({ item })
    assert.match(html, /class="wb-secondary wb-editor-open"[^>]*aria-label="打开剪映"/)
  }
  const html = render({ openingJianying: true })
  assert.match(html, /class="wb-secondary wb-editor-open"[^>]*disabled=""/)
  assert.match(html, /正在打开…/)
})
