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
plugin.apply({
  effect: (fn) => fn(), get: () => ({}),
  locale: {
    register: (_ns, dict) => { dictionary = dict.zh },
    bind: () => (key, values = {}) => (dictionary[key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match),
    subscribe: () => () => {}, getSnapshot: () => 'zh',
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

test('the conversation list is visible by default with an explicit collapse control', () => {
  const html = renderToStaticMarkup(React.createElement(captured.get('main'), {
    SessionProvider: ({ children }) => children, renderSlot: () => null,
  }))
  assert.match(html, /<aside[^>]*aria-label="会话列表"/)
  assert.match(html, /<button[^>]*aria-label="收起会话列表"/)
  assert.doesNotMatch(html, /class="wb-task-popup"/)
})

test('new conversations allow initial configuration before confirmation', () => {
  const html = render()
  assert.match(html, /<textarea[^>]*id="[^"]*"[^>]*>/)
  const confirm = html.match(/<button\b[^>]*class="wb-primary"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.match(confirm, /确认并锁定配置/)
  assert.match(confirm, /disabled=/)
  assert.doesNotMatch(html, /<textarea[^>]*disabled/)
  assert.match(html, /请先选择剧本/)
  assert.doesNotMatch(html, /aria-label="原生聊天输入"/)
})

test('ready conversations can confirm and lock configuration', () => {
  const html = render({ settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' } })
  const confirm = html.match(/<button\b[^>]*class="wb-primary"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.match(confirm, /确认并锁定配置/)
  assert.doesNotMatch(confirm, /disabled=/)
  assert.match(html, /复仇<\/textarea>/)
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

test('pending approvals remain discoverable without opening chat automatically', () => {
  const html = renderToStaticMarkup(React.createElement(captured.get('duanju.slice.conversation'), {
    model, useSession: (select) => select({ running: false, blank: false }),
    useSessionStatus: (select) => select(new Map([['session-1', { pendingInteraction: { key: 'approval-1', kind: 'approval', sessionId: 'session-1' } }]])),
    renderFactorySlot: () => React.createElement('textarea', { 'aria-label': '原生聊天输入' }),
  }))
  assert.match(html, /剪辑助手需要你确认/)
  assert.match(html, /等待确认/)
  assert.doesNotMatch(html, /aria-label="原生聊天输入"/)
})


test('confirmation can lock a new conversation without producing a video', () => {
  const html = render({ item: { configLocked: true }, settings: { scriptPath: '/剧本.docx', dramaDir: '/短剧', exportDir: '/成片', direction: '复仇' } })
  assert.match(html, /配置已锁定/)
  assert.doesNotMatch(html, /class="wb-form"|class="wb-file-choice"|修改配置/)
  assert.match(html, /生成初版/)
  assert.match(html, /aria-label="原生聊天输入"/)
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
