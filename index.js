// 短剧切片工作台（dsh-duanju-slice）
// 勘察工程 → 按方向选段定位 → 可编辑草稿 → 成片 MP4；另带工作台界面命令。
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editingSession, installEditingContext, normalize, perform, prepareCutSettings, recordProgress, recordResult } from './lib/studio.js'
import { loadDraftJson, parseDraft } from './lib/draft.js'
import { revisionEdit, revisionSource } from './lib/revision.js'
import { ffmpegPath } from './lib/frames.js'
import { formatPlan, planSlice } from './lib/plan.js'
import { renderSlice } from './lib/render.js'
import { formatSurvey, survey } from './lib/report.js'
import { buildSliceDraft } from './lib/slice-draft.js'
import { findDraftRoot, safeName } from './lib/draft-root.js'

const PLUGIN_VERSION = '0.1.6'
const BUNDLED_FONT = fileURLToPath(new URL('./assets/fonts/TikTokSansDisplayDark-Bold.ttf', import.meta.url))

const DEFAULTS = { ffmpegPath: '', workDir: '', draftRoot: '', subtitleFont: BUNDLED_FONT, exportDir: '', ending: {} }

function settings(config) {
  return { ...DEFAULTS, ...(config ?? {}) }
}

function workRoot(config) {
  const base = settings(config).workDir || join(homedir(), '.dsh', 'plugins', 'dsh-duanju-slice', 'tasks')
  return base
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

const SURVEY_PARAMETERS = {
  type: 'object',
  properties: {
    projectDir: { type: 'string', description: '剪映工程目录：里面每集一个 EPxx 草稿文件夹' },
    scriptPath: { type: 'string', description: '可选：剧本 DOCX 路径，用于核对剧本↔工程配对' },
  },
  required: ['projectDir'],
}

const PLAN_PARAMETERS = {
  type: 'object',
  properties: {
    projectDir: { type: 'string', description: '剪映工程目录（每集一个 EPxx 草稿文件夹）' },
    scriptPath: { type: 'string', description: '剧本 DOCX 路径（含「第X集」分段的中英对照台词）' },
    direction: { type: 'string', description: '内容方向，自由文本，如「复仇向：当众揭穿继母」「萌宝向：孩子认亲」' },
    provider: { type: 'string', description: '可选：指定模型 provider' },
    model: { type: 'string', description: '可选：指定模型 model' },
    verify: { type: 'boolean', description: '是否抽首尾帧核验，默认 true' },
    drafts: { type: 'array', items: { type: 'string' }, description: '可选：明确指定只用哪些草稿文件夹（可只写文件夹名的一部分）；草稿箱混着多部剧时必须用它，否则插件不会猜' },
    drama: { type: 'string', description: '可选：剧名，用于匹配剪映本地草稿分组；默认取剧本标题' },
  },
  required: ['projectDir', 'scriptPath', 'direction'],
}

const CUT_PARAMETERS = {
  type: 'object',
  properties: {
    projectDir: { type: 'string', description: '剪映工程目录（每集一个 EPxx 草稿文件夹）' },
    scriptPath: { type: 'string', description: '剧本 DOCX 路径（含「第X集」分段的中英对照台词）' },
    direction: { type: 'string', description: '内容方向，自由文本，如「复仇向：当众揭穿继母」' },
    exportDir: { type: 'string', description: '成片 MP4 的保存目录' },
    episode: { type: 'number', description: '可选：手动指定集号（默认由 AI 按方向选）' },
    lines: { type: 'array', items: { type: 'number' }, description: '可选：手动指定剧本行号区间，如 [3, 8]（需同时给 episode）' },
    draftRoot: { type: 'string', description: '可选：剪映草稿箱目录，默认自动探测' },
    verify: { type: 'boolean', description: '是否抽首尾帧核验，默认 true' },
    drafts: { type: 'array', items: { type: 'string' }, description: '可选：明确指定只用哪些草稿文件夹（可只写文件夹名的一部分）；草稿箱混着多部剧时必须用它，否则插件不会猜' },
    drama: { type: 'string', description: '可选：剧名，用于匹配剪映本地草稿分组；默认取剧本标题' },
  },
  required: ['projectDir', 'scriptPath', 'direction', 'exportDir'],
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
  const draft = await buildSliceDraft({ episodeDir: input.sourceDir, cut: input.cut, draftRoot, name, audioLevels: input.audioLevels, fontPath: options.subtitleFont || undefined, ffmpeg: ffmpegPath(options.ffmpegPath), ending: options.ending ?? {} })
  await recordProgress(ctx, exec?.agent?.id, 'render')
  const video = await renderSlice({ episodeDir: draft.draftDir, cut: { start: 0, end: draft.contentDuration ?? draft.duration }, outFile: join(input.settings.exportDir, `${name}.mp4`), fontPath: options.subtitleFont || undefined, ffmpeg: ffmpegPath(options.ffmpegPath), ending: options.ending ?? {}, signal: exec?.signal })
  const result = await recordResult(ctx, exec?.agent?.id, { episode: input.episode, ...input.cut, draftName: name, draftDir: draft.draftDir, outFile: video.outFile, sourceDir: input.sourceDir, audioLevels: input.audioLevels, note: input.note, settings: input.settings })
  const media = draft.media ?? { copied: 0, linked: 0, missing: [] }
  const summary = [
    `第 ${input.episode} 集 · V${result?.version ?? version} · ${video.duration}s`,
    `原片时间码：${input.cut.start.toFixed(2)}s–${input.cut.end.toFixed(2)}s`,
    video.ending
      ? `片尾：时停定格（剧情结束前 ${video.ending.freezeOffsetSeconds}s 的那一帧）+ 原生「炫光」${video.ending.transitionSeconds}s + 「${video.ending.title}」完整 ${video.ending.soundSeconds}s；剧情 ${video.contentDuration}s，成片 ${video.duration}s`
      : '片尾：已关闭（只输出剧情段）',
    draft.ending
      ? `剪映草稿：${draft.draftDir}\n  · 草稿里也接了同款片尾（时停定格 + 原生「炫光」${draft.ending.transitionSeconds}s + 「${draft.ending.title}」${draft.ending.soundSeconds}s），草稿总长 ${draft.duration}s，剪映直接导出应与成片一致`
      : `剪映草稿：${draft.draftDir}`,
    `  · 素材已收进草稿目录：新拷 ${media.copied} 个、复用 ${media.linked} 个`,
    media.missing.length ? `草稿素材缺口：${media.missing.slice(0, 6).join('、')}${media.missing.length > 6 ? ` 等 ${media.missing.length} 条` : ''}（原工程本身就缺文件，这些片段已从草稿里去掉）` : '',
    `成片：${video.outFile}`,
    '已有版本已保留，可以在同一会话继续修改或切回旧版。新草稿需重启剪映后出现在草稿箱。',
  ].filter(Boolean).join('\n')
  return { summary, result, draft, video }
}

export const inject = ['tools', 'agents']

export function apply(ctx, config = {}) {
  const registered = []
  return ctx.effect(() => {
    registered.push(installEditingContext(ctx))
    registered.push(ctx.tools.register({
      name: 'duanju_slice_survey',
      description: '短剧切片工作台：只读勘察剪映工程目录，列出每集时长、台词字幕数、首末句、画面段、音频构成，并可与剧本 DOCX 分集配对。工程目录可直接给扁平草稿箱（剪映草稿根目录），会按虚拟文件夹分组和草稿素材里的 EPxxx 识别集号。',
      parameters: SURVEY_PARAMETERS,
      output: output('工程勘察清单（markdown 表格）'),
      async execute(args) {
        const report = await survey({ projectDir: args.projectDir, scriptDocx: args.scriptPath })
        return jsonSafe({ summary: formatSurvey(report), report })
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_plan',
      description: '短剧切片工作台：按内容方向在剧本里选一段连续台词，定位到剪映工程字幕时间码，给出切点并抽首尾帧核验。只读，不写工程文件。',
      parameters: PLAN_PARAMETERS,
      output: output('切片方案（集号、时间码、选中台词、首尾帧）'),
      async execute(args, exec) {
        const root = workRoot(config)
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const framesDir = join(root, stamp, 'frames')
        await mkdir(framesDir, { recursive: true })
        const plan = await planSlice({
          projectDir: args.projectDir,
          scriptDocx: args.scriptPath,
          direction: args.direction,
          ctx,
          provider: args.provider,
          model: args.model,
          signal: exec?.signal,
          framesDir,
          verification: args.verify !== false,
          ffmpeg: settings(config).ffmpegPath,
          drafts: args.drafts,
          drama: args.drama,
        })
        return jsonSafe({ summary: formatPlan(plan), plan, framesDir })
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_cut',
      description: '按内容方向重新选段，生成同一会话的一个新版本（剪映草稿和MP4），保留旧版。成片末尾默认接剪映原生片尾（时停定格 + 炫光转场 + 大气片尾声效）。仅在用户要求制作时调用；调整当前片段的时长或音量请用 duanju_slice_revise。',
      parameters: CUT_PARAMETERS,
      output: output('切片结果（集号、时间码、草稿目录、成片路径、首尾帧）'),
      async execute(args, exec) {
        try {
          const currentSettings = normalize({ projectDir: args.projectDir, scriptPath: args.scriptPath, direction: args.direction, exportDir: args.exportDir })
          await prepareCutSettings(exec?.agent?.id, currentSettings)
          await recordProgress(ctx, exec?.agent?.id, 'survey')
          const options = settings(config)
          const framesDir = join(workRoot(config), `${stampName()}-${randomUUID().slice(0, 8)}`, 'frames')
          await mkdir(framesDir, { recursive: true })

          const plan = await planSlice({
            projectDir: args.projectDir,
            scriptDocx: args.scriptPath,
            direction: args.direction,
            ctx,
            signal: exec?.signal,
            framesDir,
            verification: args.verify !== false,
            ffmpeg: options.ffmpegPath,
            drafts: args.drafts,
            drama: args.drama,
            manualPick: args.episode ? { episode: args.episode, lineIds: args.lines } : undefined,
            onProgress: (stage) => recordProgress(ctx, exec?.agent?.id, stage),
          })

          const delivered = await deliver(ctx, config, exec, { settings: currentSettings, episode: plan.episode, sourceDir: join(plan.projectDir, plan.folder), cut: plan.cut, draftRoot: args.draftRoot, note: args.direction })
          return jsonSafe({ ...delivered, plan })
        } catch (error) {
          await recordProgress(ctx, exec?.agent?.id, 'error', error.message)
          throw error
        }
      },
    }))

    registered.push(ctx.tools.register({
      name: 'duanju_slice_revise',
      description: '根据当前选中的剪辑版本修改首尾时间、对白/背景音乐/音效音量，生成新草稿和MP4，保留旧版。无需重新选段。省略的设置沿用当前版本；音量倍率相对原工程（当前倍率见会话状态，“再减半”需传当前倍率×0.5）。',
      parameters: { type: 'object', properties: {
        start: { type: 'number', description: '相对当前版本开头的起点秒数，默认0；可用负数向前扩展，不能超出原集' },
        end: { type: 'number', description: '相对当前版本开头的终点秒数，默认当前时长；例如保留前25秒传25' },
        dialogueGain: { type: 'number', minimum: 0, maximum: 4, description: '对白音量倍率，0静音，1原工程音量' },
        musicGain: { type: 'number', minimum: 0, maximum: 4, description: 'BGM音量倍率，0静音，0.5减半' },
        effectsGain: { type: 'number', minimum: 0, maximum: 4, description: '音效音量倍率' },
        note: { type: 'string', description: '本次修改的一句说明' },
      }, additionalProperties: false },
      output: output('新剪辑版本和保留的历史版本'),
      async execute(args, exec) {
        try {
          const entry = await editingSession(exec?.agent?.id)
          const sourceDir = await revisionSource(entry)
          await recordProgress(ctx, exec?.agent?.id, 'survey')
          const loaded = await loadDraftJson(sourceDir)
          if (!loaded) throw new Error('原集没有可读的草稿数据，无法修改')
          const parsed = parseDraft(loaded.draft, sourceDir)
          const edit = revisionEdit(entry.lastResult, args, parsed.duration)
          const delivered = await deliver(ctx, config, exec, { ...edit, settings: entry.settings, episode: entry.lastResult.episode, sourceDir, note: String(args.note || '对话修改').slice(0, 200) })
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
