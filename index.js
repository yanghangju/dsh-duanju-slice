// 短剧切片工作台：Promo 混剪和单集连续切片。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editingSession, installEditingContext, normalize, perform, prepareCutSettings, recordProgress, recordResult, rememberAdvanced, sendWorkbenchPrompt } from './lib/studio.js'
import { asrApiKeyStatus, resolveAsrApiKey, saveAsrApiKey } from './lib/asr-credentials.js'
import { cutContiguous, reviseContiguous } from './lib/contiguous.js'
import { formatSurvey, survey } from './lib/report.js'
import { advanced, ADVANCED_DESCRIPTION, ADVANCED_PARAMETERS, prepareAdvanced } from './lib/promo/advanced.js'
import { findFfprobe } from './lib/promo/media.js'
import { configuredRuntime, runtimeOptions } from './lib/promo/runtime-setup.js'
import { consumeRuntimeReceipt, createRuntimeRequest, discardRuntimeRequest } from './lib/promo/runtime-request.js'

const PLUGIN_VERSION = '0.3.5'
export const version = PLUGIN_VERSION
export const inject = ['tools', 'agents', 'sessions', 'skills']

/** 工具输出必须是可无损提交给宿主的 JSON。 */
export function jsonSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== 'function').map(([key, item]) => [key, jsonSafe(item)]))
  return null
}

function output(description) {
  return { schema: { type: 'object', additionalProperties: true, description }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(jsonSafe(value), null, 2) }] }
}

const DRAMA_DIR = { type: 'string', description: '短剧素材目录；每集可以是单个视频或按文件名顺序衔接的分集子目录' }
const SCRIPT_PATH = { type: 'string', description: '含分集台词的原始 DOCX' }
const ADV = ADVANCED_PARAMETERS.properties
const MIX_PARAMETERS = {
  type: 'object', properties: {
    dramaDir: DRAMA_DIR, scriptPath: SCRIPT_PATH, subtitleDir: ADV.subtitleDir,
    direction: { type: 'string', description: '剧情方向，例如「复仇：当众揭穿谎言」' },
    exportDir: { type: 'string', description: '成片和 plan.json 的父目录；每版单独建任务目录' },
    draftRoot: { type: 'string', description: '可选：剪映草稿箱绝对路径，默认自动探测' },
    musicDir: ADV.musicDir, endingTransitionSeconds: ADV.endingTransitionSeconds,
    episode: { type: 'integer', minimum: 1, description: '可选：优先围绕这一集取材，不限制为单集' },
    replacePending: { type: 'boolean', description: '仅用户明确要求重开未完成的任务时为 true；保留已写文件' },
  }, required: ['dramaDir', 'scriptPath', 'direction', 'exportDir'], additionalProperties: false,
}
const CUT_PARAMETERS = {
  ...MIX_PARAMETERS,
  properties: {
    ...MIX_PARAMETERS.properties,
    mode: { type: 'string', enum: ['mix', 'slice'], description: 'mix 混剪；slice 单集连续切片。省略时沿用会话模式，无会话设置时默认混剪。' },
    exportDir: { type: 'string', description: '成片保存目录：切片直接保存 MP4，混剪每版单独建任务目录' },
    episode: { ...MIX_PARAMETERS.properties.episode, description: '混剪优先使用的集号；切片仅在指定 lines 或 start/end 时填写' },
    lines: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1 }, description: '仅切片：该集剧本台词的起、止行号（从 1 起算）' },
    start: { type: 'number', minimum: 0, description: '仅切片：该集原片开始秒数，与 end 一起指定' },
    end: { type: 'number', minimum: 0, description: '仅切片：该集原片结束秒数，与 start 一起指定' },
  },
}
const ADVANCED_ACTIONS = ADV.action.enum.filter(action => action !== 'prepare')
// The previous Word-pending status still means an existing MP4 can be recovered without re-rendering.
const PENDING_VIDEO = ['video_complete_word_pending', 'video_complete_draft_pending']
const WIP = { locate: 'asr', select_music: 'pick', beats: 'pick', mute: 'pick', save_plan: 'pick', sync: 'pick', validate: 'pick', render: 'render', export: 'draft' }
const RUNTIME_SKILL = 'duanju-slice-runtime'
const RUNTIME_SKILL_DIR = new URL(`./skills/${RUNTIME_SKILL}/`, import.meta.url)

export function apply(ctx, config = {}) {
  const baseOptions = { ...config, jianying: { ...config.jianying, draftRoot: config.jianying?.draftRoot || config.draftRoot || undefined } }
  if (!baseOptions.ffmpegPath) delete baseOptions.ffmpegPath
  const options = () => runtimeOptions(baseOptions)
  const credentials = () => ctx.get?.('credentials')
  const getAsrApiKey = () => resolveAsrApiKey(credentials(), baseOptions)
  const asrConfigured = () => asrApiKeyStatus(credentials(), baseOptions)
  const setupRequests = new WeakMap()
  const running = new Set()
  async function inSession(exec, fn) {
    const id = exec?.agent?.id
    assert(id && !running.has(id), id ? '本会话正在处理剪辑，请等待当前操作返回' : '请在同一剪辑会话中启动和继续任务')
    running.add(id)
    try { return jsonSafe(await fn(id)) } finally { running.delete(id) }
  }

  async function finishSlice(id, exec, entry, operation, input) {
    const output = await operation({
      ...input, ctx, config: { ...options(), getAsrApiKey }, signal: exec.signal,
      version: (entry.results?.length ?? 0) + 1,
      onProgress: stage => recordProgress(ctx, id, stage),
    })
    const result = await recordResult(ctx, id, output.result)
    return { ...output, status: 'complete', result }
  }

  async function start(id, args, exec, { planOnly = false, revision } = {}) {
    try {
      const session = await editingSession(id)
      const mode = args.mode ?? session?.settings?.mode ?? 'mix'
      assert(!planOnly || mode === 'mix', '只出方案仅用于混剪；切片请使用 duanju_slice_cut')
      assert(mode === 'slice' || (args.verify !== false && args.lines == null && args.start == null && args.end == null), '混剪不支持跳过核验或按单集行号或时间裁切；请描述剧情方向')
      const exportDir = args.exportDir ?? (session?.settings?.exportDir || config.workDir || join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice', 'tasks'))
      const patch = normalize({ dramaDir: args.dramaDir, scriptPath: args.scriptPath, subtitleDir: args.subtitleDir ?? '', direction: args.direction, exportDir, mode })
      if (args.subtitleDir === undefined) delete patch.subtitleDir
      const locked = await prepareCutSettings(id, patch, !planOnly)
      const { settings, advanced: pending } = locked
      if (mode === 'slice') return await finishSlice(id, exec, locked, cutContiguous, { args: { ...args, ...settings } })
      if (pending && pending.status !== 'complete' && !pending.planOnly && !args.replacePending) {
        assert(!planOnly, '当前会话已有正式剪辑任务；仅出方案不会替换该任务')
        const status = pending.status === 'awaiting_confirmation' ? 'editing' : pending.status
        if (status !== pending.status) await rememberAdvanced(id, { ...pending, status })
        if (!PENDING_VIDEO.includes(status) && (status !== pending.status || !locked.task || ['done', 'error'].includes(locked.task.stage))) await recordProgress(ctx, id, 'pick')
        return { ...pending, status, summary: `本会话已有任务（${status}）。继续用 duanju_slice_advanced，不重复创建。${status === 'awaiting_proposal' ? '先读 indexFile，提交内部 proposal 后直接 locate。' : PENDING_VIDEO.includes(status) ? '成片已就绪，用 export 补做剪映草稿导入。' : '直接从当前阶段继续；已通过的对白证据会自动复用，只有缺项或新增台词才重新定位。'}` }
      }
      if (!planOnly) await recordProgress(ctx, id, 'survey')
      const prepared = await prepareAdvanced(ctx, exec, { ...args, ...settings, workDir: settings.exportDir, planOnly, baseMontageCount: revision?.baseMontageCount }, options())
      const intent = { direction: settings.direction, preferredEpisode: args.episode, ...revision }
      await rememberAdvanced(id, { ...prepared, planOnly, intent })
      if (!planOnly) await recordProgress(ctx, id, 'pick')
      return { ...prepared, planOnly, intent, summary: `${prepared.summary}\n读取 duanju_slice_advanced(action:guide,topic:operations) 和 indexFile，按剧情方向提交 proposal。${planOnly ? '交付返回的 plan.json 后结束，不剪辑。' : 'proposal 仅记录内部取材目标；同一轮直接 locate（字幕优先，缺失或未匹配自动用语音识别，不询问用户；只对白抽帧核验动作，已通过段不重查），然后按 guide 卡点并保存 plan.json，先 render 出 MP4 并回报路径，再按需 export 导入草稿。'}` }
    } catch (error) {
      if (!planOnly) await recordProgress(ctx, id, 'error', error.message)
      throw error
    }
  }

  async function advance(id, args, exec) {
    const entry = await editingSession(id)
    const pending = entry?.advanced
    assert(pending, '本会话没有高级任务，请从工作台生成或先调用 duanju_slice_cut / duanju_slice_plan')
    assert(!args.workDir || resolve(args.workDir) === pending.workDir, '不能操作其他会话或已切换的任务目录')
    if (args.action === 'status') return pending
    // Export recovery goes through the same finalization path; this can never start a missing render.
    if (args.action === 'export') assert(PENDING_VIDEO.includes(pending.status) || pending.status === 'complete', '请先 render 生成成片，再补做草稿登记')
    const action = args.action === 'export' ? 'render' : args.action
    const data = args.action === 'export' ? { ...args.data, jianying: true } : args.data
    if (action === 'render' && pending.status === 'complete') return { ...pending, result: entry.results.find(row => row.workDir === pending.workDir), summary: '这版成片和草稿已交付，不重新渲染或切换选中的版本。' }
    try {
      const progress = WIP[args.action]
      if (progress && !pending.planOnly) await recordProgress(ctx, id, progress)
      const runtime = options()
      const result = await advanced(ctx, exec, { action, workDir: pending.workDir, data }, action === 'locate' ? { ...runtime, getAsrApiKey } : runtime)
      if (action === 'render' && result.status === 'complete') {
        const clips = result.clips
        const opening = clips[0]
        const record = await recordResult(ctx, id, {
          episode: opening.episode, start: opening.source.start, end: opening.source.end,
          outFile: result.outputPath, draftDir: result.jianying.draftDir, draftName: result.jianying.draftName ?? basename(result.jianying.draftDir),
          workDir: pending.workDir, planFile: result.planFile, planHash: result.planHash,
          sourceDir: entry.settings.dramaDir, duration: result.duration, episodes: [...new Set(clips.map(row => row.episode))],
          montageCount: result.montageCount, audioLevels: { dialogue: 1, music: result.bgm.gain, effects: 1 }, note: pending.intent?.note ?? pending.intent?.direction ?? '',
        })
        return { ...result, result: record }
      }
      if (args.action === 'proposal' || progress) {
        const status = result.status === 'plan_only' || PENDING_VIDEO.includes(result.status) ? result.status : 'editing'
        await rememberAdvanced(id, { ...pending, status, planFile: result.planFile ?? pending.planFile, outputPath: result.outputPath ?? pending.outputPath })
        if (PENDING_VIDEO.includes(status) && result.jianying?.error) await recordProgress(ctx, id, 'error', result.summary)
      }
      return result
    } catch (error) {
      if (!pending.planOnly) await recordProgress(ctx, id, 'error', error.message)
      throw error
    }
  }

  return ctx.effect(() => {
    const registered = [installEditingContext(ctx)]
    registered.push(ctx.skills.register({
      name: RUNTIME_SKILL,
      description: '在切片工作台发来环境配置请求时，检查、补齐并验证 Python、FFmpeg、FFprobe 和默认曲库。',
      source: 'runtime',
      content: readFileSync(new URL('SKILL.md', RUNTIME_SKILL_DIR), 'utf8'),
      resourceBase: { kind: 'directory', path: fileURLToPath(RUNTIME_SKILL_DIR) },
      invocation: { modelInvocable: true, userInvocable: false },
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_survey', description: '只读勘察短剧素材、时长、音轨与剧本分集配对。',
      parameters: { type: 'object', properties: { dramaDir: DRAMA_DIR, scriptPath: SCRIPT_PATH }, required: ['dramaDir'] },
      output: output('素材勘察清单'),
      async execute(args, exec) {
        const report = await survey({ dramaDir: args.dramaDir, scriptDocx: args.scriptPath, ffprobe: findFfprobe(options()), signal: exec?.signal })
        return jsonSafe({ summary: formatSurvey(report), report })
      },
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_cut', description: '按会话模式开始剪辑。切片（slice）从同一集直接裁一段原声连续片段，交付 MP4 和可用的剪映草稿。混剪（mix）优先用分集字幕定位，字幕不可用或未匹配完整台词时自动使用现有语音识别，不停下来询问用户，只对白抽帧核验动作且已通过段不重查。混剪保存并按 plan.json 剪辑，先交付 MP4，再按需导出可编辑剪映草稿；两种模式都不生成 Word。',
      parameters: CUT_PARAMETERS, output: output('连续切片成片或混剪任务及执行步骤'),
      execute: (args, exec) => inSession(exec, id => start(id, args, exec)),
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_plan', description: '只规划「铺垫—快切—原声高潮—固定片尾」，提交 plan.json。不会定位、抽帧或导出成片。',
      parameters: { ...MIX_PARAMETERS, required: ['dramaDir', 'scriptPath', 'direction'] }, output: output('混剪方案任务和原稿索引'),
      execute: (args, exec) => inSession(exec, id => start(id, args, exec, { planOnly: true })),
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_advanced', description: ADVANCED_DESCRIPTION, output: output('高级剪辑分阶段结果'),
      parameters: { type: 'object', properties: { action: { ...ADV.action, enum: ['status', ...ADVANCED_ACTIONS] }, topic: ADV.topic, workDir: { ...ADV.workDir, description: '可省略；如填，必须是本会话工具返回的当前任务路径' }, data: ADV.data }, required: ['action'], additionalProperties: false },
      execute: (args, exec) => args.action === 'guide' ? advanced(ctx, exec, args, baseOptions) : inSession(exec, id => advance(id, args, exec)),
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_revise', description: '修订当前选中的版本，保留旧版。切片在同一集按相对该版起点的秒数重新裁切；混剪按剧情、节奏或取景重做 plan.json，不截断完整台词、不改原声或固定片尾音量，BGM 固定 −5 dB。',
      parameters: { type: 'object', properties: {
        note: { type: 'string', description: '这次修订的目标' },
        start: { type: 'number', description: '切片：相对该版起点的开始秒数，可为负；混剪：开头期望时间，只作为目标' },
        end: { type: 'number', description: '切片：相对该版起点的结束秒数；混剪：结尾期望时间，只作为目标' },
        dialogueGain: { type: 'number', description: '高级方案须保留完整原声，只接受 1' },
        effectsGain: { type: 'number', description: '固定片尾音效须保留原音量，只接受 1' },
      }, additionalProperties: false }, output: output('新版本任务和直接执行步骤'),
      execute: (args, exec) => inSession(exec, async id => {
        const entry = await editingSession(id)
        const current = entry?.lastResult
        assert(current, '当前会话还没有成片，请先生成初版')
        assert(args.dialogueGain == null || args.dialogueGain === 1, '须保留原声，不能修改对白增益')
        assert(args.effectsGain == null || args.effectsGain === 1, '固定片尾须保留全长和原音量，不能修改片尾增益')
        const settings = { subtitleDir: '', ...(current.settings ?? entry.settings) }
        if (settings.mode === 'slice') {
          try { return await finishSlice(id, exec, entry, reviseContiguous, { current: { ...current, settings }, args }) }
          catch (error) {
            await recordProgress(ctx, id, 'error', error.message)
            throw error
          }
        }
        assert(args.note?.trim() || [args.start, args.end].some(Number.isFinite), '请说明这次要调整的剧情、节奏或取景')
        const revision = { baseVersion: current.version, basePlanFile: current.planFile, baseMontageCount: current.montageCount, note: args.note, desiredStart: args.start, desiredEnd: args.end }
        return start(id, settings, exec, { revision })
      }),
    }))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_versions', description: '查看当前会话版本；也可切换选中的版本。不会更改已有文件。',
      parameters: { type: 'object', properties: { version: { type: 'integer', minimum: 1 } }, additionalProperties: false }, output: output('当前选中版本及历史'),
      async execute(args, exec) {
        if (args.version != null) await perform(ctx, { action: 'select-result', version: args.version }, exec)
        const entry = await editingSession(exec?.agent?.id)
        assert(entry, '当前会话尚未打开切片工作台')
        return jsonSafe({ current: entry.lastResult, versions: entry.results })
      },
    }))
    const commands = ctx.get?.('commands')
    if (commands) registered.push(commands.register({
      name: 'duanju-slice-store-asr-key', description: '仅供切片工作台设置弹窗使用；请勿在对话中输入密钥。', recordInput: false,
      async handler({ rawInput, signal }) {
        try {
          signal?.throwIfAborted()
          await saveAsrApiKey(credentials(), rawInput)
          return { kind: 'success' }
        } catch {
          // Command results are persisted even when input is not recorded.
          return { kind: 'error', text: '保存语音识别 API Key 失败，请检查输入或稍后重试。' }
        }
      },
    }), commands.register({
      name: 'duanju-slice', description: '切片工作台：本机运行环境、会话设置和对话制作入口', recordInput: true,
      input: { hint: 'JSON: action=runtime-status/runtime-prompt/asr-status/list/create/open/save/lock/rename/remove/browse/generate/select-result/open-jianying', attachments: false },
      async handler(invocation) {
        try {
          const args = JSON.parse(invocation.rawInput || '{"action":"list"}')
          const exec = { agent: invocation.agent, signal: invocation.signal }
          let result
          if (args?.action === 'runtime-status') {
            const request = args.setup === true && setupRequests.get(exec.agent?.session)
            const ready = !!configuredRuntime()
            if (ready && request && !request.ready && await consumeRuntimeReceipt(request.id)) request.ready = true
            result = { ready: ready && (!request || request.ready) }
          } else if (args?.action === 'asr-status') {
            result = { configured: await asrConfigured() }
          } else if (args?.action === 'runtime-prompt') {
            const session = exec.agent?.session
            assert(session, '环境配置需要一条可用对话')
            if (!await asrConfigured()) {
              result = { accepted: false, needsAsrKey: true }
            } else {
              const request = { id: await createRuntimeRequest(baseOptions, invocation.signal), ready: false }
              setupRequests.set(session, request)
              const prompt = `请加载 ${RUNTIME_SKILL} Skill，按它的步骤配置切片工作台运行环境。\n配置请求 ID：${request.id}\n如果我在这条对话中请你继续配置或重试，请按同一 Skill 用这个请求 ID 继续，不要让我另开对话。配置成功后，请我在切片工作台点击「新建会话」开始剪辑。`
              try { await sendWorkbenchPrompt(ctx, exec, prompt, request.id) }
              catch (error) {
                if (setupRequests.get(session) === request) setupRequests.delete(session)
                await discardRuntimeRequest(request.id).catch(() => {})
                throw error
              }
              result = { accepted: true }
            }
          } else result = await perform(ctx, args, exec)
          return { kind: 'success', text: JSON.stringify(result) }
        } catch (error) { return { kind: 'error', text: error.message } }
      },
    }))
    return async () => { for (const dispose of registered.reverse()) dispose() }
  })
}
