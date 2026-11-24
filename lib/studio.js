// 自动剪辑工作台的会话目录与目录浏览：宿主侧命令服务，供工作台界面调用。
// 一个会话 = 一条 DSH 会话（跟普通 agent 会话一样出现在侧栏），每条会话各存一份设置。
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename as renameFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const PATH_FIELDS = ['scriptPath', 'dramaDir', 'subtitleDir', 'exportDir']
const DEFAULTS = { scriptPath: '', dramaDir: '', subtitleDir: '', exportDir: '', direction: '', mode: 'mix' }
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
        settings: normalize(migrateSettings(entry.settings ?? {})),
        configLocked: typeof entry.configLocked === 'boolean' ? entry.configLocked : !!(entry.lastResult || entry.task),
        createdAt: Number(entry.createdAt) || Date.now(),
        updatedAt: Number(entry.updatedAt) || Date.now(),
        results,
        lastResult: selected,
        task: entry.task && typeof entry.task === 'object' ? entry.task : null,
        advanced: entry.advanced?.workDir ? entry.advanced : null,
      }
    }
    return { version: 2, lastSessionId: typeof raw.lastSessionId === 'string' ? raw.lastSessionId : null, sessions }
  }
  // 老版本只存了一份全局设置：留作新建会话的继承值。
  const legacy = await readJson(LEGACY_FILE)
  const state = emptyState()
  if (legacy) state.inherit = normalize(migrateSettings(legacy))
  return state
}

/** 0.1.x 把素材目录叫 projectDir（那时是剪映工程目录）；升级时按新名字接过来。 */
function migrateSettings(settings) {
  if (!settings || typeof settings !== 'object') return {}
  const { projectDir, ...rest } = settings
  return { ...rest, dramaDir: rest.dramaDir || projectDir || '' }
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
  const value = { ...DEFAULTS }
  for (const field of Object.keys(DEFAULTS)) if (Object.hasOwn(patch, field)) value[field] = patch[field]
  assert(value.mode === 'mix' || value.mode === 'slice', '剪辑模式必须是混剪或切片')
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
  if (!settings.dramaDir) return '请选择短剧目录'
  if (!settings.exportDir) return '请选择成片保存目录'
  if (!settings.direction) return '请填写切片方向'
  return null
}

function setConfiguration(entry, patch, lock = false) {
  const next = normalize({ ...entry.settings, ...patch })
  assert(!entry.configLocked || Object.keys(DEFAULTS).every(key => next[key] === entry.settings[key]), '配置已锁定，更换模式、素材或方向请新建会话')
  if (entry.settings.dramaDir && next.dramaDir !== entry.settings.dramaDir && !Object.hasOwn(patch, 'subtitleDir')) next.subtitleDir = ''
  const invalid = validate(next, lock)
  if (invalid) throw new Error(invalid)
  if (next.mode !== entry.settings.mode) entry.advanced = null // Keep any saved plans on disk, but stop advancing them in a different mode.
  entry.settings = next
  if (lock) entry.configLocked = true
}

// The tool boundary checks the same lock before any selection or media write.
export function prepareCutSettings(sessionId, settings, lock = true) {
  return serialize(async () => {
    assert(typeof sessionId === 'string' && sessionId, '剪辑须绑定当前会话')
    const invalid = validate(settings, true)
    if (invalid) throw new Error(invalid)
    const state = await loadState()
    const entry = state.sessions[sessionId] ?? await adoptSession(state, sessionId)
    setConfiguration(entry, settings, lock)
    entry.title = autoTitle(entry)
    entry.updatedAt = Date.now()
    await saveState(state)
    return entry
  })
}

// Persist engine task identity across turns and Host reloads.
export function rememberAdvanced(sessionId, pending) {
  return serialize(async () => {
    const state = await loadState()
    const entry = state.sessions[sessionId]
    assert(entry, '剪辑会话已移除；保留已写文件，不再推进该任务')
    entry.advanced = pending
    if (!pending || pending.status === 'plan_only') entry.task = null
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
    mode: entry.settings.mode,
    scriptPath: entry.settings.scriptPath,
    dramaDir: entry.settings.dramaDir,
    subtitleDir: entry.settings.subtitleDir,
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
    // A retry is not a new version and must not change a later version selection.
    const prior = result.workDir && entry.results?.find(item => item.workDir === result.workDir)
    if (prior) return prior
    if (result.workDir) {
      assert(entry.advanced?.workDir === result.workDir, '当前剪辑任务已切换，保留已生成文件')
      entry.advanced = { ...entry.advanced, status: 'complete', outputPath: result.outFile, planFile: result.planFile ?? entry.advanced.planFile }
    }
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
      ...(entry.settings.mode === 'slice' ? { sourceDuration: result.sourceDuration, draftRoot: result.draftRoot ?? null } : {}),
      duration: result.duration,
      ...(result.workDir ? { workDir: result.workDir, planFile: result.planFile, planHash: result.planHash, episodes: result.episodes, montageCount: result.montageCount } : {}),
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

function dialogueLocation(settings) {
  const locate = settings.subtitleDir ? '字幕优先，缺失、无效或未匹配到完整台词时自动用语音识别，不询问用户' : '先用语音识别定位台词'
  return `${locate}；再在命中时间附近抽帧核验动作`
}

export async function editingContext(sessionId) {
  const entry = await editingSession(sessionId)
  if (!entry) return ''
  return [
    '自动剪辑工作台：这是持续剪辑会话，每次交付都是独立版本。没有明确制作或修改要求时只回答，不自动导出。',
    entry.configLocked ? '剪辑模式、素材路径、成片目录及基础方向已锁定。要更换它们请新建会话。' : '制作前会固定本次剪辑模式、素材和基础方向。',
    ...(entry.settings.mode === 'slice' ? [
      '当前模式是切片：从同一集裁一段连续原片，保留原声，不做快切、配乐或固定片尾。按剧本和语音识别定位，或者在用户明确给出集号和原片开始/结束秒数时按时间裁切。',
      '收到制作要求后调用 duanju_slice_cut（mode: slice），直接交付 MP4，检测到剪映草稿箱时也交付草稿。不调用混剪的 duanju_slice_plan 或 duanju_slice_advanced，不生成 Word。宿主要求的确认或回复照常处理。',
      '调整当前选中切片的起止位置用 duanju_slice_revise，start/end 是相对该版起点的秒数；保留旧版。',
    ] : [
      '剪辑结构：铺垫 → 5–10 秒静音原片、单曲真实拍点快切 → 同故事线完整原声高潮 → 固定片尾；含片尾不超过 50 秒，BGM 固定 −12 dB。',
      `收到制作要求后用 duanju_slice_cut 启动或恢复。同一轮读 duanju_slice_advanced 的 guide 和剧本索引，提交内部 proposal 后直接 locate：${dialogueLocation(entry.settings)}。不生成 Word，不等待方案审批。宿主要求的确认或回复照常处理。`,
      '按可用素材、时长和原曲拍点调整取材，校验后交付 plan.json、MP4 和独立剪映草稿。仅请求出方案时用 duanju_slice_plan，只交 plan.json，不定位或剪辑。',
      '修改已交付版本用 duanju_slice_revise 直接开始剪新版本，不截断完整原声或固定片尾。',
    ]),
    '切换历史用 duanju_slice_versions，后续修订基于当前选中版本。',
    JSON.stringify({ settings: entry.settings, configLocked: entry.configLocked, advanced: entry.advanced, current: entry.lastResult, versions: (entry.results ?? []).slice(-8).map(({ version, episode, start, end, note }) => ({ version, episode, start, end, note })) }),
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
    try { await wake(ctx, exec, entry, args.text) }
    catch (error) {
      entry.task = { ...entry.task, stage: 'error', error: error.message, updatedAt: Date.now() }
      await saveState(state)
      throw error
    }
    return { accepted: true, session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view) }
  }
  return { session: view(entry), settings: entry.settings, sessionId, sessions: sorted(state).map(view), lastSessionId: state.lastSessionId }
}

function wake(ctx, exec, entry, text) {
  const custom = typeof text === 'string' ? text.trim() : ''
  const stock = /^(?:请按这些设置调用 duanju_slice_cut，|Call duanju_slice_cut to make a new version)/.test(custom)
  const body = [
    '请立即用以下设置调用 duanju_slice_cut 启动或继续剪辑：',
    JSON.stringify(entry.settings),
    custom && !stock ? `本次附加制作要求：${custom}` : '',
    entry.settings.mode === 'slice'
      ? '按单集连续切片模式直接交付 MP4 和可用的剪映草稿。保留原声和源片顺序；不加快切、配乐或片尾，不调用混剪工具。宿主要求的确认或回复照常处理。保留已有版本，本次只制作一条。'
      : `依 duanju_slice_advanced 的 guide 读剧本、提交内部 proposal，然后同一轮直接 locate（${dialogueLocation(entry.settings)}）、选曲卡点、渲染并导入剪映草稿。交付 plan.json、MP4 和剪映草稿，不生成 Word，不等待方案审批。宿主要求的确认或回复照常处理。中断任务从当前阶段恢复；保留已有版本，本次只制作一条。`,
  ].filter(Boolean).join('\n')
  return sendWorkbenchPrompt(ctx, exec, body)
}

export function sendWorkbenchPrompt(ctx, exec, text, id = randomUUID()) {
  const live = exec?.agent
  const agent = typeof live?.followup === 'function' ? live : ctx.get?.('agents')?.get?.(live?.id)
  assert(agent && typeof agent.followup === 'function', '当前会话无法接收工作台指令')
  return agent.followup({
    id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:duanju-slice' },
  })
}
