"""Self-contained JSON bridge for the bundled NarratoAI duanju-promo executor.

python -B -X utf8 runner.py --request <jsonfile>
Only a body intermediate is rendered; native ending/export belongs to the plugin.
See workflow.md and runner-contract.md for provenance, policy and the full workflow.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import shutil
import stat
import sys
import uuid
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
# Explicit files, not NARRATOAI_HOME or a possibly preloaded external module.
for _name in ("music", "promo"):
    _spec = importlib.util.spec_from_file_location(_name, ROOT / "scripts" / (_name + ".py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_name] = _module
    _spec.loader.exec_module(_module)
import music
import promo

ACTIONS = {
    "prepare": {"sources"}, "stage_episodes": {"episodes"},
    "beats": {"audio", "output"}, "sync": {"plan", "beats", "audioIndex"},
    "validate": {"plan"}, "render": set(), "clean": set(),
}


def no_links(path):
    """Reject Windows junctions/reparse points as well as symlinks before resolving."""
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        if part.is_symlink() or (part.exists() and getattr(part.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
            raise ValueError(f"任务写入/清理路径不能包含符号链接或目录联接：{part}")
    return path


def absolute(value, name):
    if not isinstance(value, str) or not value.strip() or not Path(value).is_absolute():
        raise ValueError(f"{name} 必须为非空绝对路径")
    return Path(value).resolve()


def within(path, parent):
    return path == parent or parent in path.parents


def task_path(work, value, name, fresh=False):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} 路径无效")
    candidate = Path(value)
    candidate = no_links(candidate if candidate.is_absolute() else work / candidate).resolve()
    if candidate == work or not within(candidate, work):
        raise ValueError(f"{name} 只能写入/读取本次任务目录")
    if within(candidate, work / "work"):
        raise ValueError(f"{name} 必须使用正式任务路径，不能放入会被clean删除的work目录")
    if fresh and candidate.exists():
        raise ValueError(f"{name} 已存在，拒绝覆盖")
    return candidate


def input_file(value, name):
    path = absolute(value, name)
    if not path.is_file():
        raise ValueError(f"{name} 不存在或不是文件：{path}")
    return path


def number(value, name, minimum=0, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum or (integer and not isinstance(value, int)):
        raise ValueError(f"{name} 必须为有效{'整数' if integer else '数值'}，且不小于{minimum}")
    return value


@contextmanager
def task_lock(work):
    lock = no_links(work / ".advanced-runner.lock")
    token = uuid.uuid4().hex
    with lock.open("x", encoding="utf-8") as stream:
        stream.write(token)
    try:
        yield
    finally:
        # Only remove the exact lock created by this invocation.
        if lock.is_file() and not lock.is_symlink() and lock.read_text(encoding="utf-8") == token:
            lock.unlink()


def write_json(path, value, replace=False):
    """Atomic same-directory commit; replacement is reserved for owned task state."""
    no_links(path)
    if path.exists() and not replace:
        raise ValueError(f"输出已存在，拒绝覆盖：{path.name}")
    promo.save_json(path, value, overwrite=replace)


@contextmanager
def runtime(request):
    keys = ("FFMPEG_PATH", "FFPROBE_PATH", "NUMBA_CACHE_DIR", "LIBROSA_CACHE_DIR")
    before = {key: os.environ.get(key) for key in keys}
    try:
        for field, variable in (("ffmpegPath", "FFMPEG_PATH"), ("ffprobePath", "FFPROBE_PATH")):
            if request.get(field):
                if not isinstance(request[field], str):
                    raise ValueError(f"{field} 必须为可执行文件路径或PATH命令")
                os.environ[variable] = request[field]
        yield
    finally:
        for key, value in before.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def supplied_sources(raw, videos):
    if not isinstance(raw, list) or not raw:
        raise ValueError("data.sources 必须是非空剧集数组")
    groups, seen = {}, set()
    for entry in raw:
        if not isinstance(entry, dict) or set(entry) != {"number", "files"}:
            raise ValueError("每项素材必须包含 number 和 files")
        episode = number(entry["number"], "sources.number", 1, True)
        files = entry["files"]
        if episode in groups or not isinstance(files, list) or not files:
            raise ValueError(f"第{episode}集重复或 files 不是非空数组")
        paths = []
        for value in files:
            file = input_file(value, "sources.files")
            if not within(file, videos) or file.suffix.lower() not in promo.VIDEO_SUFFIXES:
                raise ValueError(f"剧集素材不是短剧目录内支持的视频：{file}")
            info = file.stat()
            identity = (info.st_dev, info.st_ino) if info.st_ino else file
            if identity in seen or info.st_size <= 0:
                raise ValueError(f"剧集素材重复或为空：{file}")
            seen.add(identity)
            paths.append(file)
        groups[episode] = paths
    return list(groups.items())


def episode_asset(work, episode, fresh=False):
    return task_path(work, str(promo.episode_asset(work, episode)), "正式合成剧集", fresh=fresh)


def source_paths(index, plan=None):
    paths = [e["file"] for e in index["episodes"]]
    paths.extend(part["file"] for e in index["episodes"] for part in e.get("parts", []))
    if index.get("script"):
        paths.append(index["script"])
    if plan:
        paths.extend(a["file"] for a in plan.get("audio", []))
        if plan.get("music_cues", {}).get("analysis_file"):
            paths.append(plan["music_cues"]["analysis_file"])
    return [absolute(value, "素材/分析路径") for value in paths]


def check_dependencies(index, plan, work):
    for source in source_paths(index, plan):
        if within(source, work / "work"):
            raise ValueError("原素材或正式依赖不能存入可被clean删除的work目录")
    for episode in index["episodes"]:
        if episode.get("parts") and Path(episode["file"]) != episode_asset(work, episode["number"]):
            raise ValueError("正式合成剧集路径与任务索引不符")
    if plan:
        for audio in plan.get("audio", []):
            input_file(audio["file"], "音轨file")
        cues = plan.get("music_cues", {})
        if cues.get("analysis_file"):
            task_path(work, str(absolute(cues["analysis_file"], "analysis_file")), "analysis_file")
        for segment in plan.get("segments", []):
            if not isinstance(segment, dict) or segment.get("kind") == "freeze" or segment.get("flash", 0) or segment.get("flash_start", 0):
                raise ValueError("runner只处理正文，不允许旧freeze/flash；片尾必须由插件原生ending桥完成")
        if any(a.get("speed", 1) != 1 for a in plan.get("audio", [])):
            raise ValueError("正文音轨必须原速，不使用变速迎合镜头")


def stage_episodes(index, index_path, work, requested):
    if not isinstance(requested, list):
        raise ValueError("data.episodes 必须为集号数组")
    requested = [number(value, "episodes", 1, True) for value in requested]
    if len(set(requested)) != len(requested):
        raise ValueError("data.episodes 不能包含重复集号")
    indexed = {episode["number"]: episode for episode in index["episodes"]}
    needed = []
    for value in requested:
        if value not in indexed:
            raise ValueError(f"索引中没有第{value}集")
        if indexed[value].get("staged") is False:
            needed.append((indexed[value], episode_asset(work, value, fresh=True)))
    result = {"index": str(index_path), "staged": []}
    if not needed:
        return result

    folder = needed[0][1].parent
    folder.mkdir(parents=True, exist_ok=True)
    ffmpeg, ffprobe = promo.tools()
    scratch = no_links(promo.work_dir(work) / ("stage-" + uuid.uuid4().hex))
    scratch.mkdir()
    try:
        updates, files = {}, []
        for episode, target in needed:
            staging = scratch / target.stem
            staging.mkdir()
            pending = staging / target.name
            updates[episode["number"]] = promo.stage_episode(episode, pending, ffmpeg, ffprobe)
            files.append((pending, target))
        # Source changes during FFmpeg must never be published under the old identity.
        promo.verify_sources(index)
        published = []
        try:
            for pending, target in files:
                os.link(pending, no_links(target))  # Same task filesystem; atomic no-clobber.
                published.append((pending, target))
            write_json(index_path, {**index, "episodes": [updates.get(e["number"], e) for e in index["episodes"]]}, replace=True)
        except BaseException:
            for pending, target in published:
                if no_links(target).is_file() and pending.samefile(target):
                    target.unlink()
            raise
    finally:
        if no_links(scratch).parent == work / "work":
            shutil.rmtree(scratch)
    return {**result, "staged": list(updates)}


def validate(index, plan, work):
    if not isinstance(plan, dict):
        raise ValueError("data.plan 必须为完整方案对象")
    check_dependencies(index, plan, work)
    planned = promo.validate_plan(index, plan)
    timing = promo.encoded_timeline(plan)
    positions = [n for n, s in enumerate(plan["segments"]) if s["kind"] == "montage"]
    if positions:
        frames = timing[positions[-1]]["timeline_end_frame"] - timing[positions[0]]["timeline_start_frame"]
        if not 150 <= frames <= 300:
            raise ValueError("实际帧量化后的快切须为5–10秒")
    for blackout in music.mapped_blackouts(plan):
        if (not positions or blackout["start"] < timing[positions[0]]["timeline_start"] - 1e-9
                or blackout["end"] > timing[positions[-1]]["timeline_end"] + 1e-9):
            raise ValueError("卡点黑屏只能覆盖已选的一组快切，不得落在铺垫或高潮")
        if any(a.get("role") != "bgm" and a["start"] < blackout["end"] - 1e-9
               and a["start"] + a["duration"] > blackout["start"] + 1e-9 for a in plan.get("audio", [])):
            raise ValueError("卡点黑屏区间不能叠加SFX，须保持同步静音")
    return {"duration": timing[-1]["timeline_end"], "planned_duration": planned,
            "frames": timing[-1]["timeline_end_frame"], "fps": 30, "segments": len(timing),
            "encoded_boundaries": timing, "body_only": True, "final_completed": False}


def resume_body(index, plan, work, expected, video, result_path):
    """Read-only recovery: never replace a prior body or silently accept a stale plan."""
    if not video.is_file() or not result_path.is_file():
        raise ValueError("已有正文或结果记录缺失，不覆盖、不自动重编码，请核对独立任务")
    cached = promo.load_json(result_path)
    fingerprint = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    if (not isinstance(cached, dict) or cached.get("plan_sha256") != fingerprint
            or not cached.get("body_only") or cached.get("final_completed") is not False
            or absolute(cached.get("video"), "缓存正文路径") != video
            or cached.get("frames") != expected["frames"] or cached.get("fps") != 30
            or cached.get("duration") != expected["duration"]):
        raise ValueError("已有正文与当前方案指纹或编码边界不匹配，拒绝覆盖或恢复")
    sources = {e["number"]: e for e in index["episodes"]}
    entries = cached.get("encoded_segments")
    if not isinstance(entries, list) or len(entries) != len(plan["segments"]):
        raise ValueError("已有正文缺少完整编码片段清单，拒绝恢复")
    ffmpeg, ffprobe = promo.tools()

    def verify_media(path, frames):
        promo.run([ffmpeg, "-v", "error", "-xerror", "-err_detect", "explode", "-i", path, "-f", "null", "-"])
        info, actual = promo.probe(path, ffprobe), promo.video_frames(path, ffprobe)
        if (not info["has_audio"] or (info["width"], info["height"]) != (1080, 1920)
                or actual["frames"] != frames or abs(actual["duration"] - frames / 30) > 1e-6
                or abs(actual["start"]) > 1e-6 or abs(info["duration"] - frames / 30) > 0.0011):
            raise ValueError("已有正文/正式分段的完整解码、实际帧数、PTS或媒体尺寸不匹配，拒绝恢复")

    normalized = {}
    for number, (entry, segment, timing) in enumerate(zip(entries, plan["segments"], expected["encoded_boundaries"]), 1):
        source = sources[segment["episode"]]
        original = {"episode": segment["episode"], "file": source["file"], "start": segment["start"],
                    "end": segment["end"], "duration": promo.clip_duration(segment)}
        if (not isinstance(entry, dict) or entry.get("source") != original or entry.get("episode") != segment["episode"]
                or entry.get("kind") != segment["kind"] or any(entry.get(key) != timing[key] for key in
                ("segment_index", "frames", "duration", "timeline_start_frame", "timeline_end_frame", "timeline_start", "timeline_end"))):
            raise ValueError("已有正文的原集身份、已验收源范围或累计编码映射不匹配，拒绝恢复")
        mapping = entry.get("source_mapping", {})
        readable = min(original["duration"], timing["duration"])
        if (not isinstance(mapping, dict) or any(mapping.get(key) != value for key, value in original.items())
                or mapping.get("actual_end") != segment["start"] + readable or mapping.get("actual_duration") != readable
                or mapping.get("output_frame_padding") != max(0, timing["duration"] - readable)):
            raise ValueError("已有正文的实际源读取/帧边缘映射不匹配，拒绝恢复")
        file = absolute(entry.get("file"), "编码片段file")
        if entry.get("volume_baked"):
            task_path(work, str(file), "正式编码片段")
            if (not within(file, work / "assets") or entry.get("start") != 0 or entry.get("end") != timing["duration"]
                    or entry.get("volume") != 1 or entry.get("encoded_file") != str(file)):
                raise ValueError("已有正文的正式分段路径/范围/烘焙音量不匹配，拒绝恢复")
            verify_media(file, timing["frames"])
            normalized[str(number)] = str(file)
        elif (file != absolute(source["file"], "原集file") or entry.get("start") != segment["start"]
              or entry.get("end") != segment["start"] + timing["duration"] or entry.get("volume") != segment.get("volume", 1)):
            raise ValueError("已有正文的原集片段或音量不匹配，拒绝恢复")
    if cached.get("normalized", {}) != normalized or cached.get("freezes", {}):
        raise ValueError("已有正文正式素材清单不匹配或包含旧定格，拒绝恢复")
    promo.verify_sources(index)
    verify_media(video, expected["frames"])
    return {**cached, "resumed": True}


def execute(request):
    if not isinstance(request, dict) or request.get("action") not in ACTIONS:
        raise ValueError("action 只允许prepare/stage_episodes/beats/sync/validate/render/clean；禁止旧export")
    action = request["action"]
    data = request.get("data", {})
    if not isinstance(data, dict) or set(data) - ACTIONS[action]:
        raise ValueError(f"{action} 的data参数无效或含不支持的字段")
    work = absolute(request.get("workDir"), "workDir")
    no_links(Path(request["workDir"]))
    if not work.exists() and action != "prepare":
        raise ValueError("任务目录不存在，先prepare")
    if work.exists() and not work.is_dir():
        raise ValueError("workDir不是目录")
    if action == "prepare":
        script = absolute(request.get("scriptPath"), "scriptPath")
        videos = absolute(request.get("dramaDir"), "dramaDir")
        if within(script, work) or within(videos, work) or within(work, videos):
            raise ValueError("任务目录必须独立于原剧本与原剧集素材目录")
        work.mkdir(parents=True, exist_ok=True)
    with task_lock(work), runtime(request), redirect_stdout(sys.stderr):
        index_path = task_path(work, "index.json", "index")
        plan_path = task_path(work, "plan.json", "plan")
        if action == "prepare":
            task_path(work, "index.json", "index", fresh=True)
            sources = supplied_sources(data["sources"], videos) if "sources" in data else None
            media = promo.tools()
            result = promo.prepare(SimpleNamespace(script=str(script), videos=str(videos), out=str(work), sources=sources))
            return {**result, "workDir": str(work), "runtime": {"ffmpeg": media[0], "ffprobe": media[1]}}
        index = promo.load_json(index_path)
        check_dependencies(index, None, work)
        no_links(work / "work")
        no_links(work / "work" / ".duanju-promo-work")
        if action == "clean":
            plan = promo.load_json(plan_path) if plan_path.is_file() else None
            check_dependencies(index, plan, work)
            target = no_links(work / "work")
            marker = target / ".duanju-promo-work"
            if target.resolve().parent != work or not marker.is_file() or marker.is_symlink():
                raise ValueError("拒绝清理没有promo标记的work临时目录")
            # A linked descendant could otherwise hide original assets from validation.
            for path in target.rglob("*"):
                no_links(path)
            shutil.rmtree(target)
            return {"cleaned": str(target), "assets_preserved": True}
        promo.verify_sources(index)
        if action == "stage_episodes":
            return stage_episodes(index, index_path, work, data.get("episodes"))
        if action == "beats":
            audio = input_file(data.get("audio"), "data.audio")
            if within(audio, work / "work"):
                raise ValueError("audio不能放在会被clean删除的work临时目录")
            output = task_path(work, data.get("output") or ("beats-" + uuid.uuid4().hex + ".json"), "beats.output", fresh=True)
            temporary = promo.work_dir(work)
            os.environ["NUMBA_CACHE_DIR"] = str(temporary / "numba-cache")
            os.environ["LIBROSA_CACHE_DIR"] = str(temporary / "librosa-cache")
            analysis = music.analyze_music(audio, promo.tools()[0])
            write_json(output, analysis)
            return {"analysis": str(output), "tempo": analysis["tempo"], "beats": len(analysis["beats"]),
                    "file_sha256": analysis["file_sha256"], "duration": analysis["duration"]}
        if action == "sync":
            plan = data.get("plan")
            if not isinstance(plan, dict):
                raise ValueError("sync需data.plan完整对象")
            check_dependencies(index, plan, work)
            analysis_path = task_path(work, str(absolute(data.get("beats"), "data.beats")), "data.beats")
            analysis = promo.load_json(analysis_path)
            audio_index = number(data.get("audioIndex", 0), "audioIndex", 0, True)
            if not audio_index < len(plan.get("audio", [])):
                raise ValueError("audioIndex越界")
            audio = plan["audio"][audio_index]
            file = input_file(audio["file"], "BGM file")
            if file != absolute(analysis.get("file"), "beats.file") or hashlib.sha256(file.read_bytes()).hexdigest() != analysis.get("file_sha256"):
                raise ValueError("音乐与拍点分析不一致，请重新beats")
            result = music.sync_montage(plan, analysis, audio_index)
            # Sync may be iterated before final validation; no unrelated file is replaceable.
            write_json(plan_path, result, replace=True)
            return {"plan": str(plan_path), "cuts": len(result["beat_sync"]["cuts"]),
                    "major_hits": result["beat_sync"]["major_hits"],
                    "max_error_seconds": result["beat_sync"]["max_error_seconds"]}
        plan = data.get("plan") if action == "validate" and "plan" in data else promo.load_json(plan_path)
        result = validate(index, plan, work)
        if action == "validate":
            return result
        task_path(work, "assets", "assets")
        video = task_path(work, "正文中间片.mp4", "正文中间片")
        result_path = task_path(work, "body-render-result.json", "正文渲染记录")
        fingerprint = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
        body_key = None
        if video.exists() or result_path.exists():
            cached = promo.load_json(result_path) if result_path.is_file() else None
            if not isinstance(cached, dict) or cached.get("plan_sha256") != fingerprint:
                # Execution revisions get separate artifacts, never overwrite an earlier body.
                body_key = fingerprint[:16]
                video = task_path(work, "正文中间片-" + body_key + ".mp4", "正文中间片")
                result_path = task_path(work, "body-render-result-" + body_key + ".json", "正文渲染记录")
        if video.exists() or result_path.exists():
            result = resume_body(index, plan, work, result, video, result_path)
        else:
            result = {**promo.render(index, plan, work, body_only=True, body_key=body_key), "resumed": False}
        return {**result, "result": str(result_path),
                "notice": "仅正文中间片；尚未添加强制原生炫光、照片定格和完整片尾声效，不代表最终完成。"}


def main():
    parser = argparse.ArgumentParser(description="内置短剧正文JSON执行桥（不导出最终片尾或草稿）")
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        result = execute(promo.load_json(args.request))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__, "final_completed": False}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
