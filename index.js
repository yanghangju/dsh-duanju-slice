// 短剧切片工作台（dsh-duanju-slice）
// 勘察短剧目录 → 按方向选段 → 火山语音识别取台词时间码 → 可编辑草稿 → 成片 MP4；另带工作台界面命令。
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { editingSession, installEditingContext, normalize, perform, prepareCutSettings, recordProgress, recordResult } from './lib/studio.js'
import { revisionEdit, revisionEpisode } from './lib/revision.js'
import { ffmpegPath, ffprobePath } from './lib/frames.js'
import { formatPlan, planSlice } from './lib/plan.js'
import { renderSlice } from './lib/render.js'
import { formatSurvey, survey } from './lib/report.js'
import { buildSliceDraft } from './lib/slice-draft.js'
import { findDraftRoot, safeName } from './lib/draft-root.js'

const PLUGIN_VERSION = '0.2.3'

const DEFAULTS = {
  ffmpegPath: '',
  workDir: '',
  draftRoot: '',
  exportDir: '',
  // 火山引擎（豆包语音）流式语音识别：台词定位用它，配置优先，其次环境变量 VOLCENGINE_API_KEY。
  volcApiKey: '',
  volcResourceId: 'volc.bigasr.sauc.duration',
  volcEndpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  volcPaceMs: 40,
  ending: {},
}

function settings(config) {
  return { ...DEFAULTS, ...(config ?? {}) }
}

function pluginRoot(config) {
  return settings(config).workDir || join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice')
}

function workRoot(config) {
  return join(pluginRoot(config), 'tasks')
}

/** 语音识别缓存：同一素材重复选段不再花识别费。 */
function cacheRoot(config) {
  return join(pluginRoot(config), 'cache')
}

/**
 * 工具返回值必须是 lossless JSON：undefined / NaN / Infinity 会让宿主直接拒绝整个结果，
 * 用户在界面上看到的就是「tool ... returned invalid output」。
 */
export function jsonSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(jsonSafe).map((item) => (item === undefined ? null : item))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === 'function') continue
      out[key] = jsonSafe(item)
    }
    return out
  }
  return null
}

function text(value) {
  return { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(jsonSafe(value), null, 2) }
}

function output(summary) {
  return { schema: { type: 'object', additionalProperties: true, description: summary }, render: (_args, value) => [text(value)] }
}

const DRAMA_DIR = { type: 'string', description: '短剧素材目录：一部剧一个文件夹（如 D:\\海外短剧\\艾米莉的混乱房车），每集可以是一个视频文件，也可以是装着视频的文件夹' }
const SCRIPT_PATH = { type: 'string', description: '剧本 DOCX 路径（含「第X集」分段的中英对照台词）' }
const DIRECTION = { type: 'string', description: '内容方向，自由文本，如「复仇向：当众揭穿继母」「萌宝向：孩子认亲」' }
const EPISODE = { type: 'number', description: '可选：手动指定集号（默认由 AI 按方向选）' }
const LINES = { type: 'array', items: { type: 'number' }, description: '可选：手动指定剧本行号区间，如 [3, 8]（需同时给 episode）' }
const VERIFY = { type: 'boolean', description: '是否抽首尾帧核验，默认 true' }

const SURVEY_PARAMETERS = {
  type: 'object',
  properties: { dramaDir: DRAMA_DIR, scriptPath: { ...SCRIPT_PATH, description: '可选：剧本 DOCX 路径，用于核对剧本↔素材配对' } },
  required: ['dramaDir'],
}

const PLAN_PARAMETERS = {
  type: 'object',
  properties: {
    dramaDir: DRAMA_DIR,
    scriptPath: SCRIPT_PATH,
    direction: DIRECTION,
    provider: { type: 'string', description: '可选：指定模型 provider' },
    model: { type: 'string', description: '可选：指定模型 model' },
    verify: VERIFY,
    episode: EPISODE,
    lines: LINES,
  },
  required: ['dramaDir', 'scriptPath', 'direction'],
}

const CUT_PARAMETERS = {
  type: 'object',
  properties: {
    dramaDir: DRAMA_DIR,
    scriptPath: SCRIPT_PATH,
    direction: DIRECTION,
    exportDir: { type: 'string', description: '成片 MP4 的保存目录' },
    episode: EPISODE,
    lines: LINES,
    draftRoot: { type: 'string', description: '可选：剪映草稿箱目录，默认自动探测' },
    verify: VERIFY,
  },
  required: ['dramaDir', 'scriptPath', 'direction', 'exportDir'],
}

function stampName() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

async function deliver(ctx, config, exec, input) {
  const options = settings(config)
  const draftRoot = await findDraftRoot(input.draftRoot || options.draftRoot)
  if (!draftRoot) throw new Error('没找到剪映草稿箱目录，请指定 draftRoot')
  if (!input.settings.exportDir) throw new Error('请指定成片保存目录 exportDir')
  await mkdir(input.settings.exportDir, { recursive: true })
  const entry = await editingSession(exec?.agent?.id)
  const version = (entry?.results?.length ?? 0) + 1
  // 剪映会按自己的长度上限改写超长草稿名；名字一变，草稿里写死的绝对素材路径就全断（媒体丢失）。所以名字保持短。
  const stem = safeName(`${basename(input.settings.scriptPath, '.docx')}_第${input.episode}集`, 20)
  const name = `${stem}_v${version}_${randomUUID().slice(0, 6)}`
  await recordProgress(ctx, exec?.agent?.id, 'draft')
  const draft = await buildSliceDraft({
    episode: input.episodeSource,
    cut: input.cut,
    draftRoot,
    name,
    audioLevels: input.audioLevels,
    ffmpeg: ffmpegPath(options.ffmpegPath),
    ending: options.ending ?? {},
  })
  await recordProgress(ctx, exec?.agent?.id, 'render')
  const video = await renderSlice({
    episodeDir: draft.draftDir,
    cut: { start: 0, end: draft.contentDuration ?? draft.duration },
    outFile: join(input.settings.exportDir, `${name}.mp4`),
    ffmpeg: ffmpegPath(options.ffmpegPath),
    ffprobe: ffprobePath(ffmpegPath(options.ffmpegPath)),
    ending: options.ending ?? {},
    signal: exec?.signal,
  })
  const result = await recordResult(ctx, exec?.agent?.id, {
    episode: input.episode,
    ...input.cut,
    draftName: name,
    draftDir: draft.draftDir,
    outFile: video.outFile,
    sourceDir: input.episodeSource?.dir,
    sourceFiles: input.episodeSource?.parts?.map((part) => part.path),
    audioLevels: input.audioLevels,
    note: input.note,
    settings: input.settings,
  })
  const summary = [
    `第 ${input.episode} 集 · V${result?.version ?? version} · ${video.duration}s`,
    `素材时间码：${input.cut.start.toFixed(2)}s–${input.cut.end.toFixed(2)}s`,
    video.ending
      ? `片尾：时停定格（剧情结束前 ${video.ending.freezeOffsetSeconds}s 的那一帧）+ 原生「炫光」${video.ending.transitionSeconds}s + 「${video.ending.title}」完整 ${video.ending.soundSeconds}s；剧情 ${video.contentDuration}s，成片 ${video.duration}s`
      : '片尾：已关闭（只输出剧情段）',
    draft.ending
      ? `剪映草稿：${draft.draftDir}\n  · 草稿里也接了同款片尾（时停定格 + 原生「炫光」${draft.ending.transitionSeconds}s + 「${draft.ending.title}」${draft.ending.soundSeconds}s），草稿总长 ${draft.duration}s，剪映直接导出应与成片一致`
      : `剪映草稿：${draft.draftDir}`,
    video.warnings?.length ? `警告：${video.warnings.join('；')}` : '',
    `成片：${video.outFile}`,
    '已有版本已保留，可以在同一会话继续修改或切回旧版。新草稿需重启剪映后出现在草稿箱。',
  ].filter(Boolean).join('\n')
  return { summary, result, draft, video }
}

export const inject = ['tools', 'agents']

export function apply(ctx, config = {}) {
  const registered = []
  const options = settings(config)
  const ffprobe = ffprobePath(ffmpegPath(options.ffmpegPath))
  return ctx.effect(() => {
    registered.push(installEditingContext(ctx))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_survey',
      description: '短剧切片工作台：只读勘察一部短剧的素材目录，列出每集时长、画面、段数、是否有音轨，并可与剧本 DOCX 分集配对。每集可以是一个视频文件，也可以是装着视频的文件夹（多个视频按文件名顺序拼成这一集）。',
      parameters: SURVEY_PARAMETERS,
      output: output('素材勘察清单（markdown 表格）'),
      async execute(args) {
        const report = await survey({ dramaDir: args.dramaDir, scriptDocx: args.scriptPath, ffprobe })
        return jsonSafe({ summary: formatSurvey(report), report })
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_plan',
      description: '短剧切片工作台：按内容方向在剧本里选一段连续台词，再用火山引擎（豆包语音）流式语音识别拿到这一集台词的真实时间码，给出切点并抽首尾帧核验。只读，不写草稿和成片。',
      parameters: PLAN_PARAMETERS,
      output: output('切片方案（集号、时间码、选中台词、首尾帧）'),
      async execute(args, exec) {
        const framesDir = join(workRoot(config), `${stampName()}-${randomUUID().slice(0, 8)}`, 'frames')
        await mkdir(framesDir, { recursive: true })
        const plan = await planSlice({
          dramaDir: args.dramaDir,
          scriptDocx: args.scriptPath,
          direction: args.direction,
          ctx,
          provider: args.provider,
          model: args.model,
          signal: exec?.signal,
          framesDir,
          verification: args.verify !== false,
          ffmpeg: options.ffmpegPath,
          ffprobe,
          cacheDir: cacheRoot(config),
          config,
          manualPick: args.episode ? { episode: args.episode, lineIds: args.lines } : undefined,
        })
        const { source, ...planView } = plan
        return jsonSafe({ summary: formatPlan(planView), plan: planView, framesDir })
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_cut',
      description: '按内容方向重新选段，生成同一会话的一个新版本（剪映草稿和MP4），保留旧版。成片末尾默认接剪映原生片尾（时停定格 + 炫光转场 + 大气片尾声效）。仅在用户要求制作时调用；调整当前片段的时长或音量请用 duanju_slice_revise。',
      parameters: CUT_PARAMETERS,
      output: output('切片结果（集号、时间码、草稿目录、成片路径）'),
      async execute(args, exec) {
        try {
          const currentSettings = normalize({ dramaDir: args.dramaDir, scriptPath: args.scriptPath, direction: args.direction, exportDir: args.exportDir })
          await prepareCutSettings(exec?.agent?.id, currentSettings)
          await recordProgress(ctx, exec?.agent?.id, 'survey')
          const framesDir = join(workRoot(config), `${stampName()}-${randomUUID().slice(0, 8)}`, 'frames')
          await mkdir(framesDir, { recursive: true })

          const plan = await planSlice({
            dramaDir: args.dramaDir,
            scriptDocx: args.scriptPath,
            direction: args.direction,
            ctx,
            signal: exec?.signal,
            framesDir,
            verification: args.verify !== false,
            ffmpeg: options.ffmpegPath,
            ffprobe,
            cacheDir: cacheRoot(config),
            config,
            manualPick: args.episode ? { episode: args.episode, lineIds: args.lines } : undefined,
            onProgress: (stage, detail) => recordProgress(ctx, exec?.agent?.id, stage, detail ? JSON.stringify(detail) : null),
          })

          const delivered = await deliver(ctx, config, exec, {
            settings: currentSettings,
            episode: plan.episode,
            episodeSource: plan.source,
            cut: plan.cut,
            draftRoot: args.draftRoot,
            note: args.direction,
          })
          const { source, ...planView } = plan
          return jsonSafe({ ...delivered, plan: planView })
        } catch (error) {
          await recordProgress(ctx, exec?.agent?.id, 'error', error.message)
          throw error
        }
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_revise',
      description: '根据当前选中的剪辑版本修改首尾时间、对白/背景音乐/音效音量，生成新草稿和MP4，保留旧版。无需重新选段。省略的设置沿用当前版本；音量倍率相对原素材（当前倍率见会话状态，“再减半”需传当前倍率×0.5）。',
      parameters: { type: 'object', properties: {
        start: { type: 'number', description: '相对当前版本开头的起点秒数，默认0；可用负数向前扩展，不能超出原集' },
        end: { type: 'number', description: '相对当前版本开头的终点秒数，默认当前时长；例如保留前25秒传25' },
        dialogueGain: { type: 'number', minimum: 0, maximum: 4, description: '对白音量倍率，0静音，1原素材音量' },
        musicGain: { type: 'number', minimum: 0, maximum: 4, description: 'BGM音量倍率，0静音，0.5减半' },
        effectsGain: { type: 'number', minimum: 0, maximum: 4, description: '音效音量倍率' },
        note: { type: 'string', description: '本次修改的一句说明' },
      }, additionalProperties: false },
      output: output('新剪辑版本和保留的历史版本'),
      async execute(args, exec) {
        try {
          const entry = await editingSession(exec?.agent?.id)
          const episodeSource = await revisionEpisode(entry, { ffprobe })
          await recordProgress(ctx, exec?.agent?.id, 'survey')
          const edit = revisionEdit(entry.lastResult, args, episodeSource.duration)
          const delivered = await deliver(ctx, config, exec, {
            ...edit,
            settings: entry.settings,
            episode: entry.lastResult.episode,
            episodeSource,
            note: String(args.note || '对话修改').slice(0, 200),
          })
          return jsonSafe(delivered)
        } catch (error) {
          await recordProgress(ctx, exec?.agent?.id, 'error', error.message)
          throw error
        }
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_versions',
      description: '查看当前会话所有剪辑版本；传version可切回指定版本，后续修改以该版为起点。不生成文件，不删除版本。',
      parameters: { type: 'object', properties: { version: { type: 'integer', minimum: 1, description: '可选：要切回的版本号' } }, additionalProperties: false },
      output: output('当前选中版本及历史'),
      async execute(args, exec) {
        if (args.version != null) await perform(ctx, { action: 'select-result', version: args.version }, exec)
        const entry = await editingSession(exec?.agent?.id)
        if (!entry) throw new Error('当前会话尚未打开切片工作台')
        return jsonSafe({ current: entry.lastResult, versions: entry.results })
      },
    }))

    const commands = ctx.get?.('commands')
    if (commands) registered.push(commands.register({
      name: 'duanju-slice',
      description: '切片工作台：会话设置、剪辑版本和对话制作入口',
      recordInput: true,
      input: { hint: 'JSON: action=list/create/open/save/lock/rename/remove/browse/generate/select-result/open-jianying', attachments: false },
      async handler(invocation) {
        try {
          const args = JSON.parse(invocation.rawInput || '{"action":"get"}')
          const result = await perform(ctx, args, { agent: invocation.agent, signal: invocation.signal })
          return { kind: 'success', text: JSON.stringify(result) }
        } catch (error) {
          return { kind: 'error', text: error.message }
        }
      },
    }))

    return async () => {
      for (const dispose of registered.reverse()) dispose()
    }
  })
}

export const version = PLUGIN_VERSION
