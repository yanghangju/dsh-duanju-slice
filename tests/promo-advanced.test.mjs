// Synthetic media and explicitly mocked model decisions; no real model calls or Jianying playback.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mockAsr } from './support-asr.mjs'

const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const hash = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')
const inside = (path, dir) => {
  const rel = relative(dir, path)
  return Boolean(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

test('direct promo flow mixes SRT and automatic ASR fallback in one rendered plan without Word', async (t) => {
  const root = await mkdtemp(fileURLToPath(new URL('../.promo-advanced-test-', import.meta.url)))
  const temp = join(root, 'tmp')
  const draftRoot = join(root, 'drafts')
  const env = { TEMP: temp, TMP: temp, TMPDIR: temp, LOCALAPPDATA: join(root, 'profile'), JIANYING_DRAFT_ROOT: draftRoot, DUANJU_NO_BUNDLED: '0' }
  const originalEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]))
  t.after(async () => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(temp)
  await mkdir(draftRoot)
  Object.assign(process.env, env)

  const { advanced, advancedDefaults, prepareAdvanced } = await import('../lib/promo/advanced.js')
  const { buildDocx } = await import('../lib/promo/docx.js')
  const { probe, run } = await import('../lib/promo/media.js')
  const { BUNDLED_FFMPEG, BUNDLED_FFPROBE, BUNDLED_PYTHON, BUNDLED_ENDING_SOUND, BUNDLED_ENDING_TRANSITION, DEFAULT_MUSIC_DIR } = await import('../lib/promo/runtime.js')
  const ffmpeg = process.env.FFMPEG_PATH || BUNDLED_FFMPEG
  const ffprobe = process.env.FFPROBE_PATH || BUNDLED_FFPROBE
  assert.equal(advancedDefaults().musicDir, DEFAULT_MUSIC_DIR)

  const dramaDir = join(root, 'episodes')
  const multipart = join(dramaDir, '第2集')
  const episode1 = join(dramaDir, 'ep001（英文字幕版）.mp4')
  const parts = [join(multipart, '01.mp4'), join(multipart, '02.mp4')]
  await mkdir(multipart, { recursive: true })
  for (const [i, file] of [episode1, ...parts].entries()) {
    await run(ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=90x160:rate=30',
      '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 110}:sample_rate=48000`, '-t', i ? '6' : '12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', file])
  }
  // Pulse fixture keeps actual beat analysis repeatable without using user music.
  const musicDir = join(root, 'music')
  const music = join(musicDir, 'pulses', 'pulses.wav')
  const musicIndex = join(musicDir, 'music_library.json')
  await mkdir(dirname(music), { recursive: true })
  await run(ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(mod(t\\,0.5)\\,0.04)\\,0.6*sin(2*PI*660*t)\\,0.015*sin(2*PI*220*t)):s=22050:d=20', '-c:a', 'pcm_f32le', music])
  await writeFile(musicIndex, JSON.stringify([{ directory: 'pulses', description: 'Synthetic suspense pulses; test data only.', library: 'primary' }]))
  const scriptPath = join(root, 'original-script.docx')
  await writeFile(scriptPath, buildDocx([
    { type: 'title', text: '合成回归剧' },
    ...['第一集', '甲：门后有人。', 'A: Someone is behind the door.', '乙：现在轮到我出牌。', 'B: It is my turn.',
      '第二集', '甲：追上他。', 'A: Catch him.'].map((text) => ({ type: 'p', text })),
  ]))
  const subtitleDir = join(root, '字幕')
  const subtitle1 = join(subtitleDir, 'EP01.srt')
  await mkdir(subtitleDir)
  await writeFile(subtitle1, '1\n00:00:03,000 --> 00:00:04,000\nNow it is\n\n2\n00:00:04,000 --> 00:00:05,000\nmy turn to play.\n')
  const originals = [scriptPath, subtitle1, episode1, ...parts, music, musicIndex, BUNDLED_ENDING_SOUND]
  const originalHashes = await Promise.all(originals.map(hash))

  const speech = await mockAsr([
    { definite: true, start_time: 3000, end_time: 5000, text: '现在轮到我出牌。' },
    { definite: true, start_time: 9000, end_time: 11000, text: '追上他。' },
  ])
  t.after(() => speech.close())
  const config = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, advanced: { pythonPath: process.env.DUANJU_PYTHON || BUNDLED_PYTHON }, volcApiKey: 'test-key', volcEndpoint: speech.url, volcPaceMs: 0 }
  const exec = { agent: { id: 'advanced-fixture' }, signal: t.signal }
  const visualPrompts = []
  const services = {
    agentDefaultModel: undefined,
    llm: {
      resolveModelInfo: async () => ({ inputModalities: ['image'] }),
      async *stream({ messages }) {
        const content = messages.at(-1).content
        assert.ok(content.some(({ type }) => type === 'image'), 'Visual review needs the sampled frames as images')
        const windows = []
        for (const item of content) {
          if (item.type !== 'text') continue
          if (item.text.startsWith('窗口 ')) windows.push({ text: item.text, frames: [] })
          else if (item.text.startsWith('原片时间 ')) windows.at(-1).frames.push(Number(item.text.match(/[\d.]+/)[0]))
        }
        const reviews = windows.map(({ text, frames }) => {
          const [, id] = text.match(/^窗口 (j\d+)｜/)
          const [, dialogueEnd] = text.match(/30fps保全正文边界[\d.]+–([\d.]+)秒/)
          const subtitle = text.includes('字幕锚点：')
          visualPrompts.push(subtitle ? 'subtitle' : 'asr')
          if (!subtitle) assert.ok(speech.state.packets > 0, 'ASR audio must precede visual review')
          assert.match(text, /前窗已核实连续证据/)
          const last = frames.at(-1)
          if (last < Number(dialogueEnd)) return { id, ending: 'continues', confidence: 0.99, evidence: `MOCK visual result: sampled frames end at ${last}s, before the dialogue tail.` }
          return text.includes('现在轮到我出牌。')
            ? { id, ending: 'action-complete', end: last, confidence: 0.99, evidence: `MOCK visual result: follow-on gesture ends at ${last}s.` }
            : { id, ending: 'no-action', confidence: 0.99, evidence: 'MOCK visual result: same shot, no follow-on action.' }
        })
        yield { type: 'text-delta', text: JSON.stringify({ reviews }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    attachments: { saveImages: async (images) => images.map(({ data, name }) => {
      assert.ok(data.length > 0, 'Visual review needs decoded image bytes')
      return name
    }) },
  }
  const ctx = { on: () => () => {}, get(name) {
    assert.ok(name in services, `Unexpected host service: ${name}`)
    return services[name]
  } }
  const outputRoot = join(root, 'output')
  const inputs = { dramaDir, scriptPath, musicDir, workDir: outputRoot, draftRoot }
  const prepared = await prepareAdvanced(ctx, exec, { ...inputs, subtitleDir }, config)
  assert.equal(prepared.localization, 'subtitle-first-v1')
  assert.deepEqual(prepared.subtitleFiles, { 1: subtitle1 })
  const { workDir, indexFile, bgm } = prepared
  const state = join(workDir, 'tmp')
  const task = () => json(join(state, 'advanced-task.json'))
  const call = (action, data) => advanced(ctx, exec, { action, workDir, data }, config)
  assert.equal(prepared.status, 'awaiting_proposal')
  assert.deepEqual(bgm, { db: -5, gain: 10 ** (-5 / 20) })
  assert.equal(dirname(workDir), outputRoot)
  assert.equal(prepared.runtime.ffmpeg, ffmpeg)
  assert.equal(prepared.runtime.ffprobe, ffprobe)
  assert.equal((await task()).sessionId, exec.agent.id)
  assert.equal((await task()).endingTemplate.sourceFile, BUNDLED_ENDING_SOUND)
  const index = await json(indexFile)
  assert.deepEqual(index.episodes.map(({ number }) => number), [1, 2])
  assert.equal(index.episodes[0].file, episode1)
  assert.deepEqual(index.episodes[1].parts.map(({ file }) => file), parts)
  await assert.rejects(call('sample', { episode: 2 }), /未知高级剪辑操作/)
  assert.deepEqual(await readdir(workDir), ['tmp'])
  assert.equal(existsSync(join(state, 'work')), false, 'Prepare must not extract frames')
  assert.ok((await readdir(state, { recursive: true })).every((file) => !/\.mp4$/i.test(file)), 'Prepare must not stage multipart media')

  const dialogue = (episode, source_line_id, quote_zh, purpose) =>
    ({ kind: 'dialogue', episode, source_line_id, quote_zh, purpose, seconds: 2, visual: '待定位', transition: '硬切', audio: '完整原声' })
  const shots = Array.from({ length: 12 }, (_, i) => ({ kind: 'montage', episode: 2, shot_id: `fixture-${i + 1}`,
    seconds: 0.5, purpose: `合成快切${i + 1}`, visual: '待定位', transition: '音乐重音硬切', audio: '原声静音；同曲原速' }))
  const proposal = { title: '合成冲突', story: '甲发现危机，乙原声反击。', base_montage_count: 6, segments: [
    dialogue(1, 'E1L1', '门后有人。', '开场铺垫'), ...shots, dialogue(1, 'E1L2', '现在轮到我出牌。', '同故事线原声高潮'),
  ] }
  assert.equal((await call('proposal', proposal)).status, 'editing')
  assert.equal((await task()).docxFile, undefined)
  assert.deepEqual(await readdir(workDir), ['tmp'], 'Only internal work files before rendering')
  assert.equal(existsSync(join(state, 'plan.json')), false, 'Internal targets are not yet an executable plan')
  await assert.rejects(advanced(ctx, { ...exec, agent: { id: 'unrelated-fixture' } }, { action: 'locate', workDir }, config), /会话/)
  await assert.rejects(call('confirm', {}), /未知高级剪辑操作/)

  const revision = { ...proposal, story: '实际夹具用追赶开场，后接原声反击。', segments: [
    dialogue(2, 'E2L1', '追上他。', '调整后的追赶开场'), ...proposal.segments.slice(1),
  ] }
  const subtitleRevision = { ...revision, segments: [...revision.segments.slice(0, -1), { ...revision.segments.at(-1), subtitle_quote: 'Now it is my turn to play.' }] }
  assert.equal((await call('proposal', subtitleRevision)).status, 'editing')
  const locateOptions = { provider: 'fixture', model: 'vision', concurrency: 1 }
  const located = await call('locate', locateOptions)
  assert.equal(located.status, 'complete', JSON.stringify(located))
  assert.equal(located.localization, 'subtitle-first-v1')
  assert.equal(speech.state.connections, 1, 'Only the multipart episode without SRT is transcribed')
  assert.deepEqual([...new Set(visualPrompts)].sort(), ['asr', 'subtitle'], 'Both types require local frames')
  const mainPrompts = visualPrompts.length
  const alignment = await json(located.alignmentFile)
  const [episode1Source, episode2Source] = alignment.sources
  assert.equal(episode2Source.episode, 2)
  assert.ok(!episode2Source.subtitle && existsSync(episode2Source.asr.transcriptFile))
  assert.ok(episode1Source.episode === 1 && episode1Source.subtitle.file === subtitle1 && !episode1Source.asr)
  assert.deepEqual(alignment.segments.map(({ segment_index, start, end, alignment }) => [segment_index, start,
    (alignment.subtitle_anchor ?? alignment.asr_anchor).end, end, alignment.ending, alignment.subtitle_anchor?.cueIds]), [
    [0, 9, 11, 11, 'no-action', undefined], [13, 3, 5, 5.6, 'action-complete', [1, 2]],
  ])
  for (const segment of alignment.segments) {
    const { sampling_file, subtitle_anchor, asr_anchor } = segment.alignment
    assert.equal(Boolean(subtitle_anchor), !asr_anchor)
    const anchor = subtitle_anchor ?? asr_anchor
    const sample = await json(sampling_file)
    assert.deepEqual(sample[subtitle_anchor ? 'subtitle_anchor' : 'asr_anchor'], anchor)
    if (subtitle_anchor) assert.equal(anchor.sha256, await hash(anchor.file))
    assert.ok(sample.windows.every(({ start, end, fps }) => start >= anchor.start - 0.4 - 1e-6 && end <= anchor.end + 4 + 1e-6 && fps === 5))
  }

  const { file: stagedEpisode, parts: stagedParts } = (await json(indexFile)).episodes[1]
  assert.ok(inside(stagedEpisode, state), 'Multipart episode staged inside tmp during locate')
  assert.deepEqual(stagedParts.map(({ file, target_start, target_end }) => [file, target_start, target_end]), [
    [parts[0], 0, 6], [parts[1], 6, 12],
  ])
  const staged = await probe(ffmpeg, stagedEpisode, { ffprobe })
  assert.ok(staged.hasAudio && Math.abs(staged.duration - 12) <= 1 / 30, 'The two six-second parts form a continuous episode')

  const rerun = await call('locate', locateOptions)
  assert.equal(rerun.status, 'complete', rerun.summary)
  assert.equal(rerun.reused, 2, 'Locate reuses dialogue that already passed review')
  assert.equal(visualPrompts.length, mainPrompts, 'Reused dialogue must not extract or review frames again')
  assert.equal(speech.state.connections, 1, 'Reused dialogue must not re-transcribe either')

  const { tracks } = await call('catalog')
  assert.equal(tracks.length, 1)
  await call('select_music', { trackId: tracks[0].trackId, reason: 'Synthetic pulse supports the test conflict.' })
  const beats = await call('beats')
  const analysis = await json(beats.analysis)
  assert.equal(analysis.method, 'librosa-beat-track')
  const first = analysis.events.find((event) => event.time >= 2.2)
  assert.ok(first, 'The real pulse analysis must have a later onset')
  const last = analysis.events.find((event) => event.time >= first.time + 5.8 && event.time <= first.time + 6.3)
  assert.ok(last, 'The real pulse analysis must have a roughly six-second event span')
  const fastSeconds = last.time - first.time
  const spokenClipsSeconds = alignment.segments.reduce((seconds, { start, end }) => seconds + end - start, 0)
  const plan = { title: revision.title, story: revision.story, notes: '合成回归：按本次实际定位重排。',
    segments: subtitleRevision.segments.map((segment, i) => {
      if (segment.kind !== 'montage') return alignment.segments.find(({ segment_index }) => segment_index === i)
      const start = (i - 1) * 0.75
      return { ...segment, start, end: start + fastSeconds / shots.length, available_end: start + 0.7, min_duration: 0.2, volume: 0,
        ...(i === shots.length ? { music_end: last.time } : {}) }
    }),
    audio: [{ role: 'bgm', file: beats.music.file, source_start: first.time - 2, start: 0, duration: spokenClipsSeconds + fastSeconds,
      volume_db: -20, volume: 0.1, fade_in: 0, fade_out: 0 }], // Stale overrides must be ignored.
    music_policy: { single_song: true, song_sha256: analysis.file_sha256, bgm_db: -20, preserve_audio: false },
    music_cues: { audio_index: 0, analysis_file: beats.analysis, fast_section: { source_start: first.time, source_end: last.time,
      original_duration: fastSeconds, selection: 'full', reviewed: true, evidence: 'Detected pulse events only; no listening claim.' } },
  }
  await assert.rejects(call('render', { plan }), /先用 save_plan/)
  const unproven = structuredClone(plan)
  unproven.segments.at(-1).alignment.subtitle_anchor.cueIds = [9]
  await assert.rejects(call('save_plan', unproven), /与locate证据不符/)
  // Host tool arguments are deeply frozen; save_plan must normalize a clone, not the caller's plan.
  await call('save_plan', deepFreeze(structuredClone(plan)))
  await call('sync')
  const validated = await call('validate')
  const finalized = await json(validated.planFile)
  assert.equal(finalized.beat_sync.mode, 'hierarchical')
  assert.equal(finalized.audio[0].volume_db, -5)
  assert.equal(finalized.audio[0].volume, bgm.gain)
  assert.equal(finalized.music_policy.bgm_db, -5)
  assert.deepEqual(await readdir(workDir), ['tmp'], 'Planning does not produce Word or media at the task root')

  const videoOnly = await call('render')
  assert.equal(videoOnly.status, 'video_complete_draft_pending', videoOnly.summary)
  assert.ok(videoOnly.summary.startsWith(`成片已完整解码：${videoOnly.outputPath}`), 'Report the MP4 path before any draft work')
  const renderedAt = (await stat(videoOnly.outputPath)).mtimeMs
  const render = await call('render', { jianying: true })
  assert.equal((await stat(render.outputPath)).mtimeMs, renderedAt, 'Draft recovery does not re-render')
  assert.equal(render.status, 'complete', render.summary)
  assert.equal(render.decode_check, 'passed')
  assert.equal(render.ui_playback_verified, false)
  assert.equal(render.listening_verified, false)
  assert.deepEqual(render.bgm, bgm)
  assert.ok(render.music.length && render.music.every(({ volume }) => volume === bgm.gain))
  assert.equal(render.docxFile, undefined)
  assert.deepEqual((await readdir(workDir)).sort(), ['tmp', basename(render.outputPath)].sort())
  assert.equal(render.planFile, validated.planFile)
  const executedPlan = await json(render.planFile)
  assert.equal(executedPlan.segments[0].quote_zh, '追上他。')
  assert.equal(executedPlan.native_ending.content_duration, render.contentDuration)
  const generated = await readdir(workDir, { recursive: true })
  assert.deepEqual(generated.filter((file) => basename(file) === 'plan.json'), [join('tmp', 'plan.json')])
  assert.ok(generated.every((file) => !/\.docx$/i.test(file)), 'No Word generated at any step')
  const info = await probe(ffmpeg, render.outputPath, { ffprobe })
  assert.deepEqual(info, { duration: render.duration, width: 1080, height: 1920, hasAudio: true })
  assert.ok(info.duration > render.contentDuration && info.duration <= 50)
  await run(ffmpeg, ['-v', 'error', '-xerror', '-i', render.outputPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'])

  const { jianying, clips, ending } = render
  const { draftDir, mediaDir } = jianying
  assert.equal(jianying.registration_status, 'complete')
  assert.equal(jianying.ui_playback_verified, false)
  assert.equal(dirname(draftDir), draftRoot)
  assert.equal(mediaDir, join(draftDir, '素材'))
  assert.equal(clips[0].source.file, stagedEpisode)
  assert.equal(clips.at(-1).source.file, episode1)
  assert.equal(ending.freeze.timelineTime, Math.round((render.contentDuration - 1.5) * 1e6) / 1e6)
  const copied = async (target, source) => {
    assert.ok(inside(await realpath(target), mediaDir), `Draft path must resolve inside its media directory: ${target}`)
    assert.equal(await hash(target), await hash(source), `Copied asset differs: ${target}`)
  }
  const draft = await json(join(draftDir, 'draft_content.json'))
  const { videos, audios, transitions } = draft.materials
  const video = draft.tracks.find(({ type }) => type === 'video').segments
  assert.equal(video.length, plan.segments.length + 1, 'Editable clips and freeze photo, not one flattened video')
  for (const [i, clip] of clips.entries()) {
    const item = videos.find(({ id }) => id === video[i].material_id)
    await copied(item.path, clip.file)
    assert.equal(video[i].volume, clip.volume)
  }
  assert.equal(video[0].volume, 1)
  assert.equal(video.at(-2).volume, 1)
  assert.ok(video.slice(1, -2).some(({ volume }) => volume === 0), 'Source montage still has muted original audio')
  const photo = videos.find(({ id }) => id === video.at(-1).material_id)
  assert.equal(photo.type, 'photo')
  await copied(photo.path, ending.file)
  assert.equal(photo.freeze.source_material_path, videos.find(({ id }) => id === video[ending.freeze.clipIndex].material_id).path)
  assert.deepEqual(audios.map(({ resource_id }) => resource_id ?? null), [null, '7023776340713164069'])
  await copied(audios[0].path, music)
  await copied(audios[1].path, ending.sound.file)
  assert.equal(draft.tracks.find(({ name }) => name === '剧情 BGM').segments[0].volume, bgm.gain)
  assert.equal(draft.tracks.find(({ name }) => name === ending.sound.title).segments[0].volume, 1)
  assert.equal(transitions[0].resource_id, '6726707814028284423')
  for (const file of ['config.json', 'AmazingAuto_out/main.scene', 'AmazingAuto_out/xshader/resource1/seq16-9/light12.png']) {
    await copied(join(transitions[0].path, file), join(BUNDLED_ENDING_TRANSITION, file))
  }
  const registered = await json(join(draftRoot, 'root_meta_info.json'))
  assert.deepEqual(registered.all_draft_store.map(({ draft_fold_path }) => resolve(draft_fold_path)), [draftDir])
  assert.equal((await task()).docxFile, undefined)
  assert.deepEqual(await Promise.all(originals.map(hash)), originalHashes, 'Inputs were neither rewritten nor moved')

  const planOnly = await prepareAdvanced(ctx, exec, { ...inputs, planOnly: true }, config)
  const planned = await advanced(ctx, exec, { action: 'proposal', workDir: planOnly.workDir, data: proposal }, config)
  assert.equal(planned.status, 'plan_only')
  assert.equal(planned.planFile, join(planOnly.workDir, 'tmp', 'plan.json'))
  assert.deepEqual(await json(planned.planFile), { ...proposal, plan_only: true })
  assert.deepEqual(await readdir(planOnly.workDir), ['tmp'])
  await assert.rejects(advanced(ctx, exec, { action: 'locate', workDir: planOnly.workDir }, config), /只出方案/)
  assert.equal(visualPrompts.length, mainPrompts, 'Plan-only does not see frames')
  assert.equal(speech.state.connections, 1, 'Plan-only does not connect to ASR')

  const asrTask = await prepareAdvanced(ctx, exec, inputs, config)
  assert.equal(asrTask.localization, 'asr-first-v1')
  const callAsr = (action, data) => advanced(ctx, exec, { action, workDir: asrTask.workDir, data }, config)
  await callAsr('proposal', revision)
  const asrLocated = await callAsr('locate', locateOptions)
  assert.equal(asrLocated.status, 'complete', JSON.stringify(asrLocated))
  assert.equal(speech.state.connections, 3, 'Leaving the folder unset transcribes both episodes in the new task')
  assert.ok((await json(asrLocated.alignmentFile)).segments.every(({ alignment }) => alignment.asr_anchor && !alignment.subtitle_anchor))
  assert.equal(visualPrompts.length, mainPrompts * 2, 'The ASR-first task reviews its own frames')
})
