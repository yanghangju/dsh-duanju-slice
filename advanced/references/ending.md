# 固定片尾：转场、完整音效与时停

本内置流程的每条正式宣传片必须包含本片尾。原文归属为用户指定的 NarratoAI duanju-promo Skill；参考实现随插件安装包自包含，`PLUGIN_ROOT` 为安装包根目录（本文件上两级），执行时直接复用 `PLUGIN_ROOT/lib/promo/ending.js`、`PLUGIN_ROOT/lib/promo/jianying.js` 等本地模块，无需读取外部 Skill、启动 DSH Host 或调用模型。仅应用片尾流程，正文仍遵守本 Skill 的单曲、主库优先、快切翻倍、全片 50 秒上限及本任务 BGM 增益。

## 固定资源与时间线

| 项目 | 要求 |
|---|---|
| 转场 | 剪映原生「炫光」，资源 ID `6726707814028284423`，时长 T 为本任务参数（默认 0.8 秒，范围 (0,10]） |
| 音效 | 「大气片尾声效」，资源 ID `7023776340713164069`，源起点 0，完整播放、音量 1、无循环或额外淡化 |
| 时停 | 取未加片尾的正文时间轴 E−1.5 秒画面，映射到对应集数、文件与源时间；保持完整正文至 E，再追加真正的 PNG 照片 |
| 转场与音效起点 | S=E−T/2；T=0.8 时即 E−0.4 秒。转场跨 E 前后各 T/2 秒，不扣减正文片段长度 |
| 照片起点与长度 | 从 E 开始，D=ceil((L−T/2)×30)/30 秒；L 为完整 PCM 音效的样本计时长度 |
| 最终总长 | E+D≤50 秒；向上取整使定格覆盖完整音效，最多多出不足一帧静画 |
| BGM 交接 | 新增 BGM 在 S 前淡出并截止，使用本任务实际线性增益，保持原声至 E，片尾音效独立播放 |

不要将 E−1.5 误解为提前结束剧情；取帧可以跨越末段或集数。正文须至少 1.5 秒，最后正文段至少 T/2 秒，音效至少 T 秒；不满足时说明问题，不偷偷缩短转场、截尾音效或裁掉正文。音效长度以实际解码样本数为准，不固定写成某次缓存的约 4.546 秒。

先探测资源与完整音效长度，为固定片尾预留 D 秒。正文加片尾超过 50 秒时，按真实素材精简或重排，必要时用内部 `proposal → locate` 更换对白，再 `save_plan → sync → validate → render`。最终片尾取帧、配乐交接和时长记录在 `plan.json`。不靠渲染后硬截、截断完整台词/关键动作或缩短片尾来满足上限；缺少素材、取消或资源故障须如实报告。

## 资源读取与保存

- 默认使用安装包内置的原生资源：`lib/promo/runtime.js` 的 `BUNDLED_ENDING_SOUND`、`BUNDLED_ENDING_TRANSITION` 交由 `findEndingSound`、`findEndingTransition` 校验；也可由用户明确指定同一资源的路径。转场路径须是完整效果包，包含 `config.json` 和 `AmazingAuto_out`。
- 缺资源时报告具体名称与 ID，请用户下载指定资源或提供路径；不换相似音效、不用白闪、自制炫光或已有 BGM 重击冒充。
- 将 `prepareEnding` 的 `tmp` 参数指向本次任务的正式 `assets/`（高级任务在任务目录的 `tmp/assets/`；成片在任务根，方案在 `tmp/plan.json`）。其生成的 `ending-*` 包含 PNG、完整 WAV、原生转场副本与导出序列帧，均是正式依赖，即使目录名含 ending 也不得随临时切片清理。

## 复用现有函数执行

原 `scripts/promo.py` 的 `freeze/flash` 只会生成视频定格，不会追加本版原生片尾；内置 runner 不开放该能力。`render` 仅可校验、渲染正文中间片；旧 Python `export` 已主动禁用并删除外部 NarratoAI `app` 导入，不可再用于正文中间草稿。最终成片和草稿按以下流程组合本安装包 DSH 函数执行，不能把正文或旧式视频定格作为完成结果。

1. 由内置 runner 的 `body-render-result.json.encoded_segments` 构建有序 `clips`：每项含 `file/episode/start/end`，其本地范围、音量与帧长以实际编码返回为准，不再用未量化的方案段长重建。保留每段 `source_mapping` 的原集与已核实源范围。不要先附加旧 `freeze`。E 严格等于正文总帧数/30（草稿微秒仅按累计边界转换），调用 `ending.js` 的 `freezeSource(clips)` 核对 E−1.5 的跨段映射。
2. 调用 `prepareEnding(ffmpeg, { source, transition, clips, tmp: 正式assets目录, targetStart: E, transitionSeconds: 本任务T })`，取得 ending 描述及完整音效 L；验证 E+ending.duration≤50 秒。保存返回的 `freeze/transition/sound`，不另造音效时长或资源数据。
3. 将 BGM 映射为 `file/sourceStart/targetStart/duration/sourceDuration/volume/fadeIn/fadeOut`，`volume` 固定为 −5 dB 的线性增益 `10 ** (-5 / 20)`。用 `finishMusicBefore(segments, ending.sound.targetStart)` 对齐正文与草稿的源范围、时长和淡化。末段淡出参考 0.5 秒，短段最多占其一半，淡入淡出不重叠。
4. 用本 Skill 的正文渲染器保留完整对白、快切静音和黑屏处理，输出正文中间片。已烘焙黑屏或画幅处理的正式分段，导出 clips 应引用处理后的素材及其本地源范围；以同一最终 clips 重新计算 `ending.freeze`，保证照片映射与草稿一致，同时保留原集与原时间的追溯记录。
5. 调用 `renderEnding` 抽取 PNG，再调用 `appendEnding` 追加照片并使用原生炫光资源的真实序列、方向与 RGB 混合规则导出画面。调用 `lib/media.js` 的 `mixBgm`，以 `[ending.sound]` 加入完整独立片尾音效，`duration=E+ending.duration`、`originalDuration=E`；正文已混好 BGM 时不重复加入它。完整解码并核对最终媒体时长。
6. 按用户选择的草稿根目录，调用 `lib/jianying.js` 的 `importToJianying({ videoPath: 最终成片, clips, music: 第3步的实际BGM片段, ending, size: {width:1080,height:1920}, name, draftRoot, ffmpeg })`。先备份原根索引；保留独立分段，不把整条最终视频当作唯一素材导入。原生转场挂在末个正文段，后接 `type: photo` 的「定格」，片尾声效为独立音轨。
7. DSH 的原声默认处理不同于本 Skill：导入后按 `plan.json` 逐段还原 `volume/last_nonzero_volume`，快切为 0，原声沿用计划，已烘焙音量的正式分段用 1。若原方案另有 SFX，保留其独立音轨，不塞进只允许不重叠 BGM 的 `music` 数组。保留已有草稿与原素材，不重复登记；验收成功前不报告完成。

## 最终核验

- `plan.json` 与渲染记录包含正文 E、音效实际 L、片尾 D、总长、E−1.5 的集数/源时间、转场和音效起点 S、BGM 实际截止和淡出，成片与草稿使用同一数据。
- 草稿中的照片必须为 PNG/type=photo，保留来源 material ID、路径与源时间戳；原生 transition 的资源 ID、本任务 T 秒时长与 overlap 关系正确；独立音效轨完整从源 0 播至结尾，音量 1、无淡入淡出。不能用烧录光效的 MP4 声称原生转场和照片。
- 成片实际复现原生资源，最终静止画面与 E−1.5 的源帧一致，正文原声完整至 E，BGM 不越过 S，完整片尾声效不截尾。切点/音画误差不超过一帧，全片含片尾≤50 秒。
- 没有实际打开剪映播放时，仅报告文件与结构核验，不能声称界面验收；没有听音能力时明确听感未验收。
