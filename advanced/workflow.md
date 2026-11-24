---
name: duanju-promo
description: Edit a short-drama trailer using a DOCX script and optional SRT subtitles; deliver one JSON plan, an MP4 and an editable 剪映 draft.
---

# 短剧原声宣传片

本插件复用 NarratoAI duanju-promo 的 `promo.py`、`music.py`、主从曲库与卡点逻辑，并用 Slice 既有语音识别及 DSH 本地媒体桥执行。默认曲库在配置运行环境时从 GitHub 下载。不读取外部 Skill。Python 接口见[执行契约](<runner-contract.md>)；运行正式任务用本插件工具，不单独调用 Python `render/export` 冒充最终交付。

## 执行顺序

1. 用 `duanju_slice_cut` 启动，已有版本修订用 `duanju_slice_revise`。读返回的 `indexFile` 和剧本，结合人物、原句、动作选择一条能独立理解的故事线，用 `proposal` 保存内部逐段安排。先探测完整片尾并预留时长。正式剪辑同轮继续，不等待方案审批，不生成 Word。仅明确要求只看方案时用 `duanju_slice_plan`，在 `proposal` 后交付标为 `plan_only` 的 JSON，不定位、抽帧或渲染。
2. 调用 `locate`。选了 `subtitleDir` 就优先匹配同集 `.srt` 的完整字幕条；缺字幕、字幕无效或不可用、未可靠匹配到完整台词时，自动用现有 ASR 定位未命中的台词，无需确认，不改已命中的台词。未选字幕目录则直接用 ASR。准备 `proposal` 时，如果剧本没有同语言原句，可从 `subtitleFiles` 中对应集的可用字幕引用完整原文为 `subtitle_quote`，仍保留 `source_line_id/quote_zh`；没有可引用字幕也继续定位。两路命中后都抽取局部 5 fps 短窗，交批量视觉请求核实人物、场景、完整动作与切镜（一次请求合并多个互不相关的局部窗口，逐窗给出判定）。读 `tmp/dialogue-alignment.json` 中已验收的对白；锚点或动作仍不确定时不得采用，重试或换已核实内容。新增目标用 `proposal → locate`；已通过（有连续 5 fps 证据）的对白在重跑时直接复用，不重新抽帧，`force:true` 才整体重查。随后调用 `locate_montage`：每个快切目标在 `proposal` 写具体动作和同集附近台词锚点。插件优先用字幕（缺失或未匹配则用 ASR），只在锚句指定侧紧邻的无对白空档内每秒抽 3 帧，用同一组帧确认动作、字幕、跳帧、闪镜、卡帧和封面。无可靠范围时换锚句或画面，不猜时间。详见[台词定位与画面核验](<references/visual-alignment.md>)。
3. 调用 `catalog` 先读本次曲库的 `music_library.json`。以 `description` 判断风格，主库 `primary` 有合适歌曲就不用从库 `secondary`。未指定则使用配置运行环境时下载的 Promo 曲库；指定目录无有效汇总或音频时说明问题，不默换其他目录。按剧情、情绪和节奏 `select_music` 锁定一首，`beats` 分析真实起音、重音与节拍。快切优先完整采用 5–10 秒快节奏段；超过 10 秒取连续的 5–10 秒并在真实音乐事件处退出；不足 5 秒另查同曲合适范围，不循环、变速或凑时长。
4. 用 `save_plan` 提交真实对白、其他镜头、选曲和音乐源映射。快切直接使用 `locate_montage` 返回的镜头，在一个已通过的连续范围内选定起止和 `available_end`，再 `sync → validate`。保存与卡点只校验边界，不重复抽帧；需要超出已核验部分时换目标并重新定位。卡点优先大重音、段落转折，再增加小拍和起音；保留未命中处自然切。按[剪辑方案](<references/plan-schema.md>)记录 `music_cues.fast_section`、最后快切的 `music_end`、实际画面证据和必要的黑场。需要主动短黑与同步静音时调用 `mute`，保留原曲和原分析，改用等长静音副本并重新 `beats/sync/validate`。黑屏不增加时长、不算实际镜头、不遮盖原声对白。配乐不合适时可重选整首再同步，不在快切中掺第二首。
5. `render` 生成完整 MP4，只做技术校验，不逐帧做视觉检查；`export` 导入可编辑剪映草稿。正文结构为**剧情铺垫 → 一组 5–10 秒静音卡点快切 → 同故事线完整原声高潮 → 固定片尾**；高潮可用 `dialogue` 或无台词的原声 `continuation`。全片含片尾不超过 50 秒；已有快切基准的新版使用两倍不同镜头，未有基准不虚构。检查时长、声称命中的卡点、黑屏及恢复误差不超过一帧，不牺牲台词与动作完整性。固定片尾按[原生片尾流程](<references/ending.md>)，用「炫光」与完整「大气片尾声效」，正文 E−1.5 秒取帧，E 开始定格。BGM 统一固定 −12 dB（线性约 0.2512），在片尾声效起点 E−T/2 前淡出并结束；原声、音效音量不变。
6. `tmp/plan.json` 是唯一执行方案，保存实际剧情、对白、镜头、源范围、音乐及片尾；渲染直接从此文件读取。任务目录根保留 MP4、`tmp/`；草稿是登记到草稿箱的独立工程，保留分段、独立音轨、原生转场、照片和素材副本。草稿失败时保留成功 MP4，用 `export` 或 `render` 补登记，不重剪。需要清理时只用 `clean` 删除工具标记的临时工作区。

## 交付和限制

返回成片、`plan.json`、草稿路径与实际时长，说明快切和关键片尾数据。剧本、分集素材和字幕源均不改写；多段集按文件名自然排序，只为需要的集生成任务内合并副本。旧版不被覆盖。台词来源不可用、无可用素材或权限故障如实报告；不假报播放或听感验收，不自动发布。
