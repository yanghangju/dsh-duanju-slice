window.__ModuleLoader__.load({
  id: 'dsh-duanju-slice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'duanju-slice';
    const CONVERSATION = 'duanju.slice.conversation';
    const CACHE_KEY = 'dsh-duanju-slice:lastSessionId:v1';
    const SETUP_KEY = 'dsh-duanju-slice:setupSessionId:v1';
    const fields = ['scriptPath', 'dramaDir', 'subtitleDir', 'exportDir'];
    const requiredFields = fields.filter(field => field !== 'subtitleDir');
    const defaults = normalize({});
    const dictionaries = {
      zh: {
        'task.current': '当前会话', 'task.close': '收起会话列表', 'sessions.list': '会话列表', title: '切片工作台', sessions: '剪辑会话', 'sessions.new': '新建会话', 'sessions.empty': '还没有剪辑会话',
        'sessions.rename': '重命名', 'sessions.remove': '移出列表', 'sessions.removeAccept': '移出列表',
        'sessions.removeConfirm': '将这条任务移出列表？对话记录、成片和草稿都会保留。',
        'sessions.noResult': '等待配置', 'sessions.done': '第 {episode} 集 · {start}–{end}',
        'ago.now': '刚刚', 'ago.minute': '{n} 分钟', 'ago.hour': '{n} 小时', 'ago.day': '{n} 天',
        scriptPath: '剧本 DOCX', dramaDir: '短剧目录', subtitleDir: '字幕目录（可选）', exportDir: '成片保存目录', direction: '切片方向',
        'empty.scriptPath': '选择剧本文件', 'empty.dramaDir': '选择短剧所在文件夹', 'empty.subtitleDir': '选择字幕所在文件夹', 'empty.exportDir': '选择成片保存位置',
        'help.scriptPath': '按剧本选段，定位台词后抽帧核验动作', 'help.dramaDir': '每集一个视频，或每集一个文件夹放视频', 'help.exportDir': 'MP4 将保存到这里，原素材保持不变',
        'help.subtitleDir': '优先使用按集号命名的 .srt（如 EP01.srt）。缺少可用字幕或未可靠匹配到完整台词时，自动对未定位的台词使用语音识别。留空则直接用语音识别。两种方式定位后均抽帧核验完整动作。', 'clear.subtitleDir': '清除字幕目录', 'config.subtitles': '字幕优先：{name}', 'config.noSubtitles': '台词：语音识别',
        'missing.scriptPath': '请先选择剧本', 'missing.dramaDir': '请选择短剧目录', 'missing.exportDir': '请选择成片保存目录', 'missing.direction': '再写下这一条想剪的方向',
        'form.title': '开始一段剪辑对话', 'form.subtitle': '设置素材和方向后即可开始剪辑，在同一会话里持续修改。',
        'form.sources': '素材与输出', 'form.direction': '这一条，想剪什么？', 'form.directionHelp': '描述想突出的冲突、人物或情节。越具体，选段越有针对性。',
        'placeholder.direction': '例如：复仇向，突出女主当众揭穿谎言的片段，结尾保留悬念。',
        'form.examples': '试试这样写', 'example.revenge': '复仇反转', 'example.reveal': '当众揭穿', 'example.family': '亲情冲突',
        'value.revenge': '复仇向：人物从被欺负到反击，突出反转与情绪爆发。', 'value.reveal': '当众揭穿谎言，保留对方的反应，结尾停在冲突最强的位置。', 'value.family': '亲情冲突：突出家人之间的误解、对峙和情绪转折。',
        'form.ready': '锁定后不能更改模式、素材、保存位置或方向；需要更改请新建会话。', 'form.done': '继续聊修改要求，每一版都会保留。',
        'mode.label': '剪辑模式', 'mode.mix': '混剪', 'mode.slice': '单集切片',
        'mode.mix.help': '可跨集选材，配乐卡点，保留原声高潮与固定片尾。', 'mode.slice.help': '只剪一集中的连续原片，保留原声，不加配乐或片尾。',
        'chat.help.slice': '例如：“开头提前两秒，保留原片结尾。”也可以指定集号和原片起止时间。',
        'progress.draft.slice': '正在准备连续片段', 'step.draft.slice': '准备片段', 'result.noDraft': '未生成剪映草稿；MP4 可直接打开。',
        'config.title': '素材与方向配置', 'config.lock': '锁定配置', 'config.locked': '配置已锁定', 'config.noDirection': '未填写方向', 'editor.open': '打开剪映', 'editor.opening': '正在打开…', 'error.editor': '{detail}',
        generate: '生成初版', 'generate.running': '正在切片…', 'generate.more': '按方向再剪一版', 'chat.edit': '对话剪辑', 'chat.continue': '继续对话修改', 'chat.running': '正在回复…', 'badge.chatting': '对话中',
        'badge.setup': '待配置', 'badge.ready': '可以开始', 'badge.running': '执行中', 'badge.done': '可继续修改', 'badge.error': '未完成', 'badge.waiting': '需要回复',
        'preview.title': '成片预览', 'preview.empty': '成片会出现在这里', 'preview.help': '选好素材和方向，锁定配置后即可生成。',
        'preview.loading': '正在加载视频预览…', 'preview.failed': '预览暂不可用，可直接打开成片。', 'preview.large': '视频超过内嵌预览大小限制，请直接打开成片。', 'preview.retry': '重新加载预览',
        'result.title': '当前剪辑', 'result.previous': '上次成功的成片', 'result.episode': '第 {episode} 集', 'result.episodes': '取材 {n} 集', 'result.duration': '{n} 秒', 'result.range': '原片 {start}–{end}', 'result.opening': '开场：第 {episode} 集 {start}–{end}', 'result.versions': '切换剪辑版本', 'result.version': 'V{version} · {n}秒',
        'result.video': 'MP4 成片', 'result.draft': '剪映草稿', 'result.pending': '完成后生成', 'result.open': '打开成片', 'result.reveal': '查看文件', 'result.draftOpen': '打开草稿目录',
        'result.draftHint': '剪映在启动时扫描草稿箱。新草稿生成后，请重启剪映再打开。',
        'progress.title': '正在制作这条切片', 'progress.help': '进度来自实际剪辑流程，可以切换任务或展开对话查看详情。',
        'progress.queued': '等待剪辑助手启动', 'progress.survey': '正在读取素材与剧本', 'progress.pick': '正在选段', 'progress.locate': '正在定位台词', 'progress.draft': '正在生成剪映草稿', 'progress.render': '正在渲染成片',
        'step.survey': '读取素材', 'step.pick': '选段定位', 'step.draft': '生成草稿', 'step.render': '渲染成片',
        'progress.stopped': '任务已停止', 'progress.stoppedHelp': '本次没有收到完成结果。可展开对话查看原因，或重新开始。', 'progress.failed': '这次切片未完成',
        'progress.refreshError': '进度暂时无法刷新，请稍后重试或查看对话。', 'progress.pending': '剪辑助手需要你的回复，请展开对话查看。',
        'chat.open': '展开对话', 'chat.close': '收起对话', 'chat.title': '剪辑助手', 'chat.help': '例如：“让反转更早出现，保留结尾的完整对白。”BGM 固定为 −12 dB。', 'chat.details': '查看执行详情',
        choose: '选择', change: '更换', cancel: '取消', confirm: '知道了', notice: '请检查任务信息', retry: '重试',
        'status.loading': '读取中', 'status.saved': '已保存', 'status.saving': '保存中…', 'status.dirty': '待保存', 'status.error': '保存失败', loading: '正在读取切片任务…',
        'validation.paths': '请先选择剧本、短剧目录和保存目录，并填写切片方向。', 'validation.docx': '剧本必须是 .docx 文件。',
        'error.open': '读取任务失败：{detail}', 'error.save': '设置保存失败：{detail}', 'error.prompt': '启动失败：{detail}', 'error.session': '任务操作失败：{detail}', 'error.pick': '选择失败：{detail}', 'error.output': '无法打开文件：{detail}',
        'error.hostPath': '无法获取本机路径，请使用桌面版或目录浏览器。', 'error.response': '服务返回了无效数据', 'error.command': '操作失败', 'error.unknown': '未知错误，请重试',
        pickerTitle: '选择{field}', pickerHelp: '浏览本机文件，不会上传。', address: '目录路径', go: '前往', parent: '上一级', roots: '常用目录', entries: '目录内容', browsing: '正在读取目录…', empty: '这里没有可选择的项目', truncated: '仅显示前 200 项，请输入更具体的目录。', selectFolder: '选择当前目录', selectFile: '选择此 DOCX', folder: '文件夹', docx: 'DOCX 文件', 'error.browse': '读取目录失败：{detail}',
        'environment.check': '正在读取运行环境状态…', 'environment.title': '首次运行配置', 'environment.button': '配置运行环境', 'environment.prepare': '正在打开配置对话…',
        'environment.reconfigure': '重新配置环境', 'environment.reconfigureHelp': '另开一条配置对话，保留当前记录。',
        'environment.help': '先检查是否已配置语音识别 API Key，再在对话中检查剪辑依赖并补齐缺少的工具与默认曲库。',
        'settings.title': '工作台设置', 'asr.setup': '配置语音识别', 'asr.label': '豆包语音 API Key', 'asr.private': '密钥存入本机凭据，不会发送到剪辑对话。',
        'asr.required': '未找到语音识别 API Key。保存后将继续配置运行环境。',
        'asr.check': '正在检查密钥…', 'asr.configured': '已检测到密钥。填入新密钥可替换，服务会在识别时验证。', 'asr.missing': '未配置。填写 API Key 后即可使用语音识别。',
        'asr.checkError': '暂时无法检查密钥状态。', 'asr.saveError': '保存失败，请检查 API Key 格式或稍后重试。',
        'asr.save': '保存密钥', 'asr.continue': '保存并继续', 'asr.saving': '正在保存…', 'asr.saved': '语音识别 API Key 已保存。', 'asr.close': '关闭',
        'update.label': '插件更新', 'update.check': '检查更新', 'update.checking': '正在检查…',
        'update.current': '无需更新（当前版本 {version}）。', 'update.available': '发现新版 {version}',
        'update.versions': '当前版本 {currentVersion} · 新版本 {version}', 'update.notes': '发布说明', 'update.noNotes': '这个版本没有发布说明。',
        'update.help': '请先完成正在进行的剪辑。更新只替换插件，不删除工作台数据。', 'update.install': '立即更新',
        'update.installing': '正在下载、校验并安装，请勿关闭 DeepSeek Harness。', 'update.applied': '插件已更新至 {version}。如仍看到旧界面，请刷新页面。',
        'update.restart-required': '已安装 {version}，请重启 DeepSeek Harness 使新版生效。',
        'update.error.check': '未能从 GitHub 获取版本信息，请稍后重试。', 'update.error.asset': '新版没有可校验的安装包，暂不能自动更新。',
        'update.error.unavailable': '更新服务尚未加载，请完全退出并重新打开 DeepSeek Harness 后再检查。',
        'update.error.connection': '无法连接工作台的更新服务，请刷新页面后重试。',
        'update.error.changed': '更新确认已失效或插件状态已变更，请重新检查更新。', 'update.error.busy': '另一个更新正在进行，请稍后再试。',
        'update.error.editing': '插件正在处理剪辑。任务结束后，请重新检查更新。', 'update.error.managed': '该插件不是当前配置的可卸载安装，请在插件管理中更新。',
        'update.error.download': '下载或校验失败，旧插件未改动。请重新检查更新。', 'update.error.remove': '无法卸载旧插件，未安装新版。请在插件管理中查看。',
        'update.error.install': '未能确认更新结果，请在插件管理中查看当前版本。', 'update.error.restored': '新版安装失败，已恢复旧版。',
        'update.error.restoreFailed': '更新未完成，且无法恢复旧版。请在插件管理中重新安装。',
        'environment.chat': '运行环境配置', 'environment.working': '正在配置，详情见下方对话。', 'environment.pending': '请在下方对话确认或回复后继续。',
        'environment.waiting': '若配置未完成，直接在下方回复「请继续配置运行环境」，无需另开会话。',
        'environment.done': '运行环境已就绪。请新建会话开始剪辑。', 'environment.error': '环境配置操作失败：{detail}', 'environment.statusError': '暂时无法验证配置状态：{detail}',
        prompt: '请按这些设置调用 duanju_slice_cut，生成当前会话的一个新版本：\n```json\n{parameters}\n```\n保留已有版本，只制作一条，不生成 Word。完成后简短说明集号、时间码和交付文件位置。',
      },
      en: {
        'task.current': 'Current conversation', 'task.close': 'Collapse conversation list', 'sessions.list': 'Conversations', title: 'Slice studio', sessions: 'Editing conversations', 'sessions.new': 'New conversation', 'sessions.empty': 'No conversations yet', 'sessions.rename': 'Rename', 'sessions.remove': 'Remove from list', 'sessions.removeAccept': 'Remove', 'sessions.removeConfirm': 'Remove this task from the list? Its conversation, video and draft will be kept.', 'sessions.noResult': 'Needs setup', 'sessions.done': 'Episode {episode} · {start}–{end}',
        'ago.now': 'now', 'ago.minute': '{n}m', 'ago.hour': '{n}h', 'ago.day': '{n}d',
        scriptPath: 'Script DOCX', dramaDir: 'Drama folder', subtitleDir: 'Subtitle folder (optional)', exportDir: 'Export folder', direction: 'Slice direction',
        'empty.scriptPath': 'Choose a script', 'empty.dramaDir': 'Choose the drama folder', 'empty.subtitleDir': 'Choose the subtitle folder', 'empty.exportDir': 'Choose where to save the video',
        'help.scriptPath': 'Select scenes from the script, locate the dialogue, then review frames for complete action', 'help.dramaDir': 'One video per episode, or one folder per episode', 'help.exportDir': 'The MP4 is saved here; source footage stays intact',
        'help.subtitleDir': 'Use .srt files named by episode number first (e.g. EP01.srt). If subtitles are missing, unusable, or do not reliably match a complete line, speech recognition runs automatically for unmatched lines only. Leave empty to use speech recognition from the start. Either way, frames are checked after locating dialogue to verify the full action.', 'clear.subtitleDir': 'Clear subtitle folder', 'config.subtitles': 'Subtitles first: {name}', 'config.noSubtitles': 'Dialogue: speech recognition',
        'missing.scriptPath': 'Choose a script first', 'missing.dramaDir': 'Choose a drama folder', 'missing.exportDir': 'Choose an export folder', 'missing.direction': 'Describe the direction for this slice',
        'form.title': 'Start an editing conversation', 'form.subtitle': 'Choose sources and a direction, start editing, and keep refining it here.', 'form.sources': 'Sources & output', 'form.direction': 'What should this slice focus on?', 'form.directionHelp': 'Describe a conflict, character or moment. Specific details help select the scene.', 'placeholder.direction': 'For example: revenge — expose the lie in public, ending on a cliffhanger.', 'form.examples': 'Try a direction', 'example.revenge': 'Revenge', 'example.reveal': 'Expose a lie', 'example.family': 'Family conflict', 'value.revenge': 'Revenge: focus on the turn from being bullied to fighting back.', 'value.reveal': 'Expose a lie in public, include the reaction, and end at the peak of the conflict.', 'value.family': 'Family conflict: focus on misunderstandings, confrontations and emotional turns.', 'form.ready': 'Once locked, start a new conversation to change the mode, sources, export folder, or direction.', 'form.done': 'Keep refining in this conversation. Earlier versions are retained.',
        'mode.label': 'Editing mode', 'mode.mix': 'Montage', 'mode.slice': 'Single-episode clip',
        'mode.mix.help': 'Select across episodes, sync to music, and keep the original climax and fixed ending.', 'mode.slice.help': 'Cut one continuous excerpt from a single episode with its original audio. No added music or ending.',
        'chat.help.slice': 'Try “start two seconds earlier, keeping the end of the clip.” You can also specify an episode and source time range.',
        'progress.draft.slice': 'Preparing the excerpt', 'step.draft.slice': 'Prepare excerpt', 'result.noDraft': 'No Jianying draft was created. You can open the MP4 directly.',
        generate: 'Generate first version', 'generate.running': 'Making your slice…', 'generate.more': 'Cut a new version', 'chat.edit': 'Chat to edit', 'chat.continue': 'Continue editing', 'chat.running': 'Replying…', 'badge.chatting': 'In conversation', 'badge.setup': 'Needs setup', 'badge.ready': 'Ready', 'badge.running': 'Running', 'badge.done': 'Ready to edit', 'badge.error': 'Incomplete', 'badge.waiting': 'Needs your reply',
        'preview.title': 'Video preview', 'preview.empty': 'Your video will appear here', 'preview.help': 'Choose sources, describe a direction, then start.', 'preview.loading': 'Loading video…', 'preview.failed': 'Preview unavailable. You can open the video directly.', 'preview.large': 'This video exceeds the inline preview limit. Open it directly.', 'preview.retry': 'Reload preview',
        'result.title': 'Current edit', 'result.previous': 'Previous successful video', 'result.episode': 'Episode {episode}', 'result.episodes': '{n} source episodes', 'result.duration': '{n} seconds', 'result.range': 'Source {start}–{end}', 'result.opening': 'Opening: episode {episode} {start}–{end}', 'result.video': 'MP4 video', 'result.draft': 'Jianying draft', 'result.pending': 'Available when complete', 'result.open': 'Open video', 'result.reveal': 'Show file', 'result.draftOpen': 'Open draft folder', 'result.draftHint': 'Restart Jianying after generation so the new draft appears in its draft library.',
        'progress.title': 'Making your slice', 'progress.help': 'Progress follows the actual editing pipeline. Switch tasks or open chat for details.', 'progress.queued': 'Waiting for the editing agent', 'progress.survey': 'Reading footage and script', 'progress.pick': 'Selecting a scene', 'progress.locate': 'Locating dialogue', 'progress.draft': 'Writing the Jianying draft', 'progress.render': 'Rendering the video', 'step.survey': 'Read sources', 'step.pick': 'Locate scene', 'step.draft': 'Write draft', 'step.render': 'Render video', 'progress.stopped': 'Task stopped', 'progress.stoppedHelp': 'No completion result was received. Open chat for details or try again.', 'progress.failed': 'This slice could not finish', 'progress.refreshError': 'Progress could not refresh. Retry shortly or check chat.', 'progress.pending': 'The editing agent needs your reply. Open the chat to respond.',
        'chat.open': 'Open chat', 'chat.close': 'Close chat', 'chat.title': 'Editing assistant', 'chat.help': 'Try “bring the reveal earlier and keep the final line intact.” Music is fixed at −12 dB.', 'chat.details': 'View execution details', 'result.versions': 'Switch edit version', 'result.version': 'V{version} · {n}s',
        'config.title': 'Sources and direction', 'config.lock': 'Lock settings', 'config.locked': 'Settings locked', 'config.noDirection': 'No direction yet', 'editor.open': 'Open Jianying', 'editor.opening': 'Opening…', 'error.editor': '{detail}',
        choose: 'Choose', change: 'Change', cancel: 'Cancel', confirm: 'OK', notice: 'Check task information', retry: 'Retry', 'status.loading': 'Loading', 'status.saved': 'Saved', 'status.saving': 'Saving…', 'status.dirty': 'Unsaved', 'status.error': 'Save failed', loading: 'Loading slice tasks…',
        'validation.paths': 'Choose a script, project folder and export folder, and enter a direction.', 'validation.docx': 'The script must be a .docx file.', 'error.open': 'Could not load task: {detail}', 'error.save': 'Could not save: {detail}', 'error.prompt': 'Could not start: {detail}', 'error.session': 'Task operation failed: {detail}', 'error.pick': 'Selection failed: {detail}', 'error.output': 'Could not open file: {detail}', 'error.hostPath': 'Local path unavailable. Use Desktop or the file browser.', 'error.response': 'Invalid service response', 'error.command': 'Operation failed', 'error.unknown': 'Unknown error. Try again.',
        pickerTitle: 'Choose {field}', pickerHelp: 'Browse local files. Nothing is uploaded.', address: 'Folder path', go: 'Go', parent: 'Up one level', roots: 'Locations', entries: 'Contents', browsing: 'Reading folder…', empty: 'No matching items', truncated: 'Showing the first 200 entries. Enter a more specific path.', selectFolder: 'Choose this folder', selectFile: 'Choose this DOCX', folder: 'Folder', docx: 'DOCX file', 'error.browse': 'Could not read folder: {detail}',
        'environment.check': 'Checking runtime status…', 'environment.title': 'First-time setup', 'environment.button': 'Set up runtime', 'environment.prepare': 'Opening the setup conversation…',
        'environment.reconfigure': 'Reconfigure runtime', 'environment.reconfigureHelp': 'Open a new setup conversation and keep this one.',
        'environment.help': 'First, check for a speech recognition API key. The assistant then checks the editing dependencies and installs any missing tools and the default music library.',
        'settings.title': 'Workbench settings', 'asr.setup': 'Set up speech recognition', 'asr.label': 'Doubao Speech API key', 'asr.private': 'The key is saved to the local credential store, not the editing chat.',
        'asr.required': 'No speech recognition API key was found. Save one to continue runtime setup.',
        'asr.check': 'Checking for an API key…', 'asr.configured': 'A key was found. You can replace it here. The service checks it when you use speech recognition.', 'asr.missing': 'Not configured. Add an API key to use speech recognition.',
        'asr.checkError': 'Could not check the key status.', 'asr.saveError': 'Could not save the API key. Check its format or try again.',
        'asr.save': 'Save key', 'asr.continue': 'Save and continue', 'asr.saving': 'Saving…', 'asr.saved': 'Speech recognition API key saved.', 'asr.close': 'Close',
        'update.label': 'Plugin updates', 'update.check': 'Check for updates', 'update.checking': 'Checking…',
        'update.current': 'No update needed (current version {version}).', 'update.available': 'Version {version} is available',
        'update.versions': 'Current version {currentVersion} · New version {version}', 'update.notes': 'Release notes', 'update.noNotes': 'No release notes were provided.',
        'update.help': 'Finish any active edits first. This replaces only the plugin and keeps your workbench data.', 'update.install': 'Update now',
        'update.installing': 'Downloading, verifying and installing. Keep DeepSeek Harness open.', 'update.applied': 'Updated to {version}. Refresh the page if you still see the old interface.',
        'update.restart-required': 'Version {version} is installed. Restart DeepSeek Harness to use it.',
        'update.error.check': 'Could not get release information from GitHub. Try again later.', 'update.error.asset': 'The release has no verifiable package and cannot be installed automatically.',
        'update.error.unavailable': 'The update service is not loaded. Fully quit and reopen DeepSeek Harness, then check again.',
        'update.error.connection': 'Could not connect to the workbench update service. Refresh the page and try again.',
        'update.error.changed': 'The confirmation expired or the plugin changed. Check for updates again.', 'update.error.busy': 'Another update is in progress. Try again later.',
        'update.error.editing': 'The plugin is processing an edit. Wait for it to finish and check again.', 'update.error.managed': 'This profile does not own a removable install. Use the plugin manager to update it.',
        'update.error.download': 'Download or verification failed. The old version was not changed. Check for updates again.', 'update.error.remove': 'Could not remove the old plugin. The update was not installed. Check the plugin manager.',
        'update.error.install': 'Could not confirm the update. Check the current version in the plugin manager.', 'update.error.restored': 'Installation failed. The old version was restored.',
        'update.error.restoreFailed': 'The update failed and the old version could not be restored. Reinstall it in the plugin manager.',
        'environment.chat': 'Runtime setup', 'environment.working': 'Setting up the runtime. See the conversation below.', 'environment.pending': 'Confirm or reply in the conversation to continue.',
        'environment.waiting': 'If setup is incomplete, reply “Please continue setup” below. You can keep using this conversation.',
        'environment.done': 'The runtime is ready. Start a new conversation to begin editing.', 'environment.error': 'Runtime setup action failed: {detail}', 'environment.statusError': 'Could not verify the setup status yet: {detail}',
        prompt: 'Call duanju_slice_cut to make a new version in this conversation:\n```json\n{parameters}\n```\nKeep previous versions. Make one version without a Word file, then briefly give the episode, timecode, and output paths.',
      },
    };

    function normalize(value) {
      return {
        ...Object.fromEntries(fields.map((key) => [key, String(value[key] ?? '').trim()])),
        direction: String(value.direction ?? '').trim(),
        mode: value.mode === 'slice' ? 'slice' : 'mix',
      };
    }
    function validation(value, generating = false) {
      const settings = normalize(value);
      if (settings.scriptPath && !/\.docx$/i.test(settings.scriptPath)) return 'validation.docx';
      if (generating && (requiredFields.some((key) => !settings[key]) || !settings.direction)) return 'validation.paths';
      return null;
    }
    function changedSettings(value, patch) {
      const next = { ...value, ...patch };
      if (value.dramaDir && next.dramaDir.trim() !== value.dramaDir.trim() && !Object.hasOwn(patch, 'subtitleDir')) next.subtitleDir = '';
      return next;
    }
    function runParameters(value) {
      const { subtitleDir, ...settings } = normalize(value);
      return settings.mode === 'slice' ? settings : { ...settings, subtitleDir };
    }
    const shortName = (path) => path ? path.split(/[\\/]/).filter(Boolean).pop() || path : '';
    const duration = (result) => Number((result.duration ?? (result.end - result.start)).toFixed(1));
    function Icon({ name, size = 16, className }) {
      const paths = {
        chevron: 'M7 10l5 5 5-5', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l4 4L19 6',
        play: 'M8 5l11 7-11 7z', arrow: 'M7 17L17 7M7 7h10v10',
        folder: 'M3 7a2 2 0 012-2h5l2 3h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
        doc: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8zM14 3v5h6M8 12h8M8 16h5',
        chat: 'M21 11.5a8.5 8.5 0 01-8.5 8.5H3l2.5-4.5A8.5 8.5 0 1121 11.5zM8 10h8M8 14h5',
        panel: 'M4 4h16v16H4zM9 4v16M15 9l-3 3 3 3', panelOpen: 'M4 4h16v16H4zM9 4v16M12 9l3 3-3 3',
        edit: 'M4 20l4-1 12-12-3-3L5 16zM14 7l3 3', lock: 'M5 10h14v11H5zM8 10V7a4 4 0 018 0v3', film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4',
        settings: 'M10 3h4l.5 2.7 1.8 1 2.6-.9 2 3.4-2.1 1.9v2l2.1 1.9-2 3.4-2.6-.9-1.8 1-.5 2.5h-4l-.5-2.5-1.8-1-2.6.9-2-3.4 2.1-1.9v-2L3.1 9.2l2-3.4 2.6.9 1.8-1zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z',
        info: 'M12 8h.01M12 11v6M22 12a10 10 0 11-20 0 10 10 0 0120 0',
        alert: 'M12 8v5M12 16h.01M10.2 4.2L2.5 17.5A1.7 1.7 0 004 20h16a1.7 1.7 0 001.5-2.5L13.8 4.2a2.1 2.1 0 00-3.6 0',
        spinner: 'M21 12a9 9 0 11-9-9', dot: 'M12 11h.01', refresh: 'M20 10a8 8 0 10-1 7M20 4v6h-6',
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className }, h('path', { d: paths[name] || paths.info }));
    }

    function FilmIcon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        h('path', { d: 'M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4M7 12h10' }));
    }

    const css = `
.wb-root{--wb-bg:var(--dsw-alias-bg-base,#fff);--wb-soft:color-mix(in srgb,var(--dsw-alias-label-primary,#202530) 3.5%,var(--dsw-alias-bg-base,#fff));--wb-line:var(--dsw-alias-border-l2,#e5e7ed);--wb-ink:var(--dsw-alias-label-primary,#202530);--wb-ink2:var(--dsw-alias-label-secondary,#555e6e);--wb-ink3:var(--dsw-alias-label-tertiary,#767f8f);--wb-hover:var(--dsw-alias-interactive-bg-hover,#edf0f6);--wb-accent:var(--dsw-alias-brand-primary,#4565e8);--wb-success:#278653;--wb-error:#c74743;position:relative;display:flex;flex:1;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--wb-bg);color:var(--wb-ink);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif);container:studio / inline-size}
.wb-root *,.wb-root *::before,.wb-root *::after{box-sizing:border-box}
.wb-root button,.wb-root input,.wb-root textarea{font:inherit;color:inherit}
.wb-root button{cursor:pointer}
.wb-root button:disabled{cursor:default;opacity:.45}
.wb-root button,.wb-root a,.wb-root textarea,.wb-root input{outline-offset:3px}
.wb-root :focus-visible{outline:2px solid var(--wb-accent)}
.wb-root svg{flex:none;vertical-align:middle}
.wb-root h1,.wb-root h2,.wb-root h3,.wb-root p{margin:0}



.wb-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;margin-left:8px;padding:0 5px;border-radius:4px;background:color-mix(in srgb,var(--wb-ink) 6%,transparent);font-size:10px;color:var(--wb-ink2);font-weight:500;font-variant-numeric:tabular-nums}
.wb-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--wb-ink2)}
.wb-icon-button:hover{background:var(--wb-hover)}


.wb-sessions{display:flex;flex:0 0 220px;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--wb-line);background:var(--wb-bg);outline:none}
.wb-sessions-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:68px;padding:calc(16px + min(40px,var(--dsh-frame-leading-clearance,0px))) 12px 16px 16px;border-bottom:1px solid var(--wb-line)}
.wb-sessions-head h2{display:flex;align-items:center;white-space:nowrap;font-size:12px;font-weight:600}
.wb-sessions-empty{padding:18px 16px;font-size:12px;color:var(--wb-ink3)}
.wb-sessions-scrim{display:none}
.wb-items{flex:1;min-height:0;overflow-y:auto;list-style:none;margin:0;padding:6px;scrollbar-width:thin}
.wb-item{position:relative;margin-bottom:3px;border:0;border-radius:6px}
.wb-item[aria-current="true"]{background:color-mix(in srgb,var(--wb-accent) 8%,var(--wb-bg))}.wb-item[aria-current="true"]::before{content:"";position:absolute;left:0;top:16px;bottom:16px;width:2px;border-radius:2px;background:var(--wb-accent);pointer-events:none}
.wb-item-select{display:block;width:100%;min-width:0;padding:11px 12px 10px;border:0;border-radius:6px;background:transparent;text-align:left}
.wb-item-select:hover{background:var(--wb-hover)}.wb-item[aria-current="true"] .wb-item-select:hover{background:color-mix(in srgb,var(--wb-accent) 11%,var(--wb-bg))}
.wb-item-row{display:flex;align-items:baseline;gap:10px;min-width:0;margin-bottom:5px}
.wb-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px}.wb-item[aria-current="true"] .wb-item-name{color:var(--wb-ink);font-weight:600}
.wb-dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:var(--wb-ink3)}
.wb-dot[data-state="done"]{background:var(--wb-success)}
.wb-dot[data-state="error"]{background:var(--wb-error)}
.wb-dot[data-state="running"]{background:var(--wb-accent)}
.wb-item-sub{display:flex;align-items:center;gap:6px;min-width:0;padding-right:3px;font-size:11px;line-height:17px;color:var(--wb-ink2)}.wb-item-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wb-item-sub .wb-dot{width:4px;height:4px}.wb-item:hover .wb-item-sub,.wb-item:focus-within .wb-item-sub{padding-right:53px}
.wb-item-time{flex:none;font-size:10px;font-weight:400;line-height:16px;color:var(--wb-ink3);font-variant-numeric:tabular-nums;white-space:nowrap}
.wb-item-tools{position:absolute;bottom:6px;right:6px;display:none;gap:2px;padding:0;border:0;border-radius:4px;background:var(--wb-soft)}.wb-item[aria-current="true"] .wb-item-tools{background:color-mix(in srgb,var(--wb-accent) 8%,var(--wb-bg))}
.wb-item:hover .wb-item-tools,.wb-item:focus-within .wb-item-tools{display:flex}
.wb-item-tools .wb-icon-button{width:24px;height:24px}
.wb-item-input{width:calc(100% - 14px);margin:7px;padding:5px 7px;min-width:0;border:1px solid var(--wb-accent);border-radius:5px;background:var(--wb-bg)}






.wb-main,.wb-shell{position:relative;display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.wb-main{container:slice / inline-size}
.wb-root:has(>.wb-sessions) .wb-bar{padding-inline-start:20px}
@container studio (max-width:850px){.wb-sessions{position:absolute;inset:0 auto 0 0;z-index:21;width:min(260px,calc(100% - 40px));box-shadow:12px 0 30px #00000012}.wb-sessions-scrim{position:absolute;inset:0;z-index:20;display:block;border:0;background:#10182733}}
.wb-bar{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;min-height:68px;padding:16px 28px;border-bottom:1px solid var(--wb-line)}
.wb-brand{display:flex;align-items:center;gap:10px;min-width:0}
.wb-brand>svg{color:var(--wb-accent)}
.wb-title{font-size:16px;font-weight:600;letter-spacing:-.3px;white-space:nowrap}
.wb-bar-right{display:flex;align-items:center;gap:16px}
.wb-state{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px;color:var(--wb-ink3)}
.wb-state[data-state="error"]{color:var(--wb-error)}
.wb-state[data-state="saving"] svg{animation:wb-spin 1s linear infinite}
.wb-secondary,.wb-ghost{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:6px 11px;border:1px solid var(--wb-line);border-radius:7px;background:var(--wb-bg);text-decoration:none;font-size:12px;white-space:nowrap}
.wb-secondary:hover:not(:disabled){border-color:var(--wb-ink3);background:var(--wb-soft)}
.wb-ghost{border-color:transparent;background:transparent;color:var(--wb-ink2)}
.wb-ghost:hover{background:var(--wb-hover)}
.wb-scroll{flex:1;min-height:0;overflow:auto;scrollbar-width:thin}
.wb-content{max-width:1280px;margin:0 auto;padding:24px 28px}
.wb-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:20px}
.wb-heading h2{font-size:23px;line-height:1.35;font-weight:600;letter-spacing:-.6px;overflow-wrap:anywhere}
.wb-heading p{margin-top:7px;font-size:12px;color:var(--wb-ink2)}
.wb-badge{display:inline-flex;align-items:center;gap:6px;flex:none;margin-top:5px;padding:4px 9px;border:1px solid var(--wb-line);border-radius:5px;color:var(--wb-ink2);font-size:11px;white-space:nowrap}
.wb-badge[data-state="ready"],.wb-badge[data-state="running"],.wb-badge[data-state="waiting"]{border-color:color-mix(in srgb,var(--wb-accent) 22%,transparent);color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 6%,transparent)}
.wb-badge[data-state="done"]{color:var(--wb-success);background:color-mix(in srgb,var(--wb-success) 6%,transparent);border-color:color-mix(in srgb,var(--wb-success) 22%,transparent)}
.wb-badge[data-state="error"]{color:var(--wb-error)}
.wb-workspace{display:grid;grid-template-columns:minmax(300px,.92fr) minmax(300px,1.08fr);align-items:start;gap:24px}
.wb-form{display:flex;flex-direction:column;gap:18px;min-width:0}
.wb-card{min-width:0;border:1px solid var(--wb-line);border-radius:10px;background:var(--wb-bg);overflow:hidden}
.wb-card-head{display:flex;align-items:center;gap:9px;padding:17px 20px;border-bottom:1px solid var(--wb-line)}
.wb-card-head h3{font-size:13px;font-weight:600}
.wb-step-number{font-size:10px;font-weight:500;letter-spacing:.04em;color:var(--wb-ink3)}
.wb-fields{padding:4px 20px}
.wb-mode{min-inline-size:0;margin:14px 0 6px;padding:0;border:0}
.wb-mode legend{padding:0;font-size:12px;font-weight:600}
.wb-mode-options{display:flex;flex-wrap:wrap;gap:6px;margin-block:6px}
.wb-mode-options label{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 10px;border:1px solid var(--wb-line);border-radius:6px;font-size:12px;cursor:pointer}
.wb-mode-options label:has(:checked){border-color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 7%,var(--wb-bg))}
.wb-mode-options input{margin:0;accent-color:var(--wb-accent)}
.wb-mode p{color:var(--wb-ink2);font-size:11px}
.wb-field{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;column-gap:12px;padding:14px 0}
.wb-field+.wb-field{border-top:1px solid var(--wb-line)}
.wb-field-label{display:block;margin-bottom:0;font-size:12px;font-weight:500;color:var(--wb-ink2)}
.wb-file-choice{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:43px;padding:10px 11px;border:1px solid var(--wb-line);border-radius:7px;background:var(--wb-soft);text-align:left}
.wb-file-choice:hover:not(:disabled){border-color:var(--wb-accent)}
.wb-file-choice:disabled{opacity:1!important}.wb-file-choice>svg{color:var(--wb-ink3)}
.wb-file-choice[data-empty="false"]>svg{color:var(--wb-accent)}
.wb-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.wb-file-choice[data-empty="true"] .wb-file-name{color:var(--wb-ink3)}
.wb-file-controls{display:flex;align-items:center;gap:6px;min-width:0}
.wb-file-action{flex:none;font-size:11px;color:var(--wb-accent)}
.wb-field .wb-field-hint{grid-column:1/-1;margin-top:5px;font-size:11px;color:var(--wb-ink2)}
.wb-direction{padding:17px 20px 18px}
.wb-direction label{display:block;font-size:13px;font-weight:600}
.wb-direction p{margin-top:6px;margin-bottom:12px;font-size:11.5px;color:var(--wb-ink2);line-height:1.7}
.wb-direction textarea{display:block;width:100%;min-height:100px;max-height:260px;resize:vertical;padding:12px 13px;border:1px solid var(--wb-line);border-radius:7px;background:var(--wb-bg);line-height:1.75;font-size:13px}
.wb-direction textarea::placeholder{color:var(--wb-ink3)}
.wb-direction textarea:focus{border-color:var(--wb-accent)}
.wb-examples{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:11px}
.wb-examples button{padding:4px 8px;border:1px solid var(--wb-line);border-radius:5px;background:transparent;color:var(--wb-ink2);font-size:10.5px}
.wb-examples button:hover:not(:disabled){color:var(--wb-accent);border-color:var(--wb-accent)}
.wb-form-footer{display:flex;flex-direction:column;gap:10px}
.wb-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:43px;padding:10px 18px;border:1px solid var(--wb-accent);border-radius:7px;background:var(--wb-accent);color:#fff!important;font-size:13px;font-weight:500;transition:background .15s,transform .15s}
.wb-primary:hover:not(:disabled){background:#3453d6;transform:translateY(-1px)}
.wb-primary:active:not(:disabled){transform:translateY(0)}
.wb-primary:disabled{opacity:1!important;border-color:var(--wb-line);background:var(--wb-soft);color:var(--wb-ink3)!important}
.wb-form-note{font-size:11px;text-align:center;color:var(--wb-ink3)}
.wb-generate{justify-content:center;min-height:36px}
.wb-version-select{max-width:180px;border:1px solid var(--wb-line);border-radius:5px;padding:5px 8px;background:var(--wb-bg);color:var(--wb-ink2);font:inherit;font-size:11px}
.wb-output{min-width:0}
.wb-output-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:17px 20px;border-bottom:1px solid var(--wb-line)}
.wb-output-head h3{font-size:13px;font-weight:600}
.wb-output-head span{font-size:11px;color:var(--wb-ink3)}
.wb-preview-area{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:268px;aspect-ratio:16/10;padding:28px;background:var(--wb-soft);text-align:center}
.wb-preview-area>svg{color:var(--wb-ink3);opacity:.65;margin-bottom:4px}
.wb-preview-area strong{font-size:13px;font-weight:500;color:var(--wb-ink2)}
.wb-preview-area p{max-width:270px;font-size:11px;color:var(--wb-ink3);line-height:1.8}
.wb-preview-area:has(video){padding:0;background:#11151c;aspect-ratio:16/10}
.wb-video{display:block;width:100%;height:100%;min-height:0;position:absolute;inset:0;object-fit:contain}
.wb-preview-fallback{margin:8px 0;font-size:11px;color:var(--wb-ink3)}
.wb-result-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid var(--wb-line);font-size:11px;color:var(--wb-ink2);font-variant-numeric:tabular-nums}
.wb-result-meta strong{font-weight:600;color:var(--wb-ink)}
.wb-result-range{margin-left:auto;color:var(--wb-ink3)}
.wb-output-files{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none;padding:10px 16px;border-top:1px solid var(--wb-line)}
.wb-output-files .wb-secondary,.wb-output-files .wb-ghost{min-height:32px;font-size:11px}
.wb-reveal{margin-left:auto}
.wb-draft-hint{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:0 3px;font-size:10.5px;line-height:1.8;color:var(--wb-ink3)}
.wb-draft-hint svg{margin-top:2px}
.wb-progress{padding:22px 20px;border-bottom:1px solid var(--wb-line)}
.wb-progress-title{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600}
.wb-spinner{color:var(--wb-accent);animation:wb-spin 1s linear infinite}
.wb-progress-text{margin-top:7px!important;font-size:11px;color:var(--wb-ink2);line-height:1.8}
.wb-steps{display:flex;list-style:none;padding:0;margin:22px 0 0;gap:0}
.wb-steps li{position:relative;display:flex;flex:1;flex-direction:column;align-items:center;gap:7px;font-size:10px;color:var(--wb-ink3);text-align:center}
.wb-steps li::before{content:"";position:absolute;top:10px;left:-50%;width:100%;height:1px;background:var(--wb-line)}
.wb-steps li:first-child::before{display:none}
.wb-step-dot{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:21px;height:21px;border:1px solid var(--wb-line);border-radius:50%;background:var(--wb-bg);font-size:9px}
.wb-steps li[data-state="active"]{color:var(--wb-accent)}
.wb-steps li[data-state="active"] .wb-step-dot{border-color:var(--wb-accent);background:var(--wb-accent);color:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--wb-accent) 9%,transparent)}
.wb-steps li[data-state="done"] .wb-step-dot{border-color:var(--wb-accent);color:var(--wb-accent)}
.wb-steps li[data-state="done"]::before{background:var(--wb-accent)}
.wb-progress .wb-ghost{margin-top:14px;padding-left:0;font-size:11px;color:var(--wb-accent)}
.wb-alert{display:flex;align-items:flex-start;gap:8px;margin-bottom:18px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--wb-error) 22%,transparent);border-radius:7px;background:color-mix(in srgb,var(--wb-error) 5%,transparent);color:var(--wb-error);font-size:12px;overflow-wrap:anywhere}
.wb-alert svg{margin-top:2px}
.wb-pending{border-color:color-mix(in srgb,var(--wb-accent) 22%,transparent);background:color-mix(in srgb,var(--wb-accent) 5%,transparent);color:var(--wb-accent);align-items:center}
.wb-pending span{flex:1}
.wb-chat-drawer{position:absolute;inset:0 0 0 auto;z-index:15;display:flex;flex-direction:column;width:min(520px,100%);border-left:1px solid var(--wb-line);background:var(--wb-bg);box-shadow:-12px 0 30px #00000009}
.wb-chat-drawer[hidden]{display:none}
.wb-chat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--wb-line)}
.wb-chat-head strong{font-size:14px;font-weight:600}
.wb-chat-head p{margin-top:4px;font-size:11px;color:var(--wb-ink3)}
.wb-chat{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
@container slice (min-width:1150px){.wb-shell[data-chat-open="true"]{display:grid;grid-template-columns:minmax(0,1fr) 420px;grid-template-rows:auto minmax(0,1fr)}.wb-shell[data-chat-open="true"]>.wb-bar{grid-column:1 / -1}.wb-shell[data-chat-open="true"]>.wb-scroll{grid-column:1;grid-row:2}.wb-shell[data-chat-open="true"]>.wb-chat-drawer{position:relative;inset:auto;grid-column:2;grid-row:2;width:auto;min-height:0;box-shadow:none}}
.wb-loading{display:flex;flex:1;align-items:center;justify-content:center;gap:10px;padding:28px;color:var(--wb-ink3);font-size:13px}
.wb-loading-error{flex-direction:column;color:var(--wb-error)}
.wb-environment{flex:1;min-width:0;display:grid;place-items:center;overflow:auto;padding:28px}
.wb-environment-start{text-align:center;max-width:380px}
.wb-environment-start>svg{color:var(--wb-ink2);margin-bottom:12px}
.wb-environment-start h1{font-weight:600;font-size:22px;line-height:1.4}
.wb-environment-start p{margin:10px 0 22px;color:var(--wb-ink2)}
.wb-environment-start .wb-alert{margin:16px 0 0;text-align:start}
.wb-environment-chat{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;width:min(100%,860px);margin-inline:auto}
.wb-environment-chat .wb-chat-head{flex:none;flex-wrap:wrap}
.wb-environment-chat .wb-chat-head p,.wb-environment-check{color:var(--wb-ink2)}
.wb-environment-start .wb-alert,.wb-environment-chat .wb-alert,.wb-environment-check.wb-loading-error{color:var(--wb-ink)}
.wb-environment-chat .wb-alert{margin:8px 20px 0}
.wb-environment-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
/* Native dialogs retain their own focus trap and Escape behavior. */
.duanju-studio-dialog{width:min(680px,calc(100vw - 40px));max-height:calc(100vh - 64px);padding:24px;border:1px solid var(--wb-line,#e5e7ed);border-radius:12px;background:var(--wb-bg,var(--dsw-alias-bg-base,#fff));color:var(--wb-ink,var(--dsw-alias-label-primary,#202530));box-shadow:0 24px 80px #0003;font:13px/1.6 var(--dsw-font-family,-apple-system,"PingFang SC",sans-serif)}
.duanju-studio-dialog::backdrop{background:#1018274d}
.duanju-studio-dialog h2{margin:0 0 8px;font-size:17px;font-weight:600}
.duanju-studio-dialog p{margin:8px 0 16px;color:var(--wb-ink2,#555e6e);overflow-wrap:anywhere}
.duanju-button{min-height:34px;padding:6px 11px;border:1px solid var(--wb-line,#e5e7ed);border-radius:6px;background:var(--wb-bg,#fff);color:inherit;font:inherit;cursor:pointer}
.duanju-button:disabled{opacity:.45;cursor:default}
.duanju-button:focus-visible,.duanju-control:focus-visible{outline:2px solid #4565e8;outline-offset:2px}
.duanju-studio-generate{background:#4565e8;color:#fff;border-color:#4565e8}
.duanju-picker-address{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0}
.duanju-control{flex:1;min-width:180px;height:36px;padding:7px 10px;border:1px solid var(--wb-line,#e5e7ed);border-radius:6px;background:var(--wb-bg,#fff);color:inherit;font:inherit}
.duanju-picker-roots{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.duanju-picker-roots button{font-size:11px}
.duanju-picker-list{list-style:none;margin:0;padding:0;max-height:42vh;overflow:auto;border:1px solid var(--wb-line,#e5e7ed);border-radius:7px}
.duanju-picker-entry{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;text-align:left;border:0;border-radius:0;background:transparent}
.duanju-picker-entry:hover,.duanju-picker-entry[aria-pressed="true"]{background:var(--wb-hover,#edf0f6)}
.duanju-picker-name{overflow-wrap:anywhere}
.duanju-picker-kind{flex:none;font-size:10px;opacity:.6}
.duanju-picker-message{padding:12px}
.duanju-picker-footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:18px}
.wb-asr-modal{width:min(408px,calc(100vw - 32px));margin:auto}
.wb-asr-modal label{display:block;font-weight:600;margin-bottom:5px}
.wb-asr-modal .duanju-control{width:100%;min-width:0}
.wb-asr-modal .wb-asr-help{font-size:11px;margin-top:8px}
.wb-asr-modal .wb-alert{margin:10px 0 0}
.wb-update-settings{margin-top:18px;padding-top:14px;border-top:1px solid var(--wb-line)}
.wb-update-settings h3,.wb-release-modal h3{margin:0 0 8px;font-size:13px;font-weight:600}
.wb-update-settings p{margin:8px 0 0}
.wb-update-settings p:empty{margin:0}
.wb-update-settings button[aria-disabled="true"]{opacity:.6;cursor:wait}
.wb-release-modal{width:min(480px,calc(100vw - 32px));margin:auto}
.wb-release-notes{max-height:min(34vh,260px);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border:1px solid var(--wb-line);border-radius:7px;background:var(--wb-soft);color:var(--wb-ink)}
.duanju-studio-error{color:#c74743}

.wb-bar{position:relative;z-index:5;flex-wrap:wrap;padding-inline-start:max(20px,var(--dsh-frame-leading-clearance,0px))}
.wb-bar button{-webkit-app-region:no-drag}
.wb-bar-left{display:flex;align-items:center;gap:18px;min-width:0;flex:1}
.wb-bar-right{gap:10px;margin-left:auto}
.wb-current-session{min-width:0;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:16px;border-left:1px solid var(--wb-line);font-size:12px;color:var(--wb-ink2)}
.wb-list-toggle[aria-expanded="true"]{color:var(--wb-ink);background:var(--wb-soft)}
.wb-nav-new{border-color:color-mix(in srgb,var(--wb-accent) 18%,var(--wb-bg));background:color-mix(in srgb,var(--wb-accent) 6%,var(--wb-bg));color:var(--wb-accent)!important}
@container slice (max-width:850px){.wb-bar-left{gap:12px}.wb-current-session{max-width:170px;padding-left:10px}.wb-bar-right{gap:6px}}
@container slice (max-width:620px){.wb-bar-left{gap:8px}.wb-brand .wb-title{display:none}.wb-current-session{max-width:150px}.wb-nav-new span,.wb-chat-toggle span,.wb-editor-open span{display:none}}

@keyframes wb-spin{to{transform:rotate(360deg)}}
@container slice (max-width:1050px){.wb-content{padding:24px 20px}.wb-bar{padding:16px 20px}.wb-workspace{gap:18px;grid-template-columns:minmax(270px,1fr) minmax(260px,1fr)}.wb-fields{padding:3px 16px}.wb-direction,.wb-card-head,.wb-output-head{padding-left:16px;padding-right:16px}}
@container slice (max-width:850px){.wb-workspace{grid-template-columns:minmax(0,1fr)}.wb-content{max-width:640px}.wb-bar-right{gap:8px}.wb-state{display:none}.wb-preview-area{min-height:230px;aspect-ratio:16/9}.wb-heading h2{font-size:21px}}
@container slice (max-width:620px){.wb-field{grid-template-columns:minmax(0,1fr);row-gap:7px}.wb-field-label{margin-bottom:0}.wb-content{padding:20px 16px}.wb-bar{padding:14px 16px;min-height:62px}.wb-title{font-size:14px}.wb-bar .wb-secondary{padding:6px 8px}.wb-heading{gap:8px}.wb-heading h2{font-size:20px}.wb-heading p{font-size:11px}.wb-badge{font-size:10px;padding:3px 6px}.wb-file-action{font-size:10px}.wb-preview-area{min-height:200px}.wb-result-range{width:100%;margin-left:0}}
@container slice (max-width:390px){.wb-brand{gap:6px}.wb-bar-right{gap:0}.wb-bar .wb-secondary{font-size:11px}.wb-heading{flex-wrap:wrap}.wb-badge{margin-top:0}}

.wb-config{min-width:0}
.wb-config-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 16px;min-height:64px;padding:12px 14px;border-radius:8px;background:var(--wb-soft)}
.wb-config-files{display:flex;align-items:center;flex-wrap:wrap;gap:5px 14px;min-width:0}
.wb-config-files>span{display:flex;align-items:center;gap:5px;min-width:0;max-width:33%;font-size:11px;color:var(--wb-ink2)}
.wb-config-files>span>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-config-direction{grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--wb-ink2)}
.wb-config-status{grid-column:2;grid-row:1 / 3;display:flex;align-items:center;gap:6px;align-self:center;white-space:nowrap;font-size:11px;color:var(--wb-ink2)}
.wb-shell[data-started="true"] .wb-scroll{display:flex;flex-direction:column}
.wb-shell[data-started="true"] .wb-content{display:flex;flex:1;flex-direction:column;width:100%;min-height:0;max-width:none;margin:0;padding:16px 20px}
.wb-shell[data-started="true"] .wb-workspace{display:flex;flex:1;flex-direction:column;gap:12px;min-height:0}
.wb-shell[data-started="true"] .wb-config{flex:none;width:100%;border:1px solid var(--wb-line);border-radius:8px}
.wb-shell[data-started="true"] .wb-output{display:flex;flex:1;flex-direction:column;min-height:360px;width:100%}
.wb-shell[data-started="true"] .wb-output>.wb-card{display:flex;flex:1;flex-direction:column;min-height:0}
.wb-shell[data-started="true"] .wb-output-head{flex:none;flex-wrap:wrap;padding:12px 16px}
.wb-shell[data-started="true"] .wb-output-head h3{flex:1}
.wb-shell[data-started="true"] .wb-output-head .wb-badge{margin:0;font-size:10px;padding:3px 6px}
.wb-shell[data-started="true"] .wb-preview-area{flex:1;min-height:200px;aspect-ratio:auto}
.wb-shell[data-started="true"] .wb-result-meta{flex:none;padding:10px 16px}
.wb-shell[data-started="true"] .wb-progress-run{flex:none;padding:12px 16px}
.wb-shell[data-started="true"] .wb-progress-run .wb-progress-text,.wb-shell[data-started="true"] .wb-progress-run .wb-steps,.wb-shell[data-started="true"] .wb-progress-run .wb-ghost{display:none}
.wb-shell[data-started="true"] .wb-draft-hint{flex:none;margin-top:8px}
@container slice (min-width:900px){.wb-shell[data-started="true"][data-chat-open="true"]{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(340px,.9fr);grid-template-rows:auto minmax(0,1fr)}.wb-shell[data-started="true"][data-chat-open="true"]>.wb-bar{grid-column:1 / -1}.wb-shell[data-started="true"][data-chat-open="true"]>.wb-scroll{grid-column:1;grid-row:2}.wb-shell[data-started="true"][data-chat-open="true"]>.wb-chat-drawer{position:relative;inset:auto;grid-column:2;grid-row:2;width:auto;min-height:0;box-shadow:none}}
@container slice (max-width:850px){.wb-config-files{column-gap:8px}}

@media(prefers-reduced-motion:reduce){.wb-root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout', 'fileUpload', 'remote', 'remote.session', 'remote.commands', 'remote.workspaceFiles'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        const subscribeLocale = (listener) => ctx.locale.subscribe(listener);
        const localeSnapshot = () => ctx.locale.getSnapshot();
        const sessions = ctx.get('sessions');
        const remote = ctx.get('remote');
        const useLocale = () => { React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot); return t; };
        const detail = (error) => error?.message || String(error || t('error.unknown'));
        const canceled = (runtime, error) => runtime.abort.signal.aborted || error?.name === 'AbortError';
        function remoteValue(result) {
          if (!result?.ok) throw result?.error || new Error(t('error.response'));
          return result.value;
        }
        async function blankSession(runtime) {
          active(runtime);
          const value = remoteValue(await remote.session.create({}));
          active(runtime);
          if (typeof value?.sessionId !== 'string' || !value.sessionId) throw new Error(t('error.response'));
          return value.sessionId;
        }
        function active(runtime) {
          if (runtime.abort.signal.aborted) throw new DOMException('', 'AbortError');
        }
        function release(runtime, reference) {
          if (runtime.owned.delete(reference)) reference.release();
        }
        function sessionList(value) { return Array.isArray(value?.sessions) ? value.sessions : []; }
        function projectState(value) { return { ...projectResponse(value), sessions: sessionList(value) }; }
        const seconds = (value) => (Number.isFinite(value) ? value.toFixed(1) + 's' : '\u2014');
        function agoLabel(value, translate) {
          const stamp = Number(value);
          if (!Number.isFinite(stamp)) return '';
          const gap = Date.now() - stamp;
          if (gap < 60_000) return translate('ago.now');
          if (gap < 3_600_000) return translate('ago.minute', { n: Math.floor(gap / 60_000) });
          if (gap < 86_400_000) return translate('ago.hour', { n: Math.floor(gap / 3_600_000) });
          if (gap < 7 * 86_400_000) return translate('ago.day', { n: Math.floor(gap / 86_400_000) });
          const date = new Date(stamp);
          return (date.getMonth() + 1) + '/' + date.getDate();
        }
        function projectResponse(value) {
          if (!value || typeof value.sessionId !== 'string' || !value.sessionId || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw new Error(t('error.response'));
          const settings = normalize({ ...defaults, ...value.settings });
          if (validation(settings)) throw new Error(t('error.response'));
          return { settings, sessionId: value.sessionId };
        }
        async function command(runtime, request, signal = runtime.abort.signal) {
          active(runtime);
          const execution = remoteValue(await remote.commands.execute(runtime.reference.sessionId, '/duanju-slice ' + JSON.stringify(request), [], signal));
          active(runtime);
          if (execution?.result?.kind === 'error') throw new Error(execution.result.text || t('error.command'));
          if (execution?.result?.kind !== 'success') throw new Error(t('error.response'));
          try {
            const value = JSON.parse(execution.result.text);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
            return value;
          } catch { throw new Error(t('error.response')); }
        }

        function cachedSession(key) {
          try { return localStorage.getItem(key); } catch { return null; }
        }
        function rememberSession(key, id) {
          try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key); } catch { /* Browser storage only restores convenience state. */ }
        }
        async function runtimeReady(runtime, signal, setup = false) {
          const result = await command(runtime, setup ? { action: 'runtime-status', setup: true } : { action: 'runtime-status' }, signal);
          if (typeof result.ready !== 'boolean') throw new Error(t('error.response'));
          return result.ready;
        }

        function nativeScriptPath(file, bridge = globalThis.__DSH_HOST_PATHS__) {
          if (!file) return null;
          const path = bridge?.pathFor(file);
          if (typeof path !== 'string' || !path) throw new Error(t('error.hostPath'));
          if (!/\.docx$/i.test(path)) throw new Error(t('validation.docx'));
          return path;
        }
        function nativeDirectory(desktop = globalThis.__DSH_DIRECTORY_PICKER__) {
          return desktop ? desktop.pick() : ctx.uiWorkspace.pickDirectory();
        }

        function Picker({ field, initialPath, onClose, onChoose, browse }) {
          const translate = useLocale();
          const dialog = React.useRef(null);
          const initialDirectory = field === 'scriptPath' ? initialPath.slice(0, Math.max(initialPath.lastIndexOf('\\'), initialPath.lastIndexOf('/')) + 1) : initialPath;
          const [request, setRequest] = React.useState({ path: initialDirectory });
          const [address, setAddress] = React.useState(initialDirectory);
          const [data, setData] = React.useState(null);
          const [selected, setSelected] = React.useState('');
          const [busy, setBusy] = React.useState(true);
          const [error, setError] = React.useState(null);
          const headingId = React.useId();
          const addressId = React.useId();
          const file = field === 'scriptPath';
          React.useEffect(() => {
            const element = dialog.current;
            const opener = document.activeElement;
            element.showModal();
            return () => {
              element.close();
              if (opener?.isConnected) opener.focus();
            };
          }, []);
          React.useEffect(() => {
            const abort = new AbortController();
            setBusy(true); setError(null); setSelected('');
            browse(request.path, abort.signal).then((value) => {
              if (abort.signal.aborted) return;
              if (typeof value.path !== 'string' || !(value.parent === null || typeof value.parent === 'string') || !Array.isArray(value.roots) || !value.roots.every((root) => typeof root === 'string') || !Array.isArray(value.entries) || !value.entries.every((entry) => entry && typeof entry.name === 'string' && typeof entry.path === 'string' && typeof entry.directory === 'boolean')) throw new Error(translate('error.response'));
              setData(value); setAddress(value.path);
            }).catch((reason) => {
              if (!abort.signal.aborted) setError(detail(reason));
            }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
            return () => abort.abort();
          }, [request, browse]);
          const navigate = (path) => setRequest({ path });
          const entries = (data?.entries || []).filter((entry) => entry.directory || file && /\.docx$/i.test(entry.name));
          return h('dialog', { ref: dialog, className: 'duanju-studio-dialog', 'aria-labelledby': headingId, onCancel: (event) => { event.preventDefault(); onClose(); } },
            h('h2', { id: headingId }, translate('pickerTitle', { field: translate(field) })),
            h('p', null, translate('pickerHelp')),
            h('form', { className: 'duanju-picker-address', onSubmit: (event) => { event.preventDefault(); navigate(address.trim()); } },
              h('label', { htmlFor: addressId }, translate('address')),
              h('input', { id: addressId, className: 'duanju-control', value: address, onChange: (event) => setAddress(event.target.value), autoFocus: true, spellCheck: false }),
              h('button', { className: 'duanju-button', type: 'submit', disabled: busy }, translate('go'))),
            h('nav', { className: 'duanju-picker-roots', 'aria-label': translate('roots') },
              h('button', { className: 'duanju-button', type: 'button', disabled: busy || !data?.parent, onClick: () => navigate(data.parent) }, translate('parent')),
              (data?.roots || []).map((root) => h('button', { className: 'duanju-button', type: 'button', key: root, disabled: busy, onClick: () => navigate(root) }, root))),
            error && h('div', { className: 'duanju-picker-message duanju-studio-error', role: 'alert' }, translate('error.browse', { detail: error })),
            h('div', { role: 'status', className: 'duanju-picker-message', hidden: !busy }, translate('browsing')),
            h('ul', { className: 'duanju-picker-list', 'aria-label': translate('entries'), 'aria-busy': busy },
              !busy && !entries.length && h('li', { className: 'duanju-picker-message' }, translate('empty')),
              entries.map((entry) => h('li', { key: entry.path }, h('button', {
                type: 'button', className: 'duanju-button duanju-picker-entry', disabled: busy,
                'aria-pressed': entry.directory ? undefined : selected === entry.path,
                onClick: () => entry.directory ? navigate(entry.path) : setSelected(entry.path),
                onDoubleClick: () => { if (!entry.directory) onChoose(entry.path); },
              }, h('span', { className: 'duanju-picker-name' }, entry.name), h('span', { className: 'duanju-picker-kind' }, translate(entry.directory ? 'folder' : 'docx')))))),
            data?.truncated && h('p', null, translate('truncated')),
            h('div', { className: 'duanju-picker-footer' },
              h('button', { className: 'duanju-button', type: 'button', onClick: onClose }, translate('cancel')),
              h('button', { className: 'duanju-button duanju-studio-generate', type: 'button', disabled: busy || !!error || (file ? !selected : !data?.path), onClick: () => onChoose(file ? selected : data.path) }, translate(file ? 'selectFile' : 'selectFolder'))));
        }

        function Notice({ message, onClose, onConfirm, disabled, heading = 'notice', accept = 'confirm' }) {
          const translate = useLocale();
          const dialog = React.useRef(null);
          const title = React.useId();
          React.useEffect(() => {
            const element = dialog.current;
            element.showModal();
            return () => { if (element.open) element.close(); };
          }, []);
          return h('dialog', { ref: dialog, className: 'duanju-studio-dialog', role: 'alertdialog', 'aria-labelledby': title, onCancel: onClose },
            h('h2', { id: title }, translate(heading)),
            h('p', null, translate(message.key, { detail: message.detail })),
            h('div', { className: 'duanju-picker-footer' },
              onConfirm && h('button', { className: 'duanju-button', type: 'button', autoFocus: true, onClick: onClose }, translate('cancel')),
              h('button', { className: 'duanju-button', type: 'button', autoFocus: !onConfirm, disabled: !!onConfirm && disabled, onClick: onConfirm || onClose }, translate(onConfirm ? accept : 'confirm'))));
        }

        async function releaseRequest(options) {
          const response = await fetch(new URL('api/duanju-slice/release-update', document.baseURI), { cache: 'no-store', ...options });
          if (response.status === 404) return { status: 'error', code: 'unavailable' };
          const result = await response.json();
          const success = options?.method === 'POST' ? ['applied', 'restart-required'] : ['current', 'available'];
          if (result?.status !== 'error' && (!response.ok || !success.includes(result?.status))) throw new Error('Invalid release response');
          return result;
        }

        function ReleaseDialog({ release, onClose }) {
          const translate = useLocale();
          const dialog = React.useRef(null);
          const close = React.useRef(null);
          const title = React.useId();
          const notes = React.useId();
          const [state, setState] = React.useState('ready');
          const [result, setResult] = React.useState(null);
          const pending = state === 'installing';
          React.useEffect(() => {
            const element = dialog.current;
            element.showModal();
            close.current?.focus();
            return () => { if (element.open) element.close(); };
          }, []);
          React.useEffect(() => { if (result) close.current?.focus(); }, [result]);
          async function install() {
            if (state !== 'ready' || !release.token) return;
            setState('installing');
            // Capture localized text now: live replacement can unmount this whole client plugin before the response arrives.
            const messages = Object.fromEntries(['applied', 'restart-required', 'error.install', 'error.download', 'error.remove', 'error.restored', 'error.restoreFailed', 'error.changed', 'error.busy', 'error.editing', 'error.managed'].map(key => [key, translate('update.' + key, release)]));
            let installed;
            try {
              installed = await releaseRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: release.token }) });
            } catch { installed = { status: 'error', code: 'install' }; }
            const error = !['applied', 'restart-required'].includes(installed?.status);
            const message = messages[error ? 'error.' + installed?.code : installed.status] || messages['error.install'];
            if (!dialog.current?.isConnected) { window.alert(message); return; }
            setResult({ error, message });
            setState('done');
          }
          return h('dialog', { ref: dialog, className: 'duanju-studio-dialog wb-release-modal', 'aria-labelledby': title,
            onCancel: (event) => { event.stopPropagation(); event.preventDefault(); if (!pending) onClose(); } },
            h('h2', { id: title }, translate('update.available', release)),
            h('p', null, translate('update.versions', release)),
            h('h3', { id: notes }, translate('update.notes')),
            h('div', { className: 'wb-release-notes', role: 'region', 'aria-labelledby': notes, tabIndex: 0 }, release.notes.trim() || translate('update.noNotes')),
            h('p', { className: result?.error || !release.token ? 'wb-alert' : undefined, role: result?.error || !release.token ? 'alert' : 'status' },
              result?.message || translate(!release.token ? 'update.error.asset' : pending ? 'update.installing' : 'update.help')),
            h('div', { className: 'duanju-picker-footer' }, result
              ? h('button', { ref: close, type: 'button', className: 'wb-primary', onClick: onClose }, translate('asr.close'))
              : [h('button', { key: 'cancel', ref: close, type: 'button', className: 'duanju-button', disabled: pending, onClick: onClose }, translate('cancel')),
                 h('button', { key: 'install', type: 'button', className: 'wb-primary', disabled: pending || !release.token, onClick: install }, translate('update.install'))]));
        }

        function UpdateSettings() {
          const translate = useLocale();
          const trigger = React.useRef(null);
          const request = React.useRef(null);
          const [checking, setChecking] = React.useState(false);
          const [update, setUpdate] = React.useState(null);
          React.useEffect(() => () => request.current?.abort(), []);
          async function check() {
            if (request.current) return;
            const abort = new AbortController();
            request.current = abort;
            setChecking(true); setUpdate(null);
            try {
              const result = await releaseRequest({ signal: abort.signal });
              if (!abort.signal.aborted) setUpdate(result);
            } catch { if (!abort.signal.aborted) setUpdate({ status: 'error', code: 'connection' }); }
            finally {
              request.current = null;
              if (!abort.signal.aborted) setChecking(false);
            }
          }
          function dismiss() {
            setUpdate(null);
            // Focus the trigger after the native modal closes and releases the settings dialog.
            requestAnimationFrame(() => trigger.current?.focus());
          }
          return h('section', { className: 'wb-update-settings' },
            h('h3', null, translate('update.label')),
            h('button', { ref: trigger, type: 'button', className: 'duanju-button', 'aria-disabled': checking, onClick: check }, translate('update.check')),
            h('p', { role: 'status' }, checking ? translate('update.checking') : update?.status === 'current' ? translate('update.current', { version: update.currentVersion }) : null),
            update?.status === 'error' && h('p', { className: 'wb-alert', role: 'alert' }, translate('update.error.' + (['busy', 'check', 'unavailable'].includes(update.code) ? update.code : 'connection'))),
            update?.status === 'available' && h(ReleaseDialog, { release: update, onClose: dismiss }));
        }

        function AsrSettings({ setup, setupButton, check, save, onContinue, onClose }) {
          const translate = useLocale();
          const dialog = React.useRef(null);
          const input = React.useRef(null);
          const title = React.useId();
          const field = React.useId();
          const description = React.useId();
          const [status, setStatus] = React.useState(setup ? 'asr.required' : 'asr.check');
          const [pending, setPending] = React.useState(false);
          const [failed, setFailed] = React.useState(false);
          React.useEffect(() => {
            const element = dialog.current;
            const trigger = setupButton?.current ?? element.ownerDocument.activeElement;
            element.showModal();
            input.current.focus();
            return () => {
              if (element.open) element.close();
              if (trigger?.isConnected) trigger.focus({ preventScroll: true });
            };
          }, []);
          React.useEffect(() => {
            if (setup) return;
            const abort = new AbortController();
            const report = (key) => {
              if (!abort.signal.aborted) setStatus(value => value === 'asr.check' ? key : value);
            };
            check(abort.signal).then(configured => report(configured ? 'asr.configured' : 'asr.missing'), () => report('asr.checkError'));
            return () => abort.abort();
          }, [check, setup]);
          async function submit(event) {
            event.preventDefault();
            if (pending) return;
            input.current.focus();
            setPending(true); setFailed(false);
            try {
              await save(input.current.value);
              if (input.current) input.current.value = '';
              if (setup) onContinue();
              else setStatus('asr.saved');
            } catch { setFailed(true); }
            finally { setPending(false); }
          }
          return h('dialog', { ref: dialog, className: 'duanju-studio-dialog wb-asr-modal', 'aria-labelledby': title, 'aria-describedby': description, onCancel: (event) => { event.preventDefault(); if (!pending) onClose(); } },
            h('h2', { id: title }, translate(setup ? 'asr.setup' : 'settings.title')),
            h('p', { role: 'status' }, translate(status)),
            h('form', { onSubmit: submit },
              h('label', { htmlFor: field }, translate('asr.label')),
              h('input', { ref: input, id: field, type: 'password', className: 'duanju-control', autoComplete: 'off', spellCheck: false, required: true, readOnly: pending, 'aria-describedby': description }),
              h('p', { id: description, className: 'wb-asr-help' }, translate('asr.private')),
              failed && h('p', { className: 'wb-alert', role: 'alert' }, translate('asr.saveError')),
              h('div', { className: 'duanju-picker-footer' },
                h('button', { type: 'button', className: 'duanju-button', disabled: pending, onClick: onClose }, translate(setup ? 'cancel' : 'asr.close')),
                h('button', { type: 'submit', className: 'wb-primary', disabled: pending }, translate(pending ? 'asr.saving' : setup ? 'asr.continue' : 'asr.save')))),
            !setup && h(UpdateSettings));
        }

        function VideoPreview({ result, sessionId }) {
          const translate = useLocale();
          const [preview, setPreview] = React.useState({});
          const [retry, setRetry] = React.useState(0);
          React.useEffect(() => {
            const abort = new AbortController();
            let url;
            setPreview({ loading: true });
            // shortcut: use the Host's bounded 32 MiB reader; larger videos open in the native player.
            remote.workspaceFiles.readBytes(sessionId, result.outFile, {}, abort.signal).then((response) => {
              const file = remoteValue(response);
              if (abort.signal.aborted) return;
              url = URL.createObjectURL(new Blob([file.data], { type: 'video/mp4' }));
              setPreview({ url });
            }).catch((error) => {
              if (!abort.signal.aborted) setPreview({ error: error?.code === 'workspace-file/too-large' ? 'preview.large' : 'preview.failed' });
            });
            return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
          }, [sessionId, result.outFile, result.at, retry]);
          return h('div', { className: 'wb-preview-area', 'aria-label': translate('preview.title') },
            preview.url ? h('video', { className: 'wb-video', src: preview.url, controls: true, playsInline: true, preload: 'metadata', onError: () => setPreview({ error: 'preview.failed' }) }) :
              h(React.Fragment, null, preview.loading ? h(Icon, { name: 'spinner', size: 26, className: 'wb-spinner' }) : h(FilmIcon, { size: 32 }),
                h('p', { role: preview.error ? 'status' : undefined }, translate(preview.error || 'preview.loading')),
                preview.error && h('button', { type: 'button', className: 'wb-ghost', onClick: () => setRetry((value) => value + 1) }, translate('preview.retry'))));
        }

        function EditingChat({ renderSlot }) {
          return renderSlot('conversation.session', { view: 'chat' });
        }

        function SetupConversation({ useSession, useSessionStatus, renderFactorySlot, setup }) {
          const translate = useLocale();
          const running = useSession((session) => session.running);
          const pending = useSessionStatus((statuses) => statuses.get(setup.sessionId)?.pendingInteraction);
          const heading = React.useRef(null);
          const [checkError, setCheckError] = React.useState(null);
          const { check, complete, sending, opening, failure, onReconfigure, onNew } = setup;
          const busy = sending || running || !!pending;
          React.useEffect(() => { heading.current?.focus(); }, []);
          React.useEffect(() => {
            if (busy || complete) return;
            const abort = new AbortController();
            check(abort.signal).then(() => {
              if (!abort.signal.aborted) setCheckError(null);
            }).catch(error => {
              if (!abort.signal.aborted) setCheckError(detail(error));
            });
            return () => abort.abort();
          }, [busy, complete, check]);
          const error = failure || (!busy && !complete && checkError && translate('environment.statusError', { detail: checkError }));
          return h('section', { className: 'wb-environment-chat', 'aria-label': translate('environment.chat') },
            h('header', { className: 'wb-chat-head' },
              h('div', null, h('strong', { ref: heading, tabIndex: -1 }, translate('environment.chat')),
                h('p', { role: 'status' }, translate(complete ? 'environment.done' : pending ? 'environment.pending' : sending ? 'environment.prepare' : running ? 'environment.working' : 'environment.waiting'))),
              h('div', { className: 'wb-environment-actions' },
                h('button', { type: 'button', className: complete ? 'wb-primary' : 'wb-secondary', title: complete ? undefined : translate('environment.reconfigureHelp'), disabled: complete ? opening : busy, onClick: complete ? onNew : onReconfigure },
                  h(Icon, { name: complete ? 'plus' : 'refresh', size: 15 }), translate(complete ? 'sessions.new' : 'environment.reconfigure')))),
            error && h('div', { className: 'wb-alert', role: 'alert' }, error),
            h('div', { className: 'wb-chat' }, renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: EditingChat } })));
        }

        function Conversation(props) {
          return props.setup ? h(SetupConversation, props) : h(EditingConversation, props);
        }

        function EditingConversation({ useSession, useSessionStatus, renderFactorySlot, model }) {
          const translate = useLocale();
          const running = useSession((session) => session.running);
          const pending = useSessionStatus((statuses) => statuses.get(model.sessionId)?.pendingInteraction);
          const configurationLocked = model.item?.configLocked ?? !!(model.item?.task || model.item?.lastResult);
          const started = !!(configurationLocked || model.sending);
          const [picker, setPicker] = React.useState(null);
          const [picking, setPicking] = React.useState(false);
          const [chatOpen, setChatOpen] = React.useState(started);
          const [chatVisited, setChatVisited] = React.useState(started);
          const [refreshError, setRefreshError] = React.useState(false);
          const scriptInput = React.useRef(null);
          const subtitleButton = React.useRef(null);
          const chatButton = React.useRef(null);
          const alive = React.useRef(true);
          const subtitleHelpId = React.useId();
          const modeHelpId = React.useId();
          const directionId = React.useId();
          const directionHelpId = React.useId();
          const chatId = React.useId();
          React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
          const { settings, failure, status, sending, busy, change, commit, lockConfiguration, generate, selectVersion, openJianying, openingJianying, browse, reportNotice, item = {}, sessionId, sessionTitle, onNew, openAsrSettings, refresh } = model;
          const mode = settings.mode === 'slice' ? 'slice' : 'mix';
          const slice = mode === 'slice';
          const visibleFields = slice ? requiredFields : fields;
          const task = item.task;
          const result = item.lastResult;
          const episodeLabel = result && (result.workDir && result.episodes?.length ? translate('result.episodes', { n: result.episodes.length }) : translate('result.episode', { episode: result.episode }));
          React.useEffect(() => {
            if (started) { setChatVisited(true); setChatOpen(true); }
          }, [started]);
          const queued = task?.stage === 'queued' && Date.now() - task.updatedAt < 15000;
          const working = !!running || sending || queued;
          const cutting = working && !!task && !['done', 'error'].includes(task.stage);
          const completed = !!result && (!task || task.stage === 'done');
          const stopped = !!task && !['done', 'error'].includes(task.stage) && running === false && !working && !pending;
          const failed = task?.stage === 'error';
          const locked = working || busy || picking;
          const missing = requiredFields.find((field) => !settings[field]) || (!settings.direction.trim() ? 'direction' : null);
          const badge = pending ? 'waiting' : cutting ? 'running' : completed ? 'done' : working ? 'chatting' : failed || stopped ? 'error' : missing ? 'setup' : 'ready';
          const openChat = () => { commit(); setChatVisited(true); setChatOpen(true); };
          const closeChat = () => { setChatOpen(false); chatButton.current?.focus(); };
          React.useEffect(() => {
            const abort = new AbortController();
            let timer;
            const update = async () => {
              try { await refresh(abort.signal); if (!abort.signal.aborted) setRefreshError(false); }
              catch { if (!abort.signal.aborted) setRefreshError(true); }
              if (!abort.signal.aborted && working) timer = setTimeout(update, 1800);
            };
            update();
            return () => { abort.abort(); clearTimeout(timer); };
          }, [sessionId, working, refresh]);
          async function choose(field) {
            if (locked) return;
            if (field === 'scriptPath') {
              if (!globalThis.__DSH_HOST_PATHS__) { setPicker(field); return; }
              scriptInput.current.value = '';
              scriptInput.current.click();
              return;
            }
            setPicking(true);
            try {
              const path = await nativeDirectory();
              if (alive.current && path) commit(change({ [field]: path }));
            } catch (error) { if (alive.current) reportNotice({ key: 'error.pick', detail: detail(error) }); }
            finally { if (alive.current) setPicking(false); }
          }
          function selectScript(event) {
            try { const path = nativeScriptPath(event.currentTarget.files?.[0]); if (path) commit(change({ scriptPath: path })); }
            catch (error) { reportNotice({ key: 'error.pick', detail: detail(error) }); }
          }
          async function openPath(path, action) {
            try { remoteValue(await remote.session.openWorkspacePath({ path, ...(action ? { action } : {}) })); }
            catch (error) { if (alive.current) reportNotice({ key: 'error.output', detail: detail(error) }); }
          }
          const stage = slice ? ['survey', 'pick', 'draft', 'render'] : ['survey', 'pick', 'render', 'draft'];
          const currentStage = task?.stage;
          const progressKey = ['asr', 'asr-cached'].includes(currentStage) ? 'locate' : ['frames', 'pick-subtitles'].includes(currentStage) ? 'pick' : currentStage;
          const stageIndex = progressKey === 'locate' ? 1 : stage.indexOf(progressKey);
          const stageLabel = (prefix, key) => prefix + '.' + key + (slice && key === 'draft' ? '.slice' : '');
          const progressText = pending ? 'progress.pending' : stageLabel('progress', stageIndex < 0 ? 'queued' : progressKey);
          return h('div', { className: 'wb-shell', 'data-chat-open': chatOpen, 'data-started': started },
            h('input', { ref: scriptInput, type: 'file', accept: '.docx', hidden: true, onChange: selectScript }),
            h('header', { className: 'wb-bar', 'data-window-drag': true },
              h('div', { className: 'wb-bar-left' }, model.navigation, h('div', { className: 'wb-brand' }, h(FilmIcon, { size: 21 }), h('h1', { className: 'wb-title' }, translate('title'))), h('span', { className: 'wb-current-session', title: sessionTitle }, sessionTitle)),
              h('div', { className: 'wb-bar-right' },
                h('button', { type: 'button', className: 'wb-secondary wb-settings', 'aria-label': translate('settings.title'), 'aria-haspopup': 'dialog', title: translate('settings.title'), onClick: openAsrSettings }, h(Icon, { name: 'settings', size: 16 })),
                h('button', { type: 'button', className: 'wb-secondary wb-nav-new', disabled: busy || sending, 'aria-label': translate('sessions.new'), title: translate('sessions.new'), onClick: onNew }, h(Icon, { name: 'plus', size: 15 }), h('span', null, translate('sessions.new'))),
                h('button', { type: 'button', className: 'wb-secondary wb-editor-open', disabled: !!openingJianying, 'aria-label': translate('editor.open'), title: translate('editor.open'), onClick: openJianying }, h(Icon, { name: openingJianying ? 'spinner' : 'arrow', size: 15, className: openingJianying ? 'wb-spinner' : undefined }), h('span', null, translate(openingJianying ? 'editor.opening' : 'editor.open'))),
                h('span', { className: 'wb-state', 'data-state': status, role: 'status', 'aria-live': 'polite' }, h(Icon, { name: status === 'saving' ? 'spinner' : status === 'saved' ? 'check' : 'dot', size: 13 }), translate('status.' + status)),
                h('button', { ref: chatButton, type: 'button', className: 'wb-secondary wb-chat-toggle', 'aria-label': translate(chatOpen ? 'chat.close' : 'chat.open'), 'aria-expanded': chatOpen, 'aria-controls': chatId, onClick: () => chatOpen ? closeChat() : openChat() }, h(Icon, { name: 'chat', size: 15 }), h('span', null, translate(chatOpen ? 'chat.close' : 'chat.open'))))),
            h('div', { className: 'wb-scroll' },
              h('div', { className: 'wb-content' },
                !started && h('div', { className: 'wb-heading' },
                  h('div', null, h('h2', null, completed ? sessionTitle : translate('form.title')), h('p', null, translate('form.subtitle'))),
                  h('span', { className: 'wb-badge', 'data-state': badge }, h('i', { className: 'wb-dot', 'data-state': badge, 'aria-hidden': true }), translate('badge.' + badge))),
                failure && h('div', { className: 'wb-alert', role: 'alert' }, h(Icon, { name: 'alert' }), h('span', null, translate(failure.key, { detail: failure.detail }))),
                pending && h('div', { className: 'wb-alert wb-pending', role: 'status' }, h(Icon, { name: 'alert' }), h('span', null, translate('progress.pending')), h('button', { className: 'wb-ghost', type: 'button', onClick: openChat }, translate('chat.open'))),
                h('div', { className: 'wb-workspace' },
                  h('section', { className: 'wb-config', 'data-locked': configurationLocked, 'aria-label': translate('config.title') },
                    configurationLocked && h('div', { className: 'wb-config-summary' },
                      h('span', { className: 'wb-config-files' },
                        h('span', { title: translate('mode.label') }, h(Icon, { name: 'film', size: 13 }), h('span', null, translate('mode.' + mode))),
                        visibleFields.map(field => {
                        const name = shortName(settings[field]);
                        const label = field === 'subtitleDir'
                          ? (name ? translate('config.subtitles', { name }) : translate('config.noSubtitles'))
                          : name || translate('empty.' + field);
                        return h('span', { key: field, title: translate(field) + '：' + (settings[field] || label) }, h(Icon, { name: field === 'scriptPath' ? 'doc' : 'folder', size: 13 }), h('span', null, label));
                      })),
                      h('span', { className: 'wb-config-direction', title: settings.direction }, translate('direction') + '：' + (settings.direction || translate('config.noDirection'))),
                      h('span', { className: 'wb-config-status' }, h(Icon, { name: 'lock', size: 13 }), translate('config.locked'))),
                  !configurationLocked && h('form', { className: 'wb-form', onSubmit: (event) => { event.preventDefault(); if (!locked && !missing) lockConfiguration(); } },
                    h('section', { className: 'wb-card' },
                      h('div', { className: 'wb-card-head' }, h('h3', null, translate('form.sources'))),
                      h('div', { className: 'wb-fields' },
                        h('fieldset', { className: 'wb-mode', disabled: locked, 'aria-describedby': modeHelpId },
                          h('legend', null, translate('mode.label')),
                          h('div', { className: 'wb-mode-options' }, ['mix', 'slice'].map(value => h('label', { key: value },
                            h('input', { type: 'radio', name: modeHelpId + '-value', value, checked: mode === value, onChange: () => commit(change({ mode: value })) }), translate('mode.' + value)))),
                          h('p', { id: modeHelpId }, translate('mode.' + mode + '.help'))),
                        visibleFields.map((field) => {
                        const subtitle = field === 'subtitleDir';
                        const path = settings[field];
                        return h('div', { key: field, className: 'wb-field' },
                          h('span', { className: 'wb-field-label' }, translate(field)),
                          h('div', { className: 'wb-file-controls' },
                            h('button', { ref: subtitle ? subtitleButton : undefined, type: 'button', className: 'wb-file-choice', 'data-empty': !path, disabled: locked, title: path || translate('help.' + field), 'aria-label': translate(field) + ' · ' + (shortName(path) || translate('choose')), 'aria-describedby': subtitle ? subtitleHelpId : undefined, onClick: () => choose(field) },
                              h(Icon, { name: field === 'scriptPath' ? 'doc' : 'folder', size: 18 }), h('span', { className: 'wb-file-name' }, shortName(path) || translate('empty.' + field)), !locked && h('span', { className: 'wb-file-action' }, translate(path ? 'change' : 'choose'))),
                            subtitle && path && h('button', { type: 'button', className: 'wb-icon-button', disabled: locked, title: translate('clear.subtitleDir'), 'aria-label': translate('clear.subtitleDir'), onClick: () => { commit(change({ subtitleDir: '' })); subtitleButton.current?.focus(); } }, h(Icon, { name: 'close', size: 15 }))),
                          subtitle && h('p', { id: subtitleHelpId, className: 'wb-field-hint' }, translate('help.subtitleDir')));
                      }))),
                    h('section', { className: 'wb-card wb-direction' },
                      h('label', { htmlFor: directionId }, translate('form.direction')),
                      h('p', { id: directionHelpId }, translate('form.directionHelp')),
                      h('textarea', { id: directionId, rows: 3, maxLength: 2000, value: settings.direction, disabled: locked, 'aria-describedby': directionHelpId, placeholder: translate('placeholder.direction'), onChange: (event) => change({ direction: event.target.value }), onBlur: () => commit() }),
                      h('div', { className: 'wb-examples', 'aria-label': translate('form.examples') }, ['revenge', 'reveal', 'family'].map((example) => h('button', { type: 'button', key: example, disabled: locked, onClick: () => commit(change({ direction: translate('value.' + example) })) }, translate('example.' + example))))),
                    h('div', { className: 'wb-form-footer' },
                      h('button', { type: 'submit', className: 'wb-primary', disabled: locked || !!missing }, h(Icon, { name: 'lock', size: 15 }), translate('config.lock')),
                      h('p', { className: 'wb-form-note', role: 'status' }, translate(missing ? 'missing.' + missing : 'form.ready'))))),
                  h('section', { className: 'wb-output' },
                    h('div', { className: 'wb-card' },
                      h('div', { className: 'wb-output-head' }, h('h3', null, translate(result ? completed ? 'result.title' : 'result.previous' : 'preview.title')), started && h('span', { className: 'wb-badge', 'data-state': badge }, translate('badge.' + badge)), (item.results?.length ?? 0) > 1 ? h('select', { className: 'wb-version-select', 'aria-label': translate('result.versions'), value: result.version, disabled: working || busy, onChange: (event) => selectVersion(Number(event.target.value)) }, item.results.map(version => h('option', { key: version.id, value: version.version }, translate('result.version', { version: version.version, n: duration(version) })))) : result && h('span', null, episodeLabel)),
                      cutting || pending ? h('div', { className: 'wb-progress wb-progress-run', role: 'status', 'aria-live': 'polite' },
                        h('div', { className: 'wb-progress-title' }, h(Icon, { name: pending ? 'alert' : 'spinner', size: 18, className: pending ? undefined : 'wb-spinner' }), translate(progressText)),
                        h('p', { className: 'wb-progress-text' }, translate('progress.help')),
                        h('ol', { className: 'wb-steps' }, stage.map((step, index) => h('li', { key: step, 'data-state': index === stageIndex ? 'active' : index < stageIndex ? 'done' : 'next', 'aria-current': index === stageIndex ? 'step' : undefined }, h('span', { className: 'wb-step-dot' }, index < stageIndex ? h(Icon, { name: 'check', size: 11 }) : index + 1), h('span', null, translate(stageLabel('step', step)))))),
                        h('button', { type: 'button', className: 'wb-ghost', onClick: openChat }, translate('chat.details'), h(Icon, { name: 'arrow', size: 13 }))) : null,
                      (failed || stopped) && h('div', { className: 'wb-progress', role: 'alert' },
                        h('div', { className: 'wb-progress-title' }, h(Icon, { name: 'alert', size: 18 }), translate(failed ? 'progress.failed' : 'progress.stopped')),
                        h('p', { className: 'wb-progress-text' }, failed ? task.error : translate('progress.stoppedHelp')),
                        h('button', { type: 'button', className: 'wb-ghost', onClick: openChat }, translate('chat.details'), h(Icon, { name: 'arrow', size: 13 }))),
                      refreshError && h('p', { className: 'wb-preview-fallback', role: 'status' }, translate('progress.refreshError')),
                      result?.outFile ? h(VideoPreview, { key: result.outFile, result, sessionId }) : h('div', { className: 'wb-preview-area' }, h(FilmIcon, { size: 37 }), h('strong', null, translate('preview.empty')), !started && h('p', null, translate('preview.help')), configurationLocked && h('button', { type: 'button', className: 'wb-secondary wb-generate', disabled: locked || !!missing, onClick: () => { if (!locked && !missing) generate(); } }, h(Icon, { name: working ? 'spinner' : 'play', size: 14, className: working ? 'wb-spinner' : undefined }), translate(cutting ? 'generate.running' : working ? 'chat.running' : 'generate'))),
                      result && h('div', { className: 'wb-result-meta' }, h('strong', null, episodeLabel), h('span', null, translate('result.duration', { n: duration(result) })), h('span', { className: 'wb-result-range' }, translate(result.workDir ? 'result.opening' : 'result.range', { episode: result.episode, start: seconds(result.start), end: seconds(result.end) }))),
                      result && h('div', { className: 'wb-output-files' },
                        result.outFile && h('button', { type: 'button', className: 'wb-secondary', title: result.outFile, onClick: () => openPath(result.outFile) }, h(Icon, { name: 'film', size: 14 }), translate('result.open')),
                        result.draftDir && h('button', { type: 'button', className: 'wb-secondary', title: result.draftDir, onClick: () => openPath(result.draftDir) }, h(Icon, { name: 'folder', size: 14 }), translate('result.draftOpen')),
                        result.outFile && h('button', { type: 'button', className: 'wb-ghost wb-reveal', 'aria-label': translate('result.reveal'), title: translate('result.reveal'), onClick: () => openPath(result.outFile, 'reveal') }, h(Icon, { name: 'arrow', size: 14 })))),
                    result && h('div', { className: 'wb-draft-hint' }, h(Icon, { name: 'info', size: 13 }), h('span', null, translate(slice && !result.draftDir ? 'result.noDraft' : 'result.draftHint'))))))),
            chatVisited && h('aside', { id: chatId, className: 'wb-chat-drawer', hidden: !chatOpen, 'aria-label': translate('chat.title'), onKeyDown: (event) => { if (event.key === 'Escape') closeChat(); } },
              h('div', { className: 'wb-chat-head' }, h('div', null, h('strong', null, translate('chat.title')), h('p', null, translate(slice ? 'chat.help.slice' : 'chat.help'))), h('button', { type: 'button', className: 'wb-icon-button', 'aria-label': translate('chat.close'), onClick: closeChat }, h(Icon, { name: 'close', size: 18 }))),
              h('div', { className: 'wb-chat' }, renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: EditingChat } }))),
            picker && h(Picker, { field: picker, initialPath: settings[picker], browse, onClose: () => setPicker(null), onChoose: (path) => { const next = change({ [picker]: path }); setPicker(null); commit(next); } }));
        }

        function SessionList({ id, items, activeId, busy, loading, onClose, onSelect, onRename, onRemove }) {
          const translate = useLocale();
          const [editing, setEditing] = React.useState(null);
          const [draft, setDraft] = React.useState('');
          const panel = React.useRef(null);
          const editingRef = React.useRef(null);
          React.useEffect(() => { panel.current?.focus(); }, []);
          const begin = (item) => { editingRef.current = item.id; setEditing(item.id); setDraft(item.title); };
          const finish = () => {
            const id = editingRef.current;
            if (!id) return;
            editingRef.current = null;
            setEditing(null);
            const title = draft.trim();
            if (title && title !== items.find((item) => item.id === id)?.title) onRename(id, title);
          };
          function meta(item) {
            if (item.task?.stage === 'error') return translate('badge.error');
            if (item.lastResult?.episode != null) return translate('sessions.done', { episode: item.lastResult.episode, start: seconds(item.lastResult.start), end: seconds(item.lastResult.end) }) + ' · V' + (item.lastResult.version || 1);
            if (item.configLocked) return translate('config.locked');
            return item.direction || translate('sessions.noResult');
          }
          function select(id) {
            onSelect(id);
            if (panel.current && window.getComputedStyle(panel.current).position === 'absolute') onClose();
          }
          return h('aside', { id, ref: panel, className: 'wb-sessions', 'aria-label': translate('sessions.list'), tabIndex: -1, onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } } },
            h('div', { className: 'wb-sessions-head' }, h('h2', null, translate('sessions.list'), h('span', { className: 'wb-count' }, items.length)), h('button', { type: 'button', className: 'wb-icon-button', 'aria-label': translate('task.close'), onClick: onClose }, h(Icon, { name: 'panel', size: 16 }))),
            loading && h('p', { className: 'wb-sessions-empty', role: 'status' }, translate('loading')),
            !loading && !items.length && h('p', { className: 'wb-sessions-empty' }, translate('sessions.empty')),
            h('ul', { className: 'wb-items', 'aria-label': translate('sessions') }, items.map((item) => h('li', { className: 'wb-item', key: item.id, 'aria-current': item.id === activeId ? 'true' : undefined }, editing === item.id ?
              h('input', { className: 'wb-item-input', value: draft, autoFocus: true, maxLength: 60, 'aria-label': translate('sessions.rename'), onChange: (event) => setDraft(event.target.value), onBlur: finish, onKeyDown: (event) => {
                if (event.nativeEvent?.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.stopPropagation(); editingRef.current = null; setEditing(null); }
              } }) : h(React.Fragment, null,
                h('button', { className: 'wb-item-select', type: 'button', disabled: busy, onClick: () => select(item.id), title: item.title },
                  h('span', { className: 'wb-item-row' }, h('span', { className: 'wb-item-name' }, item.title), h('span', { className: 'wb-item-time' }, agoLabel(item.updatedAt, translate))),
                  h('span', { className: 'wb-item-sub' }, h('i', { className: 'wb-dot', 'data-state': item.task?.stage === 'error' ? 'error' : item.lastResult ? 'done' : 'setup', 'aria-hidden': true }), h('span', { className: 'wb-item-summary' }, meta(item)))),
                h('div', { className: 'wb-item-tools' },
                  h('button', { type: 'button', className: 'wb-icon-button', disabled: busy, 'aria-label': translate('sessions.rename'), onClick: () => begin(item) }, h(Icon, { name: 'edit', size: 12 })),
                  h('button', { type: 'button', className: 'wb-icon-button', disabled: busy, 'aria-label': translate('sessions.remove'), onClick: () => onRemove(item.id) }, h(Icon, { name: 'close', size: 12 }))))))));
        }

        function Studio({ SessionProvider, renderSlot }) {
          const translate = useLocale();
          const [listOpen, setListOpen] = React.useState(false);
          const listId = React.useId();
          const listTrigger = React.useRef(null);
          const [reference, setReference] = React.useState(null);
          const [items, setItems] = React.useState([]);
          const [activeId, setActiveId] = React.useState(null);
          const activeRef = React.useRef(null);
          const [settings, setSettings] = React.useState(defaults);
          const settingsRef = React.useRef(defaults);
          const runtimeRef = React.useRef(null);
          const [status, setStatus] = React.useState('loading');
          const [failure, setFailure] = React.useState(null);
          const [notice, setNotice] = React.useState(null);
          const [saving, setSaving] = React.useState(false);
          const [sending, setSending] = React.useState(false);
          const [asrDialog, setAsrDialog] = React.useState(null);
          const setupButton = React.useRef(null);
          const [openingJianying, setOpeningJianying] = React.useState(false);
          const [busy, setBusy] = React.useState(false);
          const [retry, setRetry] = React.useState(0);
          const [environment, setEnvironment] = React.useState('checking');
          React.useEffect(() => { if (!listOpen) listTrigger.current?.focus(); }, [listOpen, activeId]);
          const adopt = React.useCallback(async (runtime, sessionId, editing = true) => {
            active(runtime);
            if (runtime.reference?.sessionId !== sessionId) {
              const next = sessions.retain(sessionId, { source: 'controllerOperation' });
              runtime.owned.add(next);
              try { await next.ready; active(runtime); }
              catch (error) { release(runtime, next); throw error; }
              runtime.reference = next;
              setReference(next);
            }
            if (editing) rememberSession(CACHE_KEY, sessionId);
            return runtime.reference;
          }, []);
          const applyProject = React.useCallback((runtime, project) => {
            if (project.sessions.length) setItems(project.sessions);
            activeRef.current = project.sessionId; setActiveId(project.sessionId);
            settingsRef.current = project.settings; setSettings(project.settings);
            runtime.saved = JSON.stringify(project.settings); setStatus('saved'); setFailure(null);
          }, []);
          const enterEditor = React.useCallback(async (runtime, fresh = false) => {
            const known = fresh ? [] : sessionList(await command(runtime, { action: 'list' }));
            let project;
            if (known.length) {
              const cached = cachedSession(CACHE_KEY);
              await adopt(runtime, (known.find(item => item.id === cached) || known[0]).id);
              project = projectState(await command(runtime, { action: 'open' }));
            } else {
              const create = { action: 'create' };
              if (!fresh && runtime.blankId === runtime.reference.sessionId) create.adopt = runtime.blankId;
              const created = await command(runtime, create);
              await adopt(runtime, created.sessionId);
              project = projectState(created);
            }
            runtime.setupId = null;
            rememberSession(SETUP_KEY, null);
            applyProject(runtime, project);
            setEnvironment('editor');
          }, [adopt, applyProject]);
          React.useEffect(() => {
            const runtime = { abort: new AbortController(), owned: new Set(), reference: null, saveTask: null, saved: '' };
            runtimeRef.current = runtime;
            setReference(null); setItems([]); setActiveId(null); activeRef.current = null;
            setEnvironment('checking'); setStatus('loading'); setFailure(null); setNotice(null); setAsrDialog(null); setSaving(false); setSending(false); setOpeningJianying(false); setBusy(false);
            (async () => {
              const setup = cachedSession(SETUP_KEY);
              for (const id of new Set([setup, cachedSession(CACHE_KEY)].filter(Boolean))) {
                try {
                  await adopt(runtime, id, false);
                  if (id === setup) runtime.setupId = id;
                  break;
                } catch (error) {
                  if (canceled(runtime, error)) throw error;
                }
              }
              if (!runtime.reference) {
                runtime.blankId = await blankSession(runtime);
                await adopt(runtime, runtime.blankId, false);
              }
              const ready = await runtimeReady(runtime, undefined, !!runtime.setupId);
              if (ready) await enterEditor(runtime);
              else setEnvironment(runtime.setupId ? 'setup' : 'required');
            })().catch((error) => {
              if (!canceled(runtime, error)) setFailure({ key: 'environment.error', detail: detail(error) });
            });
            return () => {
              runtime.abort.abort();
              for (const owned of [...runtime.owned]) release(runtime, owned);
              if (runtimeRef.current === runtime) runtimeRef.current = null;
            };
          }, [adopt, enterEditor, retry]);
          // Release replaced bindings after React removes their editable subtree, not before.
          React.useEffect(() => {
            const runtime = runtimeRef.current;
            return () => { if (runtime && reference) release(runtime, reference); };
          }, [reference]);

          const checkSetup = React.useCallback(async (signal) => {
            const runtime = runtimeRef.current;
            const sessionId = runtime?.setupId;
            if (!sessionId || runtime.requestingSetup) return;
            if (await runtimeReady(runtime, signal, true) && !signal.aborted && runtime.setupId === sessionId && !runtime.requestingSetup) {
              setEnvironment((view) => view === 'setup' ? 'complete' : view);
            }
          }, []);
          async function requestSetup(fresh = false) {
            const runtime = runtimeRef.current;
            if (!runtime || runtime.requestingSetup) return;
            runtime.requestingSetup = true;
            setSending(true); setFailure(null);
            try {
              if (fresh || !runtime.setupId) {
                const sessionId = (!fresh && runtime.blankId) || await blankSession(runtime);
                if (fresh && sessionId === runtime.reference.sessionId) throw new Error(translate('error.response'));
                await adopt(runtime, sessionId, false);
                runtime.blankId = null;
                runtime.setupId = sessionId;
              }
              const result = await command(runtime, { action: 'runtime-prompt' });
              if (result.needsAsrKey === true) { setAsrDialog('setup'); return; }
              if (!result.accepted) throw new Error(translate('error.response'));
              rememberSession(SETUP_KEY, runtime.setupId);
              setEnvironment('setup');
            } catch (error) {
              if (!canceled(runtime, error)) setFailure({ key: 'environment.error', detail: detail(error) });
            } finally {
              runtime.requestingSetup = false;
              if (!runtime.abort.signal.aborted) setSending(false);
            }
          }
          async function startAfterSetup() {
            const runtime = runtimeRef.current;
            if (!runtime || runtime.openingEditor) return;
            runtime.openingEditor = true;
            setBusy(true); setFailure(null);
            setListOpen(false);
            try { await enterEditor(runtime, true); }
            catch (error) { if (!canceled(runtime, error)) setFailure({ key: 'error.session', detail: detail(error) }); }
            finally {
              runtime.openingEditor = false;
              if (!runtime.abort.signal.aborted) setBusy(false);
            }
          }

          const change = (patch) => {
            const next = changedSettings(settingsRef.current, patch);
            settingsRef.current = next; setSettings(next); setStatus('dirty'); setFailure(null);
            return next;
          };
          async function save(value = settingsRef.current) {
            const runtime = runtimeRef.current;
            if (!runtime) throw new DOMException('', 'AbortError');
            const invalid = validation(value);
            if (invalid) throw new Error(translate(invalid));
            const desired = normalize(value);
            const signature = JSON.stringify(desired);
            if (runtime.saveTask) {
              const previous = runtime.saveTask;
              await previous.promise;
              active(runtime);
              if (previous.signature === signature) return runtime.reference;
              return save(value);
            }
            if (runtime.saved === signature) { setStatus('saved'); return runtime.reference; }
            setSaving(true); setStatus('saving'); setFailure(null);
            const promise = (async () => {
              const project = projectState(await command(runtime, { action: 'save', settings: desired }));
              await adopt(runtime, project.sessionId);
              runtime.saved = JSON.stringify(project.settings);
              setItems((current) => project.sessions.length ? project.sessions : current);
              if (JSON.stringify(normalize(settingsRef.current)) === signature) {
                settingsRef.current = project.settings; setSettings(project.settings); setStatus('saved');
              } else setStatus('dirty');
              return runtime.reference;
            })();
            runtime.saveTask = { signature, promise };
            try { return await promise; }
            catch (error) {
              if (!canceled(runtime, error)) { setFailure({ key: 'error.save', detail: detail(error) }); setStatus('error'); }
              throw error;
            } finally {
              runtime.saveTask = null;
              if (!runtime.abort.signal.aborted) setSaving(false);
            }
          }
          const commit = (value) => { save(value).catch(() => {}); };
          async function lockConfiguration() {
            const runtime = runtimeRef.current;
            if (!runtime || busy || sending) return;
            const invalid = validation(settingsRef.current, true);
            if (invalid) { setNotice({ key: invalid }); return; }
            setBusy(true); setFailure(null); setNotice(null);
            try {
              await save();
              applyProject(runtime, projectState(await command(runtime, { action: 'lock', settings: normalize(settingsRef.current) })));
            } catch (error) { failSession(runtime, error); }
            finally { if (!runtime.abort.signal.aborted) setBusy(false); }
          }
          async function openJianying() {
            const runtime = runtimeRef.current;
            if (!runtime || openingJianying) return;
            setOpeningJianying(true);
            try {
              const result = await command(runtime, { action: 'open-jianying' });
              if (!result.opened) throw new Error(translate('error.unknown'));
            } catch (error) { if (!canceled(runtime, error)) setNotice({ key: 'error.editor', detail: detail(error) }); }
            finally { if (!runtime.abort.signal.aborted) setOpeningJianying(false); }
          }
          async function generate() {
            const runtime = runtimeRef.current;
            if (!runtime || runtime.generating) return;
            const invalid = validation(settingsRef.current, true);
            if (invalid) { setNotice({ key: invalid }); return; }
            runtime.generating = true; setSending(true); setFailure(null); setNotice(null);
            try {
              await save();
              active(runtime);
              const parameters = runParameters(settingsRef.current);
              const text = translate('prompt', { parameters: JSON.stringify(parameters, null, 2) });
              const result = await command(runtime, { action: 'generate', text });
              active(runtime);
              if (!result?.accepted) throw new Error(translate('error.unknown'));
              if (Array.isArray(result.sessions)) setItems(result.sessions);
            } catch (error) {
              if (!canceled(runtime, error)) setNotice({ key: 'error.prompt', detail: detail(error) });
            } finally {
              runtime.generating = false;
              if (!runtime.abort.signal.aborted) setSending(false);
            }
          }
          const browse = React.useCallback((path, signal) => {
            const runtime = runtimeRef.current;
            if (!runtime) return Promise.reject(new DOMException('', 'AbortError'));
            return command(runtime, { action: 'browse', ...(path ? { path } : {}) }, signal);
          }, []);
          const failSession = (runtime, error) => { if (!canceled(runtime, error)) setFailure({ key: 'error.session', detail: detail(error) }); };
          async function switchTo(id) {
            const runtime = runtimeRef.current;
            if (!runtime || busy || !id || id === activeRef.current) return;
            setBusy(true); setFailure(null);
            try {
              await save();
              await adopt(runtime, id);
              applyProject(runtime, projectState(await command(runtime, { action: 'open' })));
              setNotice(null);
            } catch (error) { failSession(runtime, error); }
            finally { if (!runtime.abort.signal.aborted) setBusy(false); }
          }
          const refresh = React.useCallback(async (signal) => {
            const runtime = runtimeRef.current;
            if (!runtime) return;
            const response = await command(runtime, { action: 'list' }, signal);
            if (!signal?.aborted) {
              const list = sessionList(response);
              setItems(list);
              const entry = list.find(item => item.id === activeRef.current);
              if (entry && runtime.saved === JSON.stringify(normalize(settingsRef.current))) {
                const next = normalize(entry);
                runtime.saved = JSON.stringify(next); settingsRef.current = next; setSettings(next);
              }
            }
          }, []);
          async function selectVersion(version) {
            const runtime = runtimeRef.current;
            if (!runtime || busy) return;
            setBusy(true); setFailure(null);
            try {
              await save();
              applyProject(runtime, projectState(await command(runtime, { action: 'select-result', version })));
            } catch (error) { failSession(runtime, error); }
            finally { if (!runtime.abort.signal.aborted) setBusy(false); }
          }
          async function createSession() {
            const runtime = runtimeRef.current;
            if (!runtime || busy || sending) return;
            setBusy(true); setFailure(null); setNotice(null);
            try {
              await save();
              const created = await command(runtime, { action: 'create' });
              await adopt(runtime, created.sessionId);
              applyProject(runtime, projectState(created));
            } catch (error) { failSession(runtime, error); }
            finally { if (!runtime.abort.signal.aborted) setBusy(false); }
          }
          const checkAsrKey = React.useCallback(async (signal) => {
            const runtime = runtimeRef.current;
            if (!runtime) throw new DOMException('', 'AbortError');
            const result = await command(runtime, { action: 'asr-status' }, signal);
            return result.configured === true;
          }, []);
          async function saveAsrKey(value) {
            const runtime = runtimeRef.current;
            if (!runtime) throw new DOMException('', 'AbortError');
            // The normal workbench command records its inputs; never send a key through it.
            const execution = remoteValue(await remote.commands.execute(runtime.reference.sessionId, '/duanju-slice-store-asr-key ' + value.trim(), [], runtime.abort.signal));
            active(runtime);
            if (execution?.result?.kind !== 'success') throw new Error(translate('asr.saveError'));
          }
          async function renameSession(id, title) {
            const runtime = runtimeRef.current;
            if (!runtime) return;
            try { setItems(sessionList(await command(runtime, { action: 'rename', sessionId: id, title }))); }
            catch (error) { if (!canceled(runtime, error)) setNotice({ key: 'error.session', detail: detail(error) }); }
          }
          const removeSession = (id) => setNotice({ key: 'sessions.removeConfirm', detail: '', heading: 'sessions.remove', accept: 'sessions.removeAccept', sessionId: id });
          async function confirmRemove() {
            const runtime = runtimeRef.current;
            const target = notice?.sessionId;
            setNotice(null);
            if (!runtime || !target) return;
            setBusy(true);
            try {
              const list = sessionList(await command(runtime, { action: 'remove', sessionId: target }));
              setItems(list);
              if (target !== activeRef.current) return;
              if (list.length) {
                await adopt(runtime, list[0].id);
                applyProject(runtime, projectState(await command(runtime, { action: 'open' })));
              } else {
                const created = await command(runtime, { action: 'create' });
                await adopt(runtime, created.sessionId);
                applyProject(runtime, projectState(created));
              }
            } catch (error) { failSession(runtime, error); }
            finally { if (!runtime.abort.signal.aborted) setBusy(false); }
          }
          const ready = reference && status !== 'loading' && !(failure?.key === 'error.open');
          const activeItem = items.find((item) => item.id === activeId);
          const sessionTitle = activeItem?.title || translate('title');
          const closeList = () => setListOpen(false);
          const closeAsrDialog = () => setAsrDialog(null);
          const asrModal = asrDialog && h(AsrSettings, { setup: asrDialog === 'setup', setupButton, check: checkAsrKey, save: saveAsrKey, onClose: closeAsrDialog, onContinue: () => { closeAsrDialog(); void requestSetup(); } });
          if (environment !== 'editor') {
            const message = failure && translate(failure.key, { detail: failure.detail });
            return h('div', { className: 'wb-root' }, h('style', null, css),
              (environment === 'setup' || environment === 'complete') && reference ? h(SessionProvider, { key: reference.sessionId, session: reference }, renderSlot(CONVERSATION, {
                setup: { sessionId: reference.sessionId, check: checkSetup, complete: environment === 'complete', sending, opening: busy, failure: message, onReconfigure: () => requestSetup(true), onNew: startAfterSetup },
              })) : environment === 'required' ? h('main', { className: 'wb-environment' },
                h('div', { className: 'wb-environment-start' }, h(FilmIcon, { size: 36 }), h('h1', null, translate('environment.title')), h('p', null, translate('environment.help')),
                  h('button', { ref: setupButton, type: 'button', className: 'wb-primary', 'aria-disabled': sending, onClick: () => requestSetup() }, translate('environment.button')),
                  sending && h('p', { role: 'status' }, translate('environment.prepare')),
                  message && h('div', { className: 'wb-alert', role: 'alert' }, message))) :
                h('div', { className: failure ? 'wb-loading wb-environment-check wb-loading-error' : 'wb-loading wb-environment-check', role: failure ? 'alert' : 'status' },
                  h('span', null, message || translate('environment.check')),
                  failure && h('button', { type: 'button', className: 'wb-ghost', onClick: () => setRetry(value => value + 1) }, translate('retry'))),
              asrModal);
          }
          return h('div', { className: 'wb-root' }, h('style', null, css),
            listOpen && h(React.Fragment, null,
              h('button', { type: 'button', className: 'wb-sessions-scrim', 'aria-label': translate('task.close'), tabIndex: -1, onClick: closeList }),
              h(SessionList, { id: listId, items, activeId, busy: busy || sending || status === 'loading', loading: status === 'loading', onClose: closeList, onSelect: switchTo, onRename: renameSession, onRemove: removeSession })),
            h('div', { className: 'wb-main' },
              ready ? h(SessionProvider, { key: activeId, session: reference }, renderSlot(CONVERSATION, { model: { settings, failure, saving, status, sending, busy, openingJianying, reportNotice: setNotice, change, commit, lockConfiguration, generate, selectVersion, openJianying, browse, sessionId: activeId, sessionTitle, item: activeItem, navigation: h('button', { ref: listTrigger, type: 'button', className: 'wb-secondary wb-list-toggle', 'aria-label': translate('sessions.list'), 'aria-expanded': listOpen, 'aria-controls': listId, onClick: () => setListOpen(value => !value) }, h(Icon, { name: listOpen ? 'panel' : 'panelOpen', size: 15 }), h('span', null, translate('sessions.list'))), onNew: createSession, openAsrSettings: () => setAsrDialog('settings'), refresh } })) :
                h('div', { className: failure ? 'wb-loading wb-loading-error' : 'wb-loading', role: failure ? 'alert' : 'status' },
                  h('span', null, failure ? translate(failure.key, { detail: failure.detail }) : translate('loading')),
                  failure && h('button', { className: 'wb-ghost', type: 'button', onClick: () => setRetry((value) => value + 1) }, translate('retry')))),

            notice && h(Notice, { message: notice, onClose: () => setNotice(null), disabled: busy || saving, onConfirm: notice.sessionId ? confirmRemove : undefined, heading: notice.heading, accept: notice.accept }),
            asrModal);
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 5, label: () => t('title') }, FilmIcon));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS, locale: NS, children: { [CONVERSATION]: { kind: 'single', scope: 'session' } } }, Studio));
        ctx.slots.inject(CONVERSATION, () => ctx.slots.register({ name: CONVERSATION, locale: NS }, Conversation));
        // Keep settings/browse operations in the durable log without flooding the transcript.
        ctx.slots.inject('conversation.chat.commandview', () => {
          for (const key of ['duanju-slice', 'duanju-slice-store-asr-key']) ctx.slots.register({ name: 'conversation.chat.commandview', key }, () => null);
        });
      },
    };
  },
});
