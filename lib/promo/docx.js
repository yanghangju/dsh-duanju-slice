// WordprocessingML at the level this pipeline needs: read paragraph text out
// of a .docx, and write a plain document with headings and one table.
import { readZip, writeZip } from './zip.js'

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return XML_ENTITIES[body.toLowerCase()] ?? match
  })
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])
}

/** @param {Buffer} buf @returns {string[]} one string per `<w:p>`, in document order */
export function readParagraphs(buf) {
  const xml = readZip(buf).get('word/document.xml')
  if (!xml) throw new Error('docx: word/document.xml is missing')
  const source = xml.toString('utf8')
  const out = []
  for (const para of source.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    let text = ''
    for (const token of para[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\s*\/>/g)) {
      if (token[1] !== undefined) text += decodeXml(token[1])
      else text += token[2] === 'tab' ? '\t' : '\n'
    }
    out.push(text)
  }
  return out
}

function runs(text, { bold = false, size = 21, color } = {}) {
  const props = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`
  return String(text)
    .split('\n')
    .map((line) => `<w:r>${props}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`)
    .join('<w:r><w:br/></w:r>')
}

function paragraph(text, options = {}) {
  const { bold = false, size = 21, align, color, spacingBefore, spacingAfter } = options
  const props = [
    align ? `<w:jc w:val="${align}"/>` : '',
    spacingBefore ? `<w:spacing w:before="${spacingBefore}"/>` : '',
    spacingAfter ? `<w:spacing w:after="${spacingAfter}"/>` : '',
  ].join('')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs(text, { bold, size, color })}</w:p>`
}

function table(rows) {
  if (rows.length === 0) return ''
  const columns = Math.max(...rows.map((row) => row.length))
  const width = Math.floor(INNER_WIDTH / columns)
  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`
  const props = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
  const body = rows
    .map((row, index) => {
      const cells = Array.from({ length: columns }, (_, column) => {
        const text = row[column] ?? ''
        const shade = index === 0 ? '<w:shd w:val="clear" w:fill="EFEFEF"/>' : ''
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${paragraph(text, { bold: index === 0, size: 19 })}</w:tc>`
      })
      return `<w:tr>${cells.join('')}</w:tr>`
    })
    .join('')
  return `<w:tbl>${props}${grid}${body}</w:tbl>`
}

const INNER_WIDTH = 9638

/**
 * Build a .docx from simple blocks.
 * @param {Array<{type: 'title'|'p'|'h2'|'table', text?: string, rows?: string[][], align?: string, bold?: boolean}>} blocks
 */
export function buildDocx(blocks) {
  const body = blocks
    .map((block) => {
      switch (block.type) {
        case 'title':
          return paragraph(block.text, { bold: true, size: 32, align: 'center', spacingAfter: 240 })
        case 'h2':
          return paragraph(block.text, { bold: true, size: 26, spacingBefore: 240, spacingAfter: 120 })
        case 'table':
          return `${table(block.rows ?? [])}<w:p/>`
        default:
          return paragraph(block.text ?? '', { align: block.align, bold: block.bold })
      }
    })
    .join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: 'word/document.xml', data: document },
  ])
}
