// 生成切片草稿：源素材不再是剪映工程，而是短剧目录里的原始视频，
// 所以草稿从零拼装：视频段（按切点裁剪、时间线归零）+ 与成片同款的片尾（时停定格 + 原生炫光 + 大气片尾声效）。
// 不写字幕轨：源视频大多已带硬字幕，识别文本只用来找台词和切点。
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { ffmpegPath, grabTimelineFrame } from './frames.js'
import { applyAudioLevels } from './audio.js'
import { prepareDraftEnding } from './ending.js'

const E6 = 1e6
const EPS = 0.034 // 一帧
const DEFAULT_CANVAS = { width: 1080, height: 1920 }
const CLEANUP = [
  'draft_info.json.bak',
  'template.json.bak',
  'template-2.tmp',
  'draft.extra',
  '.backup',
  '.locked',
  'Timelines',
  'root_meta_info.json',
]

const id = () => randomUUID().replace(/-/g, '').toUpperCase()

function crop() {
  return { lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1, upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0 }
}

function emptyDraft({ width, height }) {
  const now = Math.floor(Date.now() / 1000)
  return {
    canvas_config: { height, ratio: 'original', width },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_template: null,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_template: null,
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    duration: 0,
    extra_info: null,
    fps: 30,
    free_render_index_mode_on: false,
    group_container: null,
    id: id(),
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: { app_id: 3704, app_source: 'lv', app_version: '11.6.0', os: platformName(), os_version: '' },
    materials: {
      audio_balances: [], audio_effects: [], audio_fades: [], audio_track_indexes: [], audios: [],
      beats: [], canvases: [], color_curves: [], digital_humans: [], drafts: [], effects: [],
      flowers: [], green_screens: [], handwrites: [], images: [], log_color_wheels: [],
      loudnesses: [], manual_deformations: [], masks: [], material_animations: [], material_colors: [],
      multi_language_refs: [], placeholders: [], plugin_effects: [], primary_color_wheels: [],
      realtime_denoises: [], shapes: [], smart_crops: [], smart_relights: [], sound_channel_mappings: [],
      speeds: [], stickers: [], tail_leaders: [], text_templates: [], texts: [], time_marks: [],
      transitions: [], video_effects: [], video_trackings: [], videos: [], vocal_beats: [], vocal_separations: [],
    },
    mutable_config: null,
    name: '',
    new_version: '110.0.0',
    platform: { app_id: 3704, app_source: 'lv', app_version: '11.6.0', device_id: '', hard_disk_id: '', mac_address: '', os: platformName(), os_version: '' },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks: [],
    update_time: now,
    version: 360000,
  }
}

function platformName() {
  return process.platform === 'win32' ? 'windows' : 'mac'
}

function us(seconds) {
  return Math.round(seconds * E6)
}

/** 视频素材：剪映把 path 当绝对路径读，换机或挪动短剧目录才会丢素材。 */
function videoMaterial(part) {
  const materialId = id()
  return {
    audio_fade: null,
    category_id: '',
    category_name: 'local',
    check_flag: 63487,
    crop: crop(),
    crop_ratio: 'free',
    crop_scale: 1,
    duration: us(part.duration),
    has_audio: part.hasAudio !== false,
    height: part.height || DEFAULT_CANVAS.height,
    id: materialId,
    local_material_id: materialId,
    material_id: materialId,
    material_name: part.name,
    media_path: '',
    path: part.path,
    type: 'video',
    volume: 1,
    width: part.width || DEFAULT_CANVAS.width,
  }
}

function videoSegment(materialId, speedId, source, target) {
  return {
    clip: { alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
    common_keyframes: [],
    extra_material_refs: [speedId],
    id: randomUUID(),
    keyframe_refs: [],
    last_nonzero_volume: 1,
    material_id: materialId,
    render_index: 0,
    reverse: false,
    source_timerange: { duration: us(source.duration), start: us(source.start) },
    speed: 1,
    target_timerange: { duration: us(target.duration), start: us(target.start) },
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1 },
    visible: true,
    volume: 1,
  }
}

/** 切点内每一段画面：源文件内的偏移 → 切片时间线偏移。 */
export function planSegments(episode, cut) {
  const segments = []
  for (const part of episode.videoSegments) {
    const start = Math.max(part.targetStart, cut.start)
    const end = Math.min(part.targetEnd, cut.end)
    if (end - start <= EPS) continue
    segments.push({
      part,
      source: { start: part.sourceStart + (start - part.targetStart), duration: end - start },
      target: { start: start - cut.start, duration: end - start },
    })
  }
  return segments
}

/** 片尾素材与段落：定格照片 + 原生炫光转场 + 独立音效轨，和成片用的是同一套资源与时长。 */
export function applyDraftEnding(draft, { photo, width, height, ending, contentDuration }) {
  const materials = draft.materials ??= {}
  for (const bucket of ['videos', 'audios', 'transitions', 'speeds', 'audio_fades']) materials[bucket] ??= []
  const photoId = id()
  const photoSpeedId = id()
  const transitionId = id()
  const soundId = id()
  const soundSpeedId = id()
  const fadeId = id()

  materials.videos.push({
    audio_fade: null, category_id: '', category_name: '', check_flag: 63487, crop: crop(), crop_ratio: 'free', crop_scale: 1,
    duration: 10_800_000_000, has_audio: false, height, id: photoId, local_material_id: photoId, material_id: photoId,
    material_name: '片尾定格', media_path: '', path: photo, type: 'photo', width,
  })
  materials.speeds.push({ curve_speed: null, id: photoSpeedId, mode: 0, speed: 1, type: 'speed' })
  // 剪映的原生转场挂在上一个片段上，两段的 target 区间紧邻。
  materials.transitions.push({
    adjust_params: [], category_id: '39663', category_name: '热门',
    duration: us(ending.transitionSeconds), effect_id: ending.resourceId, id: transitionId,
    is_ai_transition: false, is_overlap: true, name: ending.transition.title,
    path: ending.transition.path.replace(/\\/g, '/'), platform: 'all', request_id: '',
    resource_id: ending.transition.resourceId, source_platform: 1, sub_type: 0,
    task_id: '', third_resource_id: ending.transition.resourceId, type: 'transition', video_path: '',
  })
  materials.audios.push({
    id: soundId, local_material_id: soundId, type: 'sound', name: ending.title,
    path: ending.soundFile, duration: us(ending.soundDuration), category_id: '', category_name: 'local',
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
    source_timerange: { start: 0, duration: us(ending.duration) },
    target_timerange: { start: us(contentDuration), duration: us(ending.duration) },
    speed: 1, volume: 1, last_nonzero_volume: 1, reverse: false, visible: true,
    extra_material_refs: [photoSpeedId],
    common_keyframes: [], keyframe_refs: [],
  })

  const soundStart = Math.max(0, contentDuration - ending.start)
  draft.tracks.push({
    attribute: 0, flag: 0, id: randomUUID(), is_default_name: false, name: '片尾声效', type: 'audio',
    segments: [{
      id: randomUUID(), material_id: soundId, visible: true, volume: 1, last_nonzero_volume: 1,
      speed: 1, reverse: false, is_loop: false, is_tone_modify: false,
      source_timerange: { start: 0, duration: us(ending.soundDuration) },
      target_timerange: { start: us(soundStart), duration: us(ending.soundDuration) },
      common_keyframes: [], keyframe_refs: [], extra_material_refs: [soundSpeedId, fadeId],
      track_attribute: 0, track_render_index: 2, render_index: 0, clip: null, uniform_scale: null,
    }],
  })
  draft.duration = us(contentDuration + ending.duration)
  return draft
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

function materialIndex(draft) {
  const index = new Map()
  for (const [kind, list] of Object.entries(draft.materials ?? {})) {
    if (!Array.isArray(list)) continue
    for (const material of list) index.set(material.id, { kind, material })
  }
  return index
}

/** 剪映首页索引用的草稿身份与素材库：只登记草稿里真正引用到的文件。 */
async function writeMetadata(targetDir, draft) {
  const now = Date.now()
  const materials = materialIndex(draft)
  const library = new Map()
  for (const track of draft.tracks) {
    if (track.type !== 'video' && track.type !== 'audio') continue
    for (const segment of track.segments) {
      const material = materials.get(segment.material_id)?.material
      if (!material?.path) continue
      if (!existsSync(material.path)) continue
      const materialId = material.local_material_id || material.id
      material.local_material_id = materialId
      if (library.has(materialId)) continue
      const duration = material.duration ?? us(0)
      library.set(materialId, {
        id: materialId, file_Path: material.path, extra_info: material.material_name ?? material.name ?? basename(material.path),
        type: 0, metetype: track.type === 'audio' ? 'music' : material.type === 'photo' ? 'photo' : 'video',
        duration, width: material.width ?? 0, height: material.height ?? 0,
        create_time: Math.floor(now / 1000), import_time: Math.floor(now / 1000), import_time_ms: now * 1000,
        enter_from: 0, item_source: 1, md5: '', material_color_tag: '', ai_group_type: '',
        roughcut_time_range: { start: 0, duration }, sub_time_range: { start: -1, duration: -1 },
      })
    }
  }
  const draftMaterials = [{ type: 0, value: [...library.values()] }, ...[1, 2, 3, 6, 7, 8].map(type => ({ type, value: [] }))]
  const metadata = {
    draft_id: randomUUID().toUpperCase(),
    draft_name: basename(targetDir),
    draft_fold_path: targetDir,
    draft_root_path: dirname(targetDir),
    draft_json_file: join(targetDir, 'draft_info.json'),
    draft_cover: join(targetDir, 'draft_cover.jpg'),
    draft_cover_ratio: '9:16',
    draft_new_version: draft.new_version ?? '',
    draft_is_invisible: false,
    tm_draft_removed: 0,
    tm_draft_create: now * 1000,
    tm_draft_modified: now * 1000,
    tm_duration: draft.duration,
    draft_materials: draftMaterials,
    draft_timeline_materials_size_: 0,
  }
  await writeFile(join(targetDir, 'draft_meta_info.json'), JSON.stringify(metadata), 'utf8')
  await writeFile(join(targetDir, 'draft_virtual_store.json'), JSON.stringify({ draft_materials: draftMaterials, version: '1.0' }), 'utf8')
}

/**
 * @param {{episode: object, cut: {start:number, end:number}, draftRoot: string, name: string,
 *   audioLevels?: object, ffmpeg?: string, cover?: boolean,
 *   ending?: {enabled?: boolean, transitionSeconds?: number, soundPath?: string, freezeOffsetSeconds?: number}}} input
 */
export async function buildSliceDraft(input) {
  const { episode, cut, draftRoot, name, ffmpeg } = input
  if (!episode) throw new Error('缺少原集素材')
  if (!existsSync(episode.parts[0].path)) throw new Error(`原集素材不存在：${episode.parts[0].path}`)
  if (!existsSync(draftRoot)) throw new Error(`剪映草稿箱不存在：${draftRoot}`)
  const cutStart = Number(cut.start)
  const cutEnd = Number(cut.end)
  if (!Number.isFinite(cutStart) || !Number.isFinite(cutEnd) || cutEnd - cutStart < 1) throw new Error('切点区间无效')
  const targetDir = join(resolve(draftRoot), name)
  if (existsSync(targetDir)) throw new Error(`草稿同名已存在：${targetDir}`)

  const width = Math.max(2, Math.round((episode.canvas?.width ?? DEFAULT_CANVAS.width) / 2) * 2)
  const height = Math.max(2, Math.round((episode.canvas?.height ?? DEFAULT_CANVAS.height) / 2) * 2)
  const contentDuration = cutEnd - cutStart
  const plan = planSegments(episode, { start: cutStart, end: cutEnd })
  if (!plan.length) throw new Error('切点范围内没有画面，请检查素材')

  const draft = emptyDraft({ width, height })
  const materials = draft.materials
  const segments = []
  for (const item of plan) {
    const material = videoMaterial(item.part)
    const speed = { curve_speed: null, id: id(), mode: 0, speed: 1, type: 'speed' }
    materials.videos.push(material)
    materials.speeds.push(speed)
    segments.push(videoSegment(material.id, speed.id, item.source, item.target))
  }
  draft.tracks.push({
    attribute: 0,
    flag: 0,
    id: randomUUID(),
    is_default_name: true,
    name: '',
    segments,
    type: 'video',
  })
  draft.duration = us(contentDuration)
  const leveled = applyAudioLevels(draft, input.audioLevels)
  leveled.id = id().toUpperCase()
  draft.id = leveled.id
  draft.tracks = leveled.tracks

  await mkdir(targetDir, { recursive: true })

  // 草稿末尾也接上和成片一样的片尾：时停定格 + 原生炫光 + 完整音效。
  let ending
  if (input.ending?.enabled !== false) {
    const timing = await prepareDraftEnding(ffmpegPath(ffmpeg), {
      draftDir: targetDir,
      soundPath: input.ending?.soundPath,
      transitionSeconds: input.ending?.transitionSeconds,
    })
    const photo = join(targetDir, 'materials', '_ending', '定格.png')
    const freezeOffset = input.ending?.freezeOffsetSeconds ?? 1.5
    const at = Math.max(0, cutEnd - freezeOffset)
    await grabTimelineFrame({ ffmpeg: ffmpegPath(ffmpeg), episode, timelineSeconds: at, outFile: photo, width })
    applyDraftEnding(draft, { photo, width, height, ending: timing, contentDuration })
    ending = {
      title: timing.title,
      resourceId: timing.resourceId,
      transitionSeconds: timing.transitionSeconds,
      soundSeconds: Number(timing.soundDuration.toFixed(3)),
      freezeOffsetSeconds: freezeOffset,
      addedSeconds: Number(timing.duration.toFixed(3)),
      totalSeconds: Number((contentDuration + timing.duration).toFixed(3)),
    }
  }

  const removed = await removeCleanupFiles(targetDir)
  await writeMetadata(targetDir, draft)
  // 剪映 11.5 读的是新版正文文件：三份都写同一份切片时间线。
  for (const file of ['draft_info.json', 'draft_content.json', 'template.json']) {
    await writeFile(join(targetDir, file), JSON.stringify(draft), 'utf8')
  }

  let cover
  if (input.cover !== false) {
    try {
      const result = await grabTimelineFrame({
        ffmpeg: ffmpegPath(ffmpeg),
        episode,
        timelineSeconds: cutStart + 0.1,
        outFile: join(targetDir, 'draft_cover.jpg'),
        width: 720,
      })
      cover = result?.outFile
    } catch {
      // 封面失败不影响草稿可用
    }
  }

  return {
    draftDir: targetDir,
    name,
    duration: Number((ending ? contentDuration + ending.addedSeconds : contentDuration).toFixed(2)),
    contentDuration: Number(contentDuration.toFixed(2)),
    tracks: draft.tracks.map((track) => ({ type: track.type, segments: track.segments.length })),
    segments: plan.map((item) => ({ file: basename(item.part.path), source: item.source, target: item.target })),
    removed,
    cover,
    ending,
    media: { files: [...new Set(plan.map((item) => item.part.path))] },
  }
}

/** 读回草稿里的明文（渲染、修改都从草稿出发）。 */
export async function readDraft(dir) {
  for (const file of ['draft_info.json', 'draft_content.json']) {
    const path = join(dir, file)
    if (!existsSync(path)) continue
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {}
  }
  return undefined
}
