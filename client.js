window.__ModuleLoader__.load({
  id: '@local/dsh-duanju-slice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'duanju-slice';
    const CONVERSATION = 'duanju.slice.conversation';
    const CACHE_KEY = '@local/dsh-duanju-slice:lastSessionId:v1';
    const defaults = { scriptPath: '', projectDir: '', exportDir: '', direction: '' };
    const fields = ['scriptPath', 'projectDir', 'exportDir'];
    const dictionaries = {
      zh: {
        'task.current': '当前会话', 'task.close': '收起会话列表', 'sessions.list': '会话列表', title: '切片工作台', sessions: '剪辑会话', 'sessions.new': '新建会话', 'sessions.empty': '还没有剪辑会话',
        'sessions.rename': '重命名', 'sessions.remove': '移出列表', 'sessions.removeAccept': '移出列表',
        'sessions.removeConfirm': '将这条任务移出列表？对话记录、成片和草稿都会保留。',
        'sessions.noResult': '等待配置', 'sessions.done': '第 {episode} 集 · {start}–{end}',
        'ago.now': '刚刚', 'ago.minute': '{n} 分钟', 'ago.hour': '{n} 小时', 'ago.day': '{n} 天',
        scriptPath: '剧本 DOCX', projectDir: '剪映工程目录', exportDir: '成片保存目录', direction: '切片方向',
        'empty.scriptPath': '选择剧本文件', 'empty.projectDir': '选择逐集工程所在文件夹', 'empty.exportDir': '选择成片保存位置',
        'help.scriptPath': '按剧本选段，再用工程字幕定位', 'help.projectDir': '包含 EP001、EP002 等各集草稿的目录', 'help.exportDir': 'MP4 将保存到这里，原工程保持不变',
        'missing.scriptPath': '请先选择剧本', 'missing.projectDir': '请选择剪映工程目录', 'missing.exportDir': '请选择成片保存目录', 'missing.direction': '再写下这一条想剪的方向',
        'form.title': '开始一段剪辑对话', 'form.subtitle': '先聊想法，再生成；在同一会话里持续修改。',
        'form.sources': '素材与输出', 'form.direction': '这一条，想剪什么？', 'form.directionHelp': '描述想突出的冲突、人物或情节。越具体，选段越有针对性。',
        'placeholder.direction': '例如：复仇向，突出女主当众揭穿谎言的片段，结尾保留悬念。',
        'form.examples': '试试这样写', 'example.revenge': '复仇反转', 'example.reveal': '当众揭穿', 'example.family': '亲情冲突',
        'value.revenge': '复仇向：人物从被欺负到反击，突出反转与情绪爆发。', 'value.reveal': '当众揭穿谎言，保留对方的反应，结尾停在冲突最强的位置。', 'value.family': '亲情冲突：突出家人之间的误解、对峙和情绪转折。',
        'form.ready': '确认后将锁定素材、保存位置和方向；需要更换请新建会话。', 'form.done': '继续聊修改要求，每一版都会保留。',
        'config.title': '素材与方向配置', 'config.lock': '确认并锁定配置', 'config.locked': '配置已锁定', 'config.noDirection': '未填写方向', 'editor.open': '打开剪映', 'editor.opening': '正在打开…', 'error.editor': '{detail}',
        generate: '生成初版', 'generate.running': '正在切片…', 'generate.more': '按方向再剪一版', 'chat.edit': '对话剪辑', 'chat.continue': '继续对话修改', 'chat.running': '正在回复…', 'badge.chatting': '对话中',
        'badge.setup': '待配置', 'badge.ready': '可以开始', 'badge.running': '执行中', 'badge.done': '可继续修改', 'badge.error': '未完成', 'badge.waiting': '等待确认',
        'preview.title': '成片预览', 'preview.empty': '成片会出现在这里', 'preview.help': '选好素材和方向后，确认并锁定配置。',
        'preview.loading': '正在加载视频预览…', 'preview.failed': '预览暂不可用，可直接打开成片。', 'preview.large': '视频超过内嵌预览大小限制，请直接打开成片。', 'preview.retry': '重新加载预览',
        'result.title': '当前剪辑', 'result.previous': '上次成功的成片', 'result.episode': '第 {episode} 集', 'result.duration': '{n} 秒', 'result.range': '原片 {start}–{end}', 'result.versions': '切换剪辑版本', 'result.version': 'V{version} · {n}秒',
        'result.video': 'MP4 成片', 'result.draft': '剪映草稿', 'result.pending': '完成后生成', 'result.open': '打开成片', 'result.reveal': '查看文件', 'result.draftOpen': '打开草稿目录',
        'result.draftHint': '剪映在启动时扫描草稿箱。新草稿生成后，请重启剪映再打开。',
        'progress.title': '正在制作这条切片', 'progress.help': '进度来自实际剪辑流程，可以切换任务或展开对话查看详情。',
        'progress.queued': '等待剪辑助手启动', 'progress.survey': '正在读取工程与剧本', 'progress.pick': '正在选段并定位字幕', 'progress.pick-subtitles': '正在核对工程字幕', 'progress.frames': '正在核对首尾帧', 'progress.draft': '正在生成剪映草稿', 'progress.render': '正在渲染成片',
        'step.survey': '读取素材', 'step.pick': '选段定位', 'step.draft': '生成草稿', 'step.render': '渲染成片',
        'progress.stopped': '任务已停止', 'progress.stoppedHelp': '本次没有收到完成结果。可展开对话查看原因，或重新开始。', 'progress.failed': '这次切片未完成',
        'progress.refreshError': '进度暂时无法刷新，请稍后重试或查看对话。', 'progress.pending': '剪辑助手需要你确认，请展开对话处理。',
        'chat.open': '展开对话', 'chat.close': '收起对话', 'chat.title': '剪辑助手', 'chat.help': '说说想法，或直接说“保留前25秒、音乐减半”', 'chat.details': '查看执行详情',
        choose: '选择', change: '更换', cancel: '取消', confirm: '知道了', notice: '请检查任务信息', retry: '重试',
        'status.loading': '读取中', 'status.saved': '已保存', 'status.saving': '保存中…', 'status.dirty': '待保存', 'status.error': '保存失败', loading: '正在读取切片任务…',
        'validation.paths': '请先选择剧本、工程目录和保存目录，并填写切片方向。', 'validation.docx': '剧本必须是 .docx 文件。',
        'error.open': '读取任务失败：{detail}', 'error.save': '设置保存失败：{detail}', 'error.prompt': '启动失败：{detail}', 'error.session': '任务操作失败：{detail}', 'error.pick': '选择失败：{detail}', 'error.output': '无法打开文件：{detail}',
        'error.hostPath': '无法获取本机路径，请使用桌面版或目录浏览器。', 'error.response': '服务返回了无效数据', 'error.command': '操作失败', 'error.unknown': '未知错误，请重试',
        pickerTitle: '选择{field}', pickerHelp: '浏览本机文件，不会上传。', address: '目录路径', go: '前往', parent: '上一级', roots: '常用目录', entries: '目录内容', browsing: '正在读取目录…', empty: '这里没有可选择的项目', truncated: '仅显示前 200 项，请输入更具体的目录。', selectFolder: '选择当前目录', selectFile: '选择此 DOCX', folder: '文件夹', docx: 'DOCX 文件', 'error.browse': '读取目录失败：{detail}',
        prompt: '请按这些设置调用 duanju_slice_cut，生成当前会话的一个新版本：\n```json\n{parameters}\n```\n保留已有版本，不额外生成多条候选。完成后简短说明集号、时间码、草稿与成片位置；之后我会在本会话继续对话修改。',
      },
      en: {
        'task.current': 'Current conversation', 'task.close': 'Collapse conversation list', 'sessions.list': 'Conversations', title: 'Slice studio', sessions: 'Editing conversations', 'sessions.new': 'New conversation', 'sessions.empty': 'No conversations yet', 'sessions.rename': 'Rename', 'sessions.remove': 'Remove from list', 'sessions.removeAccept': 'Remove', 'sessions.removeConfirm': 'Remove this task from the list? Its conversation, video and draft will be kept.', 'sessions.noResult': 'Needs setup', 'sessions.done': 'Episode {episode} · {start}–{end}',
        'ago.now': 'now', 'ago.minute': '{n}m', 'ago.hour': '{n}h', 'ago.day': '{n}d',
        scriptPath: 'Script DOCX', projectDir: 'Jianying projects', exportDir: 'Export folder', direction: 'Slice direction', 'empty.scriptPath': 'Choose a script', 'empty.projectDir': 'Choose the episode project folder', 'empty.exportDir': 'Choose where to save the video', 'help.scriptPath': 'Pick from the script, locate using project subtitles', 'help.projectDir': 'A folder containing EP001, EP002 and other episode drafts', 'help.exportDir': 'The MP4 is saved here; source projects stay intact', 'missing.scriptPath': 'Choose a script first', 'missing.projectDir': 'Choose a project folder', 'missing.exportDir': 'Choose an export folder', 'missing.direction': 'Describe the direction for this slice',
        'form.title': 'Start an editing conversation', 'form.subtitle': 'Discuss an idea, generate a version, then keep refining it here.', 'form.sources': 'Sources & output', 'form.direction': 'What should this slice focus on?', 'form.directionHelp': 'Describe a conflict, character or moment. Specific details help select the scene.', 'placeholder.direction': 'For example: revenge — expose the lie in public, ending on a cliffhanger.', 'form.examples': 'Try a direction', 'example.revenge': 'Revenge', 'example.reveal': 'Expose a lie', 'example.family': 'Family conflict', 'value.revenge': 'Revenge: focus on the turn from being bullied to fighting back.', 'value.reveal': 'Expose a lie in public, include the reaction, and end at the peak of the conflict.', 'value.family': 'Family conflict: focus on misunderstandings, confrontations and emotional turns.', 'form.ready': 'Confirmation locks these settings. Start a new conversation to change them.', 'form.done': 'Keep refining in this conversation. Earlier versions are retained.',
        generate: 'Generate first version', 'generate.running': 'Making your slice…', 'generate.more': 'Cut a new version', 'chat.edit': 'Chat to edit', 'chat.continue': 'Continue editing', 'chat.running': 'Replying…', 'badge.chatting': 'In conversation', 'badge.setup': 'Needs setup', 'badge.ready': 'Ready', 'badge.running': 'Running', 'badge.done': 'Ready to edit', 'badge.error': 'Incomplete', 'badge.waiting': 'Needs confirmation',
        'preview.title': 'Video preview', 'preview.empty': 'Your video will appear here', 'preview.help': 'Choose sources, describe a direction, then start.', 'preview.loading': 'Loading video…', 'preview.failed': 'Preview unavailable. You can open the video directly.', 'preview.large': 'This video exceeds the inline preview limit. Open it directly.', 'preview.retry': 'Reload preview',
        'result.title': 'Current edit', 'result.previous': 'Previous successful video', 'result.episode': 'Episode {episode}', 'result.duration': '{n} seconds', 'result.range': 'Source {start}–{end}', 'result.video': 'MP4 video', 'result.draft': 'Jianying draft', 'result.pending': 'Available when complete', 'result.open': 'Open video', 'result.reveal': 'Show file', 'result.draftOpen': 'Open draft folder', 'result.draftHint': 'Restart Jianying after generation so the new draft appears in its draft library.',
        'progress.title': 'Making your slice', 'progress.help': 'Progress follows the actual editing pipeline. Switch tasks or open chat for details.', 'progress.queued': 'Waiting for the editing agent', 'progress.survey': 'Reading projects and script', 'progress.pick': 'Selecting and locating a scene', 'progress.pick-subtitles': 'Checking project subtitles', 'progress.frames': 'Checking first and last frames', 'progress.draft': 'Writing the Jianying draft', 'progress.render': 'Rendering the video', 'step.survey': 'Read sources', 'step.pick': 'Locate scene', 'step.draft': 'Write draft', 'step.render': 'Render video', 'progress.stopped': 'Task stopped', 'progress.stoppedHelp': 'No completion result was received. Open chat for details or try again.', 'progress.failed': 'This slice could not finish', 'progress.refreshError': 'Progress could not refresh. Retry shortly or check chat.', 'progress.pending': 'The editing agent needs your confirmation. Open chat to respond.',
        'chat.open': 'Open chat', 'chat.close': 'Close chat', 'chat.title': 'Editing assistant', 'chat.help': 'Discuss an idea, or say “keep the first 25s and halve the music”', 'chat.details': 'View execution details', 'result.versions': 'Switch edit version', 'result.version': 'V{version} · {n}s',
        'config.title': 'Sources and direction', 'config.lock': 'Confirm and lock settings', 'config.locked': 'Settings locked', 'config.noDirection': 'No direction yet', 'editor.open': 'Open Jianying', 'editor.opening': 'Opening…', 'error.editor': '{detail}',
        choose: 'Choose', change: 'Change', cancel: 'Cancel', confirm: 'OK', notice: 'Check task information', retry: 'Retry', 'status.loading': 'Loading', 'status.saved': 'Saved', 'status.saving': 'Saving…', 'status.dirty': 'Unsaved', 'status.error': 'Save failed', loading: 'Loading slice tasks…',
        'validation.paths': 'Choose a script, project folder and export folder, and enter a direction.', 'validation.docx': 'The script must be a .docx file.', 'error.open': 'Could not load task: {detail}', 'error.save': 'Could not save: {detail}', 'error.prompt': 'Could not start: {detail}', 'error.session': 'Task operation failed: {detail}', 'error.pick': 'Selection failed: {detail}', 'error.output': 'Could not open file: {detail}', 'error.hostPath': 'Local path unavailable. Use Desktop or the file browser.', 'error.response': 'Invalid service response', 'error.command': 'Operation failed', 'error.unknown': 'Unknown error. Try again.',
        pickerTitle: 'Choose {field}', pickerHelp: 'Browse local files. Nothing is uploaded.', address: 'Folder path', go: 'Go', parent: 'Up one level', roots: 'Locations', entries: 'Contents', browsing: 'Reading folder…', empty: 'No matching items', truncated: 'Showing the first 200 entries. Enter a more specific path.', selectFolder: 'Choose this folder', selectFile: 'Choose this DOCX', folder: 'Folder', docx: 'DOCX file', 'error.browse': 'Could not read folder: {detail}',
        prompt: 'Call duanju_slice_cut to make a new version in this conversation:\n```json\n{parameters}\n```\nKeep previous versions. Make one version, then briefly give the episode, timecode, draft and video paths. We can continue editing in this conversation.',
      },
    };

    function normalize(value) {
      return {
        ...Object.fromEntries(fields.map((key) => [key, String(value[key] ?? '').trim()])),
        direction: String(value.direction ?? '').trim(),
      };
    }
    function validation(value, generating = false) {
      const settings = normalize(value);
      if (settings.scriptPath && !/\.docx$/i.test(settings.scriptPath)) return 'validation.docx';
      if (generating && (!settings.scriptPath || !settings.projectDir || !settings.exportDir || !settings.direction)) return 'validation.paths';
      return null;
    }
    function changedSettings(value, patch) { return { ...value, ...patch }; }
    function runParameters(value) { return normalize(value); }
    const shortName = (path) => path ? path.split(/[\\/]/).filter(Boolean).pop() || path : '';
    function Icon({ name, size = 16, className }) {
      const paths = {
        chevron: 'M7 10l5 5 5-5', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l4 4L19 6',
        play: 'M8 5l11 7-11 7z', arrow: 'M7 17L17 7M7 7h10v10',
        folder: 'M3 7a2 2 0 012-2h5l2 3h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
        doc: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8zM14 3v5h6M8 12h8M8 16h5',
        chat: 'M21 11.5a8.5 8.5 0 01-8.5 8.5H3l2.5-4.5A8.5 8.5 0 1121 11.5zM8 10h8M8 14h5',
        panel: 'M4 4h16v16H4zM9 4v16M15 9l-3 3 3 3', panelOpen: 'M4 4h16v16H4zM9 4v16M12 9l3 3-3 3',
        edit: 'M4 20l4-1 12-12-3-3L5 16zM14 7l3 3', lock: 'M5 10h14v11H5zM8 10V7a4 4 0 018 0v3', film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4',
        info: 'M12 8h.01M12 11v6M22 12a10 10 0 11-20 0 10 10 0 0120 0',
        alert: 'M12 8v5M12 16h.01M10.2 4.2L2.5 17.5A1.7 1.7 0 004 20h16a1.7 1.7 0 001.5-2.5L13.8 4.2a2.1 2.1 0 00-3.6 0',
        spinner: 'M21 12a9 9 0 11-9-9', dot: 'M12 11h.01',
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className }, h('path', { d: paths[name] || paths.info }));
    }

    function FilmIcon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        h('path', { d: 'M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4M7 12h10' }));
    }

    const css = `
.wb-root{--wb-bg:var(--dsw-alias-bg-base,#fff);--wb-soft:color-mix(in srgb,var(--dsw-alias-label-primary,#202530) 3.5%,var(--dsw-alias-bg-base,#fff));--wb-line:var(--dsw-alias-border-l2,#e5e7ed);--wb-ink:var(--dsw-alias-label-primary,#202530);--wb-ink2:var(--dsw-alias-label-secondary,#555e6e);--wb-ink3:var(--dsw-alias-label-tertiary,#767f8f);--wb-hover:var(--dsw-alias-interactive-bg-hover,#edf0f6);--wb-accent:#4565e8;--wb-success:#278653;--wb-error:#c74743;position:relative;display:flex;flex:1;height:100%;min-height:0;min-width:0;overflow:hidden;background:var(--wb-bg);color:var(--wb-ink);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif);container:studio / inline-size}
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
.wb-field{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;column-gap:12px;padding:14px 0}
.wb-field+.wb-field{border-top:1px solid var(--wb-line)}
.wb-field-label{display:block;margin-bottom:0;font-size:12px;font-weight:500;color:var(--wb-ink2)}
.wb-file-choice{display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:43px;padding:10px 11px;border:1px solid var(--wb-line);border-radius:7px;background:var(--wb-soft);text-align:left}
.wb-file-choice:hover:not(:disabled){border-color:var(--wb-accent)}
.wb-file-choice:disabled{opacity:1!important}.wb-file-choice>svg{color:var(--wb-ink3)}
.wb-file-choice[data-empty="false"]>svg{color:var(--wb-accent)}
.wb-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.wb-file-choice[data-empty="true"] .wb-file-name{color:var(--wb-ink3)}
.wb-file-action{flex:none;font-size:11px;color:var(--wb-accent)}
.wb-field-hint{grid-column:2;margin-top:5px!important;font-size:10.5px;color:var(--wb-ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.duanju-picker-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
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
.wb-config-files{display:flex;align-items:center;gap:14px;min-width:0}
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
@container slice (max-width:850px){.wb-config-files{gap:8px}}

@media(prefers-reduced-motion:reduce){.wb-root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'fileUpload', 'remote', 'remote.session', 'remote.commands', 'remote.workspaceFiles'],
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
        async function command(runtime, request, signal = runtime.abort.signal, files = []) {
          active(runtime);
          const execution = remoteValue(await remote.commands.execute(runtime.reference.sessionId, '/duanju-slice ' + JSON.stringify(request), files, signal));
          active(runtime);
          if (execution?.result?.kind === 'error') throw new Error(execution.result.text || t('error.command'));
          if (execution?.result?.kind !== 'success') throw new Error(t('error.response'));
          try {
            const value = JSON.parse(execution.result.text);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
            return value;
          } catch { throw new Error(t('error.response')); }
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

        function Conversation({ useSession, useSessionStatus, renderFactorySlot, model }) {
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
          const chatButton = React.useRef(null);
          const alive = React.useRef(true);
          const directionId = React.useId();
          const directionHelpId = React.useId();
          const chatId = React.useId();
          React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
          const { settings, failure, saving, status, sending, busy, change, commit, lockConfiguration, generate, selectVersion, openJianying, openingJianying, browse, reportNotice, item = {}, sessionId, sessionTitle, onNew, refresh } = model;
          const task = item.task;
          const result = item.lastResult;
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
          const missing = fields.find((field) => !settings[field]) || (!settings.direction.trim() ? 'direction' : null);
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
          const stage = ['survey', 'pick', 'draft', 'render'];
          const stageIndex = task?.stage === 'frames' || task?.stage === 'pick-subtitles' ? 1 : stage.indexOf(task?.stage);
          const progressText = pending ? 'progress.pending' : 'progress.' + (stageIndex < 0 ? 'queued' : task.stage);
          return h('div', { className: 'wb-shell', 'data-chat-open': chatOpen, 'data-started': started },
            h('input', { ref: scriptInput, type: 'file', accept: '.docx', hidden: true, onChange: selectScript }),
            h('header', { className: 'wb-bar', 'data-window-drag': true },
              h('div', { className: 'wb-bar-left' }, model.navigation, h('div', { className: 'wb-brand' }, h(FilmIcon, { size: 21 }), h('h1', { className: 'wb-title' }, translate('title'))), h('span', { className: 'wb-current-session', title: sessionTitle }, sessionTitle)),
              h('div', { className: 'wb-bar-right' },
                h('button', { type: 'button', className: 'wb-secondary wb-nav-new', disabled: busy || sending, 'aria-label': translate('sessions.new'), title: translate('sessions.new'), onClick: onNew }, h(Icon, { name: 'plus', size: 15 }), h('span', null, translate('sessions.new'))),
                h('button', { type: 'button', className: 'wb-secondary wb-editor-open', disabled: !!openingJianying, 'aria-label': translate('editor.open'), title: translate('editor.open'), onClick: openJianying }, h(Icon, { name: openingJianying ? 'spinner' : 'arrow', size: 15, className: openingJianying ? 'wb-spinner' : undefined }), h('span', null, translate(openingJianying ? 'editor.opening' : 'editor.open'))),
                h('span', { className: 'wb-state', 'data-state': status, role: 'status', 'aria-live': 'polite' }, h(Icon, { name: status === 'saved' ? 'check' : status === 'saving' ? 'spinner' : 'dot', size: 13 }), translate('status.' + status)),
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
                      h('span', { className: 'wb-config-files' }, fields.map(field => h('span', { key: field, title: translate(field) + '：' + settings[field] }, h(Icon, { name: field === 'scriptPath' ? 'doc' : 'folder', size: 13 }), h('span', null, shortName(settings[field]) || translate('empty.' + field))))),
                      h('span', { className: 'wb-config-direction', title: settings.direction }, translate('direction') + '：' + (settings.direction || translate('config.noDirection'))),
                      h('span', { className: 'wb-config-status' }, h(Icon, { name: 'lock', size: 13 }), translate('config.locked'))),
                  !configurationLocked && h('form', { className: 'wb-form', onSubmit: (event) => { event.preventDefault(); if (!locked && !missing) lockConfiguration(); } },
                    h('section', { className: 'wb-card' },
                      h('div', { className: 'wb-card-head' }, h('h3', null, translate('form.sources'))),
                      h('div', { className: 'wb-fields' }, fields.map((field) => h('div', { key: field, className: 'wb-field' },
                        h('span', { className: 'wb-field-label' }, translate(field)),
                        h('button', { type: 'button', className: 'wb-file-choice', 'data-empty': !settings[field], disabled: locked, title: settings[field] || translate('help.' + field), 'aria-label': translate(field) + ' · ' + (shortName(settings[field]) || translate('choose')), onClick: () => choose(field) },
                          h(Icon, { name: field === 'scriptPath' ? 'doc' : 'folder', size: 18 }), h('span', { className: 'wb-file-name' }, shortName(settings[field]) || translate('empty.' + field)), !locked && h('span', { className: 'wb-file-action' }, translate(settings[field] ? 'change' : 'choose'))),
                        null)))),
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
                      h('div', { className: 'wb-output-head' }, h('h3', null, translate(result ? completed ? 'result.title' : 'result.previous' : 'preview.title')), started && h('span', { className: 'wb-badge', 'data-state': badge }, translate('badge.' + badge)), (item.results?.length ?? 0) > 1 ? h('select', { className: 'wb-version-select', 'aria-label': translate('result.versions'), value: result.version, disabled: working || busy, onChange: (event) => selectVersion(Number(event.target.value)) }, item.results.map(version => h('option', { key: version.id, value: version.version }, translate('result.version', { version: version.version, n: Number((version.end - version.start).toFixed(1)) })))) : result && h('span', null, translate('result.episode', { episode: result.episode }))),
                      cutting || pending ? h('div', { className: 'wb-progress wb-progress-run', role: 'status', 'aria-live': 'polite' },
                        h('div', { className: 'wb-progress-title' }, h(Icon, { name: pending ? 'alert' : 'spinner', size: 18, className: pending ? undefined : 'wb-spinner' }), translate(progressText)),
                        h('p', { className: 'wb-progress-text' }, translate('progress.help')),
                        h('ol', { className: 'wb-steps' }, stage.map((step, index) => h('li', { key: step, 'data-state': index === stageIndex ? 'active' : index < stageIndex ? 'done' : 'next', 'aria-current': index === stageIndex ? 'step' : undefined }, h('span', { className: 'wb-step-dot' }, index < stageIndex ? h(Icon, { name: 'check', size: 11 }) : index + 1), h('span', null, translate('step.' + step))))),
                        h('button', { type: 'button', className: 'wb-ghost', onClick: openChat }, translate('chat.details'), h(Icon, { name: 'arrow', size: 13 }))) : null,
                      (failed || stopped) && h('div', { className: 'wb-progress', role: 'alert' },
                        h('div', { className: 'wb-progress-title' }, h(Icon, { name: 'alert', size: 18 }), translate(failed ? 'progress.failed' : 'progress.stopped')),
                        h('p', { className: 'wb-progress-text' }, failed ? task.error : translate('progress.stoppedHelp')),
                        h('button', { type: 'button', className: 'wb-ghost', onClick: openChat }, translate('chat.details'), h(Icon, { name: 'arrow', size: 13 }))),
                      refreshError && h('p', { className: 'wb-preview-fallback', role: 'status' }, translate('progress.refreshError')),
                      result?.outFile ? h(VideoPreview, { key: result.outFile, result, sessionId }) : h('div', { className: 'wb-preview-area' }, h(FilmIcon, { size: 37 }), h('strong', null, translate('preview.empty')), !started && h('p', null, translate('preview.help')), configurationLocked && h('button', { type: 'button', className: 'wb-secondary wb-generate', disabled: locked || !!missing, onClick: () => { if (!locked && !missing) generate(); } }, h(Icon, { name: working ? 'spinner' : 'play', size: 14, className: working ? 'wb-spinner' : undefined }), translate(cutting ? 'generate.running' : working ? 'chat.running' : 'generate'))),
                      result && h('div', { className: 'wb-result-meta' }, h('strong', null, translate('result.episode', { episode: result.episode })), h('span', null, translate('result.duration', { n: Number((result.end - result.start).toFixed(1)) })), h('span', { className: 'wb-result-range' }, translate('result.range', { start: seconds(result.start), end: seconds(result.end) }))),
                      result && h('div', { className: 'wb-output-files' },
                        result.outFile && h('button', { type: 'button', className: 'wb-secondary', title: result.outFile, onClick: () => openPath(result.outFile) }, h(Icon, { name: 'film', size: 14 }), translate('result.open')),
                        result.draftDir && h('button', { type: 'button', className: 'wb-secondary', title: result.draftDir, onClick: () => openPath(result.draftDir) }, h(Icon, { name: 'folder', size: 14 }), translate('result.draftOpen')),
                        result.outFile && h('button', { type: 'button', className: 'wb-ghost wb-reveal', 'aria-label': translate('result.reveal'), title: translate('result.reveal'), onClick: () => openPath(result.outFile, 'reveal') }, h(Icon, { name: 'arrow', size: 14 })))),
                    result && h('div', { className: 'wb-draft-hint' }, h(Icon, { name: 'info', size: 13 }), h('span', null, translate('result.draftHint'))))))),
            chatVisited && h('aside', { id: chatId, className: 'wb-chat-drawer', hidden: !chatOpen, 'aria-label': translate('chat.title'), onKeyDown: (event) => { if (event.key === 'Escape') closeChat(); } },
              h('div', { className: 'wb-chat-head' }, h('div', null, h('strong', null, translate('chat.title')), h('p', null, translate('chat.help'))), h('button', { type: 'button', className: 'wb-icon-button', 'aria-label': translate('chat.close'), onClick: closeChat }, h(Icon, { name: 'close', size: 18 }))),
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
          const [listOpen, setListOpen] = React.useState(true);
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
          const [openingJianying, setOpeningJianying] = React.useState(false);
          const [busy, setBusy] = React.useState(false);
          const [retry, setRetry] = React.useState(0);
          React.useEffect(() => { if (!listOpen) listTrigger.current?.focus(); }, [listOpen, activeId]);
          const adopt = React.useCallback(async (runtime, sessionId) => {
            active(runtime);
            if (runtime.reference?.sessionId === sessionId) return runtime.reference;
            const next = sessions.retain(sessionId, { source: 'controllerOperation' });
            runtime.owned.add(next);
            try { await next.ready; active(runtime); }
            catch (error) { release(runtime, next); throw error; }
            runtime.reference = next;
            setReference(next);
            try { localStorage.setItem(CACHE_KEY, sessionId); } catch { /* A blocked browser cache must not block editing. */ }
            return next;
          }, []);
          const applyProject = (runtime, project) => {
            if (project.sessions.length) setItems(project.sessions);
            activeRef.current = project.sessionId; setActiveId(project.sessionId);
            settingsRef.current = project.settings; setSettings(project.settings);
            runtime.saved = JSON.stringify(project.settings); setStatus('saved'); setFailure(null);
          };
          React.useEffect(() => {
            const runtime = { abort: new AbortController(), owned: new Set(), reference: null, saveTask: null, saved: '' };
            runtimeRef.current = runtime;
            setReference(null); setItems([]); setActiveId(null); activeRef.current = null;
            setStatus('loading'); setFailure(null); setNotice(null); setSaving(false); setSending(false); setOpeningJianying(false); setBusy(false);
            (async () => {
              let cached;
              try { cached = localStorage.getItem(CACHE_KEY); } catch { /* Host storage remains authoritative. */ }
              if (cached) {
                try { await adopt(runtime, cached); }
                catch { await adopt(runtime, await blankSession(runtime)); }
              } else await adopt(runtime, await blankSession(runtime));
              const known = sessionList(await command(runtime, { action: 'list' }));
              let project;
              if (!known.length) {
                const created = await command(runtime, { action: 'create', adopt: runtime.reference.sessionId });
                await adopt(runtime, created.sessionId);
                project = projectState(created);
              } else if (known.some((item) => item.id === runtime.reference.sessionId)) project = projectState(await command(runtime, { action: 'open' }));
              else {
                await adopt(runtime, known[0].id);
                project = projectState(await command(runtime, { action: 'open' }));
              }
              applyProject(runtime, project);
            })().catch((error) => {
              if (!canceled(runtime, error)) { setFailure({ key: 'error.open', detail: detail(error) }); setStatus('error'); }
            });
            return () => {
              runtime.abort.abort();
              for (const owned of [...runtime.owned]) release(runtime, owned);
              if (runtimeRef.current === runtime) runtimeRef.current = null;
            };
          }, [adopt, retry]);
          // Release replaced bindings after React removes their editable subtree, not before.
          React.useEffect(() => {
            const runtime = runtimeRef.current;
            return () => { if (runtime && reference) release(runtime, reference); };
          }, [reference]);

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
          return h('div', { className: 'wb-root' }, h('style', null, css),
            listOpen && h(React.Fragment, null,
              h('button', { type: 'button', className: 'wb-sessions-scrim', 'aria-label': translate('task.close'), tabIndex: -1, onClick: closeList }),
              h(SessionList, { id: listId, items, activeId, busy: busy || sending || status === 'loading', loading: status === 'loading', onClose: closeList, onSelect: switchTo, onRename: renameSession, onRemove: removeSession })),
            h('div', { className: 'wb-main' },
              ready ? h(SessionProvider, { key: activeId, session: reference }, renderSlot(CONVERSATION, { model: { settings, failure, saving, status, sending, busy, openingJianying, reportNotice: setNotice, change, commit, lockConfiguration, generate, selectVersion, openJianying, browse, sessionId: activeId, sessionTitle, item: activeItem, navigation: h('button', { ref: listTrigger, type: 'button', className: 'wb-secondary wb-list-toggle', 'aria-label': translate('sessions.list'), 'aria-expanded': listOpen, 'aria-controls': listId, onClick: () => setListOpen(value => !value) }, h(Icon, { name: listOpen ? 'panel' : 'panelOpen', size: 15 }), h('span', null, translate('sessions.list'))), onNew: createSession, refresh } })) :
                h('div', { className: failure ? 'wb-loading wb-loading-error' : 'wb-loading', role: failure ? 'alert' : 'status' },
                  h('span', null, failure ? translate(failure.key, { detail: failure.detail }) : translate('loading')),
                  failure && h('button', { className: 'wb-ghost', type: 'button', onClick: () => setRetry((value) => value + 1) }, translate('retry')))),

            notice && h(Notice, { message: notice, onClose: () => setNotice(null), disabled: busy || saving, onConfirm: notice.sessionId ? confirmRemove : undefined, heading: notice.heading, accept: notice.accept }));
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 5, label: () => t('title') }, FilmIcon));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS, locale: NS, children: { [CONVERSATION]: { kind: 'single', scope: 'session' } } }, Studio));
        ctx.slots.inject(CONVERSATION, () => ctx.slots.register({ name: CONVERSATION, locale: NS }, Conversation));
        // Keep settings/browse operations in the durable log without flooding the transcript.
        ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'duanju-slice' }, () => null));
      },
    };
  },
});
