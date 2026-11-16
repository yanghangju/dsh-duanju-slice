import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, test } from 'node:test'
import { familySummary, folderFamily, listEpisodeFolders, resolveDramaGroup, scopeFolders, surveyProject } from '../lib/draft.js'

const original = process.env.DUANJU_JIANYING_CONFIG_DIR
afterEach(() => {
  if (original === undefined) delete process.env.DUANJU_JIANYING_CONFIG_DIR
  else process.env.DUANJU_JIANYING_CONFIG_DIR = original
})

async function draft(dir, { draftId, video, storeVideo, metaPlain = true }) {
  await mkdir(dir, { recursive: true })
  const materials = video ? { videos: [{ id: 'v1', type: 'video', path: video, material_name: '素材' }] } : {}
  await writeFile(join(dir, 'draft_info.json'), JSON.stringify({ id: draftId ?? 'x', duration: 1e6, canvas_config: { width: 1080, height: 1920 }, materials, tracks: [] }))
  if (storeVideo) {
    await writeFile(join(dir, 'draft_virtual_store.json'), JSON.stringify({ draft_materials: [{ type: 0, value: [{ file_Path: storeVideo, extra_info: storeVideo.split('/').pop() }] }] }))
  }
  if (draftId && metaPlain) {
    await writeFile(join(dir, 'draft_meta_info.json'), JSON.stringify({ draft_id: draftId, draft_name: '测试草稿', draft_materials: [{ type: 0, value: [{ file_Path: storeVideo ?? video ?? '' }] }] }))
  }
}

async function config(dir, folders) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'folder_meta_info.json'), JSON.stringify({ folders: folders.map(({ id, name, createdTime }) => ({ id, name, parentId: '', createdTime: createdTime ?? new Date().toISOString() })), version: '1.0' }))
  await writeFile(join(dir, 'draft_folder_mappings.json'), JSON.stringify({ mappings: folders.flatMap(({ id, name, drafts }) => drafts.map((draftId) => ({ draftId, folderId: id, mappedTime: '2026-11-16T12:01:35' }))), version: '1.0' }))
}

test('扁平草稿箱：用剪映虚拟文件夹的成员草稿识别集号', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-virtual-'))
  try {
    const project = join(root, 'JianyingPro Drafts')
    const folderId = 'e3a59d25-0d26-4fda-a035-049f5ed889bb'
    const ids = ['7E3BF31B-3299-4976-8CF2-7F5BBBD26517', 'C8C2BACF-9952-42EC-B7F8-D7E0599A472C', 'B6E6CFA3-2DAD-4F49-99BB-B4123FEC0D79']
    await draft(join(project, '10月13日 (1) (1)'), { draftId: ids[0], video: 'materials/video/EP002.mp4' })
    await draft(join(project, '10月13日 (2) (1)'), { draftId: ids[1], video: 'materials/video/EP035.mp4' })
    await draft(join(project, '10月13日 (3) (1)'), { draftId: ids[2], video: 'materials/video/EP042.mp4' })
    const configDir = join(root, 'config')
    await config(configDir, [{ id: folderId, name: 'cut-肥胖女星', drafts: ids }])
    process.env.DUANJU_JIANYING_CONFIG_DIR = configDir

    const folders = await listEpisodeFolders(project)
    assert.deepEqual(folders.map((entry) => entry.episode), [2, 35, 42])
    assert.ok(folders.every((entry) => entry.from === 'virtual-folder' && entry.group === 'cut-肥胖女星'))

    const survey = await surveyProject(project)
    assert.equal(survey.resolution.mode, 'virtual-folder')
    assert.deepEqual(survey.resolution.groups, [{ name: 'cut-肥胖女星', members: ['10月13日 (1) (1)', '10月13日 (2) (1)', '10月13日 (3) (1)'] }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('分组对不上时，退回草稿自己素材里的 EPxxx 文件名', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-media-name-'))
  try {
    const project = join(root, 'JianyingPro Drafts')
    // 一份只有素材库线索（draft_info.json 里没有视频素材），一份时间轴里就有。
    await draft(join(project, '10月13日 (1) (1)'), { draftId: 'AAAA', storeVideo: 'materials/video/EP002.mp4' })
    await draft(join(project, '10月13日 (2) (1)'), { draftId: 'BBBB', video: 'materials/video/EP035.mp4' })
    await draft(join(project, '无关草稿'), { draftId: 'CCCC', video: 'materials/video/花絮.mp4' })
    const configDir = join(root, 'config-missing')
    process.env.DUANJU_JIANYING_CONFIG_DIR = configDir

    const folders = await listEpisodeFolders(project)
    assert.deepEqual(folders.map((entry) => entry.episode), [2, 35])
    assert.ok(folders.every((entry) => entry.from === 'draft-media'))

    const survey = await surveyProject(project)
    assert.equal(survey.resolution.mode, 'draft-media')
    assert.deepEqual(survey.resolution.groups, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('文件夹名带集号的照旧识别；没有集号的草稿也会被收进来（两类一起报，交给 scope 决定用哪族）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-name-first-'))
  try {
    const project = join(root, 'project')
    await draft(join(project, 'EP007-副本'), { video: 'materials/video/EP007.mp4' })
    await draft(join(project, '8'), { video: 'materials/video/EP008.mp4' })
    await draft(join(project, '10月13日 (1) (1)'), { draftId: 'DDDD', video: 'materials/video/EP002.mp4' })
    process.env.DUANJU_JIANYING_CONFIG_DIR = join(root, 'no-config')

    const folders = await listEpisodeFolders(project)
    assert.deepEqual(folders.map((entry) => entry.episode), [2, 7, 8])
    assert.deepEqual(folders.map((entry) => entry.from), ['draft-media', 'folder-name', 'folder-name'])
    assert.deepEqual(folders.map((entry) => entry.family), ['date', 'ep', 'ep'])
    // 两族混在一起 → 自动流程会要求明确指定，而不会自己猜。
    assert.throws(() => scopeFolders(folders), /混着多部剧/)
    assert.deepEqual([...scopeFolders(folders, ['EP007', '8'])].sort(), ['8', 'EP007-副本'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('「N-副本」这类导入命名也能认出集号，并归为 copy 命名族', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-copy-name-'))
  try {
    const project = join(root, 'project')
    for (const name of ['1-副本', '2-副本 (1)', '25-副本-未剪', '4-副本1']) await draft(join(project, name), {})
    process.env.DUANJU_JIANYING_CONFIG_DIR = join(root, 'no-config')

    const folders = await listEpisodeFolders(project)
    assert.deepEqual(folders.map((entry) => entry.episode), [1, 2, 4, 25])
    assert.ok(folders.every((entry) => entry.family === 'copy'))
    assert.equal(folderFamily('10月13日 (1) (1)'), 'date')
    assert.equal(folderFamily('EP007-副本'), 'ep')
    // 日期名看起来像数字开头，但不能被当成「N-副本」抢走。
    assert.equal(folderFamily('10月13日 (1) (1)'), 'date')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('混着多部剧时不猜：无 drafts 报错，给了 drafts 只留指定草稿', () => {  const entries = [
    { folder: '10月13日 (1) (1)', episode: 2, family: 'date' },
    { folder: '10月13日 (2) (1)', episode: 35, family: 'date' },
    { folder: '1-副本', episode: 1, family: 'copy' },
    { folder: '2-副本', episode: 2, family: 'copy' },
  ]
  assert.deepEqual(familySummary(entries).map((item) => `${item.family}:${item.drafts}`), ['date:2', 'copy:2'])
  assert.throws(() => scopeFolders(entries), /混着多部剧/)
  assert.deepEqual([...scopeFolders(entries, ['10月13日'])].sort(), ['10月13日 (1) (1)', '10月13日 (2) (1)'])
  assert.deepEqual([...scopeFolders(entries, ['2-副本'])], ['2-副本'])
  assert.throws(() => scopeFolders(entries, ['不存在']), /没有匹配项/)
  // 只有一族时照常放行。
  assert.equal([...scopeFolders(entries.filter((entry) => entry.family === 'copy'))].length, 2)
})

test('剧名先去剪映虚拟文件夹：draftId 对不上时按草稿文件夹创建时间对齐', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slice-group-'))
  try {
    const project = join(root, 'JianyingPro Drafts')
    await draft(join(project, '2-副本'), {})
    await draft(join(project, '3-副本 (1)'), {})
    await draft(join(project, '10月13日 (1) (1)'), { video: 'materials/video/EP002.mp4' })
    const configDir = join(root, 'config')
    // 三份草稿都是刚创建的，分组也登记 3 份 → 创建时间窗口应当正好命中这 3 份。
    await config(configDir, [{ id: 'group-1', name: 'cut-掌权先知', drafts: ['AAAA', 'BBBB', 'CCCC'], createdTime: new Date().toISOString() }])
    process.env.DUANJU_JIANYING_CONFIG_DIR = configDir

    const resolved = await resolveDramaGroup({ drama: '《掌权先知：豪门复仇者》', projectDir: project })
    assert.equal(resolved.folder.name, 'cut-掌权先知')
    assert.equal(resolved.memberCount, 3)
    assert.equal(resolved.how, 'created-time')
    assert.deepEqual([...resolved.folders].sort(), ['10月13日 (1) (1)', '2-副本', '3-副本 (1)'])

    // 数量对不上就不认（宁可报错也不猜）。
    const configDir2 = join(root, 'config-2')
    await config(configDir2, [{ id: 'group-2', name: 'cut-掌权先知', drafts: ['A', 'B'], createdTime: new Date().toISOString() }])
    process.env.DUANJU_JIANYING_CONFIG_DIR = configDir2
    const unresolved = await resolveDramaGroup({ drama: '掌权先知', projectDir: project })
    assert.equal(unresolved.unresolved, 'members')
    assert.deepEqual(unresolved.folders, [])

    // 剧名和分组名对不上时不乱认。
    const other = await resolveDramaGroup({ drama: '肥胖女星的逆袭', projectDir: project })
    assert.equal(other.folder, undefined)
    assert.equal(other.unresolved, 'no-match')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})