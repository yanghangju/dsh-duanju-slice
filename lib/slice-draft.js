// 生成切片草稿：克隆原集目录 → 把时间线引用的素材收进草稿自己目录 → 只留 视频/字幕/音频 三轨
// → 裁到 [t0,t1] → 时间线归零 → 统一字幕字体 → 重截封面 → 删掉会让剪映读旧时间线的加密档（剪映下次保存会自己重建）。
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { loadDraftJson, parseDraft, resolveMaterialPath } from './draft.js'
import { ffmpegPath, grabTimelineFrame } from './frames.js'
import { frameAt } from './locate.js'
import { applyAudioLevels, preferDialogueAudio } from './audio.js'
import { prepareDraftEnding } from './ending.js'
import { SUBTITLE_POSITION } from './subtitle-position.js'

const KEEP_TRACK_TYPES = new Set(['video', 'text', 'audio'])
const SLICE_MEDIA_DIR = join('materials', '_slice')

/** 素材进草稿后的短文件名：保留可读原名，末尾加源路径指纹避免重名覆盖。 */
function shortName(absPath) {
  const ext = extname(absPath)
  const stem = basename(absPath, ext).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(-40)
  return `${stem}-${createHash('sha1').update(absPath).digest('hex').slice(0, 8)}${ext}`
}

/** 文件是否就在源草稿目录里（那样整目录复制时已经带上了，不用再拷一份）。 */
function relativeInside(dir, file) {
  const base = resolve(dir)
  const target = resolve(file)
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  const prefix = fold(base.endsWith(sep) ? base : base + sep)
  if (!fold(target).startsWith(prefix)) return null
  return target.slice(base.length).replace(/^[\\/]+/, '')
}

/**
 * 把裁切后仍然引用的素材收进草稿自己目录，并把 path 改成草稿内绝对路径。
 * 工程常把素材散放在别的草稿目录里（或写成 Windows 缓存特效路径），只做整目录复制的话，
 * 剪映打开新草稿会整条时间线报「媒体丢失」。
 */
async function attachMedia(sourceDir, targetDir, draft) {
  const materials = indexMaterials(draft)
  const refs = new Set()
  for (const track of draft.tracks ?? []) {
    for (const segment of track.segments ?? []) {
      if (segment.material_id) refs.add(segment.material_id)
      if (segment.canvas_material_id) refs.add(segment.canvas_material_id)
      for (const ref of segment.extra_material_refs ?? []) refs.add(ref)
    }
  }

  const mediaDir = join(targetDir, SLICE_MEDIA_DIR)
  const bySource = new Map()
  const unresolved = new Set()
  let copied = 0
  let linked = 0

  for (const id of refs) {
    const material = materials.get(id)?.material
    if (!material?.path) continue
    const source = resolveMaterialPath(sourceDir, material.path)
    if (!source || !existsSync(source)) {
      unresolved.add(id)
      continue
    }
    let relative = bySource.get(source)
    if (!relative) {
      const inside = relativeInside(sourceDir, source)
      if (inside && existsSync(join(targetDir, inside))) {
        relative = inside
        linked += 1
      } else {
        relative = join(SLICE_MEDIA_DIR, shortName(source))
        await mkdir(mediaDir, { recursive: true })
        await copyFile(source, join(targetDir, relative))
        copied += 1
      }
      bySource.set(source, relative)
    }
    // 剪映对相对路径解析不可靠（尤其换机/换系统），统一改写成草稿内绝对路径。
    material.path = join(targetDir, relative)
  }

  const missing = []
  const dropped = []
  const tracks = []
  for (const track of draft.tracks ?? []) {
    const segments = []
    for (const segment of track.segments ?? []) {
      if (segment.material_id && unresolved.has(segment.material_id)) {
        const material = materials.get(segment.material_id)?.material
        const label = material?.material_name ?? material?.name ?? segment.material_id
        missing.push(`${track.type}:${label}`)
        dropped.push({ track: track.type, material: label })
        continue
      }
      segments.push(segment)
    }
    if (segments.length) tracks.push({ ...track, segments })
  }
  draft.tracks = tracks

  // 找不到的特效/蒙版类素材清空 path，让剪映用默认效果，而不是显示离线素材。
  for (const id of unresolved) {
    const material = materials.get(id)?.material
    if (material) material.path = ''
  }

  // 只保留仍被引用的素材，免得残留 Windows 缓存特效路径；canvases 是工程级设置，始终保留。
  const keep = new Set()
  for (const track of draft.tracks) {
    for (const segment of track.segments) {
      if (segment.material_id) keep.add(segment.material_id)
      if (segment.canvas_material_id) keep.add(segment.canvas_material_id)
      for (const ref of segment.extra_material_refs ?? []) keep.add(ref)
    }
  }
  for (const [kind, list] of Object.entries(draft.materials ?? {})) {
    if (!Array.isArray(list)) continue
    draft.materials[kind] = list.filter((material) => kind === 'canvases' || keep.has(material.id))
  }

  return { copied, linked, files: bySource.size, missing, dropped }
}
const CLEANUP = [
  'Timelines',
  'draft_info.json.bak',
  // 新版剪映（134+）把原始时间轴写在 template.json，留着会让剪映读回整集。
  'template.json',
  'template.json.bak',
  'template-2.tmp',
  // draft_meta_info.json 在生成后重写为本切片的身份和时长。
  'draft.extra',
  '.backup',
  '.locked',
  'deepagent',
  'adjust_mask',
  'matting',
  'qr_upload',
  'smart_crop',
  'agent_adoption_ledger.db',
  'attachment_editing.json',
  'attachment_pc_common.json',
  'common_attachment',
  'color_match',
]

const EPS = 0.034 // 一帧
const E6 = 1e6

function segmentSpeed(segment, materials) {
  for (const ref of segment.extra_material_refs ?? []) {
    const material = materials.get(ref)?.material
    if (material && typeof material.speed === 'number' && material.speed > 0) return material.speed
  }
  return 1
}

function indexMaterials(draft) {
  const index = new Map()
  for (const [kind, list] of Object.entries(draft.materials ?? {})) {
    if (!Array.isArray(list)) continue
    for (const material of list) index.set(material.id, { kind, material })
  }
  return index
}

/** 裁到 [cut.start, cut.end)，target 从 0 开始；返回新 draft。 */
function trimDraft(draft, cut) {
  const materials = indexMaterials(draft)
  const tracks = []

  for (const track of draft.tracks ?? []) {
    if (!KEEP_TRACK_TYPES.has(track.type)) continue
    const segments = []
    for (const segment of track.segments ?? []) {
      const target = segment.target_timerange ?? {}
      const start = (target.start ?? 0) / E6
      const duration = (target.duration ?? 0) / E6
      if (duration <= 0) continue
      const end = start + duration
      if (end <= cut.start + EPS || start >= cut.end - EPS) continue

      const material = materials.get(segment.material_id)?.material
      if (track.type === 'video' && !material?.path) continue // 片头预设/名片卡
      if (track.type === 'text' && material?.type !== 'subtitle') continue // 集数卡等

      const clampStart = Math.max(start, cut.start)
      const clampEnd = Math.min(end, cut.end)
      const newDuration = clampEnd - clampStart
      if (newDuration <= EPS) continue
      const lead = clampStart - start

      const next = {
        ...segment,
        target_timerange: {
          start: Math.round((clampStart - cut.start) * E6),
          duration: Math.round(newDuration * E6),
        },
      }
      if (track.type === 'text') {
        next.clip = { ...segment.clip, transform: { ...segment.clip?.transform, ...SUBTITLE_POSITION } }
        if (segment.common_keyframes) next.common_keyframes = segment.common_keyframes.filter(group => !['KFTypePositionX', 'KFTypePositionY'].includes(group.property_type))
      }
      const source = segment.source_timerange
      if (source && track.type !== 'text') {
        const speed = segmentSpeed(segment, materials)
        next.source_timerange = {
          ...source,
          start: Math.round((source.start ?? 0) + lead * speed * E6),
          duration: Math.round(newDuration * speed * E6),
        }
      }
      segments.push(next)
    }
    if (segments.length) tracks.push({ ...track, segments })
  }

  // 跨镜转场在裁切后会错位，直接清空成硬切（用户要「干净三轨」）。
  if (draft.materials) draft.materials.transitions = []

  const total = cut.end - cut.start
  return { ...draft, tracks, duration: Math.round(total * E6) }
}

/** 字幕统一字体，保留字号/颜色/描边。 */
function applyFont(draft, fontPath) {
  if (!fontPath) return 0
  let changed = 0
  for (const material of draft.materials?.texts ?? []) {
    if (typeof material.content !== 'string') continue
    let content
    try {
      content = JSON.parse(material.content)
    } catch {
      continue
    }
    if (!Array.isArray(content.styles)) continue
    for (const style of content.styles) {
      if (!style || typeof style !== 'object') continue
      style.font = { ...(style.font ?? {}), path: fontPath, id: '' }
      changed += 1
    }
    material.content = JSON.stringify(content)
  }
  return changed
}

async function removeCleanupFiles(dir) {
  const removed = []
  for (const name of CLEANUP) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    await rm(path, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

async function writeCover(episodeDir, draft, cut, targetDir, ffmpeg, width = 720) {
  const episode = parseDraft(draft, episodeDir)
  if (!frameAt(episode.videoSegments, cut.start + 0.1)) return undefined
  try {
    const cover = await grabTimelineFrame({
      ffmpeg: ffmpegPath(ffmpeg),
      episode,
      timelineSeconds: cut.start + 0.1,
      outFile: join(targetDir, 'draft_cover.jpg'),
      width,
    })
    return cover?.outFile ?? join(targetDir, 'draft_cover.jpg')
  } catch {
    return undefined // 封面失败不影响草稿可用
  }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

async function writeMetadata(episodeDir, targetDir, draft) {
  const [source, virtualStore, index] = await Promise.all([
    readJson(join(episodeDir, 'draft_meta_info.json')),
    readJson(join(episodeDir, 'draft_virtual_store.json')),
    readJson(join(dirname(episodeDir), 'root_meta_info.json')),
  ])
  // 加密的旧元数据不能原样继承；首页索引提供本地字段，素材库沿用随草稿复制的记录。
  const entry = index?.all_draft_store?.find(item => item.draft_fold_path === resolve(episodeDir))
  const metadata = { ...(source ?? entry ?? {}) }
  for (const key of Object.keys(metadata)) if (/^(cloud_|draft_cloud_|tm_draft_cloud_|pippit_)/.test(key)) delete metadata[key]
  const now = Date.now() * 1000
  const materials = indexMaterials(draft)
  const library = new Map()
  for (const track of draft.tracks) {
    if (track.type !== 'video' && track.type !== 'audio') continue
    for (const segment of track.segments) {
      const material = materials.get(segment.material_id)?.material
      if (!material?.path) continue
      const path = resolveMaterialPath(targetDir, material.path)
      if (!existsSync(path)) continue // 草稿里引用了但本机没有的素材，剪映里会显示离线
      const id = material.local_material_id || material.id
      material.local_material_id = id
      if (library.has(id)) continue
      const duration = material.duration ?? (segment.source_timerange?.start ?? 0) + (segment.source_timerange?.duration ?? 0)
      library.set(id, {
        id, file_Path: path, extra_info: material.material_name ?? material.name ?? basename(path),
        type: 0, metetype: track.type === 'audio' ? 'music' : material.type === 'photo' ? 'photo' : 'video',
        duration, width: material.width ?? 0, height: material.height ?? 0,
        create_time: Math.floor(now / E6), import_time: Math.floor(now / E6), import_time_ms: now,
        enter_from: 0, item_source: 1, md5: '', material_color_tag: '', ai_group_type: '',
        roughcut_time_range: { start: 0, duration }, sub_time_range: { start: -1, duration: -1 },
      })
    }
  }
  const draftMaterials = [{ type: 0, value: [...library.values()] }, ...[1, 2, 3, 6, 7, 8].map(type => ({ type, value: [] }))]
  Object.assign(metadata, {
    draft_id: randomUUID().toUpperCase(), draft_name: basename(targetDir),
    draft_fold_path: targetDir, draft_root_path: dirname(targetDir),
    draft_json_file: join(targetDir, 'draft_info.json'), draft_cover: join(targetDir, 'draft_cover.jpg'),
    draft_new_version: draft.new_version ?? metadata.draft_new_version ?? '',
    draft_is_invisible: false, tm_draft_removed: 0,
    tm_draft_create: now, tm_draft_modified: now, tm_duration: draft.duration,
    draft_materials: draftMaterials,
    draft_timeline_materials_size_: metadata.draft_timeline_materials_size_ ?? entry?.draft_timeline_materials_size ?? 0,
  })
  await writeFile(join(targetDir, 'draft_meta_info.json'), JSON.stringify(metadata), 'utf8')
  await writeFile(join(targetDir, 'draft_virtual_store.json'), JSON.stringify({ ...(virtualStore ?? {}), draft_materials: draftMaterials }), 'utf8')
}

/** 片尾素材与段落：定格照片 + 原生炫光转场 + 独立音效轨，和成片用的是同一套资源与时长。 */
function applyDraftEnding(draft, { photo, width, height, ending, contentDuration }) {
  const materials = draft.materials ??= {}
  for (const bucket of ['videos', 'audios', 'transitions', 'speeds', 'audio_fades']) materials[bucket] ??= []
  const id = () => randomUUID().replace(/-/g, '').toUpperCase()
  const photoId = id()
  const photoSpeedId = id()
  const transitionId = id()
  const soundId = id()
  const soundSpeedId = id()
  const fadeId = id()

  materials.videos.push({
    audio_fade: null, category_id: '', category_name: '', check_flag: 63487,
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', crop_scale: 1, duration: 10_800_000_000, has_audio: false,
    height, id: photoId, local_material_id: photoId, material_id: photoId, material_name: '片尾定格',
    media_path: '', path: photo, type: 'photo', width,
  })
  materials.speeds.push({ curve_speed: null, id: photoSpeedId, mode: 0, speed: 1, type: 'speed' })
  // 剪映的原生转场挂在上一个片段上，两段的 target 区间紧邻。
  materials.transitions.push({
    adjust_params: [], category_id: '39663', category_name: '热门',
    duration: Math.round(ending.transitionSeconds * E6), effect_id: ending.resourceId, id: transitionId,
    is_ai_transition: false, is_overlap: true, name: ending.transition.title,
    path: ending.transition.path.replace(/\\/g, '/'), platform: 'all', request_id: '',
    resource_id: ending.transition.resourceId, source_platform: 1, sub_type: 0,
    task_id: '', third_resource_id: ending.transition.resourceId, type: 'transition', video_path: '',
  })
  materials.audios.push({
    id: soundId, local_material_id: soundId, type: 'sound', name: ending.title,
    path: ending.soundFile, duration: Math.round(ending.soundDuration * E6), category_id: '', category_name: 'local',
    music_id: '', app_id: 3704, source_platform: 1, check_flag: 1,
    effect_id: ending.resourceId, resource_id: ending.resourceId,
  })
  materials.speeds.push({ curve_speed: null, id: soundSpeedId, mode: 0, speed: 1, type: 'speed' })
  materials.audio_fades.push({ id: fadeId, type: 'audio_fade', fade_type: 0, fade_in_duration: 0, fade_out_duration: 0 })

  const videoTrack = draft.tracks.find((track) => track.type === 'video')
  if (!videoTrack?.segments?.length) throw new Error('草稿里没有可接片尾的画面轨')
  const last = videoTrack.segments.at(-1)
  last.extra_material_refs = [...(last.extra_material_refs ?? []), transitionId]
  videoTrack.segments.push({
    ...last,
    id: randomUUID(),
    material_id: photoId,
    source_timerange: { start: 0, duration: Math.round(ending.duration * E6) },
    target_timerange: { start: Math.round(contentDuration * E6), duration: Math.round(ending.duration * E6) },
    speed: 1, volume: 1, last_nonzero_volume: 1, reverse: false, visible: true,
    extra_material_refs: [photoSpeedId],
    common_keyframes: [], keyframe_refs: [],
  })

  const soundStart = Math.max(0, contentDuration - ending.start)
  draft.tracks.push({
    attribute: 0, flag: 0, id: randomUUID(), is_default_name: false, name: '片尾声效',
    segments: [{
      id: randomUUID(), material_id: soundId, visible: true, volume: 1, last_nonzero_volume: 1,
      speed: 1, reverse: false, is_loop: false, is_tone_modify: false,
      source_timerange: { start: 0, duration: Math.round(ending.soundDuration * E6) },
      target_timerange: { start: Math.round(soundStart * E6), duration: Math.round(ending.soundDuration * E6) },
      common_keyframes: [], keyframe_refs: [], extra_material_refs: [soundSpeedId, fadeId],
      track_attribute: 0, track_render_index: 2, render_index: 0, clip: null, uniform_scale: null,
    }],
  })
  draft.duration = Math.round((contentDuration + ending.duration) * E6)
  return draft
}

/**
 * @param {{episodeDir: string, cut: {start: number, end: number}, draftRoot: string,
 *   name: string, fontPath?: string, ffmpeg?: string, cover?: boolean,
 *   ending?: {enabled?: boolean, transitionSeconds?: number, soundPath?: string}}} input
 */
export async function buildSliceDraft(input) {
  const { episodeDir, cut, draftRoot, name, fontPath, ffmpeg } = input
  if (!existsSync(episodeDir)) throw new Error(`原集目录不存在：${episodeDir}`)
  if (!existsSync(draftRoot)) throw new Error(`剪映草稿箱不存在：${draftRoot}`)
  const cutStart = Number(cut.start)
  const cutEnd = Number(cut.end)
  if (!Number.isFinite(cutStart) || !Number.isFinite(cutEnd) || cutEnd - cutStart < 1) throw new Error('切点区间无效')
  const targetDir = join(resolve(draftRoot), name)
  if (existsSync(targetDir)) throw new Error(`草稿同名已存在：${targetDir}`)

  const loaded = await loadDraftJson(episodeDir)
  if (!loaded) throw new Error('原集没有可读的明文 draft_info.json（先让剪映写一份 .bak 再试）')

  const original = structuredClone(loaded.draft)
  const contentDuration = cutEnd - cutStart
  const trimmed = applyAudioLevels(preferDialogueAudio(trimDraft(structuredClone(original), { start: cutStart, end: cutEnd })), input.audioLevels)
  trimmed.id = randomUUID().toUpperCase()
  if (!trimmed.tracks.length) throw new Error('裁剪后没有任何轨道，请检查切点')
  applyFont(trimmed, fontPath)

  await cp(episodeDir, targetDir, { recursive: true, preserveTimestamps: true })
  // 顺序不能换：先把素材收进草稿，再按草稿内路径写元数据，最后落正文文件。
  const media = await attachMedia(episodeDir, targetDir, trimmed)

  // 草稿末尾也接上和成片一样的片尾：时停定格 + 原生炫光 + 完整音效。
  let ending
  if (input.ending?.enabled !== false) {
    const width = trimmed.canvas_config?.width ?? 1080
    const height = trimmed.canvas_config?.height ?? 1920
    const timing = await prepareDraftEnding(ffmpegPath(ffmpeg), {
      draftDir: targetDir,
      soundPath: input.ending?.soundPath,
      transitionSeconds: input.ending?.transitionSeconds,
    })
    const photo = join(targetDir, 'materials', '_ending', '定格.png')
    const episode = parseDraft(original, episodeDir)
    const at = Math.max(0, cutEnd - (input.ending?.freezeOffsetSeconds ?? 1.5))
    if (frameAt(episode.videoSegments, at)) {
      await grabTimelineFrame({ ffmpeg: ffmpegPath(ffmpeg), episode, timelineSeconds: at, outFile: photo, width })
    } else {
      throw new Error(`片尾定格取帧失败：${at.toFixed(2)}s 落在空档，请把结束点挪出黑场/片头卡`)
    }
    applyDraftEnding(trimmed, { photo, width, height, ending: timing, contentDuration })
    ending = {
      title: timing.title,
      resourceId: timing.resourceId,
      transitionSeconds: timing.transitionSeconds,
      soundSeconds: Number(timing.soundDuration.toFixed(3)),
      freezeOffsetSeconds: input.ending?.freezeOffsetSeconds ?? 1.5,
      addedSeconds: Number(timing.duration.toFixed(3)),
      totalSeconds: Number((contentDuration + timing.duration).toFixed(3)),
    }
  }

  const removed = await removeCleanupFiles(targetDir)
  await writeMetadata(episodeDir, targetDir, trimmed)
  // 剪映 11.5 读的是新版正文文件：三份都写同一份切片时间线，避免它读回复制过来的整集。
  for (const file of ['draft_info.json', 'draft_content.json', 'template.json']) {
    await writeFile(join(targetDir, file), JSON.stringify(trimmed), 'utf8')
  }
  const cover = input.cover === false ? undefined : await writeCover(episodeDir, original, { start: cutStart, end: cutEnd }, targetDir, ffmpeg)

  return {
    draftDir: targetDir,
    name,
    duration: Number(((ending ? contentDuration + ending.addedSeconds : contentDuration)).toFixed(2)),
    contentDuration: Number(contentDuration.toFixed(2)),
    tracks: trimmed.tracks.map((track) => ({ type: track.type, segments: track.segments.length })),
    subtitleCount: trimmed.tracks.filter((track) => track.type === 'text').reduce((sum, track) => sum + track.segments.length, 0),
    removed,
    cover,
    media,
    ending,
    source: loaded.source,
  }
}
