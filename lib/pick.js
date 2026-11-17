// Step: let the model choose ONE continuous dialogue range for a direction.
import { generateText, parseModelJson } from './model.js'

const SYSTEM = `你是短剧投流剪辑编导。运营会给你一个内容方向，你要在一部短剧的台词里挑出**一集之内连续的一段**，作为切片成片的内容。

规则：
1. 只能选一集，台词必须连续，不能跨集、不能挑不连贯的几句。
2. 成片时长目标 25–40 秒（中文约 4–6 字/秒，英文约 2.2 词/秒，按选中台词的总字数估算）。
3. 优先选情绪强、冲突强、有反转或信息量大的段落；但**方向匹配优先于单纯的钩子**。
4. 如果整部剧没有强匹配的段落，就选最接近方向的一段，match 写 partial 或 weak，不要编造。
5. lineIds 只填行号数字，不重复集号；只输出 JSON，不要输出任何解释文字。

输出格式：
{"episode": 集号数字, "lineIds": [起始行号, 结束行号], "reason": "一句话说明为什么这段符合方向", "match": "strong|partial|weak"}`

function compactLine(episodeNumber, index, line) {
  const who = line.speaker ? `${line.speaker}${line.tone ? `(${line.tone})` : ''}` : ''
  const zh = String(line.zh ?? '').replace(/\s+/g, ' ').trim()
  const en = (line.en ?? []).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim()
  const text = zh || en
  return `[${episodeNumber}-${index + 1}] ${who ? `${who}：` : ''}${text}`
}

/** Build the script digest handed to the model: only episodes the drama folder can cut. */
export function buildScriptDigest({ script, usableEpisodes }) {
  const wanted = new Map(usableEpisodes.map((item) => [item.episode, item]))
  const blocks = []
  for (const episode of script.episodes) {
    const meta = wanted.get(episode.number)
    if (!meta) continue
    const lines = episode.lines.map((line, index) => compactLine(episode.number, index, line))
    blocks.push(`第${episode.number}集（素材时长 ${meta.duration.toFixed(1)}s，${lines.length} 句台词）\n${lines.join('\n')}`)
  }
  return blocks.join('\n\n')
}

/**
 * Ask the model to pick a continuous line range.
 * @param {{direction: string, script: any, usableEpisodes: Array<any>, ctx: any, provider?: string, model?: string, signal?: AbortSignal}} input
 */
export async function pickSegment({ direction, script, usableEpisodes, ctx, provider, model, signal }) {
  if (!usableEpisodes.length) throw new Error('短剧目录里没有能和剧本配上的集，无法选段')
  const digest = buildScriptDigest({ script, usableEpisodes })
  const user = `内容方向：${direction}\n\n剧本台词（只列出素材里能切的集，行号格式为 [集号-行号]）：\n\n${digest}`
  const { response } = await generateText(ctx, { provider, model, system: SYSTEM, user, maxTokens: 4000, signal })
  const parsed = parseModelJson(response)

  const episodeNumber = Number(parsed.episode)
  const episode = script.episodes.find((item) => item.number === episodeNumber)
  if (!episode) throw new Error(`模型选的集号 ${parsed.episode} 不在剧本里`)
  if (!usableEpisodes.some((item) => item.episode === episodeNumber)) {
    throw new Error(`模型选的第 ${episodeNumber} 集在短剧目录里没有素材`)
  }
  const rawIds = Array.isArray(parsed.lineIds) ? parsed.lineIds : []
  if (rawIds.length !== 2) throw new Error('模型没有返回有效的起止行号')
  const [start, end] = rawIds.map(raw => {
    const match = /^(?:(\d+)-)?(\d+)$/.exec(String(raw).trim().replace(/^\[(.*)\]$/, '$1'))
    const value = Number(match?.[2])
    if (!match || (match[1] && Number(match[1]) !== episodeNumber) || value < 1 || value > episode.lines.length) throw new Error(`模型返回的行号无效：${raw}`)
    return value - 1
  })
  if (end < start) throw new Error('模型返回的起止行号顺序错误')
  return {
    episode: episodeNumber,
    start,
    end,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    match: ['strong', 'partial', 'weak'].includes(parsed.match) ? parsed.match : 'partial',
    model,
  }
}

const LINE_SYSTEM = `你是短剧投流剪辑编导。给你某一集的语音识别台词（带时间码），运营给一个内容方向，你挑出**连续的一段**作为切片。

规则：
1. 只能选连续的一段台词，从某句开始到某句结束。
2. 成片时长目标 25–40 秒，按下面给的时间码估算。
3. 方向匹配优先于单纯的钩子；没有强匹配就选最接近的，match 写 partial 或 weak。
4. 只输出 JSON：{"from": 起始序号, "to": 结束序号, "reason": "一句话", "match": "strong|partial|weak"}`

/** Fallback: choose directly among this episode's recognized lines. */
export async function pickFromLines({ direction, episode, ctx, provider, model, signal, scriptLines }) {
  const lines = episode.dialogue.map((item, index) => `${index + 1}. ${item.start.toFixed(2)}s-${item.end.toFixed(2)}s ${item.text}`)
  const scriptBlock = (scriptLines ?? []).length
    ? `\n\n这一集的剧本文台词（中文，供你对照语义；识别文本可能是英文，不要按字面比对）：\n${scriptLines.map((line) => `- ${line.speaker ? line.speaker + '：' : ''}${line.zh || (line.en ?? []).map((item) => item.text).join(' ')}`).join('\n')}`
    : ''
  const user = `内容方向：${direction}${scriptBlock}\n\n第${episode.episode}集语音识别台词（共 ${lines.length} 句）：\n${lines.join('\n')}`
  const { response } = await generateText(ctx, { provider, model, system: LINE_SYSTEM, user, maxTokens: 2000, signal })
  const parsed = parseModelJson(response)
  const from = Math.min(Math.max(Number(parsed.from) || 1, 1), episode.dialogue.length) - 1
  const to = Math.min(Math.max(Number(parsed.to) || from + 1, from + 1), episode.dialogue.length) - 1
  return {
    episode: episode.episode,
    start: from,
    end: to,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    match: ['strong', 'partial', 'weak'].includes(parsed.match) ? parsed.match : 'partial',
    fromSubtitles: true,
  }
}
