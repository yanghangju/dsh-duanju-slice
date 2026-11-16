// 切片工作台的会话目录与目录浏览：宿主侧命令服务，供工作台界面调用。
// 一个会话 = 一条 DSH 会话（跟普通 agent 会话一样出现在侧栏），每条会话各存一份设置。
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename as renameFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const PATH_FIELDS = ['scriptPath', 'projectDir', 'exportDir']
const DEFAULTS = { scriptPath: '', projectDir: '', exportDir: '', direction: '' }
const CONFIG_DIR = join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice')
const STATE_FILE = join(CONFIG_DIR, 'sessions.json')
const LEGACY_FILE = join(CONFIG_DIR, 'config.json')
const runFile = promisify(execFile)
let pendingWrite = Promise.resolve()

// Commands and renderer progress share one file; serialize read-modify-write operations.
function serialize(operation) {
  const result = pendingWrite.then(operation)
  pendingWrite = result.catch(() => {})
  return result
}

function emptyState() {
  return { version: 2, lastSessionId: null, sessions: {} }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function loadState() {
  const raw = await readJson(STATE_FILE)
  if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') {
    const sessions = {}
    for (const [id, entry] of Object.entries(raw.sessions)) {
      if (!entry || typeof entry !== 'object') continue
      const results = Array.isArray(entry.results) ? entry.results.filter(result => result && typeof result === 'object') : []
      if (!results.length && entry.lastResult) results.push({ ...entry.lastResult, id: `legacy-${id}`, version: 1 })
      const selected = results.find(result => result.id === entry.lastResult?.id) ?? results.at(-1) ?? null
      sessions[id] = {
        id,
        title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : '切片',
        titleLocked: entry.titleLocked === true,
        settings: normalize(entry.settings ?? {}),
        configLocked: typeof entry.configLocked === 'boolean' ? entry.configLocked : !!(entry.lastResult || entry.task),
        createdAt: Number(entry.createdAt) || Date.now(),
        updatedAt: Number(entry.updatedAt) || Date.now(),
        results,
        lastResult: selected,
        task: entry.task && typeof entry.task === 'object' ? entry.task : null,
      }
    }
    return { version: 2, lastSessionId: typeof raw.lastSessionId === 'string' ? raw.lastSessionId : null, sessions }
  }
  // 老版本只存了一份全局设置：留作新建会话的继承值。
  const legacy = await readJson(LEGACY_FILE)
  const state = emptyState()
  if (legacy) state.inherit = normalize(legacy)
  return state
}

async function saveState(state) {
  await mkdir(CONFIG_DIR, { recursive: true })
  const payload = { version: 2, lastSessionId: state.lastSessionId ?? null, sessions: state.sessions }
  const temp = `${STATE_FILE}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(payload, null, 2))
  await renameFile(temp, STATE_FILE)
}

export function normalize(patch) {
  assert(patch && typeof patch === 'object' && !Array.isArray(patch), 'settings 必须是对象')
  const value = { ...DEFAULTS, ...patch }
  for (const field of PATH_FIELDS) {
    assert(typeof value[field] === 'string' && value[field].length <= 4096 && !value[field].includes('\0'), `${field} 路径无效`)
    const path = value[field].trim()
    assert(!path || isAbsolute(path), `${field} 必须是绝对路径`)
    assert(field !== 'scriptPath' || !path || /\.docx$/i.test(path), '剧本必须是 DOCX 文件')
    value[field] = path ? resolve(path) : ''
  }
  assert(typeof value.direction === 'string' && value.direction.length <= 2000, '方向文本无效')
  value.direction = value.direction.trim()
  return value
}

export function validate(settings, generating = false) {
  if (settings.scriptPath && !/\.docx$/i.test(settings.scriptPath)) return '剧本必须是 .docx 文件'
  if (!generating) return null
  if (!settings.scriptPath) return '请选择剧本 DOCX'
  if (!settings.projectDir) return '请选择剪映工程目录'
  if (!settings.exportDir) return '请选择成片保存目录'
  if (!settings.direction) return '请填写切片方向'
  return null
}

function setConfiguration(entry, patch, lock = false) {
  const next = normalize({ ...entry.settings, ...patch })
  assert(!entry.configLocked || Object.keys(DEFAULTS).every(key => next[key] === entry.settings[key]), '配置已锁定，更换素材或方向请新建会话')
  const invalid = validate(next, lock)
  if (invalid) throw new Error(invalid)
  entry.settings = next
  if (lock) entry.configLocked = true
}

// The tool boundary checks the same lock before any selection or media write.
export function prepareCutSettings(sessionId, settings) {
  return serialize(async () => {
    const state = await loadState()
    const entry = state.sessions[sessionId]
    if (!entry) return
    setConfiguration(entry, settings, true)
    entry.title = autoTitle(entry)
    entry.updatedAt = Date.now()
    await saveState(state)
  })
}

export async function browse(path, current) {
  const start = path || (current.scriptPath ? dirname(current.scriptPath) : homedir())
  const directory = isAbsolute(start) ? resolve(start) : resolve(homedir(), start)
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || (entry.isFile() && /\.(docx|mp4|mov)$/i.test(entry.name)))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const roots = process.platform === 'win32'
    ? [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `${letter}:\\`).filter(existsSync)
    : ['/', join(homedir(), 'Desktop'), join(homedir(), 'Downloads'), join(homedir(), 'Movies')]
  return {
    path: directory,
    parent: dirname(directory) === directory ? null : dirname(directory),
    roots,
    entries: files.slice(0, 200).map((entry) => ({ name: entry.name, path: join(directory, entry.name), directory: entry.isDirectory() })),
    truncated: files.length > 200,
  }
}

function autoTitle(entry) {
  if (entry.titleLocked) return entry.title
  const direction = entry.settings.direction.trim()
  if (direction) return direction.length > 18 ? `${direction.slice(0, 18)}…` : direction
  const script = entry.settings.scriptPath ? basename(entry.settings.scriptPath, '.docx') : ''
  if (script) return script.length > 18 ? `${script.slice(0, 18)}…` : script
  return entry.title || '新切片'
}

function view(entry) {
  return {
    id: entry.id,
    title: entry.title,
    direction: entry.settings.direction,
    scriptPath: entry.settings.scriptPath,
    projectDir: entry.settings.projectDir,
    exportDir: entry.settings.exportDir,
    configLocked: entry.configLocked,
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt,
    lastResult: entry.lastResult,
    results: entry.results ?? [],
    task: entry.task ?? null,
  }
}

function sorted(state) {
  return Object.values(state.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
}

function nextTitle(state) {
  let index = Object.keys(state.sessions).length + 1
  const titles = new Set(Object.values(state.sessions).map((entry) => entry.title))
  while (titles.has(`切片 ${index}`)) index += 1
  return `切片 ${index}`
}

function inheritSettings(state) {
  const last = state.lastSessionId ? state.sessions[state.lastSessionId] : undefined
  if (last) return { ...last.settings }
  return { ...DEFAULTS, ...(state.inherit ?? {}) }
}

async function controllerOf(ctx) {
  const controller = ctx.get('sessionController')
  assert(controller, '当前环境没有会话服务，无法新建会话')
  return controller
}

function sessionIdOf(agent) {
  assert(agent && typeof agent.id === 'string' && agent.id, '当前会话不可用，请刷新页面后重试')
  return agent.id
}

async function rename(ctx, sessionId, title) {
  const controller = ctx.get('sessionController')
  if (!controller?.rename) return
  try {
    await controller.rename({ sessionId, title })
  } catch {
    // 改名失败不影响工作台自己的列表；DSH 侧标题保持原样。
  }
}

async function createSession(ctx, state, title, overrides) {
  const controller = await controllerOf(ctx)
  const inherited = inheritSettings(state)
  const settings = overrides ? normalize({ ...inherited, ...overrides }) : { ...inherited, direction: '' }
  if (overrides) {
    const invalid = validate(settings, true)
    if (invalid) throw new Error(invalid)
  }
  const cwd = settings.scriptPath ? dirname(settings.scriptPath) : undefined
  const { sessionId } = await controller.create(cwd ? { cwd } : {})
  const entry = {
    id: sessionId,
    title: title || nextTitle(state),
    titleLocked: false,
    settings,
    configLocked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastResult: null,
  }
  state.sessions[sessionId] = entry
  state.lastSessionId = sessionId
  await rename(ctx, sessionId, autoTitle(entry))
  entry.title = autoTitle(entry)
  await saveState(state)
  return entry
}

async function adoptSession(state, sessionId, title) {
  const existing = state.sessions[sessionId]
  if (existing) return existing
  const entry = {
    id: sessionId,
    title: title || nextTitle(state),
    titleLocked: false,
    settings: inheritSettings(state),
    configLocked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastResult: null,
  }
  state.sessions[sessionId] = entry
  state.lastSessionId = sessionId
  await saveState(state)
  return entry
}

/** 成片是会话中的一个版本；切换和重试都不覆盖已有文件。 */
export async function recordResult(ctx, sessionId, result) {
  if (!sessionId || !result) return
  return serialize(async () => {
    const state = await loadState()
    const entry = state.sessions[sessionId]
    if (!entry) return
    entry.lastResult = {
      id: randomUUID(),
      version: (entry.results?.length ?? 0) + 1,
      episode: result.episode ?? null,
      start: result.start ?? null,
      end: result.end ?? null,
      draftName: result.draftName ?? null,
      draftDir: result.draftDir ?? null,
      outFile: result.outFile ?? null,
      sourceDir: result.sourceDir ?? null,
      audioLevels: result.audioLevels ?? { dialogue: 1, music: 1, effects: 1 },
      note: result.note ?? '',
      settings: entry.settings,
      at: Date.now(),
    }
    entry.results = [...(entry.results ?? []), entry.lastResult]
    entry.configLocked = true
    entry.updatedAt = Date.now()
    entry.task = { ...entry.task, stage: 'done', updatedAt: Date.now(), error: null }
    await saveState(state)
    return entry.lastResult
  })
}

export function editingSession(sessionId) {
  return serialize(async () => (await loadState()).sessions[sessionId] ?? null)
}

export async function editingContext(sessionId) {
  const entry = await editingSession(sessionId)
  if (!entry) return ''
  return [
    '切片工作台：这是持续剪辑会话，成片只是一个版本。以下是当前状态，用户本轮要求优先。',
    '可以先讨论选段、节奏和修改方案；没有明确制作或修改要求时只回答，不自动导出。不要因为已有成片而另建会话。面向用户用简短自然语言，不解释内部工具名和参数。',
    entry.configLocked ? '本会话的素材路径、保存目录和基础方向已锁定，不能修改。重选片段时原样使用这些设置；裁剪和音量可继续调整。用户要更换素材或基础方向时，提示新建会话。' : '当前配置尚未锁定；制作前会固定本次使用的素材与方向。',
    '修改当前片段的首尾或音量用 duanju_slice_revise，时间相对当前版本开头；重新选片段用 duanju_slice_cut。每次修改都保留旧版。',
    'duanju_slice_revise 可选参数：start/end（秒）、dialogueGain/musicGain/effectsGain（0–4倍率）、note（修改说明）。省略项沿用当前版；无音量记录按1。按已注册工具执行，不需要检查插件源码。',
    '查看或回到旧版用 duanju_slice_versions；后续修改基于当前选中版本。若素材或需求不足，结合当前状态简短澄清，不臆造路径。',
    JSON.stringify({ settings: entry.settings, configLocked: entry.configLocked, current: entry.lastResult, versions: (entry.results ?? []).slice(-8).map(({ version, episode, start, end, note }) => ({ version, episode, start, end, note })) }),
  ].join('\n')
}

export function installEditingContext(ctx) {
  return ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (step !== 1 || decision.kind === 'reject' || signal?.aborted) return decision
    const text = await editingContext(agent.id)
    if (!text) return decision
    const message = Object.freeze({
      id: randomUUID(), role: 'user',
      content: Object.freeze([Object.freeze({ type: 'text', text })]),
      source: Object.freeze({ kind: 'plugin:duanju-slice-context', form: 'snapshot', sections: Object.freeze([Object.freeze({ name: 'duanju-slice', text })]) }),
    })
    return { ...decision, messages: [...decision.messages, message] }
  }, { prepend: true })
}

export function recordProgress(ctx, sessionId, stage, error = null) {
  if (!sessionId) return Promise.resolve()
  return serialize(async () => {
    const state = await loadState()
    const entry = state.sessions[sessionId]
    if (!entry) return
    const startedAt = stage === 'survey' && ['done', 'error'].includes(entry.task?.stage) ? Date.now() : entry.task?.startedAt ?? Date.now()
    entry.task = { startedAt, stage, updatedAt: Date.now(), error }
    await saveState(state)
  }).catch(() => {})
}

export function perform(ctx, args, exec) {
  return serialize(() => performCommand(ctx, args, exec))
}

async function performCommand(ctx, args, exec) {
  assert(args && typeof args === 'object' && !Array.isArray(args), '工作台请求必须是对象')
  const allowed = ['list', 'create', 'open', 'save', 'lock', 'rename', 'remove', 'browse', 'generate', 'select-result', 'open-jianying']
  assert(allowed.includes(args.action), '未知工作台操作')

  if (args.action === 'open-jianying') {
    // shortcut: macOS LaunchServices; add a native launcher when supporting other desktop platforms.
    try { await runFile('/usr/bin/open', ['-b', 'com.lemon.lvpro'], { timeout: 10000 }) }
    catch (error) { throw new Error(`打开剪映失败：${error.message}`) }
    return { opened: true }
  }

  const state = await loadState()
  const activeId = exec?.agent?.id

  if (args.action === 'browse') {
    const base = (activeId && state.sessions[activeId]?.settings) || inheritSettings(state)
    return browse(args.path, base)
  }

  if (args.action === 'list') {
    return { sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
  }

  if (args.action === 'create') {
    // adopt：把界面上已经存在的会话收进目录（首次打开工作台时用它，避免多建一条空会话）
    const entry = args.adopt ? await adoptSession(state, String(args.adopt)) : await createSession(ctx, state, undefined, args.settings)
    return { session: view(entry), settings: entry.settings, sessionId: entry.id, sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
  }

  if (args.action === 'rename') {
    const sessionId = String(args.sessionId || activeId || '')
    const entry = state.sessions[sessionId]
    assert(entry, '要改名的会话不存在')
    const title = String(args.title || '').trim()
    assert(title && title.length <= 60, '会话名需要 1–60 个字符')
    entry.title = title
    entry.titleLocked = true
    entry.updatedAt = Date.now()
    await rename(ctx, sessionId, title)
    await saveState(state)
    return { session: view(entry), sessions: sorted(state).map(view) }
  }

  if (args.action === 'remove') {
    const sessionId = String(args.sessionId || '')
    const entry = state.sessions[sessionId]
    assert(entry, '要删除的会话不存在')
    delete state.sessions[sessionId]
    if (state.lastSessionId === sessionId) {
      state.lastSessionId = sorted(state)[0]?.id ?? null
    }
    await saveState(state)
    return { sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
  }

  // open / save / generate 都作用于界面当前绑定的那条会话。
  const sessionId = sessionIdOf(exec?.agent)
  if (args.action === 'open') {
    const entry = await adoptSession(state, sessionId)
    entry.updatedAt = Date.now()
    state.lastSessionId = sessionId
    await saveState(state)
    return { session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
  }

  const entry = state.sessions[sessionId] ?? (await adoptSession(state, sessionId))
  if (args.action === 'select-result') {
    const selected = entry.results?.find(result => result.version === args.version)
    assert(selected, '这个剪辑版本不存在')
    entry.lastResult = selected
    entry.updatedAt = Date.now()
    entry.task = { stage: 'done', updatedAt: Date.now(), error: null }
    await saveState(state)
    return { session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view) }
  }
  assert(args.action !== 'save' || args.settings, 'save 需要 settings')
  if (args.settings || args.action === 'lock' || args.action === 'generate') {
    setConfiguration(entry, args.settings ?? {}, args.action === 'lock' || args.action === 'generate')
    entry.updatedAt = Date.now()
    entry.title = autoTitle(entry)
    state.lastSessionId = sessionId
    await saveState(state)
  }
  if (args.action === 'generate') {
    entry.task = { stage: 'queued', startedAt: Date.now(), updatedAt: Date.now(), error: null }
    await saveState(state)
    try { await wake(ctx, exec, entry.settings, args.text) }
    catch (error) {
      entry.task = { ...entry.task, stage: 'error', error: error.message, updatedAt: Date.now() }
      await saveState(state)
      throw error
    }
    return { accepted: true, session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view) }
  }
  return { session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
}

async function wake(ctx, exec, settings, text) {
  const live = exec?.agent
  const agent = typeof live?.followup === 'function' ? live : ctx.get?.('agents')?.get?.(live?.id)
  assert(agent && typeof agent.followup === 'function', '当前会话无法接收工作台指令')
  const parameters = {
    projectDir: settings.projectDir,
    scriptPath: settings.scriptPath,
    direction: settings.direction,
    exportDir: settings.exportDir,
  }
  const body = typeof text === 'string' && text.trim()
    ? text.trim()
    : [
        '请调用 duanju_slice_cut，参数如下：',
        '```json',
        JSON.stringify(parameters, null, 2),
        '```',
        '按这些设置生成一个新版本，保留同一会话已有版本。不要额外生成多条候选。之后可以继续对话修改。',
        '完成后用一段短摘要回我：第几集、时间码、草稿名、成片路径，以及提醒我重启剪映才能看到草稿。',
      ].join('\n')
  agent.followup({
    id: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    role: 'user',
    content: [{ type: 'text', text: body }],
    source: { kind: 'plugin:duanju-slice' },
  })
}
