import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { episodeOfName } from '../drama-source.js'
import { normalizeText } from '../script.js'

const SRT = /\.srt$/i
const COPY = /[（(]\s*\d+\s*[)）]\s*$/
const TIME = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/
const millis = ([h, m, s, ms]) => Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms)
const unstyle = (text) => text.replace(/<\/?(?:[bius]|font)(?:\s+[^<>]*)?>/gi, '')

// A regular subtitle wins over its numbered copies. Do not guess between equally ranked files.
export async function listSubtitleFiles(subtitleDir) {
  assert(typeof subtitleDir === 'string' && subtitleDir.trim(), '请选择有效的字幕目录')
  const dir = resolve(subtitleDir)
  const episodes = new Map()
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || !SRT.test(entry.name)) continue
    const stem = entry.name.replace(SRT, '')
    const number = episodeOfName(stem)
    if (!Number.isSafeInteger(number) || number <= 0) continue
    const options = episodes.get(number) ?? []
    options.push({ file: resolve(dir, entry.name), copy: COPY.test(stem) })
    episodes.set(number, options)
  }
  const files = {}
  for (const [number, options] of episodes) {
    const originals = options.filter(({ copy }) => !copy)
    const preferred = originals.length ? originals : options
    if (preferred.length === 1) files[number] = preferred[0].file
  }
  return files
}

function parseSrt(bytes, file) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n').trim() }
  catch (cause) { throw new Error(`字幕必须为有效的 UTF-8 SRT：${file}`, { cause }) }
  assert(text, `字幕文件没有内容：${file}`)
  const ids = new Set()
  return text.split(/\n(?:[ \t]*\n)+/).map((block) => {
    const [number, range, ...lines] = block.split('\n')
    const id = Number(number.trim())
    const time = TIME.exec(range?.trim() ?? '')
    const text = unstyle(lines.map((line) => line.trim()).join(' ')).trim()
    assert(/^\d+$/.test(number.trim()) && Number.isSafeInteger(id) && id > 0 && !ids.has(id) && time && text, `无效的 SRT 字幕条（${number}）：${file}`)
    const start = millis(time.slice(1, 5))
    const end = millis(time.slice(5))
    assert(Number.isSafeInteger(end) && end > start, `第 ${id} 条字幕时间无效：${file}`)
    ids.add(id)
    return { id, start, end, text, normalized: normalizeText(text) }
  })
}

export async function readSubtitleTrack(subtitleFile, signal) {
  assert(typeof subtitleFile === 'string' && subtitleFile.trim() && SRT.test(subtitleFile), '字幕定位需要指定有效的 .srt 文件')
  const file = resolve(subtitleFile)
  const bytes = await readFile(file, { signal })
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), cues: parseSrt(bytes, file) }
}

export function matchSubtitleTargets({ file, sha256, cues }, targets, duration) {
  return targets.map(({ id, zh, en, subtitleQuote }) => {
    const quotes = (subtitleQuote === undefined ? [zh, en?.join(' ')] : [subtitleQuote])
      .filter((quote) => typeof quote === 'string').map((quote) => ({ quote, normalized: normalizeText(unstyle(quote)) }))
      .filter(({ normalized }) => normalized)
    const candidates = []
    // Unlike ASR, subtitles have no word bounds: exact match on one or more whole, adjacent cues.
    for (const [i, first] of cues.entries()) {
      let full = ''
      for (let j = i; j < cues.length; j++) {
        const cue = cues[j]
        const previous = j === i ? null : cues[j - 1]
        const gap = previous ? cue.start - previous.end : 0
        if (!cue.normalized || cue.end > duration * 1000 + 1e-6 || cue.end - first.start > 45_000 ||
            gap > 1500 || gap < -50 || previous && (cue.start < previous.start || cue.end < previous.end)) break
        full += cue.normalized
        const match = quotes.find(({ normalized }) => normalized === full)
        if (match) {
          const used = cues.slice(i, j + 1)
          candidates.push({ start: first.start / 1000, end: cue.end / 1000, text: used.map((item) => item.text).join(' '),
            quote: match.quote, score: 1, timing: 'cue', file, sha256, cueIds: used.map((item) => item.id) })
          if (candidates.length > 3) return { id, candidates: [], ambiguous: true, reason: '字幕完整锚句有超过3个重复位置，无法可靠消歧' }
        }
        if (!quotes.some(({ normalized }) => normalized.length > full.length && normalized.startsWith(full))) break
      }
    }
    return candidates.length ? { id, candidates } : { id, candidates, reason: '字幕未可靠匹配完整锚句；需使用连续完整字幕条，不能推算条内子句时间' }
  })
}

export async function locateSubtitleTargets(subtitleFile, targets, duration, signal) {
  const track = await readSubtitleTrack(subtitleFile, signal)
  return { file: track.file, sha256: track.sha256, cueCount: track.cues.length, anchors: matchSubtitleTargets(track, targets, duration) }
}
