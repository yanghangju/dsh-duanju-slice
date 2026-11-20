"""BGM 节拍分析与快切卡点编排。

移植自 dsh-duanju-promo 高级模式的 advanced/scripts/music.py：分析算法、事件分级、
快切的动态规划落点都保持不变，只把「一次调用做一件事」的 CLI 换成 JSON 请求/响应，
方便切片插件按需调用。

用法：
    python -B -X utf8 beats.py <request.json>

request.json:
    {"action": "analyze", "file": "…/bgm.mp3", "ffmpeg": "…/ffmpeg.exe"}
    {"action": "arrange", "analysis": {...}, "total": 6.4, "min_duration": 0.2,
     "shots": [{"available": 1.8}, ...]}

输出：stdout 最后一行 JSON。出错时输出 {"error": "..."} 并以 1 退出。
"""
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

FPS = 30
SAMPLE_RATE = 22050
HOP_LENGTH = 256
MAJOR_SEPARATION = 1.2


def fail(message):
    print(json.dumps({"error": message}, ensure_ascii=False))
    sys.exit(1)


def decode(file, ffmpeg):
    import numpy as np

    resolved = (ffmpeg if os.path.isfile(ffmpeg) else shutil.which(ffmpeg)) if ffmpeg else None
    if not resolved:
        fail("找不到 ffmpeg：%s" % ffmpeg)
    if not os.path.isfile(file):
        fail("找不到音乐文件：%s" % file)
    creation = 0x08000000 if os.name == "nt" else 0
    base = [resolved, "-v", "error"]
    tail = ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"]
    proc = subprocess.run(base + ["-i", file] + tail, capture_output=True, creationflags=creation)
    if proc.returncode != 0:
        # 个别自带的 ffmpeg 对裸 WAV 的探测会失败，显式指定 demuxer 再试一次。
        guess = {".wav": "wav", ".mp3": "mp3", ".flac": "flac", ".ogg": "ogg", ".m4a": "mp4"}.get(os.path.splitext(file)[1].lower())
        if guess:
            proc = subprocess.run(base + ["-f", guess, "-i", file] + tail, capture_output=True, creationflags=creation)
    if proc.returncode != 0:
        fail("无法解码音乐：%s" % proc.stderr.decode("utf-8", "replace").strip()[-800:])
    return np.frombuffer(proc.stdout, dtype="<f4")


def analyze_music(file, ffmpeg):
    import numpy as np
    import librosa

    os.environ.setdefault("NUMBA_CACHE_DIR", os.path.join(tempfile.gettempdir(), "duanju-numba-cache"))
    y = decode(file, ffmpeg)
    if len(y) < SAMPLE_RATE:
        fail("音乐太短，无法分析节拍")
    duration = float(len(y)) / SAMPLE_RATE

    # 20ms 短时能量（dB）：用来给「强拍」和黑场点判断能量落差。
    frame_length = int(0.02 * SAMPLE_RATE)
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=HOP_LENGTH)[0]
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-6))

    onset = librosa.onset.onset_strength(y=y, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    if len(beat_frames) < 4:
        fail("未检测到足够真实节拍，请换音乐或人工确认")
    beat_times = librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)

    def at(values, frame):
        index = int(min(max(frame, 0), len(values) - 1))
        return float(values[index])

    median_onset = float(np.median(onset)) or 1e-6
    beat_energy = [at(rms_db, frame) for frame in beat_frames]
    median_energy = float(np.median(beat_energy)) or 1e-6

    beats = []
    for time, frame, energy in zip(beat_times, beat_frames, beat_energy):
        value = at(onset, frame)
        strong = value > median_onset * 1.2 or energy > median_energy * 1.3
        beats.append({
            "time": round(float(time), 6),
            "strength": round(min(value / median_onset, 2.0) / 2.0, 4),
            "beat_type": "strong" if strong else "weak",
        })

    # 起音（onset）事件与强度：0.75 × 起音强度 + 0.25 × 能量上升。
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset, sr=SAMPLE_RATE, hop_length=HOP_LENGTH, units="frames"
    )
    lookback = int(round(0.25 * SAMPLE_RATE / HOP_LENGTH))
    rises = []
    for frame in onset_frames:
        before = at(onset, frame - lookback) if frame - lookback >= 0 else 0.0
        rises.append(max(0.0, at(onset, frame) - before))
    onset_strengths = [at(onset, frame) for frame in onset_frames]

    def percentile(values, q):
        if not values:
            return 1e-6
        return float(np.percentile(values, q)) or 1e-6

    top_onset = percentile(onset_strengths, 95)
    top_rise = percentile(rises, 95)
    strengths = [0.75 * s / top_onset + 0.25 * r / top_rise for s, r in zip(onset_strengths, rises)]

    majors = []
    for frame, strength in sorted(zip(onset_frames, strengths), key=lambda item: -item[1]):
        if strength <= 0:
            continue
        time = float(librosa.frames_to_time([frame], sr=SAMPLE_RATE, hop_length=HOP_LENGTH)[0])
        if all(abs(time - other) >= MAJOR_SEPARATION for other in majors):
            majors.append(time)
            if len(majors) >= 24:
                break
    major_times = sorted(round(time, 6) for time in majors)
    major_strength = dict(zip(major_times, [0.0] * len(major_times)))
    for frame, strength in zip(onset_frames, strengths):
        time = round(float(librosa.frames_to_time([frame], sr=SAMPLE_RATE, hop_length=HOP_LENGTH)[0]), 6)
        if time in major_strength and strength > major_strength[time]:
            major_strength[time] = round(float(strength), 4)

    events = []
    for beat in beats:
        events.append({"time": beat["time"], "level": "minor", "kind": "beat", "strength": beat["strength"]})
    for frame, strength in zip(onset_frames, strengths):
        time = round(float(librosa.frames_to_time([frame], sr=SAMPLE_RATE, hop_length=HOP_LENGTH)[0]), 6)
        if time in major_strength:
            continue
        events.append({"time": time, "level": "minor", "kind": "onset", "strength": round(float(strength), 4)})
    for time in major_times:
        events.append({"time": time, "level": "major", "kind": "accent", "strength": major_strength[time]})
    events.sort(key=lambda item: item["time"])

    onset_times = [float(t) for t in librosa.frames_to_time(onset_frames, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)]
    sections = []
    step = 8.0
    start = 0.0
    while start < duration:
        end = min(duration, start + step)
        count = sum(1 for time in onset_times if start <= time < end)
        span = max(end - start, 1e-6)
        mask = (np.arange(len(rms_db)) * HOP_LENGTH / SAMPLE_RATE >= start) & (
            np.arange(len(rms_db)) * HOP_LENGTH / SAMPLE_RATE < end
        )
        energy = float(np.mean(rms_db[mask])) if mask.any() else float(np.mean(rms_db[-1:]))
        sections.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "onsets_per_second": round(count / span, 4),
            "energy": round(energy, 3),
        })
        start = end

    step = 0.02
    envelope = []
    for start in np.arange(0.0, duration, step):
        index = int(round(start * SAMPLE_RATE / HOP_LENGTH))
        envelope.append(round(at(rms_db, index), 2))

    sha = hashlib.sha256()
    with open(file, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)

    return {
        "file": file,
        "file_sha256": sha.hexdigest(),
        "method": "librosa-beat-track",
        "fallback": False,
        "librosa_version": librosa.__version__,
        "duration": round(duration, 6),
        "tempo": round(float(np.atleast_1d(tempo)[0]), 4),
        "sample_rate": SAMPLE_RATE,
        "hop_length": HOP_LENGTH,
        "beats": beats,
        "rhythm_sections": sections,
        "events": events,
        "energy_envelope": {"step": step, "db": envelope},
        "accent_method": "起音强度前 10%（0.75 × 起音 + 0.25 × 能量上升），间隔 ≥1.2 秒",
        "majors": major_times,
    }


def mapped_events(analysis, total):
    """把事件对齐到 30fps 帧号；同一帧只保留最强的一条（major 优先）。"""
    best = {}
    for event in analysis.get("events") or []:
        time = float(event["time"])
        frame = int(round(time * FPS))
        if frame < 0 or frame > total:
            continue
        key = (1 if event["level"] == "major" else 0, float(event.get("strength") or 0))
        if frame not in best or key > best[frame][0]:
            best[frame] = (key, dict(event))
    return best


def arrange(analysis, shots, total, min_duration=0.2):
    """把一组快切镜头的落点排到真实拍点上（动态规划，和高级模式同一个评分）。"""
    last = int(round(total * FPS))
    if last <= 0:
        fail("快切区间无效")
    if not shots:
        fail("没有可用于快切的镜头")
    events = mapped_events(analysis, last)
    minimum = max(1, int(math.ceil(min_duration * FPS)))
    states = {0: ((0, 0, 0.0, 0.0), [0])}
    for index, shot in enumerate(shots):
        available = float(shot.get("available") or 0.0)
        weight = float(shot.get("weight") or available or 1.0)
        if available <= 0:
            fail("第 %d 个快切镜头没有可用素材" % (index + 1))
        maximum = int(math.floor(available * FPS))
        if maximum < minimum:
            fail("第 %d 个快切镜头可用素材不足 %.2fs" % (index + 1, min_duration))
        mid = float(shot.get("ideal") or 0.0)
        next_states = {}
        final = index == len(shots) - 1
        for frame, (score, path) in states.items():
            low = frame + minimum
            high = min(last if final else last - minimum * (len(shots) - index - 1), frame + maximum)
            if low > high:
                continue
            for end in range(low, high + 1):
                seconds = (end - frame) / FPS
                major = 1 if (end in events and events[end][0][0]) else 0
                hit = 1 if end in events else 0
                strength = events[end][0][1] if end in events else 0.0
                target = mid if mid > 0 else weight
                penalty = (seconds - target) ** 2
                if final and end != last:
                    continue
                total_score = (
                    score[0] + major,
                    score[1] + hit,
                    score[2] + strength,
                    score[3] - penalty,
                )
                previous = next_states.get(end)
                if previous is None or total_score > previous[0]:
                    next_states[end] = (total_score, path + [end])
        if not next_states:
            fail("画面容量不足以覆盖音乐，需更换镜头或调整音乐选段")
        states = next_states
    if last not in states:
        fail("画面容量不足以覆盖音乐，需更换镜头或调整音乐选段")

    score, path = states[last]
    cuts = []
    major_hits = 0
    for index in range(1, len(path)):
        end = path[index]
        event = events.get(end)
        if event and event[0][0]:
            major_hits += 1
        cuts.append({
            "index": index - 1,
            "start": round(path[index - 1] / FPS, 6),
            "end": round(end / FPS, 6),
            "duration": round((end - path[index - 1]) / FPS, 6),
            "beat": {"time": event[1]["time"], "level": event[1]["level"]} if event else None,
        })
    return {
        "cuts": cuts,
        "total": round(last / FPS, 6),
        "major_hits": major_hits,
        "score": [round(float(value), 4) for value in score],
        "fps": FPS,
        "max_error_seconds": round(1.0 / FPS, 6),
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        fail("缺少请求文件")
    with open(sys.argv[1], "r", encoding="utf-8-sig") as handle:
        request = json.load(handle)
    action = request.get("action")
    if action == "analyze":
        result = analyze_music(request["file"], request.get("ffmpeg"))
    elif action == "arrange":
        result = arrange(
            request["analysis"],
            request.get("shots") or [],
            float(request["total"]),
            float(request.get("min_duration") or 0.2),
        )
    else:
        fail("未知动作：%s" % action)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except BaseException as error:  # 任何意外都要给出可读的一行 JSON
        fail("%s: %s" % (type(error).__name__, error))
