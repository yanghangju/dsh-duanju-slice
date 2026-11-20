# Bundled from the user-specified NarratoAI duanju-promo Skill.
# Original workflow and upstream music-analysis attribution are retained in ../workflow.md.
# Plugin adaptation: environment-only NarratoAI lookup and frame-exact body rendering.
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from zipfile import ZipFile

CN = {**dict(zip("零一二三四五六七八九", range(10))), "两": 2}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
# Compute even dimensions from the display aspect ratio (including non-square source pixels).
PORTRAIT_FILTER = ("scale='2*max(1,trunc(min(1080,1920*dar)/2))':'2*max(1,trunc(min(1920,1080/dar)/2))':"
                   "out_range=tv:out_color_matrix=bt709,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,"
                   "setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709")
H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "6", "-bf", "0", "-pix_fmt", "yuv420p"]
MP4_CLOCK = ["-video_track_timescale", "90000", "-movie_timescale", "90000"]
VIDEO_COPY = ["-c:v", "copy", "-bsf:v", "setts=pts=N*3000:dts=N*3000:duration=3000", *MP4_CLOCK]


def chinese_number(text):
    if text.isdigit():
        return int(text)
    total = current = 0
    for char in text:
        if char in CN:
            current = CN[char]
        elif char in "十百":
            total += (current or 1) * (10 if char == "十" else 100)
            current = 0
        else:
            raise ValueError(f"无法识别集数：{text}")
    return total + current


def episode_number(name):
    match = re.search(r"(?:ep(?:isode)?[ _-]*0*(\d+)|第([零一二三四五六七八九十百\d]+)集)", name, re.I)
    if match:
        return int(match[1]) if match[1] else chinese_number(match[2])
    match = re.fullmatch(r"0*(\d+)", Path(name).stem)
    return int(match[1]) if match else None


def parse_script(path):
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = ["".join(p.itertext()).strip() for p in document.findall(".//w:body//w:p", ns)]
    result = {"title": Path(path).stem, "episodes": []}
    episode = entry = None
    scene = action = ""
    for text in paragraphs:
        if not text:
            continue
        match = re.match(r"^(?:第\s*([零一二两三四五六七八九十百\d]+)\s*[集话]|EP\s*(\d+)(?=\s|$|[：:、．.]))", text, re.I)
        if match:
            episode = {"number": chinese_number(match[1] or match[2]), "lines": []}
            result["episodes"].append(episode)
            entry, scene, action = None, "", ""
            continue
        if episode is None:
            continue
        if re.match(r"^\d+-\d+\s", text):
            scene, entry = text, None
            continue
        if text.startswith("▲"):
            action = (action + " " + text[1:]).strip()
            continue
        match = re.match(r"^([A-Z][A-Z0-9 .'’\-]{0,24}?)(?:\s*\((?:OS|VO|V\.O\.)\))?\s*:\s*(.+)$", text)
        if match:
            if entry is not None:
                entry["en"].append(match[2].strip())
            continue
        if text.startswith(("人物：", "音效：", "字幕：", "画面：", "注：")):
            continue
        match = re.match(r"^([^：:]{1,24})[：:]\s*(.*)$", text)
        if match:
            entry = {"id": f"E{episode['number']}L{len(episode['lines']) + 1}", "episode": episode["number"],
                     "scene": scene, "speaker": re.sub(r"（[^）]*）", "", match[1]).strip(),
                     "zh": re.sub(r"^（[^）]*）\s*", "", match[2]).strip(), "en": [], "context": action}
            episode["lines"].append(entry)
            action = ""
    if not result["episodes"]:
        raise ValueError("未找到按第X集组织的台词，请检查输入文档")
    return result


def save_json(path, data, overwrite=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".writing")
    created = False
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            created = True
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.replace(temporary, path)
        else:
            # Atomic no-clobber commit, even if another process creates the target.
            os.link(temporary, path)
    finally:
        if created and temporary.exists():
            temporary.unlink()


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def register_draft(path, before, entry):
    path = Path(path)
    snapshot = path.read_bytes() if path.exists() else None
    current = json.loads(snapshot.decode("utf-8-sig")) if snapshot is not None else {"all_draft_store": []}
    if not isinstance(current, dict) or not isinstance(current.get("all_draft_store"), list):
        raise ValueError("剪映根索引无效，拒绝覆盖")
    entries = current["all_draft_store"]
    if any(not isinstance(e, dict) for e in entries):
        raise ValueError("剪映根索引含无效条目")
    if not {e.get("draft_id") for e in before["all_draft_store"]} <= {e.get("draft_id") for e in entries}:
        raise ValueError("导出期间原有索引发生变化，请重新核对")
    if any(e.get(key) == entry.get(key) for e in entries for key in ("draft_id", "draft_name", "draft_fold_path")):
        raise ValueError("新草稿与现有条目冲突，拒绝覆盖")
    result = {**current, "all_draft_store": [entry, *entries]}
    result.setdefault("draft_ids", 1)
    result.setdefault("root_path", str(path.parent))
    if (path.read_bytes() if path.exists() else None) != snapshot:
        raise ValueError("剪映索引正在变化，请重试登记")
    save_json(path, result)


@contextmanager
def defer_registration(builder):
    original = builder._write_root_meta_info
    writer = builder._write_plaintext_draft_files
    entries = []
    builder._write_root_meta_info = lambda root, entry: entries.append(entry)
    builder._write_plaintext_draft_files = lambda *args, **kwargs: retry_file_write(lambda: writer(*args,**kwargs))
    try:
        yield entries
    finally:
        builder._write_root_meta_info = original
        builder._write_plaintext_draft_files = writer


def retry_file_write(operation):
    for attempt in range(5):
        try:
            return operation()
        except PermissionError:
            if attempt==4:
                raise
            time.sleep(0.2)


def narrato_root():
    # Optional environment override only; bundled tools are passed explicitly by the plugin bridge.
    value = os.environ.get("NARRATOAI_HOME")
    return Path(value).resolve() if value else None


def tools():
    import tomllib
    root = narrato_root()
    app = {}
    config_path = root / "config.toml" if root else None
    if not (os.environ.get("FFMPEG_PATH") and os.environ.get("FFPROBE_PATH")) and config_path and config_path.is_file():
        app = tomllib.loads(config_path.read_text(encoding="utf-8-sig")).get("app", {})
    selected = []
    for name, key in (("FFMPEG_PATH", "ffmpeg_path"), ("FFPROBE_PATH", "ffprobe_path")):
        value = os.environ.get(name) or app.get(key) or shutil.which(key.removesuffix("_path"))
        if not value:
            raise ValueError("缺少 FFmpeg/FFprobe：由插件桥显式传入内置路径，或设置对应环境变量")
        path = Path(value)
        if not path.is_absolute() and root and (root / path).is_file():
            path = root / path
        executable = str(path.resolve()) if path.is_file() else shutil.which(str(value))
        if not executable:
            raise ValueError(f"媒体工具不存在：{value}")
        selected.append(executable)
    return tuple(selected)


def run(command):
    process = subprocess.run([str(value) for value in command], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if process.returncode:
        raise RuntimeError(process.stderr[-6000:] or process.stdout[-3000:])
    return process.stdout


def probe(file, ffprobe, video_source=False):
    value = json.loads(run([ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", file]))
    video = next((s for s in value["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")), {})
    result = {"duration": float(value["format"]["duration"]), "width": video.get("width"), "height": video.get("height"),
              "has_audio": any(s["codec_type"] == "audio" for s in value["streams"])}
    if video_source:
        format_start = value["format"].get("start_time")
        start = video.get("start_time")
        result["format_start"] = float(format_start) if format_start not in (None, "N/A") else 0.0
        result["video_start"] = float(start) if start not in (None, "N/A") else result["format_start"]
        if (not all(isinstance(result[key], int) and result[key] > 0 for key in ("width", "height"))
                or not all(math.isfinite(result[key]) for key in ("duration", "format_start", "video_start"))
                or result["duration"] <= 0):
            raise ValueError(f"没有有效的视频画面或媒体时长：{file}")
    return result


def episode_asset(out, number):
    return Path(out) / "assets" / "episodes" / f"episode-{number}.mp4"


def fingerprint(path):
    info = Path(path).stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"素材不是普通文件：{path}")
    return {"size": info.st_size, "mtime_ns": info.st_mtime_ns}


def prepare(args):
    script = Path(args.script).resolve()
    if script.is_dir():
        candidates = [p for p in script.glob("*.docx") if not p.name.startswith("~$")]
        if len(candidates) != 1:
            raise ValueError("剧本目录有多份或没有 DOCX，请指定原始台词稿文件：" + "、".join(p.name for p in candidates))
        script = candidates[0]
    videos = Path(args.videos).resolve()
    if not videos.is_dir():
        raise ValueError("短剧目录不存在")
    text = parse_script(script)
    by_number = {e["number"]: e for e in text["episodes"]}
    sources = getattr(args, "sources", None)
    if sources is None:
        sources = [(episode_number(p.name), [p]) for p in videos.iterdir() if p.is_file() and p.suffix.lower() in {".mp4", ".mov", ".mkv"}]
        supplied = False
    else:
        supplied = True
        if len(by_number) != len(text["episodes"]):
            raise ValueError("剧本中存在重复集号，请确认各集原始台词")
    candidates = [(n, files) for n, files in sources if n in by_number]
    if not candidates or len({n for n, _ in candidates}) != len(candidates):
        raise ValueError("没有匹配剧本的可用剧集或同集存在多份视频，请明确素材版本")
    output = Path(args.out).resolve()
    _, ffprobe = tools()

    def inspect(item):
        number, files = item
        parts = []
        for file in files:
            snapshot = fingerprint(file)
            info = probe(file, ffprobe, video_source=supplied)
            if fingerprint(file) != snapshot:
                raise ValueError(f"剧集素材在索引时已改变：{file}")
            parts.append({**info, **snapshot, "file": str(file)})
        if len(parts) == 1:
            return {**by_number[number], **parts[0]}
        return {**by_number[number], "file": str(episode_asset(output, number)), "parts": parts,
                "duration": math.fsum(part["duration"] for part in parts), "duration_estimated": True,
                "width": 1080, "height": 1920, "has_audio": any(part["has_audio"] for part in parts), "staged": False}

    with ThreadPoolExecutor(max_workers=4) as pool:
        episodes = sorted(pool.map(inspect, candidates), key=lambda e: e["number"])
    output.mkdir(parents=True, exist_ok=True)
    if (output / "index.json").exists():
        raise ValueError("该输出目录已有素材索引，请复用索引或选择新的输出目录")
    save_json(output / "index.json", {"title": text["title"], "script": str(script), "video_dir": str(videos), "episodes": episodes}, overwrite=False)
    result = {"index": str(output / "index.json"), "episodes": len(episodes),
              "lines": sum(len(e["lines"]) for e in episodes)}
    print(json.dumps(result, ensure_ascii=False))
    return result


def work_dir(out):
    parent = Path(out).resolve()
    folder = parent / "work"
    if folder.exists() and (folder.resolve().parent != parent or folder.is_symlink() or getattr(folder, "is_junction", lambda: False)()
                            or (folder / ".duanju-promo-work").is_symlink()
                            or not (folder / ".duanju-promo-work").is_file()):
        raise ValueError("拒绝使用未标记或指向外部的工作目录")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / ".duanju-promo-work").touch()
    return folder


def verify_sources(index):
    for episode in index["episodes"]:
        sources = list(episode.get("parts", []))
        if episode.get("staged") is not False:
            sources.append(episode)
        for source in sources:
            try:
                current = fingerprint(source["file"])
            except (OSError, ValueError):
                current = {}
            if current != {key: source[key] for key in ("size", "mtime_ns")}:
                raise ValueError(f"第 {episode['number']} 集素材已改变，须重新索引与定位：{source['file']}")


def require_staged(episode):
    if episode.get("staged") is False:
        raise ValueError(f"第{episode['number']}集多段素材尚未合成（stage_episodes），请先合成再取用")


def concat_file(path, files, durations):
    path.write_text("".join("file '" + file.as_posix().replace("'", "'\\''") + f"'\nduration {seconds:.9f}\n"
                            for file, seconds in zip(files, durations)), encoding="utf-8")
    return path


def stage_episode(episode, target, ffmpeg, ffprobe):
    """Build a CFR episode and join uncompressed audio without per-part AAC priming."""
    prefix = [ffmpeg, "-v", "error", "-xerror", "-nostdin", "-n"]
    filters = ("setpts=PTS-STARTPTS,fps=30:start_time=0:round=up:eof_action=pass,"
               f"{PORTRAIT_FILTER},setpts=N/(30*TB)")
    pictures, tracks, durations, parts = [], [], [], []
    total_frames = 0
    for n, part in enumerate(episode["parts"], 1):
        picture, track = target.parent / f"video-{n}.mp4", target.parent / f"audio-{n}.wav"
        run(prefix + ["-i", part["file"], "-map", "0:V:0", "-an", "-vf", filters, *H264, *MP4_CLOCK, picture])
        actual = video_frames(picture, ffprobe, count_frames=False)
        frames = actual["frames"]
        seconds = frames / 30
        if frames < 1 or abs(actual["start"]) > 1e-6 or abs(actual["duration"] - seconds) > 1e-6:
            raise ValueError(f"第{episode['number']}集第{n}段编码帧长无效：{actual}")
        if part["has_audio"]:
            inputs = ["-copyts", "-i", part["file"]]
            # Keep original A/V offset relative to the first video frame, not the first audio packet.
            align = f"asetpts=PTS-({part['video_start']:.9f})/TB,aresample=48000:async=1:first_pts=0,"
        else:
            inputs, align = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"], ""
        run(prefix + inputs + ["-map", "0:a:0", "-af", f"{align}apad,atrim=end_sample={frames * 1600}",
                              "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", track])
        # Source ranges use seek time relative to the original container, not its raw PTS.
        start = max(0.0, part["video_start"] - part["format_start"])
        parts.append({**part, "source_start": start, "source_end": start + seconds,
                      "target_start": total_frames / 30, "target_end": (total_frames + frames) / 30})
        total_frames += frames
        pictures.append(picture)
        tracks.append(track)
        durations.append(seconds)

    video_list = concat_file(target.parent / "concat-video.txt", pictures, durations)
    audio_list = concat_file(target.parent / "concat-audio.txt", tracks, durations)
    run(prefix + ["-f", "concat", "-safe", "0", "-i", video_list, "-f", "concat", "-safe", "0", "-i", audio_list,
                  "-map", "0:v:0", "-map", "1:a:0", "-af", "asetpts=N/(48000*TB)", *VIDEO_COPY,
                  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target])
    info, actual = probe(target, ffprobe), video_frames(target, ffprobe, count_frames=False)
    duration = total_frames / 30
    if (not info["has_audio"] or (info["width"], info["height"]) != (1080, 1920) or actual["frames"] != total_frames
            or abs(actual["start"]) > 1e-6 or abs(actual["duration"] - duration) > 1e-6 or abs(info["duration"] - duration) > 1e-6):
        raise ValueError(f"第{episode['number']}集合成校验失败：{info}, {actual}")
    return {**episode, **fingerprint(target), "parts": parts, "duration": duration, "staged": True, "duration_estimated": False}


def clip_duration(segment):
    return segment["duration"] if segment["kind"] == "freeze" else segment["end"] - segment["start"]


LEGACY_BGM_DB = -3


def bgm_db_of(plan):
    """Task-level BGM dB from music_policy; None means muted, missing keeps the legacy -3 dB."""
    policy = plan.get("music_policy") or {}
    return policy["bgm_db"] if "bgm_db" in policy else LEGACY_BGM_DB


def audio_gain(audio, bgm_db=LEGACY_BGM_DB):
    role = audio.get("role")
    if role == "bgm":
        if bgm_db is None:
            if audio.get("volume_db") is not None:
                raise ValueError("BGM已设为静音，不能同时声明dB增益")
            gain = 0.0
        else:
            if not isinstance(bgm_db,(int,float)) or not math.isfinite(bgm_db):
                raise ValueError("BGM基础增益必须是有效dB数值或null（静音）")
            db = audio.get("volume_db", bgm_db)
            if db is None:
                db = bgm_db
            if not isinstance(db,(int,float)) or not math.isfinite(db):
                raise ValueError("音轨增益必须是有效dB数值")
            if abs(db-bgm_db) > 0.01:
                raise ValueError(f"BGM基础增益须为本任务 {bgm_db}dB")
            gain = 10**(db/20)
        if "volume" in audio and abs(audio["volume"]-gain)>1e-6:
            raise ValueError("线性音量与dB增益不一致，不能重复衰减")
        return gain
    db = audio.get("volume_db")
    if db is None:
        return audio.get("volume",1)
    if not isinstance(db,(int,float)) or not math.isfinite(db):
        raise ValueError("音轨增益必须是有效dB数值")
    gain = 10**(db/20)
    if "volume" in audio and abs(audio["volume"]-gain)>1e-6:
        raise ValueError("线性音量与dB增益不一致，不能重复衰减")
    return gain


def validate_plan(index, plan):
    sources = {e["number"]: e for e in index["episodes"]}
    if not plan.get("segments"):
        raise ValueError("剪辑清单没有片段")
    if any(s.get("kind") == "freeze" for s in plan["segments"][:-1]):
        raise ValueError("定格必须作为最后画面，不能再接完整正片")
    duration = 0
    for number, segment in enumerate(plan["segments"], 1):
        source = sources.get(segment.get("episode"))
        if source is None:
            raise ValueError(f"片段 {number} 没有对应剧集")
        require_staged(source)
        start = segment.get("start")
        if not isinstance(start, (int, float)) or not math.isfinite(start) or not 0 <= start < source["duration"]:
            raise ValueError(f"片段 {number} 起点越界")
        kind = segment.get("kind")
        if kind not in {"dialogue", "montage", "picture", "continuation", "freeze"}:
            raise ValueError("无效片段类型")
        end = segment.get("end", start)
        if kind != "freeze" and (not isinstance(end, (int, float)) or not math.isfinite(end) or not start < end <= source["duration"] + 0.001):
            raise ValueError(f"片段 {number} 终点越界")
        seconds = clip_duration(segment)
        if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("片段时长无效")
        flash, flash_start = segment.get("flash",0),segment.get("flash_start",0)
        if any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in (flash,flash_start)) or flash_start+flash>seconds+1e-6:
            raise ValueError("白闪时间范围无效")
        volume = segment.get("volume", 1)
        if not isinstance(volume, (int, float)) or not math.isfinite(volume) or not 0 <= volume <= 2:
            raise ValueError("原声音量须为 0–2")
        if kind == "montage" and volume != 0:
            raise ValueError("快切必须静音，不能截断原声对白充数")
        if kind == "picture" and volume != 0:
            raise ValueError("picture仅用于静音画面；有原声的台词须按对白验证完整性")
        if kind in {"dialogue", "continuation"} and (not source.get("has_audio") or volume == 0):
            raise ValueError("原声对白和连续正片必须具有可用原声音轨")
        if kind == "dialogue":
            alignment = segment.get("alignment", {})
            if alignment.get("method") != "video-frames" or not alignment.get("reviewed") or not alignment.get("complete"):
                raise ValueError("对白必须经过完整视觉定位验收")
            confidence = alignment.get("confidence", 0)
            if (not alignment.get("evidence") or not isinstance(confidence, (int, float))
                    or not math.isfinite(confidence) or confidence < 0.65 or confidence > 1):
                raise ValueError("对白缺少可靠画面证据")
            dialogue_end = alignment.get("dialogueEnd")
            if not isinstance(dialogue_end, (int, float)) or not start < dialogue_end <= end:
                raise ValueError("正文结束边界无效")
            cut = alignment.get("postDialogueCut")
            if cut is not None and (cut < dialogue_end or end > cut + 0.001):
                raise ValueError("台词收尾越过已确认切镜")
            ending = alignment.get("ending")
            if ending not in {"no-action", "action-complete", "shot-cut"}:
                raise ValueError("同镜头收尾未确认完整")
            if ending == "no-action" and abs(end-dialogue_end) > 0.001:
                raise ValueError("没有相关动作时不能延长片尾")
            if ending == "shot-cut" and (cut is None or abs(end-cut) > 0.001):
                raise ValueError("切镜收尾缺少切镜边界")
        duration += seconds
    positions = [n for n, s in enumerate(plan["segments"]) if s["kind"] == "montage"]
    if positions:
        if positions != list(range(positions[0], positions[-1] + 1)):
            raise ValueError("快切须为一组连续镜头")
        following = plan["segments"][positions[-1] + 1:]
        if not following or following[0]["kind"] not in {"dialogue", "continuation"}:
            raise ValueError("快切结束后须立即衔接保留原声的剧情高潮")
        if not 5 - 1e-6 <= sum(clip_duration(plan["segments"][n]) for n in positions) <= 10 + 1e-6:
            raise ValueError("快切区间时长须为5–10秒")
    audio_sources = {}
    bgm_hashes = set()
    bgm_db = bgm_db_of(plan)
    for audio in plan.get("audio", []):
        values = {key: audio.get(key, default) for key, default in (
            ("start", None), ("duration", None), ("source_start", 0), ("volume", 1), ("fade_in", 0), ("fade_out", 0))}
        values["volume"] = audio_gain(audio, bgm_db)
        if plan.get("music_policy",{}).get("single_song") and audio.get("role") not in {"bgm","sfx"}:
            raise ValueError("单曲方案需标记音轨role为bgm或sfx")
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in values.values()):
            raise ValueError("配乐范围、音量和淡化必须是非负有限数值")
        if not Path(audio["file"]).is_file() or not values["start"] < duration or not 0 < values["duration"] <= duration-values["start"]+0.001:
            raise ValueError("配乐或音效路径、范围无效")
        if (values["volume"] > 2 or max(values["fade_in"], values["fade_out"]) > values["duration"]
                or values["fade_in"] + values["fade_out"] > values["duration"] + 1e-9):
            raise ValueError("配乐音量或淡化长度无效")
        if audio["file"] not in audio_sources:
            audio_sources[audio["file"]] = probe(audio["file"], tools()[1])
        info = audio_sources[audio["file"]]
        if not info["has_audio"] or values["source_start"]+values["duration"] > info["duration"]+0.001:
            raise ValueError("配乐源音轨或源时间范围无效")
        if audio.get("role") == "bgm":
            bgm_hashes.add(hashlib.sha256(Path(audio["file"]).read_bytes()).hexdigest())
    if plan.get("music_policy",{}).get("single_song") and (len(bgm_hashes)!=1 or plan["music_policy"].get("song_sha256") not in bgm_hashes):
        raise ValueError("本片BGM必须来自指定的同一首歌")
    if plan.get("music_policy",{}).get("preserve_audio"):
        tracks = [a for a in plan.get("audio",[]) if a.get("role")=="bgm"]
        if len(tracks)!=1 or abs(tracks[0]["start"]+tracks[0]["duration"]-duration)>1e-6 or tracks[0].get("speed",1)!=1 or tracks[0].get("fade_in",0) or tracks[0].get("fade_out",0):
            raise ValueError("BGM须连续原样播放，不插入静音、拼接、变速或淡化")
    from music import validate_sync, validate_cues
    validate_sync(plan)
    validate_cues(plan)
    return round(duration, 6)


def encoded_timeline(plan):
    """Quantize cumulative boundaries once, never independently round each clip."""
    lengths, previous, result = [], 0, []
    for number, segment in enumerate(plan["segments"], 1):
        seconds = clip_duration(segment)
        lengths.append(seconds)
        # Stabilize half-frame ties against subtraction noise in JSON decimal endpoints.
        boundary = round(round(math.fsum(lengths) * 30, 7))
        frames = boundary - previous
        if frames <= 0:
            raise ValueError(f"片段 {number} 量化后不足一帧")
        actual = frames / 30
        # Full original dialogue/action must survive, not be silently trimmed for a beat.
        if segment["kind"] in {"dialogue", "continuation"} and actual + 1e-8 < seconds:
            raise ValueError(f"片段 {number} 累计帧量化会截短完整原声，请看帧补验可用的30fps边界后更新方案；不会自动截断或延长已验收源范围")
        result.append({"segment_index": number - 1, "frames": frames, "duration": actual,
                       "timeline_start_frame": previous, "timeline_end_frame": boundary,
                       "timeline_start": previous / 30, "timeline_end": boundary / 30,
                       "planned_duration": seconds, "duration_adjustment": actual - seconds})
        previous = boundary
    return result


def video_frames(file, ffprobe, count_frames=True):
    mode = ["-count_frames"] if count_frames else []
    value = json.loads(run([ffprobe, "-v", "error", "-select_streams", "v:0", *mode,
                           "-show_streams", "-of", "json", file]))
    stream = value["streams"][0]
    return {"frames": int(stream["nb_read_frames" if count_frames else "nb_frames"]),
            "duration": float(stream["duration"]), "start": float(stream.get("start_time", 0))}


def render(index, plan, out, body_only=False, body_key=None):
    if body_key is not None and (not body_only or not isinstance(body_key, str) or not re.fullmatch(r"[0-9a-f]{16}", body_key)):
        raise ValueError("隔离正文标识必须是方案SHA256的16位前缀，且仅用于正文")
    planned_total = validate_plan(index, plan)
    verify_sources(index)
    timeline = encoded_timeline(plan)
    total_frames = timeline[-1]["timeline_end_frame"]
    total = total_frames / 30
    ffmpeg, ffprobe = tools()
    sources = {e["number"]: e for e in index["episodes"]}
    out = Path(out).resolve()
    suffix = "-" + body_key if body_key else ""
    target = out / ("正文中间片" + suffix + ".mp4" if body_only else "宣传片.mp4")
    result_path = out / ("body-render-result" + suffix + ".json" if body_only else "render-result.json")
    if target.exists() or result_path.exists():
        raise ValueError("输出视频或渲染记录已存在，拒绝覆盖")
    stamp = uuid.uuid4().hex[:12]
    temporary = work_dir(out) / ("render-" + stamp)
    temporary.mkdir()
    assets = out / "assets"
    if assets.is_symlink() or (assets.exists() and assets.resolve().parent != out):
        raise ValueError("正式素材目录不能指向任务外部")
    assets.mkdir(exist_ok=True)
    from music import mapped_blackouts
    blackouts = mapped_blackouts(plan)
    paths, audio_paths, freezes, normalized, encoded = [], [], {}, {}, []
    for number, (segment, timing) in enumerate(zip(plan["segments"], timeline), 1):
        source = sources[segment["episode"]]
        seconds, frames = timing["duration"], timing["frames"]
        source_seconds = min(clip_duration(segment), seconds)
        local_blackouts = [(max(0, round(b["start"] * 30) - timing["timeline_start_frame"]),
                            min(frames, round(b["end"] * 30) - timing["timeline_start_frame"])) for b in blackouts]
        local_blackouts = [(start, end) for start, end in local_blackouts if start < end]
        prepared = source["width"] * 16 != source["height"] * 9 or bool(local_blackouts) or abs(timing["duration_adjustment"]) > 1e-8
        output = (assets / f"normalized-{stamp}-{number:03d}.mp4") if prepared else (temporary / f"part-{number:03d}.mp4")
        prefix = [ffmpeg, "-hide_banner", "-loglevel", "error", "-n"]
        if segment["kind"] == "freeze":
            still = temporary / f"freeze-{number}.jpg"
            run(prefix + ["-ss", segment["start"], "-i", source["file"], "-frames:v", 1, "-q:v", 2, still])
            output, prepared = assets / f"freeze-{stamp}-{number:03d}.mp4", True
            inputs = ["-loop", 1, "-i", still, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            has_audio = False
            freezes[str(number)] = str(output)
        else:
            # Input and filter trims both stop at the verified source boundary.
            inputs = ["-ss", f"{segment['start']:.9f}", "-t", f"{source_seconds:.9f}", "-i", source["file"]]
            has_audio = source["has_audio"]
            if not has_audio:
                inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            if prepared:
                normalized[str(number)] = str(output)
        filters = (f"trim=duration={source_seconds:.9f},setpts=PTS-STARTPTS,"
                   "fps=30:start_time=0:round=up,scale=1080:1920:force_original_aspect_ratio=decrease:out_range=tv:out_color_matrix=bt709,"
                   "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,"
                   "setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709,"
                   f"trim=end_frame={frames},setpts=N/(30*TB)")
        if segment.get("flash", 0):
            flash_frame = round(segment.get("flash_start", 0) * 30)
            flash_frames = max(1, round(segment["flash"] * 30))
            filters += f",fade=t=in:start_frame={flash_frame}:nb_frames={flash_frames}:color=white:enable='gte(n,{flash_frame})'"
        for start, end in local_blackouts:
            filters += f",drawbox=color=black:t=fill:enable='gte(n,{start})*lt(n,{end})'"
        audio_input = "0:a:0" if has_audio else "1:a:0"
        audio_filter = (f"aresample=48000,atrim=duration={source_seconds:.9f},asetpts=PTS-STARTPTS,"
                        f"volume={segment.get('volume', 1)},apad,atrim=end_sample={frames * 1600},asplit=2[aac][pcm]")
        pcm = temporary / f"audio-{number:03d}.wav"
        run(prefix + inputs + ["-filter_complex", f"[0:v:0]{filters}[v];[{audio_input}]{audio_filter}",
            "-map", "[v]", "-map", "[aac]", "-t", f"{seconds:.9f}", "-frames:v", frames,
            *H264,
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", *MP4_CLOCK, "-movflags", "+faststart", output,
            "-map", "[pcm]", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", pcm])
        actual = video_frames(output, ffprobe)
        if actual["frames"] != frames or abs(actual["duration"] - seconds) > 1e-6 or abs(actual["start"]) > 1e-6:
            raise ValueError(f"片段 {number} 实际编码帧长/PTS不符，须复核源帧边界：{actual}")
        paths.append(output)
        audio_paths.append(pcm)
        original = {"episode": segment["episode"], "file": source["file"], "start": segment["start"],
                    "end": segment.get("end", segment["start"]), "duration": clip_duration(segment)}
        encoded.append({**timing, "file": str(output) if prepared else source["file"], "episode": segment["episode"],
                        "kind": segment["kind"], "start": 0 if prepared else segment["start"],
                        "end": seconds if prepared else segment["start"] + seconds,
                        "actual_duration": actual["duration"], "actual_end": seconds if prepared else segment["start"] + seconds,
                        "volume": 1 if prepared else segment.get("volume", 1), "volume_baked": bool(prepared),
                        "source": original, "source_mapping": {**original, "actual_end": segment["start"] + source_seconds,
                        "actual_duration": source_seconds, "output_frame_padding": max(0, seconds - source_seconds),
                        "method": "verified-range only; cumulative30fps; fps upward edge sampling, no source extension"},
                        "encoded_file": str(output) if prepared else None, "blackouts_frames": local_blackouts})
        print(f"body rendered {number}/{len(plan['segments'])}: {frames} frames", file=sys.stderr, flush=True)
    # AAC priming is never concatenated into the source-audio timeline: PCM has exactly 1600 samples/video frame.
    durations = [t["duration"] for t in timeline]
    video_list = concat_file(temporary / "concat-video.txt", paths, durations)
    audio_list = concat_file(temporary / "concat-audio.txt", audio_paths, durations)
    joined = temporary / "joined-video.mp4"
    run([ffmpeg, "-v", "error", "-n", "-f", "concat", "-safe", "0", "-i", video_list,
         "-map", "0:v:0", "-an", *VIDEO_COPY, joined])
    command = [ffmpeg, "-v", "error", "-n", "-i", joined, "-f", "concat", "-safe", "0", "-i", audio_list]
    filters, labels = [f"[1:a]asetpts=PTS-STARTPTS,atrim=end_sample={total_frames * 1600}[original]"], ["[original]"]
    bgm_db = bgm_db_of(plan)
    for number, audio in enumerate(plan.get("audio", []), 2):
        command += ["-ss", audio.get("source_start", 0), "-t", audio["duration"], "-i", audio["file"]]
        chain = f"[{number}:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration={audio['duration']},volume={audio_gain(audio, bgm_db)}"
        if audio.get("fade_in", 0):
            chain += f",afade=t=in:st=0:d={audio['fade_in']}"
        if audio.get("fade_out", 0):
            chain += f",afade=t=out:st={audio['duration'] - audio['fade_out']}:d={audio['fade_out']}"
        chain += f",adelay={round(audio['start'] * 48000)}S:all=1[m{number}]"
        filters.append(chain)
        labels.append(f"[m{number}]")
    filters.append("".join(labels) + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true[mix]")
    run(command + ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[mix]", *VIDEO_COPY,
                   "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{total:.9f}", "-movflags", "+faststart", target])
    run([ffmpeg, "-v", "error", "-i", target, "-f", "null", "-"])
    info, actual = probe(target, ffprobe), video_frames(target, ffprobe)
    if (not info["has_audio"] or (info["width"], info["height"]) != (1080, 1920) or actual["frames"] != total_frames
            or abs(actual["duration"] - total) > 1e-6 or abs(actual["start"]) > 1e-6 or abs(info["duration"] - total) > 0.0011):
        raise ValueError(f"正文编码校验失败：{info}, {actual}；要求{total_frames}/30秒")
    result = {"video": str(target), "duration": total, "frames": total_frames, "fps": 30,
              "media_duration": info["duration"], "planned_duration": planned_total, "encoded_segments": encoded,
              "freezes": freezes, "normalized": normalized, "blackouts": blackouts, "body_only": bool(body_only),
              "final_completed": False, "requires_native_ending": True,
              "plan_sha256": hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest(), "decode_check": "passed"}
    save_json(result_path, result, overwrite=False)
    return result


def export(index, plan, out, draft_root):
    # The old video-freeze exporter must never import NarratoAI business code.
    raise ValueError("最终草稿必须通过插件原生导出，不加载NarratoAI业务模块")


def main():
    parser = argparse.ArgumentParser(description="原声短剧宣传片：索引、视觉采样、成片、剪映草稿")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare")
    for name in ("script", "videos", "out"):
        prepare_parser.add_argument("--"+name, required=True)
    beats_parser = sub.add_parser("beats")
    beats_parser.add_argument("--audio", required=True)
    beats_parser.add_argument("--out", required=True)
    sync_parser = sub.add_parser("sync")
    for name in ("plan", "beats", "out"):
        sync_parser.add_argument("--"+name, required=True)
    sync_parser.add_argument("--audio-index", type=int, default=0)
    for command in ("validate", "render", "export"):
        command_parser = sub.add_parser(command)
        command_parser.add_argument("--index", required=True)
        command_parser.add_argument("--plan", required=True)
        if command == "export":
            command_parser.add_argument("--draft-root", required=True)
    clean = sub.add_parser("clean")
    clean.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    elif args.command == "beats":
        from music import analyze_music
        if Path(args.out).exists():
            raise ValueError("拍点文件已存在，请选择新路径")
        result = analyze_music(args.audio, tools()[0])
        save_json(args.out, result)
        print(json.dumps({"analysis": args.out, "tempo": result["tempo"], "beats": len(result["beats"])}, ensure_ascii=False))
    elif args.command == "sync":
        from music import sync_montage
        if Path(args.out).exists():
            raise ValueError("方案文件已存在，请选择新路径")
        result = sync_montage(load_json(args.plan), load_json(args.beats), args.audio_index)
        save_json(args.out, result)
        print(json.dumps({"plan": args.out, "cuts": len(result["beat_sync"]["cuts"]), "max_error_seconds": result["beat_sync"]["max_error_seconds"]}, ensure_ascii=False))
    elif args.command == "clean":
        parent = Path(args.out).resolve()
        target = parent / "work"
        if target.resolve().parent != parent or target.is_symlink() or not (target / ".duanju-promo-work").is_file():
            raise ValueError("拒绝清理没有本工具标记的目录")
        shutil.rmtree(target)
        print("临时工作目录已清理")
    else:
        index, plan = load_json(args.index), load_json(args.plan)
        out = Path(args.index).resolve().parent
        if args.command == "validate":
            result = {"duration": validate_plan(index, plan), "segments": len(plan["segments"])}
        elif args.command == "render":
            result = render(index, plan, out)
        else:
            result = export(index, plan, out, args.draft_root)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, StopIteration) as error:
        print(f"失败：{error}", file=sys.stderr)
        sys.exit(1)
