// 字幕烧录：把切片时间窗内的字幕写成 ASS，位置/字号按画布比例还原剪映里的大致效果。
import { writeFile } from 'node:fs/promises'
import { SUBTITLE_POSITION } from './subtitle-position.js'

function assTime(seconds) {
  const clamped = Math.max(0, seconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const cs = Math.round((clamped - Math.floor(clamped)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`
}

function escapeText(text) {
  return String(text).replace(/\r?\n/g, '\\N').replace(/{/g, '(').replace(/}/g, ')').trim()
}

function charWidth(code) {
  // 中日韩文字按 1em，其余按 0.52em 估算
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60)
  ) return 1
  return 0.52
}

function textWidth(text) {
  let total = 0
  for (const char of text) total += charWidth(char.codePointAt(0))
  return total
}

function wrapWords(text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next) <= maxWidth || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function layoutText(text, maxWidth) {
  const lines = wrapWords(text, maxWidth)
  if (lines.length <= 2) return lines.join('\\N')
  // 超过两行：按整段文字均分压成两行，宁可挤一点也不超过两行
  const raw = lines.join(' ')
  const mid = Math.ceil(raw.length / 2)
  return `${raw.slice(0, mid).trim()}\\N${raw.slice(mid).trim()}`
}

/**
 * @param {{subtitles: Array<{start:number,end:number,text:string}>, cut:{start:number,end:number},
 *   width:number, height:number, fontFamily?:string, outFile:string, fontSize?:number}} input
 */
export async function buildAss(input) {
  const { subtitles, cut, width, height, outFile } = input
  const fontFamily = input.fontFamily ?? 'TikTok Sans Display Dark'
  const fontSize = Math.round(input.fontSize ?? height * 0.026)
  const positionX = Math.round(width * (1 + SUBTITLE_POSITION.x) / 2)
  const positionY = Math.round(height * (1 - SUBTITLE_POSITION.y) / 2)
  const marginX = Math.round(width * 0.05)
  const perLine = (width - marginX * 2) / fontSize
  const total = cut.end - cut.start
  const events = []
  for (const subtitle of subtitles) {
    const start = Math.max(subtitle.start, cut.start) - cut.start
    const end = Math.min(subtitle.end, cut.end) - cut.start
    if (end - start < 0.08) continue
    if (!subtitle.text.trim()) continue
    const text = layoutText(escapeText(subtitle.text), perLine)
    events.push(`Dialogue: 0,${assTime(start)},${assTime(Math.min(end, total))},Sub,,0,0,0,,{\\pos(${positionX},${positionY})}${text}`)
  }
  const body = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fontSize * 0.06))},0,5,${marginX},${marginX},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
  await writeFile(outFile, body, 'utf8')
  return { outFile, count: events.length }
}
