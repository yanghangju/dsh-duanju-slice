# 内置执行契约：台词定位、局部核验与 Python 媒体桥

归属：`workflow.md`、`references/` 与 `scripts/promo.py`、`scripts/music.py`、`scripts/test_promo.py` 完整内置自用户指定的 NarratoAI `skills/duanju-promo`。适配内容包括安装包路径、环境读取、任务内 JSON 桥、原生批量视觉核验（一次请求合并多个局部窗口并逐窗判定）、正文编码帧时钟和验证。原音乐分析上游链接保留在 `references/plan-schema.md`。不加载外部本地 Skill；Node 宿主通过 DSH 原生服务委派视觉定位并完成最终草稿，Python runner 本身不调用模型、不写真实草稿。

## 入口与发现

```text
python -B -X utf8 <PLUGIN_ROOT>/advanced/runner.py --request <JSON请求文件>
```

`PLUGIN_ROOT` 为当前安装包根目录。Python 标准输出只有一份成功 JSON；日志写标准错误。任何 Python 异常退出码为 1，错误 JSON 在标准错误，不能按成功解析。所有路径返回 Windows 原生绝对路径；主会话用 `read` 读取结果，`locate` 返回的帧图交给视觉请求查看，不把大量图片再放回主上下文。

```json
{
  "action": "prepare",
  "workDir": "D:/project/tasks/new-task",
  "scriptPath": "D:/project/script.docx",
  "dramaDir": "D:/project/episodes",
  "ffmpegPath": "D:/plugin/tools/ffmpeg.exe",
  "ffprobePath": "D:/plugin/tools/ffprobe.exe",
  "data": {}
}
```

本节 Python 请求必需 `action/workDir`。`workDir` 必须绝对路径，与原剧本、分集素材和字幕目录独立。高级任务传入 Python 的是任务目录下的 `tmp/` 状态目录，Python 只在该目录内读写；正式成片放任务根。`prepare` 还需 `scriptPath/dramaDir`，字幕由 Node 宿主读取，不传给 Python；其他动作读本任务 `index.json`。`data` 未填为 `{}`，拒绝动作不支持的字段。

媒体工具优先级：请求显式字段（插件默认传内置 FFmpeg/FFprobe）> 进程 `FFMPEG_PATH/FFPROBE_PATH` > `NARRATOAI_HOME` 若显式设置时的 `config.toml` > PATH。插件不依赖任何固定外部目录；所有脚本固定从本安装包 `advanced/scripts` 加载。

## Python 媒体动作

| action | data | 返回 |
|---|---|---|
| `prepare` | 可选 `sources:[{number,files}]`，由宿主传入自然排序的绝对路径 | 新建 `index.json`，与 DOCX 配集并记录全部原片指纹；多段集仅探测、不会生成合并文件 |
| `stage_episodes` | `episodes:[正整数,...]` | 正式任务按需校验并合并多段集，更新索引，返回 `{index,staged}` |
| `beats` | `audio` 绝对只读音频路径；可选 `output`（任务内路径） | 默认新建 `beats-<uuid>.json`；`analysis/tempo/beats/file_sha256/duration` |
| `sync` | `plan` 完整对象，`beats` 本任务正式分析绝对路径；`audioIndex=0` | `synced_plan/cuts/major_hits/max_error_seconds`；宿主确认快切没有超出已核验范围后才保存 `plan.json` |
| `validate` | 可选 `plan` 完整对象，否则读 `plan.json` | `duration/planned_duration/frames/fps/segments/encoded_boundaries/body_only:true/final_completed:false` |
| `render` | `{}`，固定读取 `plan.json/index.json` | 按方案指纹新建隔离正文 MP4/结果；同指纹已有两文件完全匹配时只读 `resumed:true`，不重编码或覆盖旧文件；见下节 |
| `clean` | `{}` | 仅删除 promo 标记的 `work/`；`cleaned/assets_preserved:true` |

Python runner 不再提供 `sample`；只有 `locate` 会对白抽帧，已通过的对白在重跑时复用。

`sync` 检查分析的音频绝对路径与 SHA256；沿用完整原 promo/music 卡点算法，大重音优先，再增加真实小拍/起音；不生成模拟拍点。同步后 Node 必须再次 `validate`。`validate` 另要求黑屏位于已选快切范围，不能与 SFX 叠加破坏同步静音；实际能量落差及恢复仍由原 music 验证器核对。此动作不承担叙事验收。

## Node 宿主动作：内部取材与执行调整

- 正式剪辑的 `proposal` 保存 `{title,story,segments,base_montage_count?}` 为内部取材目标，返回 `editing`，随即 `locate`；显式只出方案时写标为 `plan_only` 的 `plan.json` 并终止，不定位或渲染。
- 可按真实素材删、替、增、重排。新增或更换对白提交 `proposal → locate`；使用已验收的对白条目，不改其边界。快切通过 `proposal → locate_montage` 在锚句紧邻无对白的空档以每秒 3 帧定位动作，并用同一组帧检查字幕、跳帧、闪镜、卡帧和封面。后续只校验 `start/end/available_end` 未超出已通过的连续区间；`picture/continuation` 不做该检查。`save_plan/sync` 可用 `plan.story` 记录实际剧情。变更后重新同步校验，50 秒、单首原速 BGM、一组 5–10 秒快切、完整原声及片尾等规格不变。
- `save_plan/sync/validate` 在同一个 `tmp/plan.json` 保存方案；`render` 从磁盘读取，不接受另一份内联计划。没有 Word 输出；若草稿登记失败，保留成片并重试 `export`，不重剪。
- 未成片时可因实际问题再次 `select_music`：同曲幂等，不同曲保留旧素材副本，改用新的单首歌曲后重新 `beats/sync/validate`，不能把多首叠加为正文。`mute` 每次从 `originalFile` 重建新副本，不累积旧静音区间，保留原曲并重分析/同步。
- 技术错误由 AI 继续修复重试，不能吞错假成功；无可用素材、取消或权限故障须保留真实诊断，不承诺必然成功，不绕过安全和源保护。

## Node 宿主动作：locate

同一剪辑会话提交内部 `proposal` 后，用 `duanju_slice_advanced` 立即调用 `locate`，无需调用 Python runner 的独立定位动作或手动发起视觉核验。`workDir` 可省略；若填写，只能用 `duanju_slice_cut` 返回的任务目录，而非其 `tmp/`。

```json
{
  "action": "locate",
  "workDir": "<duanju_slice_cut 返回的独立任务目录>",
  "data": {
    "concurrency": 6,
    "minScore": 0.65,
    "force": false
  }
}
```

- `locateEpisode` 优先用同集可用 SRT 的完整字幕条时间定位。未选 `subtitleDir` 时直接走 Slice 火山引擎 ASR；选了但该集字幕没有配对、无效、不可用或未可靠匹配某句完整台词时自动回退，无需确认。每次 `locate` 对每个需要的集最多转写一次（可复用缓存），转写只用于匹配未命中的台词，不替换已有字幕锚点。两路命中后均取锚点附近连续 5 fps 短窗，交批量视觉请求（一次请求合并多个互不相关的窗口）核验动作与切镜，不作整集粗扫。详见[台词定位与画面核验](<references/visual-alignment.md>)。
- 仅台词起止、动作或切镜边界及覆盖全部通过，才把可用项写入 `tmp/dialogue-alignment.json`。动作不确定不通过，也不因此改用 ASR。缺项保留 `incomplete` 诊断，已通过项仍可用，不在下次重跑时重新核验。

## 正文帧时钟与片尾交接

- 每个原计划累计边界统一 `round(sum(duration)*30)`，每段帧数为相邻累计边界相减；不是逐段独立 round。零帧段失败。`duration` 严格等于总帧数/30；`planned_duration` 另外保留原数学时长。
- 完整原声段若量化会缩短已核实范围，明确失败并要求看帧补验可用帧边界，不自动截对白/动作或延长源范围。必要向上不足一帧时只读到已验收 `end`，用正常 fps 向上边缘采样保留源内画面，原声完整后仅零填充至帧边界，记录 `source_mapping.output_frame_padding`。若实际源帧不足以产生要求帧数，失败而不是克隆末帧凑素材。静音段允许量化到较短源内范围，记录实际源终点。
- 每段视频首 PTS=0、无 B 帧，concat 显式使用实际帧长。各段原声另以恰好每视频帧 1600 个 48kHz PCM 样本拼接，避免逐段 AAC priming 累积；最终 AAC 只编码一次。正文完整解码并验证帧数/时长/PTS。
- Python runner 的 `render` 永远只正文：`body_only:true/final_completed:false/requires_native_ending:true`。拒绝 `freeze/flash/export`，不把正文中间片冒充成片；旧 `promo.export` 函数也已主动禁用，明确报“最终草稿必须通过插件原生导出，不加载NarratoAI业务模块”，已移除 `app` 与 `sys.path` 外部业务导入。最终强制原生片尾、完整 SFX 与草稿由安装包 Node `lib/promo/ending.js`、`lib/promo/jianying.js` 负责。
- Node 按实际 `duration=E` 在正文渲染前用 `finishMusicBefore` 将 BGM 裁到 `E−T/2`，回填 `plan.json`；T 为片尾高光秒数（默认 0.8）。`music_policy.bgm_db` 和 BGM 轨的 `volume_db` 统一为 −12，线性 `volume` 为 `10 ** (-12 / 20)`。仅补导出旧成片时，草稿沿用该片实际渲染的音量。正文已混的 BGM 与 SFX 不重复混合。

已有正文恢复：同一方案指纹的已有 MP4/结果必须都是本任务普通文件；核对 `plan_sha256`、当前 index 的源文件大小/mtime 身份、完整编码清单与源映射、正式 assets、音量、严格完整解码、实际帧数/PTS/尺寸/时长，全部一致才只读返回缓存结果加 `resumed:true`。同一产物任一缺失或不匹配均明确失败并保留诊断，不能伪装恢复或覆盖它。执行计划调整、指纹不同时使用新的隔离正文输出，新编码返回 `resumed:false`；不覆盖、不重编码旧正文，也不动旧成片或源素材。AI 处理可修复错误后继续重试，不能清掉错误或借恢复冒称完成。

正文结果至少返回：

```text
video, result, duration, planned_duration, media_duration, frames, fps=30,
encoded_segments, normalized, blackouts, plan_sha256, decode_check,
body_only=true, final_completed=false, requires_native_ending=true
```

每项 `encoded_segments`：

```text
segment_index, file, episode, kind, start, end, duration, frames,
timeline_start_frame, timeline_end_frame, timeline_start, timeline_end,
actual_duration, actual_end, planned_duration, duration_adjustment,
volume, volume_baked, source:{episode,file,start,end,duration},
source_mapping:{episode,file,start,end,duration,actual_end,actual_duration,
                output_frame_padding,method}, encoded_file, blackouts_frames
```

Node **必须用 `encoded_segments` 的 `file/start/end/volume` 生成 ending/draft clips**；不可恢复使用未量化计划段长。可直接引用的 9:16、无黑屏且帧长未改片段仍引用原集与原始 volume；画幅/黑屏/帧量化需要的正式分段落 `assets/normalized-<uuid>-*.mp4`，本地范围从 0 开始，音量已烘焙，草稿 volume=1。原集追溯始终在 `source/source_mapping`。`encoded_file:null` 只表示临时编码副本不会作为正式依赖；正式 clips 仍指原集。草稿导入时 Node 会把这些 clips、BGM/SFX 与原生片尾素材各复制一份到草稿目录的 `素材/`，`draft_content.json` 只引用草稿内副本。

## 非破坏约束

- 所有产物在本任务目录；beats 输出和 `analysis_file` 不许使用临时 `work/`。音频可从外部只读。
- index、beats、正文 MP4 与结果均不覆盖。仅 sync 可原子更新 `plan.json`。任务锁防止多个桥接进程同时操作；中断残留锁须人工确认空闲后处理，不自动夺锁。
- 原剧本、分集、字幕、音轨、正式依赖不能位于可清理的 `work/`。任务写入/清理路径拒绝符号链接与 Windows junction/reparse point；clean 再检查引用和所有后代。
- clean 仅删除任务中有 `.duanju-promo-work` 标记的 `work/`；`assets/`、计划、分析、PNG、原生效果包、WAV、最终成片及源素材保留。不会递归清理用户指定的任意目录。

## 本地回归

```powershell
& '<BUNDLED_PYTHON>' -B -X utf8 advanced/test_runner.py
& '<BUNDLED_PYTHON>' -B -X utf8 advanced/scripts/test_promo.py
```

`<BUNDLED_PYTHON>` 为 `lib/promo/runtime.js` 的 `BUNDLED_PYTHON`；也可用任意装有 `librosa==0.11.0` 的 Python 3。测试只使用合成视频/音频和临时任务，不调用模型或真实剪映草稿。
