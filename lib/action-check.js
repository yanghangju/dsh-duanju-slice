// ASR 给出完整台词边界；画面只决定是否需要保留同一动作的余量。
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { grabTimelineFrame } from './frames.js'
import { snapToFrame } from './locate.js'
import { generateJson } from './model.js'

const ACTION_WINDOW = { back: 1.2, ahead: 3.4, step: 0.55, maxFrames: 9 }
const SYSTEM = `根据给出的原片抽帧，核对台词结束时同一镜头里与这句台词有关的动作是否完整。只看画面，不猜没给的音频、帧或台词。若动作还在进行，给出已抽到的能证明动作做完的时间；换镜头后的新动作、反打或反应不要当作动作延续。没有延长依据或动作已完整则返回现切点。只返回 JSON：{"complete":true|false,"cutAt":原片秒数,"confidence":0到1,"evidence":"简述画面依据"}`

export async function frameContent({ ctx, episode, ffmpeg, outDir, times, intro, signal }) {
  const attachments = ctx?.get('attachments')
  if (!attachments?.saveImages) throw new Error('没有可用的图像附件服务')
  const count = Math.min(times.length, attachments.imageLimits?.maxImagesPerMessage ?? times.length)
  if (count < 2) throw new Error('图像额度不足，不能核对画面')
  await mkdir(outDir, { recursive: true })
  const frames = []
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted()
    const at = times[Math.round(i * (times.length - 1) / (count - 1))]
    const file = join(outDir, `${at.toFixed(3)}.jpg`)
    await grabTimelineFrame({ ffmpeg, episode, timelineSeconds: at, outFile: file, width: 540, signal })
    frames.push({ data: await readFile(file), mediaType: 'image/jpeg', name: `${at.toFixed(3)}s.jpg`, time: at })
  }
  const refs = await attachments.saveImages(frames.map(({ time, ...frame }) => frame))
  return {
    times: frames.map(({ time }) => time),
    content: [{ type: 'text', text: intro }, ...refs.flatMap((attachment, i) => [
      { type: 'text', text: `原片 ${frames[i].time.toFixed(3)} 秒` },
      { type: 'image', attachment },
    ])],
  }
}

export async function verifyAction({ ctx, episode, cut, ffmpeg, outDir, provider, model, signal, endLimit = Infinity }) {
  const result = { cut: { ...cut, dialogueEnd: cut.subtitleEnd ?? cut.end } }
  if (!ctx || !outDir) return { ...result, check: { skipped: '未启用视觉核验' } }
  const from = Math.max(cut.start + 0.1, cut.end - ACTION_WINDOW.back)
  const to = Math.min((episode.contentEnd ?? episode.duration) - 0.05, cut.end + ACTION_WINDOW.ahead, endLimit)
  if (to <= from) return { ...result, check: { skipped: '片段尾部没有足够的画面可核验' } }
  const count = Math.min(ACTION_WINDOW.maxFrames, Math.ceil((to - from) / ACTION_WINDOW.step) + 1)
  const times = Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1))
  try {
    const frames = await frameContent({ ctx, episode, ffmpeg, outDir, times, signal, intro: `ASR 末句结束于 ${result.cut.dialogueEnd.toFixed(3)} 秒，现切点 ${cut.end.toFixed(3)} 秒。只在所见画面证实同一动作需要保留时延长，且不能跨过 ${to.toFixed(3)} 秒。` })
    const parsed = await generateJson(ctx, { provider, model, system: SYSTEM, content: frames.content, signal, maxTokens: 8000 })
    const { cutAt, complete, confidence, evidence } = parsed
    if (!Number.isFinite(cutAt) || typeof complete !== 'boolean' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || typeof evidence !== 'string') throw new Error('视觉模型没有给出有效的切点与依据')
    if (!complete && confidence >= 0.6 && evidence.trim() && cutAt <= to + 0.001) {
      result.cut.end = Math.max(cut.end, Math.min(snapToFrame(cutAt, 'ceil'), snapToFrame(to)))
    }
    return { ...result, check: { complete, cutAt: result.cut.end, confidence, evidence: evidence.slice(0, 120), frames: frames.times.length } }
  } catch (error) {
    signal?.throwIfAborted()
    return { ...result, check: { skipped: `视觉核验失败：${error.message}` } }
  }
}
