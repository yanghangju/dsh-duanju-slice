// Map a chosen script line range onto the 剪映 project's subtitle timings.
// Pure functions: no ffmpeg, no model, easy to unit-check.
import { normalizeText } from './script.js'

const FRAME_RATE = 30
const MATCH_THRESHOLD = 0.62
const SENTENCE_WINDOW = 6

/** Character-level longest common subsequence length. */
function lcs(a, b) {
  if (!a || !b) return 0
  let previous = new Array(b.length + 1).fill(0)
  let current = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const charA = a[i - 1]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = charA === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
    }
    ;[previous, current] = [current, previous]
    current.fill(0)
  }
  return previous[b.length]
}

/** 0..1 similarity of two subtitle-ish strings (LCS ratio on normalized text). */
export function similarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const longest = Math.max(left.length, right.length)
  const shortest = Math.min(left.length, right.length)
  if (shortest / longest < 0.22) return 0
  const common = lcs(left, right)
  const dice = (2 * common) / (left.length + right.length)
  // 剪辑师常把一句长台词拆成几条短字幕，或字幕只保留半句：
  // 用「短串被长串覆盖的比例」兜住这种包含关系，但打折，避免短句乱命中。
  const containment = common / shortest
  const boost = shortest >= 8 ? containment * 0.92 : containment * 0.5
  return Math.min(1, Math.max(dice, boost))
}

/** Script line → the text usually burned into the 剪映 subtitle track. */
export function scriptLineText(line) {
  if (!line) return ''
  if (Array.isArray(line.en) && line.en.length) return line.en.map((item) => item.text).join(' ')
  return line.zh ?? ''
}

/**
 * 剧本一行常对多句字幕（例如 "a? b? c!" 三句），按句子顺序喂给字幕匹配。
 * 中英都拆：英文按 .!?；中文按 。！？；同时保留整行作为兜底比较对象。
 */
export function splitSentences(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!value) return []
  const parts = value
    .split(/(?<=[.!?。！？])/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [value]
}

/**
 * Sequential, monotonic match of script lines onto subtitle lines.
 * 一行台词可能吃掉多句字幕，因此按"行 → 句子 → 字幕"三层贪心匹配。
 */
export function matchScriptLines(subtitles, scriptLines, options = {}) {
  const threshold = options.threshold ?? MATCH_THRESHOLD
  const window = options.window ?? SENTENCE_WINDOW
  const matches = []
  let cursor = 0

  for (const line of scriptLines) {
    const sentences = []
    for (const text of line.en?.length ? line.en.map((item) => item.text) : [line.zh ?? '']) {
      sentences.push(...splitSentences(text))
    }
    const wanted = [scriptLineText(line), line.zh ?? ''].filter(Boolean)
    let first
    let last
    let matchedSentences = 0
    let skipped = 0

    for (const sentence of sentences) {
      let best
      for (let index = cursor; index < Math.min(subtitles.length, cursor + window); index += 1) {
        const subtitle = subtitles[index]
        const score = Math.max(similarity(sentence, subtitle.text), ...wanted.map((text) => similarity(text, subtitle.text)))
        if (!best || score > best.score) best = { index, score, subtitle }
      }
      if (best && best.score >= threshold) {
        if (!first) first = best
        last = best
        matchedSentences += 1
        cursor = best.index + 1
      } else {
        // 一句没对上不立刻判失败：字幕可能被剪辑师改写过，继续试下一句。
        skipped += 1
        if (skipped > 2 && !first) break
      }
    }

    if (first && last) {
      matches.push({
        scriptIndex: line.index,
        from: first.index,
        to: last.index,
        score: Number(((first.score + last.score) / 2).toFixed(3)),
        sentences: sentences.length,
        matchedSentences,
        firstSubtitle: first.subtitle,
        lastSubtitle: last.subtitle,
      })
    } else {
      matches.push({ scriptIndex: line.index, missing: true, sentences: sentences.length, matchedSentences: 0 })
    }
  }

  const hits = matches.filter((match) => !match.missing)
  const totalSentences = matches.reduce((sum, match) => sum + match.sentences, 0)
  const matchedSentences = matches.reduce((sum, match) => sum + match.matchedSentences, 0)
  return {
    matches,
    hits,
    coverage: totalSentences ? matchedSentences / totalSentences : 0,
    confidence: totalSentences ? matchedSentences / totalSentences : 0,
  }
}

/** Snap a timeline second to the nearest frame boundary (1/30 s). */
export function snapToFrame(seconds, mode = 'floor') {
  const frames = mode === 'ceil' ? Math.ceil(seconds * FRAME_RATE) : Math.floor(seconds * FRAME_RATE)
  return frames / FRAME_RATE
}

/**
 * Turn a matched range into cut points on the project timeline.
 * 剪辑点只做「句首对齐、句尾对齐」，再加 1 帧余量，避免吞字。
 */
export function cutPoints(matchResult, options = {}) {
  const { hits } = matchResult
  if (!hits.length) return undefined
  const lead = options.lead ?? 0.1
  const tail = options.tail ?? 0.15
  const first = hits[0].firstSubtitle ?? hits[0].subtitle
  const last = hits[hits.length - 1].lastSubtitle ?? hits[hits.length - 1].subtitle
  if (!first || !last) return undefined
  const videos = (options.videoSegments ?? []).filter(segment => segment.kind === 'video')
  const minStart = videos.length ? Math.min(...videos.map(segment => segment.targetStart)) : 0
  const maxEnd = videos.length ? Math.max(...videos.map(segment => segment.targetEnd)) : Infinity
  return {
    start: Math.max(minStart, snapToFrame(first.start - lead)),
    end: Math.min(maxEnd, snapToFrame(last.end + tail, 'ceil')),
    subtitleStart: first.start,
    subtitleEnd: last.end,
    firstText: first.text,
    lastText: last.text,
  }
}

/**
 * 按字幕兜底选段时，把过短的区间撑到 minSpan 秒（默认 8），并压到 maxSpan 秒以内（默认 60）。
 * 只做边界外扩，不改变模型给出的起点句。
 */
export function expandSubtitleRange(dialogue, from, to, options = {}) {
  const minSpan = options.minSpan ?? 8
  const maxSpan = options.maxSpan ?? 60
  const last = dialogue.length - 1
  let start = Math.max(0, Math.min(from, to, last))
  let end = Math.max(0, Math.min(Math.max(from, to), last))
  if (last < 0) return { from: start, to: end, span: 0 }
  const span = () => dialogue[end].end - dialogue[start].start
  while (end < last && span() < minSpan) end += 1
  while (start > 0 && span() < minSpan) start -= 1
  while (end > start && span() > maxSpan) end -= 1
  return { from: start, to: end, span: Math.max(0, span()) }
}

/** Find the video segment that covers a timeline moment. */
export function frameAt(videoSegments, seconds) {
  const segment = videoSegments.find((item) => seconds >= item.targetStart && seconds < item.targetEnd)
  if (!segment) return undefined
  const offset = seconds - segment.targetStart
  return {
    file: segment.path,
    seek: segment.sourceStart + offset * (segment.sourceEnd - segment.sourceStart) / (segment.targetEnd - segment.targetStart),
    name: segment.name,
    kind: segment.kind,
    targetStart: segment.targetStart,
    targetEnd: segment.targetEnd,
  }
}

/** 把识别分句的词级时间码摊平成「字符 → 词序号」，用来按字符对齐剧本行。 */
function wordChars(words) {
  const chars = []
  const owners = []
  words.forEach((word, index) => {
    for (const char of normalizeText(word.text)) {
      chars.push(char)
      owners.push(index)
    }
  })
  return { chars, owners }
}

/**
 * 把一行剧本对齐到某个识别分句的逐词时间码，返回这一行真正的起止时间。
 * 字符级最长公共子序列 + 回溯，匹配不到一半字符就放弃（宁可退回整句边界）。
 */
export function alignLineToWords(line, words) {
  const target = normalizeText(scriptLineText(line))
  if (!target || !Array.isArray(words) || !words.length) return undefined
  const { chars, owners } = wordChars(words)
  if (!chars.length) return undefined
  const cols = chars.length + 1
  const table = new Uint16Array((target.length + 1) * cols)
  for (let i = 1; i <= target.length; i += 1) {
    for (let j = 1; j <= chars.length; j += 1) {
      const here = i * cols + j
      table[here] = target[i - 1] === chars[j - 1]
        ? table[(i - 1) * cols + (j - 1)] + 1
        : Math.max(table[(i - 1) * cols + j], table[i * cols + (j - 1)])
    }
  }
  let i = target.length
  let j = chars.length
  let first
  let last
  let matched = 0
  while (i > 0 && j > 0) {
    if (target[i - 1] === chars[j - 1]) {
      const word = owners[j - 1]
      last ??= word
      first = word
      matched += 1
      i -= 1
      j -= 1
    } else if (table[(i - 1) * cols + j] >= table[i * cols + (j - 1)]) {
      i -= 1
    } else {
      j -= 1
    }
  }
  if (first === undefined || matched / target.length < 0.5) return undefined
  return {
    start: words[first].start,
    end: words[last].end,
    matched: Number((matched / target.length).toFixed(2)),
  }
}

/**
 * 用词级时间码收紧切点：首句取对齐到的第一个词，末句取对齐到的最后一个词。
 * 对不齐就返回 undefined，调用方沿用整句边界。
 */
export function refineCutByWords(matching, scriptLines) {
  const hits = matching?.hits ?? []
  if (!hits.length || !scriptLines?.length) return undefined
  const head = alignLineToWords(scriptLines[0], hits[0].firstSubtitle?.words)
  const tail = alignLineToWords(scriptLines[scriptLines.length - 1], hits[hits.length - 1].lastSubtitle?.words)
  if (!head && !tail) return undefined
  return { start: head?.start, end: tail?.end, head, tail }
}
