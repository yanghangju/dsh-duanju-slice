// Match approved dialogue against real, time-coded ASR. Never derive timestamps from the script.
import { similarity } from '../locate.js'
import { normalizeText } from '../script.js'

const MAX_GAP = 1.5
const MAX_SPAN = 45
const MAX_CANDIDATES = 3

const validTime = (item, duration) => Number.isFinite(item?.start) && Number.isFinite(item.end) &&
  item.start >= 0 && item.end > item.start && item.end <= duration
const adjacent = (left, right) => right.start - left.end <= MAX_GAP && right.start >= left.end - 0.05

function wholeScore(wanted, heard) {
  if (wanted === heard) return 1
  // The legacy LCS boosts containment. A partial quote is not a full-line anchor.
  if (wanted.length < 8 || Math.abs(wanted.length - heard.length) > wanted.length * 0.12 ||
      wanted[0] !== heard[0] || wanted.at(-1) !== heard.at(-1) || wanted.includes(heard) || heard.includes(wanted)) return 0
  return similarity(wanted, heard)
}

function candidateAnchors(lines, { quote, normalized }) {
  const candidates = []
  for (let i = 0; i < lines.length; i++) {
    let text = '', heard = ''
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]
      if ((j > i && !adjacent(lines[j - 1], line)) || line.end - lines[i].start > MAX_SPAN) break
      heard += line.normalized
      if (heard.length > normalized.length * 1.12) break
      text += (text ? ' ' : '') + line.text
      const score = wholeScore(normalized, heard)
      if (score >= 0.88) candidates.push({ start: lines[i].start, end: line.end, text, quote, score, timing: 'utterance' })
    }
  }

  // A fragment of a larger ASR utterance must have explicit word boundaries; never interpolate them.
  const tokens = lines.flatMap((line, i) => [
    ...(i && !adjacent(lines[i - 1], line) ? [null] : []),
    ...(line.words ?? [null]),
  ])
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue
    let heard = '', text = ''
    for (let j = i; tokens[j] && (j === i || tokens[j].start - tokens[j - 1].end <= MAX_GAP); j++) {
      const word = tokens[j]
      heard += word.normalized
      if (!normalized.startsWith(heard) || word.end - tokens[i].start > MAX_SPAN) break
      text += (text ? ' ' : '') + word.text
      if (heard === normalized) {
        candidates.push({ start: tokens[i].start, end: word.end, text, quote, score: 1, timing: 'word' })
        break
      }
    }
  }
  return candidates
}

export function matchAsrTargets(transcript, targets, duration) {
  const lines = transcript.filter((line) => validTime(line, duration) && typeof line.text === 'string')
    .map((line) => {
      const normalized = normalizeText(line.text)
      const words = Array.isArray(line.words) ? line.words.filter((word) => typeof word?.text === 'string')
        .map((word) => ({ ...word, normalized: normalizeText(word.text) })).filter((word) => word.normalized) : []
      const timed = words.length && words.every((word, i) => validTime(word, duration) && word.start >= line.start && word.end <= line.end &&
        (i === 0 || word.start >= words[i - 1].start)) && words.map((word) => word.normalized).join('') === normalized
      return { ...line, normalized, words: timed ? words : undefined }
    }).filter((line) => line.normalized).sort((a, b) => a.start - b.start)

  return targets.map(({ id, zh, en, subtitleQuote, asrQuote }) => {
    const quotes = (asrQuote ? [asrQuote] : [zh, en?.join(' '), subtitleQuote]).filter(Boolean)
      .map((quote) => ({ quote, normalized: normalizeText(quote) })).filter((item) => item.normalized)
    const candidates = quotes.flatMap((quote) => candidateAnchors(lines, quote))
      .sort((a, b) => b.score - a.score || (a.end - a.start) - (b.end - b.start) || a.start - b.start)
    const distinct = []
    for (const candidate of candidates) {
      const same = distinct.some((item) => Math.min(item.end, candidate.end) - Math.max(item.start, candidate.start) >=
        Math.min(item.end - item.start, candidate.end - candidate.start) * 0.8)
      if (!same) distinct.push(candidate)
    }
    const near = distinct.filter(({ score }) => distinct[0].score - score <= 0.06)
    if (near.length > MAX_CANDIDATES) return { id, candidates: [], reason: `ASR有${near.length}个难以区分的时间锚点，缺少唯一的原句位置` }
    if (!near.length) return { id, candidates: [], reason: lines.length ? 'ASR未可靠匹配完整锚句；合并分句里的子句须有可验证词级时间' : 'ASR未返回可用的带时间台词' }
    return { id, candidates: near }
  })
}
