// Import original source ranges as editable segments into 剪映's draft box (草稿箱).
//
// 剪映 keeps one folder per draft under its draft root: draft_content.json is
// the timeline, draft_meta_info.json is the card in the list. root_meta_info.json
// is the list itself, so the new draft is appended there as well — 剪映 otherwise
// only shows it after it rescans the root on the next launch.
//
// The schema below is the one 剪映 11.x opens and silently migrates on save;
// it mirrors a draft 剪映 itself wrote on this machine. Every referenced file is
// copied into the draft's own 素材/ folder, so the draft never points outside it.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { validateMusicSegments } from './bgm.js'
import { ENDING_SOUND, ENDING_TRANSITION, FREEZE_OFFSET, findEndingTransition } from './ending.js'
import { probe, run } from './media.js'

const JIANYING_HOME = join(process.env.LOCALAPPDATA ?? '', 'JianyingPro')
const DRAFT_ROOT = join(JIANYING_HOME, 'User Data', 'Projects', 'com.lveditor.draft')
const GLOBAL_SETTING = join(JIANYING_HOME, 'User Data', 'Config', 'globalSetting')

const SCHEMA = { version: 360_000, newVersion: '110.0.0', appVersion: '5.9.0' }
const MEDIA_DIR = '素材'
const MEDIA_BUCKETS = { episodes: '原片', audio: '音频', ending: '片尾' }

/** Keep every expected bucket, including editable local BGM and fade materials. */
const MATERIAL_BUCKETS = [
  'ai_translates', 'audio_balances', 'audio_effects', 'audio_fades', 'audio_track_indexes', 'audios', 'beats',
  'canvases', 'chromas', 'color_curves', 'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens',
  'handwrites', 'hsl', 'images', 'log_color_wheels', 'loudnesses', 'manual_deformations', 'masks',
  'material_animations', 'material_colors', 'multi_language_refs', 'placeholders', 'plugin_effects',
  'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops', 'smart_relights', 'sound_channel_mappings',
  'speeds', 'stickers', 'tail_leaders', 'text_templates', 'texts', 'time_marks', 'transitions', 'video_effects',
  'video_trackings', 'videos', 'vocal_beautifys', 'vocal_separations',
]

const us = (seconds) => Math.round(seconds * 1_000_000)
const hex = () => randomUUID().replace(/-/g, '')
const slash = (path) => path.replace(/\\/g, '/')
const timecode = (seconds) => {
  const whole = Math.floor(seconds)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/** 剪映's own draft root, honouring the custom location set in its settings. */
export function findDraftRoot(config = {}) {
  const configured = config.jianying?.draftRoot ?? process.env.JIANYING_DRAFT_ROOT
  return [configured, customDraftPath(), DRAFT_ROOT].filter(Boolean).find((dir) => existsSync(dir))
}

function customDraftPath() {
  try {
    const match = /^currentCustomDraftPath=(.+)$/m.exec(readFileSync(GLOBAL_SETTING, 'utf8'))
    return match?.[1].trim().replace(/\\\\/g, '\\')
  } catch {
    return undefined
  }
}

function platform() {
  return { app_id: 3704, app_source: 'lv', app_version: SCHEMA.appVersion, os: 'windows' }
}

function draftContent({ clips, music, sfx, ending, width, height, duration }) {
  const materials = Object.fromEntries(MATERIAL_BUCKETS.map((bucket) => [bucket, []]))
  const videos = ending ? [...clips, ending.clip] : clips
  // Timeline labels come from material_name: each range needs its own record,
  // even when several records reference the same original file.
  materials.videos = videos.map(({ source: { file, info }, id, name, freeze }) => ({
    audio_fade: null,
    category_id: '',
    category_name: freeze ? '' : 'local',
    check_flag: 63487,
    crop: {
      upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0,
      lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1,
    },
    crop_ratio: 'free',
    crop_scale: 1,
    duration: freeze ? 10_800_000_000 : us(info.duration),
    ...(freeze ? { freeze, has_audio: false } : {}),
    height: info.height ?? height,
    id,
    local_material_id: '',
    material_id: id,
    material_name: name,
    media_path: '',
    path: file,
    type: freeze ? 'photo' : 'video',
    width: info.width ?? width,
  }))
  // Native overlap lives on the outgoing plot segment; target ranges stay adjacent.
  if (ending) materials.transitions.push({
    adjust_params: [], category_id: '39663', category_name: '热门',
    duration: us(ending.transition.duration), effect_id: ENDING_TRANSITION.resourceId, id: hex(),
    is_ai_transition: false, is_overlap: true, name: ENDING_TRANSITION.title,
    path: slash(ending.transition.path), platform: 'all', request_id: '',
    resource_id: ENDING_TRANSITION.resourceId, source_platform: 1, sub_type: 0,
    task_id: '', third_resource_id: ENDING_TRANSITION.resourceId, type: 'transition', video_path: '',
  })
  // 剪映 expects a speed material behind every segment, even at 1.0x.
  materials.speeds = videos.map(() => ({ curve_speed: null, id: hex(), mode: 0, speed: 1, type: 'speed' }))
  const audioSegment = (segment, musicId = '', trackIndex = 1) => {
    const id = hex()
    const speed = { curve_speed: null, id: hex(), mode: 0, speed: 1, type: 'speed' }
    const fade = { id: hex(), type: 'audio_fade', fade_type: 0, fade_in_duration: us(segment.fadeIn), fade_out_duration: us(segment.fadeOut) }
    materials.audios.push({ id, local_material_id: id, type: 'extract_music', name: segment.title,
      path: segment.file, duration: us(segment.sourceDuration), category_id: '', category_name: 'local',
      music_id: musicId, app_id: 3704, source_platform: 0, check_flag: 1,
      ...(musicId ? { type: 'sound', effect_id: musicId, resource_id: musicId, source_platform: 1 } : {}) })
    materials.speeds.push(speed)
    materials.audio_fades.push(fade)
    return {
      id: hex(), material_id: id, source_timerange: { start: us(segment.sourceStart), duration: us(segment.duration) },
      target_timerange: { start: us(segment.targetStart), duration: us(segment.duration) },
      volume: segment.volume, last_nonzero_volume: segment.volume, speed: 1, reverse: false,
      visible: true, is_loop: false, is_tone_modify: false, clip: null, uniform_scale: null,
      common_keyframes: [], keyframe_refs: [], extra_material_refs: [speed.id, fade.id],
      track_attribute: 0, track_render_index: trackIndex, render_index: 0,
    }
  }
  const musicSegments = music.map((segment) => audioSegment(segment))
  const soundEffectSegments = ending ? [audioSegment(ending.sound, ending.sound.resourceId, 2)] : []
  let targetStart = 0

  return {
    canvas_config: { width, height, ratio: 'original' },
    color_space: 0,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null,
      extract_audio_last_index: 1, lyrics_recognition_id: '', lyrics_sync: true, lyrics_taskinfo: [],
      maintrack_adsorb: true, material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none', original_sound_last_index: 1,
      record_audio_last_index: 1, sticker_max_index: 1, subtitle_keywords_config: null,
      subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [], system_font_list: [],
      video_mute: false, zoom_info_params: null,
    },
    create_time: 0,
    cover: null,
    duration,
    extra_info: null,
    fps: 30,
    free_render_index_mode_on: false,
    group_container: null,
    id: hex(),
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: platform(),
    materials,
    mutable_config: null,
    name: '',
    new_version: SCHEMA.newVersion,
    platform: platform(),
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks: [{
      attribute: 0,
      flag: 0,
      id: hex(),
      is_default_name: false,
      name: '投流切片',
      segments: videos.map((clip, index) => {
        const start = targetStart
        targetStart += clip.duration
        return {
          enable_adjust: true,
          enable_color_correct_adjust: false,
          enable_color_curves: true,
          enable_color_match_adjust: false,
          enable_color_wheels: true,
          enable_lut: true,
          enable_smart_color_adjust: false,
          last_nonzero_volume: clip.volume ?? 1,
          reverse: false,
          track_attribute: 0,
          track_render_index: 0,
          visible: true,
          id: hex(),
          material_id: clip.id,
          target_timerange: { start, duration: clip.duration },
          common_keyframes: [],
          keyframe_refs: [],
          source_timerange: { start: clip.start, duration: clip.duration },
          speed: 1,
          volume: clip.volume ?? 1,
          extra_material_refs: [materials.speeds[index].id,
            ...(ending && index === clips.length - 1 ? [materials.transitions[0].id] : [])],
          is_tone_modify: false,
          clip: {
            alpha: 1,
            flip: { horizontal: false, vertical: false },
            rotation: 0,
            scale: { x: 1, y: 1 },
            transform: { x: 0, y: 0 },
          },
          uniform_scale: { on: true, value: 1 },
          hdr_settings: { intensity: 1, mode: 1, nits: 1000 },
          render_index: 1,
        }
      }),
      type: 'video',
    }, ...(musicSegments.length ? [{ attribute: 0, flag: 0, id: hex(), is_default_name: false,
      name: '剧情 BGM', type: 'audio', segments: musicSegments }] : []),
    ...sfx.map((segment, index) => ({ attribute: 0, flag: 0, id: hex(), is_default_name: false,
      name: segment.title, type: 'audio', segments: [audioSegment(segment, '', index + 3)] })),
    ...(soundEffectSegments.length ? [{ attribute: 0, flag: 0, id: hex(), is_default_name: false,
      name: ending.sound.title, type: 'audio', segments: soundEffectSegments }] : [])],
    update_time: 0,
    version: SCHEMA.version,
  }
}

function draftMeta({ draftId, draftName, folder, root, duration, size, cover }) {
  const now = Date.now() * 1000
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: cover,
    draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: slash(folder),
    draft_has_unfinished_aigc_video_effect: false,
    draft_id: draftId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_infinite_canvas_draft: false,
    draft_is_invisible: false,
    draft_is_pippit_draft: false,
    draft_is_web_article_video: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })),
    draft_materials_copied_info: [],
    draft_name: draftName,
    draft_need_rename_folder: false,
    draft_new_version: '',
    draft_removable_storage_device: /^[a-z]:/i.test(root) ? root.slice(0, 2) : '',
    draft_root_path: root,
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: size,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    pippit_avatar_url: '',
    pippit_extra_info: '',
    pippit_id: '',
    pippit_user_name: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_draft_removed: 0,
    tm_duration: us(duration),
  }
}

function rootMetaEntry({ draftId, draftName, folder, root, duration, size, cover }) {
  const now = Date.now() * 1000
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: cover ? slash(join(folder, cover)) : '',
    draft_fold_path: slash(folder),
    draft_id: draftId,
    draft_is_ai_shorts: false,
    draft_is_cloud_temp_draft: false,
    draft_is_infinite_canvas_draft: false,
    draft_is_invisible: false,
    draft_is_pippit_draft: false,
    draft_is_web_article_video: false,
    draft_json_file: slash(join(folder, 'draft_content.json')),
    draft_name: draftName,
    draft_new_version: '',
    draft_root_path: root,
    draft_timeline_materials_size: size,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    pippit_avatar_url: '',
    pippit_extra_info: '',
    pippit_id: '',
    pippit_user_name: '',
    streaming_edit_draft_ready: true,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_draft_removed: 0,
    tm_duration: us(duration),
  }
}

/** First used frame as the list thumbnail; a missing cover only costs the thumbnail. */
async function coverFrame(ffmpeg, videoPath, folder, start = 0) {
  try {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', videoPath, '-frames:v', '1', '-q:v', '4', join(folder, 'draft_cover.jpg')])
    return 'draft_cover.jpg'
  } catch {
    return ''
  }
}

// ponytail: one process-local queue; close 剪映 before importing to avoid external writers.
let registration = Promise.resolve()

/** Preserve the old list on read/format/write errors and serialize concurrent imports. */
function register(file, entry) {
  const next = registration.then(async () => {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const meta = text === undefined ? { all_draft_store: [], draft_ids: 0 } : JSON.parse(text)
    if (!Array.isArray(meta?.all_draft_store)) throw new Error('草稿列表格式异常，为避免覆盖已有草稿，未更新列表')
    if (text !== undefined && !existsSync(`${file}.bak`)) await writeFile(`${file}.bak`, text, 'utf8')
    const store = meta.all_draft_store.filter((item) => item.draft_fold_path !== entry.draft_fold_path)
    const pending = `${file}.${hex()}.tmp`
    await writeFile(pending, JSON.stringify({ ...meta, all_draft_store: [entry, ...store] }), 'utf8')
    await rename(pending, file)
  })
  registration = next.catch(() => {})
  return next
}

async function registerStores(root, entry) {
  // 剪映's default list also owns its active custom root.
  const stores = [join(root, 'root_meta_info.json')]
  const custom = customDraftPath()
  if (custom && root.toLowerCase() === resolve(custom).toLowerCase() && root.toLowerCase() !== resolve(DRAFT_ROOT).toLowerCase() && existsSync(DRAFT_ROOT)) stores.push(join(DRAFT_ROOT, 'root_meta_info.json'))
  const registered = []
  const warnings = []
  for (const file of stores) {
    try { await register(file, entry); registered.push(file) }
    catch (error) { warnings.push(`草稿文件已生成，但草稿列表更新失败：${file}（${error.message}）；请关闭剪映并检查列表后重试登记`) }
  }
  return { registered, warnings }
}

/** Retry only this already-written draft; never create a second folder to repair a list. */
export async function retryDraftRegistration({ draftDir, draftRoot }) {
  const folder = resolve(draftDir)
  const root = resolve(draftRoot)
  if (dirname(folder).toLowerCase() !== root.toLowerCase()) throw new Error('已有草稿不属于预期根目录')
  const meta = JSON.parse(await readFile(join(folder, 'draft_meta_info.json'), 'utf8'))
  const content = JSON.parse(await readFile(join(folder, 'draft_content.json'), 'utf8'))
  if (typeof meta.draft_id !== 'string' || !meta.draft_id || typeof content.id !== 'string' || resolve(meta.draft_fold_path).toLowerCase() !== folder.toLowerCase() || resolve(meta.draft_root_path).toLowerCase() !== root.toLowerCase() || !Number.isFinite(content.duration) || content.duration <= 0 || meta.tm_duration !== content.duration) throw new Error('已有草稿内容与元数据不一致，不重新登记')
  for (const item of [...content.materials.videos, ...content.materials.audios, ...content.materials.transitions]) {
    if (!isAbsolute(item.path)) throw new Error('已有草稿正式素材路径无效')
    const info = await stat(item.path)
    if (!info.isDirectory() && (!info.isFile() || !info.size)) throw new Error('已有草稿正式素材不可用，不重新登记')
  }
  const entry = rootMetaEntry({ draftId: meta.draft_id, draftName: meta.draft_name, folder, root, duration: content.duration / 1e6, size: meta.draft_timeline_materials_size_, cover: existsSync(join(folder, 'draft_cover.jpg')) ? 'draft_cover.jpg' : '' })
  return registerStores(root, entry)
}

/**
 * Copy every referenced material inside the draft folder, so the draft keeps opening
 * after the source episodes, the task tmp folder or the music library move away.
 * One copy per source path; same-name materials in one bucket get a numeric suffix.
 */
function materialStager(folder) {
  const root = join(folder, MEDIA_DIR)
  const copies = new Map()
  const reserved = new Set()
  const key = (path) => process.platform === 'win32' ? path.toLowerCase() : path
  const reserve = async (dir, name) => {
    await mkdir(dir, { recursive: true })
    const extension = extname(name)
    const stem = name.slice(0, name.length - extension.length)
    for (let index = 1; ; index++) {
      const target = join(dir, index === 1 ? name : `${stem}-${index}${extension}`)
      if (reserved.has(key(target)) || existsSync(target)) continue
      reserved.add(key(target))
      return target
    }
  }
  const copy = async (source, bucket) => {
    const file = resolve(source)
    if (copies.has(key(file))) return copies.get(key(file))
    const target = await reserve(join(root, bucket), basename(file))
    await copyFile(file, target)
    copies.set(key(file), target)
    return target
  }
  return {
    copy,
    async copyTree(source, bucket) {
      const dir = resolve(source)
      if (copies.has(key(dir))) return copies.get(key(dir))
      const target = await reserve(join(root, bucket), basename(dir))
      await cp(dir, target, { recursive: true, force: false, errorOnExist: true })
      copies.set(key(dir), target)
      return target
    },
    copied(source) {
      const target = copies.get(key(resolve(source)))
      if (target === undefined) throw new Error(`草稿素材未复制：${source}`)
      return target
    },
  }
}

/**
 * Write ordered original-source clips as editable segments; videoPath is cover-only
 * when clips are supplied. With no clips, import the full video as one segment.
 * Referenced media is copied into the draft so the draft is self-contained.
 * An optional native 炫光 transition, PNG freeze and complete sound stay independently editable.
 * Explicit draftRoot isolates tests; no installed root returns `{ skipped }`.
 */
export async function importToJianying({ videoPath, name, draftRoot, ffmpeg, ffprobe, clips, music = [], sfx = [], ending, size } = {}) {
  const exe = ffmpeg || 'ffmpeg'
  const detectedRoot = draftRoot || findDraftRoot()
  if (!detectedRoot) return { skipped: '未检测到剪映草稿目录（安装并启动一次剪映，或在配置里指定 jianying.draftRoot）' }
  const root = resolve(detectedRoot)
  const preview = videoPath ? resolve(videoPath) : undefined
  const hasClips = clips !== undefined
  if (hasClips && (!Array.isArray(clips) || !clips.length)) throw new Error('剪映片段清单必须是非空数组')
  if (!hasClips && !preview) throw new Error('请提供原片片段 clips 或视频 videoPath')

  const sources = new Map()
  const ranges = []
  for (const clip of hasClips ? clips : [{ file: preview, start: 0 }]) {
    if (!clip || typeof clip.file !== 'string' || !clip.file.trim()) throw new Error('剪映片段缺少原视频路径 file')
    const file = resolve(clip.file)
    const key = process.platform === 'win32' ? file.toLowerCase() : file
    if (!sources.has(key)) {
      const info = await probe(exe, file, { ffprobe })
      if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error(`无法读取视频时长：${file}`)
      sources.set(key, { file, info, bytes: (await stat(file)).size })
    }
    const source = sources.get(key)
    const start = clip.start
    const end = hasClips ? clip.end : source.info.duration
    if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > source.info.duration || us(end - start) <= 0) {
      throw new Error(`剪映片段时间范围无效：${file}（${start}–${end} 秒，原片时长 ${source.info.duration} 秒）`)
    }
    const episode = clip.episode ?? Number(/ep\s*0*(\d{1,3})/i.exec(basename(file))?.[1])
    if (hasClips && (!Number.isInteger(episode) || episode <= 0)) throw new Error(`剪映片段缺少有效集数 episode，且文件名无法识别集数：${file}`)
    const label = hasClips ? `第${episode}集中${timecode(start)}到${timecode(end)}` : basename(file)
    const volume = clip.volume ?? 1
    if (!Number.isFinite(volume) || volume < 0 || volume > 2) throw new Error('原声音量必须为0–2')
    ranges.push({ source, id: hex(), name: label, start: us(start), duration: us(end - start), volume })
  }
  const first = ranges[0]
  const width = size?.width ?? first.source.info.width ?? 1080
  const height = size?.height ?? first.source.info.height ?? 1920
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)) throw new Error('剪映画布尺寸必须为正整数')
  let durationUs = ranges.reduce((total, clip) => total + clip.duration, 0)
  let duration = durationUs / 1_000_000
  validateMusicSegments(music, duration)
  if (!Array.isArray(sfx)) throw new Error('SFX必须为数组')
  for (const segment of sfx) validateMusicSegments([segment], duration)
  const musicSources = new Map()
  const musicRanges = []
  const sfxRanges = []
  for (const [index, segment] of [...music, ...sfx].entries()) {
    const file = resolve(segment.file)
    if (!musicSources.has(file)) {
      const info = await probe(exe, file, { ffprobe })
      if (!info.hasAudio) throw new Error(`BGM 素材没有可读取的音轨：${file}`)
      musicSources.set(file, { info, bytes: (await stat(file)).size })
    }
    const ranges = index < music.length ? musicRanges : sfxRanges
    ranges.push({ ...segment, file, sourceDuration: musicSources.get(file).info.duration })
  }
  // Recheck against the current audio file, not a stale/hand-edited source duration.
  validateMusicSegments(musicRanges, duration)
  for (const segment of sfxRanges) validateMusicSegments([segment], duration)
  let endingRange
  let endingBytes = 0
  if (ending !== undefined) {
    if (ending?.schemaVersion !== 2) throw new Error('旧版片尾不能作为原生炫光/定格导入，请重新运行 duanju_render 合成后再导入剪映')
    const { sound, transition, freeze, transitionSeconds } = ending
    if (!sound || ending.title !== ENDING_SOUND.title || ending.resourceId !== ENDING_SOUND.resourceId
      || sound.title !== ending.title || sound.resourceId !== ending.resourceId) throw new Error('片尾音效必须保留原名称与资源编号')
    if (!transition || transition.title !== ENDING_TRANSITION.title || transition.resourceId !== ENDING_TRANSITION.resourceId
      || !Number.isFinite(transitionSeconds) || transitionSeconds <= 0 || transitionSeconds > 10
      || transition.duration !== transitionSeconds) throw new Error('片尾必须使用剪映原生「炫光」转场，时长须一致且为大于 0、不超过 10 秒的有限数值')
    for (const [label, file] of [['定格 PNG', ending.file], ['音效', sound.file], ['转场目录', transition.path], ['定格原片', freeze?.sourceFile]]) {
      if (typeof file !== 'string' || !file.trim() || !isAbsolute(file)) throw new Error(`片尾${label}必须使用稳定素材的绝对路径`)
    }
    const halfTransitionUs = us(transitionSeconds / 2)
    const transitionStartUs = us(duration - transitionSeconds / 2)
    if (!Number.isFinite(ending.targetStart) || us(ending.targetStart) !== durationUs) throw new Error('片尾起点必须对齐原片各段的微秒时长之和')
    if (![transition.start, sound.targetStart].every((value) => Number.isFinite(value) && us(value) === transitionStartUs)
      || ranges.at(-1).duration < halfTransitionUs) throw new Error(`原生转场及片尾音效必须从剧情结束前 ${transitionSeconds / 2} 秒同起，最后剧情段至少需 ${transitionSeconds / 2} 秒`)
    if (![ending.duration, sound.duration, sound.sourceDuration].every((value) => Number.isFinite(value) && value > 0 && Number.isSafeInteger(us(value)) && us(value) > 0)
      || sound.duration < transitionSeconds) throw new Error(`片尾音效须完整且至少 ${transitionSeconds} 秒，定格时长必须有效`)
    const frames = Math.ceil((sound.duration - transitionSeconds / 2) * 30)
    if (us(ending.duration) !== us(frames / 30) || (ending.frames !== undefined && ending.frames !== frames)
      || us(ending.duration) < halfTransitionUs || !Number.isSafeInteger(durationUs + us(ending.duration))) throw new Error('片尾定格须按 30fps 向上取整到完整音效结束，不得缩短原生转场或时间线')
    if (sound.sourceStart !== 0 || us(sound.sourceDuration) !== us(sound.duration)
      || sound.volume !== 1 || sound.fadeIn !== 0 || sound.fadeOut !== 0) throw new Error('片尾音效必须完整保留源区间和原音量，不得裁剪或淡入淡出')
    const freezeTimeUs = durationUs - us(FREEZE_OFFSET)
    if (!freeze || freeze.offsetSeconds !== FREEZE_OFFSET || !Number.isFinite(freeze.timelineTime)
      || freezeTimeUs < 0 || us(freeze.timelineTime) !== freezeTimeUs
      || !Number.isInteger(freeze.clipIndex) || !Number.isFinite(freeze.sourceTime) || freeze.sourceTime < 0) throw new Error('定格必须取未加片尾的剧情结束前 1.5 秒，并保留准确的原片映射')
    let freezeIndex = 0
    let freezeStartUs = 0
    while (freezeIndex < ranges.length && freezeStartUs + ranges[freezeIndex].duration <= freezeTimeUs) {
      freezeStartUs += ranges[freezeIndex++].duration
    }
    const freezeSource = ranges[freezeIndex]
    const freezeFile = resolve(freeze.sourceFile)
    if (!freezeSource || freeze.clipIndex !== freezeIndex
      || (process.platform === 'win32' ? freezeFile.toLowerCase() !== freezeSource.source.file.toLowerCase() : freezeFile !== freezeSource.source.file)
      || Math.abs(us(freeze.sourceTime) - (freezeSource.start + freezeTimeUs - freezeStartUs)) > 1) throw new Error('定格原片/集数/源时间与剧情结束前 1.5 秒的跨片段映射不符，请重新合成')
    // Unlike the legacy BGM probe tolerance, no music may spill into the ending.
    if (musicRanges.some((segment) => us(segment.targetStart) + us(segment.duration) > durationUs)) throw new Error('剧情 BGM 不能进入片尾')
    try {
      await findEndingTransition({ transitionPath: transition.path })
      if (!(await stat(transition.path)).isDirectory()) throw new Error('素材路径不是目录')
      for (const file of ['config.json', 'AmazingAuto_out/main.scene']) {
        const info = await stat(join(transition.path, file))
        if (!info.isFile() || !info.size) throw new Error(`缺少有效资源 ${file}`)
      }
    } catch (error) {
      throw new Error(`片尾原生炫光转场素材无效：${error.message}`)
    }
    const photoStat = await stat(ending.file)
    const soundStat = await stat(sound.file)
    if (!photoStat.isFile() || !photoStat.size || !soundStat.isFile() || !soundStat.size) throw new Error('片尾定格或音效不是有效素材文件')
    const png = await readFile(ending.file)
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error('片尾定格必须是真实 PNG，且尺寸必须匹配成片画布')
    // PNG has no Duration banner; decode it instead of using the video-only probe.
    await run(exe, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', ending.file, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-'])
    const soundInfo = await probe(exe, sound.file, { ffprobe })
    // ffmpeg's banner rounds to centiseconds; retain the decoded sample precision.
    if (!soundInfo.hasAudio || soundInfo.width || soundInfo.height
      || !Number.isFinite(soundInfo.duration) || soundInfo.duration <= 0
      || Math.abs(soundInfo.duration - sound.sourceDuration) > 0.01) throw new Error('片尾音效必须为有效独立音频，且完整时长必须匹配实际素材')
    endingRange = {
      clip: { source: { file: ending.file, info: { width, height } }, id: hex(), name: '定格', start: 0, duration: us(ending.duration), volume: 0,
        freeze: { reverse_material_path: '', source_material_id: freezeSource.id, source_material_path: freezeSource.source.file, timestamp: us(freeze.sourceTime) } },
      sound: { ...sound }, transition,
    }
    endingBytes = photoStat.size + soundStat.size
    durationUs += endingRange.clip.duration
    duration = durationUs / 1_000_000
  }
  const bytes = [...sources.values(), ...musicSources.values()].reduce((total, source) => total + source.bytes, endingBytes)

  const title = String(name || basename(first.source.file).replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]/g, '').trim() || '投流切片'
  await mkdir(root, { recursive: true })
  let folder
  do {
    folder = join(root, `${title}-${hex().slice(0, 8)}`)
  } while (existsSync(folder))
  await mkdir(folder, { recursive: true })

  const draftId = randomUUID()
  const draftName = basename(folder)
  // Media lives inside the draft; a failed copy removes the half-written card again.
  const staged = materialStager(folder)
  let cover = ''
  try {
    for (const source of sources.values()) await staged.copy(source.file, MEDIA_BUCKETS.episodes)
    for (const segment of [...musicRanges, ...sfxRanges]) await staged.copy(segment.file, MEDIA_BUCKETS.audio)
    let transition
    if (endingRange) {
      await staged.copy(endingRange.clip.source.file, MEDIA_BUCKETS.ending)
      await staged.copy(endingRange.sound.file, MEDIA_BUCKETS.ending)
      transition = await staged.copyTree(endingRange.transition.path, MEDIA_BUCKETS.ending)
    }
    const endingDraft = endingRange && {
      ...endingRange,
      clip: {
        ...endingRange.clip,
        source: { ...endingRange.clip.source, file: staged.copied(endingRange.clip.source.file) },
        freeze: { ...endingRange.clip.freeze, source_material_path: staged.copied(endingRange.clip.freeze.source_material_path) },
      },
      sound: { ...endingRange.sound, file: staged.copied(endingRange.sound.file) },
      transition: { ...endingRange.transition, path: transition },
    }
    const audio = (segment) => ({ ...segment, file: staged.copied(segment.file) })
    cover = await coverFrame(exe, preview ?? first.source.file, folder, preview ? 0 : first.start / 1_000_000)
    await writeFile(join(folder, 'draft_content.json'), JSON.stringify(draftContent({
      clips: ranges.map((clip) => ({ ...clip, source: { ...clip.source, file: staged.copied(clip.source.file) } })),
      music: musicRanges.map(audio), sfx: sfxRanges.map(audio), ending: endingDraft, width, height, duration: durationUs,
    })), 'utf8')
    await writeFile(join(folder, 'draft_meta_info.json'), JSON.stringify(draftMeta({ draftId, draftName, folder, root, duration, size: bytes, cover })), 'utf8')
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }

  const entry = rootMetaEntry({ draftId, draftName, folder, root, duration, size: bytes, cover })
  const { registered, warnings } = await registerStores(root, entry)

  return { draftRoot: root, draftDir: folder, draftName, duration, segmentCount: ranges.length, musicSegmentCount: musicRanges.length,
    endingSegmentCount: endingRange ? 1 : 0, soundEffectSegmentCount: sfxRanges.length + (endingRange ? 1 : 0),
    mediaDir: join(folder, MEDIA_DIR), cover: cover ? join(folder, cover) : '', registered, warnings }
}
