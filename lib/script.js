// Parse the bilingual shooting script (.docx) into episodes → dialogue lines,
// and resolve a generated promo line back to its original script line.
import { readParagraphs } from "./docx.js"

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

export function cnNumber(text) {
  if (!/[十百]/.test(text)) return CN_DIGITS[text] ?? Number.NaN
  let total = 0
  let num = 0
  for (const ch of text) {
    const digit = CN_DIGITS[ch]
    if (digit !== undefined) num = digit
    else if (ch === '十') {
      total += (num || 1) * 10
      num = 0
    } else if (ch === '百') {
      total += (num || 1) * 100
      num = 0
    }
  }
  return total + num
}

// 剧本里集号写法不统一：「第一集」「第1集」「第01集」「EP01」都算。
const EPISODE_RE = /^\s*(?:第\s*([0-9]{1,3}|[一二三四五六七八九十百零两]+)\s*[集话]|EP\s*0*(\d{1,3}))(?:\s|$|[：:、．.])/i
const SCENE_RE = /^\d+-\d+\s+\S/
const ENGLISH_RE = /^([A-Z][A-Z0-9 .'’\-]{0,24}?)\s*(\(OS\)|\(VO\)|\(V\.O\.\))?\s*:\s*(.+)$/
const ZH_DIALOGUE_RE = /^([^：:]{1,24})[：:]\s*(.*)$/

/** Strip punctuation/spaces so the same line written twice compares equal. */
export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[^\p{Script=Han}a-z0-9]/gu, '')
}

/**
 * @param {Buffer} docxBuffer
 * @returns {{title: string, englishTitle: string, episodes: Array<{number: number, label: string, scenes: string[], lines: Array<any>}>}}
 */
export function parseScript(docxBuffer) {
  const paragraphs = readParagraphs(docxBuffer).map((text) => text.trim())
  const episodes = []
  let episode = null
  let scene = ''
  let entry = null
  let pendingAction = ''
  let title = ''
  let englishTitle = ''

  const push = () => {
    if (entry && episode) episode.lines.push(entry)
    entry = null
  }

  for (const text of paragraphs) {
    if (text === '') continue

    const episodeMatch = EPISODE_RE.exec(text)
    if (episodeMatch) {
      push()
      const raw = episodeMatch[1] ?? episodeMatch[2]
      const number = /^\d+$/.test(raw) ? Number(raw) : cnNumber(raw)
      if (!Number.isFinite(number)) continue
      episode = { number, label: text, scenes: [], lines: [] }
      episodes.push(episode)
      scene = ''
      pendingAction = ''
      continue
    }

    if (!episode) {
      if (!title && text.includes('台词') === false && text.includes('中英对照') === false && text.length < 40) title = text
      else if (!englishTitle && /^[A-Za-z0-9 ,.'’!?-]{3,80}$/.test(text)) englishTitle = text
      continue
    }

    if (SCENE_RE.test(text)) {
      push()
      scene = text
      episode.scenes.push(text)
      continue
    }

    if (text.startsWith('▲')) {
      pendingAction = pendingAction ? `${pendingAction} ${text.slice(1)}` : text.slice(1)
      continue
    }
    if (/^(音效|字幕|画面|注)/.test(text)) {
      if (entry) entry.sfx.push(text)
      continue
    }
    if (/^(人物|标签|题材|主要角色|主要场景|故事|人物关系)[：:]/.test(text)) continue

    const englishMatch = ENGLISH_RE.exec(text)
    if (englishMatch) {
      if (!entry) continue
      entry.en.push({ speaker: englishMatch[1].trim(), text: englishMatch[3].trim() })
      continue
    }

    const zhMatch = ZH_DIALOGUE_RE.exec(text)
    if (zhMatch) {
      push()
      const rawSpeaker = zhMatch[1].trim()
      entry = {
        episode: episode.number,
        scene,
        speaker: rawSpeaker.replace(/（[^）]*）/g, '').trim() || rawSpeaker,
        tone: /（([^）]*)）/.exec(rawSpeaker)?.[1] ?? '',
        zh: zhMatch[2].trim().replace(/^（[^）]*）\s*/, ''),
        en: [],
        context: pendingAction,
        sfx: [],
      }
      pendingAction = ''
      continue
    }

    // Continuation of the previous Chinese sentence (rare): append, else treat as action.
    if (entry && !/[。！？…]$/.test(entry.zh)) entry.zh += text
    else pendingAction = pendingAction ? `${pendingAction} ${text}` : text
  }
  push()

  return {
    title: title.replace(/[_《》]/g, '').trim(),
    englishTitle: englishTitle.trim(),
    episodes: episodes.filter((item) => item.lines.length > 0),
  }
}

function bigrams(text) {
  const set = new Set()
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2))
  return set
}

/** Dice coefficient over character bigrams; 1 means identical. */
export function similarity(a, b) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return 0.72 + 0.28 * ratio
  }
  const left = bigrams(a)
  const right = bigrams(b)
  let common = 0
  for (const gram of left) if (right.has(gram)) common++
  return (2 * common) / (left.size + right.size)
}

/** Find the original dialogue entry a promo line quotes. */
export function findLine(episodes, episodeNumber, zhText) {
  const target = normalizeText(zhText)
  if (!target) return undefined
  const candidates = episodes.filter((item) => item.number === episodeNumber).flatMap((item) => item.lines)
  let best
  for (const line of candidates) {
    const score = similarity(normalizeText(line.zh), target)
    if (!best || score > best.score) best = { line, score }
  }
  return best && best.score >= 0.6 ? best : undefined
}

/** Compact script excerpt for one plan request: only episodes with video. */
export function digest(episodes, availableNumbers, { actionLimit = 60 } = {}) {
  const blocks = []
  for (const episode of episodes) {
    if (!availableNumbers.has(episode.number)) continue
    const lines = []
    for (const line of episode.lines) {
      if (line.context) lines.push(`  ▲${line.context.slice(0, actionLimit)}`)
      lines.push(`  [E${episode.number}] ${line.speaker}：${line.zh}`)
    }
    blocks.push(`## 第${episode.number}集（${episode.scenes.join(' / ') || '未标注场景'}）\n${lines.join('\n')}`)
  }
  return blocks.join('\n')
}
