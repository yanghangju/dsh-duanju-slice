// Read a 剪映 draft folder the way this workbench needs it: episode number,
// timeline duration, subtitle lines with timings, video/audio segments with
// resolved material paths. Read-only: never writes to the project folder.
import { existsSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const PLACEHOLDER_RE = /^##_draftpath_placeholder_[^#]+_##/
// 片头集数卡字幕（"EP40" / "第40集"）不是台词，不能参与选段与定位。
const TITLE_CARD_RE = /^\s*(?:EP(?:ISODE)?\s*0*\d{1,3}|第\s*[0-9一二三四五六七八九十百]+\s*[集话]?)\s*$/i
// 新版剪映把集号直接当文件夹名（1、2、6、33（1）…），这同样能确定集号。
const NUMERIC_DIR_RE = /^0*(\d{1,3})(?:\s*[（(]\s*\d+\s*[)）])?$/
const EPISODE_DIR_RE = /ep\s*0*(\d{1,3})/i
// 从别的电脑整目录导入时，剪映把草稿命名成「2-副本」「25-副本-未剪」「4-副本1」「8-副本 (2)」。
const COPY_DIR_RE = /^\s*0*(\d{1,3})\s*[-_－—·]?\s*(?:副本|拷贝|copy|切片|集|话)/i
const DATE_DIR_RE = /^\s*\d{1,4}\s*月\s*\d{1,2}\s*日/

export function episodeOfFolder(name) {
  const match = EPISODE_DIR_RE.exec(name)
  if (match) return Number(match[1])
  const numeric = NUMERIC_DIR_RE.exec(String(name ?? '').trim())
  if (numeric) return Number(numeric[1])
  const copy = COPY_DIR_RE.exec(String(name ?? ''))
  return copy ? Number(copy[1]) : undefined
}

/**
 * 草稿命名族：同一部剧导入后通常共用一种命名，草稿箱里出现多族就是混着多部剧。
 * copy = 「12-副本」，ep = 「EP012-副本」或纯数字「12」，date = 「10月13日 (1) (1)」，other = 其它。
 */
export function folderFamily(name) {
  const text = String(name ?? '')
  if (COPY_DIR_RE.test(text)) return 'copy'
  if (/^\s*ep/i.test(text) || NUMERIC_DIR_RE.test(text.trim())) return 'ep'
  if (DATE_DIR_RE.test(text)) return 'date'
  return 'other'
}

export const FAMILY_LABELS = { copy: '「N-副本」', ep: '「EPxx」', date: '日期名（导入稿）', other: '其它命名' }

/** 按命名族统计一批草稿：族内份数、集数集合、文件夹。 */
export function familySummary(entries) {
  const families = new Map()
  for (const entry of entries) {
    const family = entry.family ?? folderFamily(entry.folder)
    const item = families.get(family) ?? { family, drafts: 0, episodes: new Set(), folders: [] }
    item.drafts += 1
    if (Number.isFinite(entry.episode)) item.episodes.add(entry.episode)
    if (item.folders.length < 8) item.folders.push(entry.folder)
    families.set(family, item)
  }
  return [...families.values()].map((item) => ({ ...item, episodes: [...item.episodes].sort((a, b) => a - b) }))
}

/**
 * 决定这次只用哪几份草稿。草稿箱里混着多部剧时不允许猜：要么显式给 drafts，
 * 要么整箱只认一族，否则报错让人来定，避免剪到另一部剧的画面。
 */
export function scopeFolders(entries, drafts) {
  const wanted = (drafts ?? []).map((item) => String(item).trim()).filter(Boolean)
  if (wanted.length) {
    const picked = new Set(entries.filter((entry) => wanted.some((text) => entry.folder === text || entry.folder.includes(text))).map((entry) => entry.folder))
    if (!picked.size) throw new Error(`指定的草稿（${wanted.join('、')}）在工程目录里没有匹配项`)
    return picked
  }
  const families = familySummary(entries)
  if (families.length > 1) {
    const list = families.map((item) => `${FAMILY_LABELS[item.family] ?? item.family} ${item.drafts} 份（第 ${item.episodes.join(',')} 集，如 ${item.folders.slice(0, 2).join(' / ')}）`).join('；')
    throw new Error(`草稿箱里混着多部剧（${list}），不能自动判断这次要剪哪一部。请用 drafts 指定要用的草稿文件夹（可只写文件夹名的一部分），或把该剧草稿单独放一个工程目录`)
  }
  return new Set(entries.map((entry) => entry.folder))
}

// —— 扁平草稿箱里的集数识别 ——
// Windows 上「肥胖女星」这类分组是剪映的虚拟文件夹：名字只写在配置里，磁盘上没有同名目录，
// 草稿文件夹还叫「10月13日 (1) (1)」这种名字。分两步找：先看虚拟文件夹的成员路径，
// 再看草稿自己素材里的 EPxxx 文件名。
const EPISODE_IN_FILE = [/(?:^|[^\d])ep\s*[_\-.]?0*(\d{1,3})(?:\D|$)/i, /第\s*0*(\d{1,3})\s*[集话]/, /episode[\s_-]*0*(\d{1,3})(?:\D|$)/i]
const DRAFT_JSON_ORDER = ['draft_info.json', 'template.json', 'draft_content.json', 'draft_info.json.bak', 'template.json.bak']

/** 剪映「本地草稿」的虚拟文件夹配置（可用 DUANJU_JIANYING_CONFIG_DIR 覆盖）。 */
export function jianyingFolderConfigDir() {
  return process.env.DUANJU_JIANYING_CONFIG_DIR
    || join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Config', 'LocalDraftFolder')
}

function episodeInName(name) {
  const text = String(name ?? '')
  for (const pattern of EPISODE_IN_FILE) {
    const match = pattern.exec(text)
    if (match) return Number(match[1])
  }
  return undefined
}

async function readPlainJson(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  if (!raw.trimStart().startsWith('{')) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** 虚拟文件夹：folder_meta_info.json 存名字，draft_folder_mappings.json 存 folderId ↔ draftId。 */
export async function virtualFolders() {
  const dir = jianyingFolderConfigDir()
  const [meta, mapping] = await Promise.all([
    readPlainJson(join(dir, 'folder_meta_info.json')),
    readPlainJson(join(dir, 'draft_folder_mappings.json')),
  ])
  const folders = Array.isArray(meta?.folders)
    ? meta.folders.filter((folder) => folder && typeof folder.id === 'string').map((folder) => ({
      id: folder.id,
      name: String(folder.name ?? ''),
      parentId: String(folder.parentId ?? ''),
      createdTime: String(folder.createdTime ?? ''),
      drafts: 0,
    }))
    : []
  const nameById = new Map(folders.map((folder) => [folder.id, folder.name]))
  const byDraft = new Map()
  for (const item of Array.isArray(mapping?.mappings) ? mapping.mappings : []) {
    if (!item || typeof item.draftId !== 'string' || typeof item.folderId !== 'string') continue
    byDraft.set(item.draftId.toUpperCase(), nameById.get(item.folderId) ?? '')
    const folder = folders.find((entry) => entry.id === item.folderId)
    if (folder) folder.drafts += 1
  }
  return { dir, folders, byDraft, available: folders.length > 0 }
}

/** 剪映分组名去掉 cut- / 副本 之类的噪音，用于和剧本剧名比对。 */
function normalizeDramaName(name) {
  return String(name ?? '')
    .replace(/^cut[\s_-]*/i, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 剧名 ↔ 剪映虚拟文件夹：优先整名包含，其次取剧名里的中文片段/英文词。 */
export function matchDramaFolder(folders, drama) {
  const wanted = normalizeDramaName(drama)
  if (!wanted) return undefined
  const scored = folders
    .map((folder) => {
      const name = normalizeDramaName(folder.name)
      if (!name) return { folder, score: 0 }
      if (wanted.includes(name) || name.includes(wanted)) return { folder, score: name.length }
      const pieces = String(drama ?? '').split(/[^\u3400-\u9fffA-Za-z0-9]+/).map((piece) => piece.trim()).filter((piece) => piece.length >= 2)
      const hit = pieces.filter((piece) => name.includes(normalizeDramaName(piece)) || normalizeDramaName(piece).includes(name))
      return { folder, score: hit.length ? Math.max(...hit.map((piece) => piece.length)) : 0 }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.folder
}

const DRAFT_MARKERS = ['draft_info.json', 'template.json', 'draft_content.json', 'draft_meta_info.json']

async function draftFoldersOf(projectDir) {
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(projectDir, entry.name)
    if (!DRAFT_MARKERS.some((name) => existsSync(join(dir, name)))) continue
    dirs.push({ folder: entry.name, dir })
  }
  return dirs
}

/**
 * Windows 上先把「这部短剧」落到剪映本地草稿分组，再回来草稿箱里找它的成员草稿。
 * 认成员优先用 draftId；导入稿的 draftId 被剪映加密读不到时，退回「草稿文件夹创建时间 ≈ 分组创建时间」，
 * 并只在候选数量与分组登记数量完全一致时才采用，避免张冠李戴。
 */
export async function resolveDramaGroup({ drama, projectDir } = {}) {
  const virtual = await virtualFolders()
  if (!virtual.available) return null
  const matched = matchDramaFolder(virtual.folders, drama)
  if (!matched) return { folder: undefined, groups: virtual.folders, unresolved: 'no-match', memberCount: 0, folders: [], how: undefined }
  const memberIds = new Set([...virtual.byDraft.entries()].filter(([, name]) => name === matched.name).map(([id]) => id))
  const dirs = await draftFoldersOf(projectDir)
  const result = { folder: matched, memberCount: memberIds.size, folders: [], how: undefined, windowSeconds: undefined }

  // 1) draftId 能读到就直接对上。
  if (memberIds.size) {
    const byId = []
    for (const item of dirs) {
      const identity = await draftIdentity(item.dir)
      if (identity.draftId && memberIds.has(identity.draftId.toUpperCase())) byId.push(item.folder)
    }
    if (byId.length) return { ...result, folders: byId, how: 'draft-id' }
  }

  // 2) 导入稿：整批草稿文件夹是在分组创建那一刻生成的，用创建时间对齐，且数量必须与分组登记一致。
  const anchor = Date.parse(matched.createdTime)
  if (Number.isFinite(anchor) && memberIds.size) {
    for (const window of [5, 30, 120, 300]) {
      const within = []
      for (const item of dirs) {
        const info = await stat(item.dir).catch(() => null)
        if (!info) continue
        if (Math.abs(info.birthtimeMs - anchor) <= window * 1000) within.push(item.folder)
      }
      if (within.length === memberIds.size) return { ...result, folders: within, how: 'created-time', windowSeconds: window }
    }
  }
  return { ...result, unresolved: 'members' }
}

async function firstPlainDraft(dir) {
  for (const name of DRAFT_JSON_ORDER) {
    const draft = await readPlainJson(join(dir, name))
    if (draft && Array.isArray(draft.tracks) && draft.materials) return draft
  }
  return undefined
}

/** 草稿自己的身份与素材名：draft_meta_info.json 常被剪映加密，但素材库和明文时间轴还在。 */
async function draftIdentity(dir) {
  const identity = { draftId: undefined, videoNames: [], mediaNames: [], readable: false }
  const [meta, store, draft] = await Promise.all([
    readPlainJson(join(dir, 'draft_meta_info.json')),
    readPlainJson(join(dir, 'draft_virtual_store.json')),
    firstPlainDraft(dir),
  ])
  identity.readable = Boolean(draft) || existsSync(join(dir, '.backup'))
  if (typeof meta?.draft_id === 'string') identity.draftId = meta.draft_id
  for (const material of (meta?.draft_materials ?? []).flatMap((group) => group?.value ?? [])) {
    if (typeof material?.file_Path === 'string') identity.mediaNames.push(material.file_Path)
  }
  for (const material of (store?.draft_materials ?? []).flatMap((group) => group?.value ?? [])) {
    if (typeof material?.file_Path === 'string') identity.mediaNames.push(material.file_Path)
    if (typeof material?.extra_info === 'string') identity.mediaNames.push(material.extra_info)
  }
  if (draft) {
    if (!identity.draftId && typeof draft.id === 'string') identity.draftId = draft.id
    const videos = Array.isArray(draft.materials?.videos) ? draft.materials.videos : []
    for (const material of videos) if (typeof material?.path === 'string') identity.videoNames.push(material.path)
    if (!videos.length) {
      for (const list of Object.values(draft.materials ?? {})) {
        if (!Array.isArray(list)) continue
        for (const material of list) if (typeof material?.path === 'string') identity.mediaNames.push(material.path)
      }
    }
  }
  return identity
}

/** 视频素材名里的集号优先；多个不同集号视为无法判断，不猜。 */
function episodeFromIdentity(identity) {
  for (const pool of [identity.videoNames, identity.mediaNames]) {
    const episodes = new Set(pool.map(episodeName => episodeInName(episodeName)).filter((value) => Number.isFinite(value)))
    if (episodes.size === 1) return [...episodes][0]
    if (episodes.size > 1) return undefined
  }
  return undefined
}

/** Absolute path of a material path (drafts store `##_draftpath_placeholder_<uuid>_##/...`). */
const sharedMediaCache = new Map()

/** 草稿箱里同名的素材常被多集共用（别集目录里能找到），找不到就回退到本机其它草稿。 */
function buildSharedMediaIndex(root) {
  const index = new Map()
  let children = []
  try {
    children = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return index
  }
  for (const name of children) {
    for (const sub of ['materials/video', 'materials/audio', 'Resources/local', '']) {
      const dir = sub ? join(root, name, sub) : join(root, name)
      let files = []
      try {
        files = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.isFile()) continue
        if (index.has(file.name)) continue
        index.set(file.name, join(dir, file.name))
      }
    }
  }
  return index
}

function sharedMedia(draftDir, path) {
  const root = dirname(draftDir)
  let index = sharedMediaCache.get(root)
  if (!index) {
    index = buildSharedMediaIndex(root)
    sharedMediaCache.set(root, index)
  }
  return index.get(basename(path))
}

export function resolveMaterialPath(draftDir, materialPath) {
  if (!materialPath) return undefined
  // 164 之前的剪映写 `##_draftpath_placeholder_<uuid>_##/materials/...`；
  // 134+ 的工程（纯数字集名那批）直接写 `materials/video/x.mp4` 这样的相对路径。
  const locate = (candidate) => {
    if (existsSync(candidate)) return candidate
    return sharedMedia(draftDir, candidate) ?? candidate
  }
  if (PLACEHOLDER_RE.test(materialPath)) {
    return locate(join(draftDir, materialPath.replace(PLACEHOLDER_RE, '').replace(/^\/+/, '')))
  }
  if (materialPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(materialPath)) return locate(materialPath)
  return locate(join(draftDir, materialPath))
}

function seconds(timeRange) {
  return ((timeRange?.start ?? 0) + (timeRange?.duration ?? 0)) / 1e6
}

function start(timeRange) {
  return (timeRange?.start ?? 0) / 1e6
}

function parseJsonField(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function subtitleText(material) {
  const content = parseJsonField(material?.content, undefined)
  if (content && typeof content.text === 'string') return content.text
  return typeof material?.recognize_text === 'string' ? material.recognize_text : ''
}

export function isTitleCard(text) {
  return TITLE_CARD_RE.test(String(text ?? ''))
}

/** Candidate episode folders under a project directory. */
export async function listEpisodeFolders(projectDir) {
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, dir: join(projectDir, entry.name) }))
  // 本插件自己产出的切片（…_v1_20261116054226_678c90fe）不是素材，别当成可剪的集。
  const produced = dirs.filter((folder) => /_\d{14}_[0-9a-f]{8}$/i.test(folder.name))
  const sources = dirs.filter((folder) => !produced.includes(folder))
  const entryOf = (folder, episode, extra) => ({ episode, folder: folder.name, dir: folder.dir, family: folderFamily(folder.name), draftFile: join(folder.dir, 'draft_info.json'), ...extra })
  // 同一集可能有多份草稿（其中有的已被剪映加密、读不出时间轴）：能读的排前面。
  const byEpisode = (a, b) => Number(b.readable ?? false) - Number(a.readable ?? false) || a.episode - b.episode || a.folder.localeCompare(b.folder)

  // 1) 文件夹名自带集号（EP007-副本 / 7 / 2-副本）：最可靠。
  //    名字里没集号的继续走 2)3)，两类要一起收集，否则一箱里混着别的命名会把能用的集挡掉。
  const virtual = await virtualFolders()
  const found = new Map()
  for (const folder of sources) {
    const byName = episodeOfFolder(folder.name)
    if (byName !== undefined) {
      found.set(folder.name, entryOf(folder, byName, { from: 'folder-name' }))
      continue
    }
    // 2) 剪映虚拟文件夹（本地草稿分组）的成员；3) 草稿素材里的 EPxxx。
    const identity = await draftIdentity(folder.dir)
    const group = identity.draftId ? virtual.byDraft.get(identity.draftId.toUpperCase()) : undefined
    const episode = episodeFromIdentity(identity)
    if (group !== undefined && episode !== undefined) {
      found.set(folder.name, entryOf(folder, episode, { from: 'virtual-folder', group, readable: identity.readable }))
    } else if (episode !== undefined) {
      found.set(folder.name, entryOf(folder, episode, { from: 'draft-media', draftId: identity.draftId, readable: identity.readable }))
    }
  }
  return [...found.values()].sort(byEpisode)
}

/** Parse one draft_info.json into the pieces the pipeline uses. */
export function parseDraft(draft, draftDir) {
  const materials = new Map()
  for (const [kind, list] of Object.entries(draft.materials ?? {})) {
    if (!Array.isArray(list)) continue
    for (const material of list) materials.set(material.id, { kind, material })
  }

  const subtitles = []
  const videoSegments = []
  const audioSegments = []

  for (const track of draft.tracks ?? []) {
    for (const segment of track.segments ?? []) {
      const target = segment.target_timerange ?? {}
      const source = segment.source_timerange ?? {}
      const ref = materials.get(segment.material_id)
      if (!ref) continue
      const { kind, material } = ref

      if (track.type === 'text' && kind === 'texts') {
        const text = subtitleText(material).trim()
        if (!text) continue
        subtitles.push({
          start: start(target),
          end: seconds(target),
          duration: seconds(target) - start(target),
          text,
          titleCard: isTitleCard(text),
        })
        continue
      }

      if (track.type === 'video' && kind === 'videos') {
        const path = typeof material.path === 'string' ? material.path : ''
        // 预设 / 名片卡（subdraft）没有素材路径，属片头类素材。
        if (!path) continue
        const isPhoto = material.type === 'photo'
        videoSegments.push({
          kind: isPhoto ? 'photo' : 'video',
          name: material.material_name ?? material.name ?? '',
          path: resolveMaterialPath(draftDir, path),
          sourceStart: start(source),
          sourceEnd: seconds(source),
          targetStart: start(target),
          targetEnd: seconds(target),
          width: material.width,
          height: material.height,
        })
        continue
      }

      if (track.type === 'audio') {
        const path = typeof material.path === 'string' ? material.path : ''
        if (!path) continue
        audioSegments.push({
          audioType: material.type ?? 'sound',
          name: material.name ?? material.material_name ?? '',
          path: resolveMaterialPath(draftDir, path),
          sourceStart: start(source),
          sourceEnd: seconds(source),
          targetStart: start(target),
          targetEnd: seconds(target),
          volume: typeof segment.volume === 'number' ? segment.volume : 1,
        })
      }
    }
  }

  subtitles.sort((a, b) => a.start - b.start)
  videoSegments.sort((a, b) => a.targetStart - b.targetStart)
  audioSegments.sort((a, b) => a.targetStart - b.targetStart)

  return {
    duration: (draft.duration ?? 0) / 1e6,
    canvas: { width: draft.canvas_config?.width, height: draft.canvas_config?.height },
    subtitles,
    videoSegments,
    audioSegments,
  }
}

/**
 * Plaintext candidates inside a draft folder, best first. 剪映 opens a draft
 * once -> rewrites `draft_info.json` as ciphertext; the pre-open plaintext is
 * still kept at `.backup/<time>_<md5>.load.bak`, so that is the fallback.
 */
async function draftFileCandidates(dir) {
  // 新版剪映（new_version 134+）把明文时间轴放在 template.json，draft_info.json 换成密文。
  const candidates = [
    join(dir, 'draft_info.json'),
    join(dir, 'draft_info.json.bak'),
    join(dir, 'template.json'),
    join(dir, 'template.json.bak'),
  ]
  const backups = []
  try {
    const entries = await readdir(join(dir, '.backup'), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bak')) continue
      if (!entry.name.includes('.load.bak') && !entry.name.includes('.save.bak')) continue
      const path = join(dir, '.backup', entry.name)
      backups.push({ path, mtime: (await stat(path)).mtimeMs })
    }
  } catch {}
  backups.sort((a, b) => b.mtime - a.mtime)
  candidates.push(...backups.map((item) => item.path), join(dir, 'template-2.tmp'))
  return candidates
}

// 展开工程内嵌的复合片段，让定位、裁草稿和渲染共用同一条完整时间轴。
function expandCombinations(draft, inherited = [], ancestors = []) {
  const materials = Object.fromEntries(Object.entries(draft.materials).map(([kind, list]) => [kind, Array.isArray(list) ? [...list] : list]))
  const combinations = [...(draft.materials.drafts ?? []), ...inherited]
  const extraTracks = []
  const tracks = draft.tracks.map((track) => {
    const segments = []
    for (const parent of track.segments ?? []) {
      const combination = combinations.find(item => parent.extra_material_refs?.includes(item.id) && item.draft?.tracks)
      if (!combination) {
        segments.push(parent)
        continue
      }
      if (ancestors.includes(combination.id)) throw new Error(`复合片段循环引用：${combination.id}`)
      const child = expandCombinations(combination.draft, combinations, [...ancestors, combination.id])
      for (const [kind, list] of Object.entries(child.materials)) {
        if (!Array.isArray(list) || kind === 'drafts') continue
        const target = materials[kind] ??= []
        const known = new Set(target.map(item => item.id))
        target.push(...list.filter(item => !known.has(item.id)))
      }
      const targetStart = parent.target_timerange?.start ?? 0
      const targetDuration = parent.target_timerange?.duration ?? 0
      const sourceStart = parent.source_timerange?.start ?? 0
      const sourceDuration = parent.source_timerange?.duration ?? targetDuration
      if (targetDuration <= 0 || sourceDuration <= 0) continue
      const rate = sourceDuration / targetDuration
      let merged = false
      for (const childTrack of child.tracks) {
        const mapped = []
        for (const segment of childTrack.segments ?? []) {
          const childStart = segment.target_timerange?.start ?? 0
          const childDuration = segment.target_timerange?.duration ?? 0
          const from = Math.max(sourceStart, childStart)
          const to = Math.min(sourceStart + sourceDuration, childStart + childDuration)
          if (to <= from) continue
          const begin = targetStart + Math.round((from - sourceStart) / rate)
          const end = targetStart + Math.round((to - sourceStart) / rate)
          const next = { ...segment, id: randomUUID(), target_timerange: { start: begin, duration: end - begin }, volume: (parent.volume ?? 1) * (segment.volume ?? 1) }
          if (segment.source_timerange) {
            const childRate = (segment.source_timerange.duration ?? childDuration) / childDuration
            next.source_timerange = { start: Math.round((segment.source_timerange.start ?? 0) + (from - childStart) * childRate), duration: Math.round((to - from) * childRate) }
            const speedId = randomUUID()
            next.speed = childRate * rate
            next.extra_material_refs = (segment.extra_material_refs ?? []).filter(id => !materials.speeds?.some(item => item.id === id))
            next.extra_material_refs.push(speedId)
            ;(materials.speeds ??= []).push({ id: speedId, type: 'speed', speed: next.speed })
          }
          mapped.push(next)
        }
        if (childTrack.type === track.type && !merged) {
          segments.push(...mapped)
          merged = true
        } else if (mapped.length) {
          extraTracks.push({ ...childTrack, id: randomUUID(), segments: mapped })
        }
      }
    }
    segments.sort((a, b) => (a.target_timerange?.start ?? 0) - (b.target_timerange?.start ?? 0))
    return { ...track, segments }
  })
  // shortcut: 沿用硬切导出的规则，复合片段父级蒙版、特效不重建；需要保留此类效果时接原生渲染。
  return { ...draft, materials, tracks: [...tracks, ...extraTracks] }
}

/** Parse the first candidate file that is readable JSON with a timeline. */
export async function loadDraftJson(dir) {
  for (const path of await draftFileCandidates(dir)) {
    if (!existsSync(path)) continue
    const raw = await readFile(path, 'utf8')
    if (!raw.trimStart().startsWith('{')) continue
    let draft
    try {
      draft = JSON.parse(raw)
    } catch {
      continue
    }
    if (!Array.isArray(draft.tracks) || !draft.materials) continue
    return { draft: expandCombinations(draft), source: basename(path), relative: path.slice(dir.length + 1) }
  }
  return undefined
}

/** Read + parse one episode; returns undefined when no plaintext copy exists. */
export async function readEpisode(entry) {
  const loaded = await loadDraftJson(entry.dir)
  if (!loaded) return undefined
  const parsed = parseDraft(loaded.draft, entry.dir)
  const media = [...parsed.videoSegments, ...parsed.audioSegments].map((segment) => segment.path)
  const missingMedia = [...new Set(media.filter((path) => path && !existsSync(path)))]
  const missingVideo = missingMedia.filter((path) => /\.(?:mp4|mov|m4v|mkv|webm)$/i.test(path))
  const missingAudio = missingMedia.filter((path) => /\.(?:mp3|m4a|wav|aac|flac|ogg)$/i.test(path))
  const dialogueAudio = parsed.audioSegments.filter((segment) => segment.audioType === 'video_original_sound')
  const music = parsed.audioSegments.filter((segment) => segment.audioType === 'extract_music')
  const sound = parsed.audioSegments.filter((segment) => segment.audioType === 'sound')
  const lines = parsed.subtitles.filter((subtitle) => !subtitle.titleCard)
  return {
    episode: entry.episode,
    folder: entry.folder,
    dir: entry.dir,
    from: entry.from,
    group: entry.group,
    family: entry.family,
    draftSource: loaded.relative,
    ...parsed,
    dialogue: lines,
    contentStart: lines.length ? lines[0].start : 0,
    contentEnd: parsed.videoSegments.filter(segment => segment.kind === 'video').reduce((max, segment) => Math.max(max, segment.targetEnd), 0),
    counts: {
      subtitles: lines.length,
      titleCards: parsed.subtitles.length - lines.length,
      videoSegments: parsed.videoSegments.filter((segment) => segment.kind === 'video').length,
      photos: parsed.videoSegments.filter((segment) => segment.kind === 'photo').length,
      dialogue: dialogueAudio.length,
      music: music.length,
      sound: sound.length,
    },
    missingMedia,
    missingVideo,
    missingAudio,
  }
}

/** Read every episode folder in a project directory (read-only). */
export async function surveyProject(projectDir) {
  const folders = await listEpisodeFolders(projectDir)
  const episodes = []
  const unreadable = []
  for (const folder of folders) {
    const episode = await readEpisode(folder)
    if (episode) episodes.push(episode)
    else unreadable.push({ folder: folder.folder, reason: '没有可读的明文 draft_info.json（工程可能已被剪映加密，且无 .backup 明文）' })
  }
  const modes = new Set(folders.map((folder) => folder.from).filter(Boolean))
  const groups = new Map()
  for (const folder of folders) {
    if (!folder.group) continue
    groups.set(folder.group, [...(groups.get(folder.group) ?? []), folder.folder])
  }
  // 剪映里有哪些分组、各有几份草稿：即便 draftId 对不上（草稿是从别的电脑导入的），也要让操作者看见。
  const virtual = await virtualFolders()
  return {
    projectDir,
    episodes,
    unreadable,
    resolution: {
      mode: modes.size === 1 ? [...modes][0] : modes.size ? 'mixed' : 'none',
      configDir: jianyingFolderConfigDir(),
      groups: [...groups.entries()].map(([name, members]) => ({ name, members })),
      folders: virtual.folders.map((folder) => ({ name: folder.name, drafts: folder.drafts })),
      families: familySummary(folders),
    },
  }
}

/** Whether a folder looks like a single 剪映 draft (has draft_info.json). */
export async function isDraftFolder(dir) {
  try {
    return (await stat(join(dir, 'draft_info.json'))).isFile()
  } catch {
    return false
  }
}
