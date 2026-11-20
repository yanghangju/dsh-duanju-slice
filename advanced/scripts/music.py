# Bundled from the user-specified NarratoAI duanju-promo Skill.
# Algorithm attribution and upstream links are retained in ../references/plan-schema.md.
import copy
import hashlib
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path


def analyze_music(file, ffmpeg):
    # runner.py sets task-local caches; standalone CLI use falls back to the OS temp dir.
    os.environ.setdefault("NUMBA_CACHE_DIR", str(Path(tempfile.gettempdir()) / "duanju-promo-numba"))
    import librosa
    import numpy as np
    source = Path(file).resolve()
    rate = 22050
    decoded = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", str(rate),
                              "-f", "f32le", "pipe:1"], capture_output=True,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if decoded.returncode:
        raise ValueError("音乐解码失败："+decoded.stderr.decode("utf-8", errors="replace")[-1000:])
    samples = np.frombuffer(decoded.stdout, dtype="<f4")
    hop = 256
    if not len(samples) or float(np.max(np.abs(samples))) < 1e-6:
        raise ValueError("音乐没有可分析的声音，不能生成模拟拍点")
    window = round(rate*0.02)
    envelope = np.sqrt(np.mean(samples[:len(samples)//window*window].reshape(-1,window)**2,axis=1))
    envelope_db = 20*np.log10(np.maximum(envelope,1e-8))
    onset = librosa.onset.onset_strength(y=samples, sr=rate, hop_length=hop)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=rate, hop_length=hop)
    if len(frames) < 4:
        raise ValueError("未检测到足够真实节拍，请换音乐或人工确认")
    rms = librosa.feature.rms(y=samples, hop_length=hop)[0]
    energy = (rms-rms.min()) / (np.ptp(rms)+1e-8)
    median_onset, median_energy = float(np.median(onset[frames])), float(np.median(energy))
    beats = []
    for frame in frames:
        strength = float(onset[frame])
        strong = strength > median_onset*1.2 or float(energy[min(frame, len(energy)-1)]) > median_energy*1.3
        beats.append({"time": float(librosa.frames_to_time(frame, sr=rate, hop_length=hop)),
                      "strength": min(strength/(median_onset+1e-8), 2)/2,
                      "beat_type": "strong" if strong else "normal"})
    onset_times = librosa.onset.onset_detect(onset_envelope=onset, sr=rate, hop_length=hop, units="time")
    peak_frames = librosa.time_to_frames(onset_times,sr=rate,hop_length=hop)
    lookback = max(1,round(0.25*rate/hop))
    running = np.concatenate(([0.0],np.cumsum(energy)))
    baseline = np.array([(running[n]-running[max(0,n-lookback)])/max(1,min(n,lookback)) for n in range(len(energy))])
    rise = np.maximum(energy-baseline,0)
    strengths = np.array([0.75*float(onset[f])/(np.percentile(onset[peak_frames],95)+1e-8)
                         +0.25*float(rise[min(f,len(rise)-1)])/(np.percentile(rise,95)+1e-8) for f in peak_frames])
    majors = []
    for n in np.argsort(strengths)[::-1]:
        if strengths[n] < np.percentile(strengths,90):
            break
        if all(abs(float(onset_times[n])-m["time"])>=1.2 for m in majors):
            majors.append({"time":float(onset_times[n]),"level":"major","strength":float(strengths[n]),"kind":"accent"})
    events = [{"time":b["time"],"level":"minor","strength":b["strength"],"kind":"beat"} for b in beats]
    events += [{"time":float(t),"level":"minor","strength":float(s),"kind":"onset"} for t,s in zip(onset_times,strengths)]
    events += majors
    events.sort(key=lambda e:e["time"])
    sections = []
    duration = len(samples)/rate
    for start in range(0, int(duration), 8):
        end = min(start+8, duration)
        local = energy[int(start*rate/hop):int(end*rate/hop)]
        sections.append({"start":start,"end":end,"onsets_per_second":float(np.sum((onset_times>=start)&(onset_times<end))/(end-start)),
                         "energy":float(np.mean(local)) if len(local) else 0})
    return {"file": str(source), "file_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "method": "librosa-beat-track", "librosa_version": librosa.__version__, "fallback": False,
            "duration": len(samples)/rate, "tempo": float(np.asarray(tempo).reshape(-1)[0]),
            "sample_rate": rate, "hop_length": hop, "beats": beats, "rhythm_sections":sections,"events":events,
            "energy_envelope":{"step":window/rate,"db":[round(float(db),2) for db in envelope_db]},
            "accent_method":"top-decile onset and energy-rise, 1.2s separation; musical accents are estimates"}


def mapped_blackouts(plan):
    cues = plan.get("music_cues",{})
    if not cues.get("blackouts"):
        return []
    audio = plan["audio"][cues["audio_index"]]
    offset = audio.get("source_start",0)-audio["start"]
    return [{**cue,"start":round((cue["source_start"]-offset)*30)/30,
             "end":round((cue["source_end"]-offset)*30)/30} for cue in cues["blackouts"]]


def validate_cues(plan):
    cues = plan.get("music_cues")
    if not cues:
        return
    audio = plan["audio"][cues["audio_index"]]
    analysis = json.loads(Path(cues["analysis_file"]).read_text(encoding="utf-8-sig"))
    if audio.get("role") != "bgm" or audio.get("speed",1) != 1 or Path(audio["file"]).resolve() != Path(analysis["file"]).resolve() or hashlib.sha256(Path(audio["file"]).read_bytes()).hexdigest() != analysis["file_sha256"]:
        raise ValueError("音乐变化证据与原速BGM不一致")
    offset = audio.get("source_start",0)-audio["start"]
    at, spoken, boundaries = 0, [], [0]
    for segment in plan["segments"]:
        end = at+(segment["duration"] if segment["kind"]=="freeze" else segment["end"]-segment["start"])
        if segment.get("volume",1)>0 and segment["kind"] in {"dialogue","continuation"}:
            spoken.append((at,end))
        at = end
        boundaries.append(end)
    boundaries = [round(t*30)/30 for t in boundaries]
    fast = cues.get("fast_section")
    if fast:
        start,end = fast.get("source_start"),fast.get("source_end")
        positions = [n for n,s in enumerate(plan["segments"]) if s["kind"]=="montage"]
        if not fast.get("reviewed") or not fast.get("evidence") or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (start,end)) or not 0<=start<end<=analysis["duration"]:
            raise ValueError("快切区间需要已核实的源范围与节奏变化证据")
        if not 5-1e-6 <= end-start <= 10+1e-6:
            raise ValueError("快切区间时长须为5–10秒，按实际快段选取")
        if not positions or positions!=list(range(positions[0],positions[-1]+1)) or not audio["start"]<=start-offset<end-offset<=audio["start"]+audio["duration"] or max(abs(boundaries[positions[0]]-(start-offset)),abs(boundaries[positions[-1]+1]-(end-offset)))>1/60+1e-6:
            raise ValueError("快切须覆盖已确认的选定快切区间，起止按同一音乐映射对齐；画面不足须补充镜头")
    hit = cues.get("final_hit")
    if hit:
        source_time = hit.get("source_time")
        if not hit.get("reviewed") or not hit.get("evidence") or not isinstance(source_time,(int,float)) or not math.isfinite(source_time):
            raise ValueError("最后重击缺少真实起音证据")
        target = source_time-offset
        if not audio["start"]<=target<=min(at,audio["start"]+audio["duration"]) or target+1e-6<max((end for _,end in spoken),default=0):
            raise ValueError("最后重击必须在最后完整原声结束后")
    envelope = analysis.get("energy_envelope",{})
    db, step = envelope.get("db",[]), envelope.get("step",0)
    previous_end = -1
    for blackout in mapped_blackouts(plan):
        start,end = blackout["start"],blackout["end"]
        source_start,source_end = blackout["source_start"],blackout["source_end"]
        if not blackout.get("reviewed") or not blackout.get("evidence") or not all(math.isfinite(t) for t in (start,end,source_start,source_end)) or not 0<=start<end<at or start<previous_end or not audio["start"]<=source_start-offset<source_end-offset<=audio["start"]+audio["duration"]:
            raise ValueError("黑场范围、顺序或音乐落差证据无效")
        previous_end = end
        if any(start<b-1e-6 and end>a+1e-6 for a,b in spoken):
            raise ValueError("黑场不能覆盖完整原声片段")
        if not step or not db or not 0<source_start<source_end<len(db)*step:
            raise ValueError("黑场缺少实际音乐能量落差数据")
        before = db[max(0,round((source_start-0.4)/step)):round(source_start/step)]
        inside = db[round(source_start/step):round(source_end/step)]
        after = db[round(source_end/step):min(len(db),round((source_end+0.12)/step))]
        if not before or not inside or not after or min(max(before),max(after))-min(inside)<6:
            raise ValueError("黑场需要至少6dB的实际相对能量落差和恢复，不能当成绝对静音")


def arrange_group(group, start, end, events):
    first, last = round(start*30), round(end*30)
    mapped = {}
    for event in events:
        frame = round(event["time"]*30)
        previous = mapped.get(frame)
        rank = (event["level"]=="major",event.get("strength",0))
        if first<frame<=last and (previous is None or rank>(previous["level"]=="major",previous.get("strength",0))):
            mapped[frame] = event
    weights = [s.get("rhythm_weight",s["end"]-s["start"]) for s in group]
    states = {first:((0,0,0.0,0.0),[])}
    for n,segment in enumerate(group):
        minimum = max(1,math.ceil(segment.get("min_duration",0.2)*30-1e-6))
        maximum = math.floor((segment.get("available_end",segment["end"])-segment["start"])*30+1e-6)
        ideal = (last-first)*weights[n]/sum(weights)
        following = {}
        for previous,(score,path) in states.items():
            lower,upper = previous+minimum,min(last,previous+maximum)
            for frame in ([last] if n==len(group)-1 else range(lower,upper+1)):
                if not lower<=frame<=upper:
                    continue
                event = mapped.get(frame)
                trial = (score[0]+int(event is not None and event["level"]=="major"),
                         score[1]+int(event is not None),score[2]+(event.get("strength",0) if event else 0),
                         score[3]-(frame-previous-ideal)**2)
                if frame not in following or trial>following[frame][0]:
                    following[frame] = (trial,path+[frame])
        states = following
    if last not in states:
        raise ValueError("画面容量不足以覆盖音乐，需更换镜头或调整音乐选段")
    return [f/30 for f in states[last][1]]


def sync_montage(plan, analysis, audio_index=0):
    result = copy.deepcopy(plan)
    segments = result["segments"]
    positions = [n for n, segment in enumerate(segments) if segment["kind"] == "montage"]
    if not positions or positions != list(range(positions[0], positions[-1]+1)):
        raise ValueError("本次卡点只允许一组连续静音快切，请合并快切镜头")
    if analysis.get("method") != "librosa-beat-track" or analysis.get("fallback"):
        raise ValueError("卡点必须使用真实音乐检测结果")
    beats = analysis["beats"]
    if len(beats) < 4 or any(b["time"] <= a["time"] for a, b in zip(beats, beats[1:])):
        raise ValueError("真实拍点不足或顺序无效")
    first, last = positions[0], positions[-1]
    length = lambda s: s["duration"] if s["kind"] == "freeze" else s["end"]-s["start"]
    block_start = sum(length(s) for s in segments[:first])
    block_end = sum(length(s) for s in segments[:last+1])
    audio = result["audio"][audio_index]
    hierarchical = bool(analysis.get("events"))
    source_events = analysis.get("events") or [{"time":b["time"],"level":"major" if b["beat_type"]=="strong" else "minor",
                                               "strength":b["strength"],"kind":"beat"} for b in beats]
    mapped_events = [{**event,"source_time":event["time"],"time":event["time"]-audio.get("source_start",0)+audio["start"]} for event in source_events]
    if block_start+1e-6 < audio["start"]:
        raise ValueError("音乐开始晚于快切，无法卡点")
    if audio.get("speed",1) != 1:
        raise ValueError("先选合适的原速音乐，不通过变速迎合镜头")
    source_at_start = block_start-audio["start"]+audio.get("source_start", 0)
    cues = result.get("music_cues",{})
    fast = cues.get("fast_section")
    if not 5-1e-6 <= segments[last].get("music_end",source_at_start)-source_at_start <= 10+1e-6:
        raise ValueError("快切区间时长须为5–10秒，请按实际快段选取")
    if fast and (cues.get("audio_index")!=audio_index or abs(source_at_start-fast["source_start"])>1/60+1e-6 or abs(segments[last].get("music_end",-1)-fast["source_end"])>1e-6):
        raise ValueError("快切起止必须对齐选定快切区间；调整前序画面或音乐入场后重新同步")
    frame_start = round(block_start*30)/30
    cuts, at, group_start = [], frame_start, first
    first_beat = min(source_events,key=lambda b:abs(b["time"]-source_at_start))
    if abs(first_beat["time"]-source_at_start) <= 1/60:
        first_matches=[e for e in source_events if abs(e["time"]-source_at_start)<=1/60]
        first_beat=max(first_matches,key=lambda e:(e["level"]=="major",e.get("strength",0)))
        cuts.append({"segment_index":first,"source_beat":first_beat["time"],"time":at,"level":first_beat["level"]})
    if "music_end" not in segments[last]:
        raise ValueError("先选定音乐乐句终点，在最后快切填写 music_end")
    for position in positions:
        if "music_end" not in segments[position]:
            continue
        source_time = segments[position]["music_end"]
        beat = min(source_events,key=lambda b:abs(b["time"]-source_time))
        if abs(beat["time"]-source_time) > 1e-6:
            raise ValueError("关键落点必须来自已检测的音乐拍点")
        beat=max((e for e in source_events if abs(e["time"]-source_time)<=1e-6),key=lambda e:(e["level"]=="major",e.get("strength",0)))
        target = source_time-audio.get("source_start",0)+audio["start"]
        group_end = round(target*30)/30
        if group_end <= at:
            raise ValueError("音乐关键落点须递增，不能倒放或移动音乐补救")
        group = segments[group_start:position+1]
        weights = [s.get("rhythm_weight",length(s)) for s in group]
        if any(not isinstance(w,(int,float)) or not math.isfinite(w) or w<=0 for w in weights):
            raise ValueError("镜头节奏权重必须是正数")
        total_weight, cumulative, previous = sum(weights), 0, at
        try:
            fitted = arrange_group(group,at,group_end,mapped_events) if hierarchical else None
        except ValueError:
            if fast:
                raise ValueError("选定快切区间画面容量不足，须补充不同镜头或重新选定5–10秒的区间") from None
            raise
        for number, (segment, weight) in enumerate(zip(group,weights),group_start):
            cumulative += weight
            end = fitted[number-group_start] if fitted else round((at+(group_end-at)*cumulative/total_weight)*30)/30
            seconds = end-previous
            available = segment.get("available_end",segment["end"])-segment["start"]
            if seconds<=0 or seconds>available+1e-6:
                raise ValueError(f"第 {number+1} 段画面不够覆盖选定音乐，请换镜头或调整镜头权重")
            segment.update(end=round(segment["start"]+seconds,9),volume=0)
            segment.pop("beat_count",None)
            if hierarchical and number<position:
                matches=[e for e in mapped_events if round(e["time"]*30)==round(end*30)]
                if matches:
                    event=max(matches,key=lambda e:(e["level"]=="major",e.get("strength",0)))
                    cuts.append({"segment_index":number+1,"source_beat":event["source_time"],"time":end,"level":event["level"]})
            previous = end
        at = group_end
        group_start = position+1
        cuts.append({"segment_index":position+1,"source_beat":source_time,"time":at,"level":beat["level"]})
    if not 5-1e-6 <= at-frame_start <= 10+1e-6:
        raise ValueError("量化后的快切区间时长须为5–10秒")
    delta = at-frame_start-(block_end-block_start)
    for number, item in enumerate(result["audio"]):
        same_music = number != audio_index and Path(item["file"]).resolve() == Path(audio["file"]).resolve()
        if number != audio_index and item["start"]+1e-6 >= block_end:
            item["start"] = round(item["start"]+delta, 9)
            if same_music:
                item["source_start"] = item.get("source_start",0)+delta
        elif item["start"]+item["duration"]+1e-6 >= block_end:
            item["duration"] = round(item["duration"]+delta, 9)
    errors = [abs(c["time"]-(c["source_beat"]-audio.get("source_start",0)+audio["start"])) for c in cuts]
    result["beat_sync"] = {"mode":"hierarchical" if hierarchical else "music-first","analysis": analysis, "audio_index": audio_index, "fps": 30,
                           "music_mapping":{"file":audio["file"],"source_offset":audio.get("source_start",0)-audio["start"],"speed":1},
                           "cuts": cuts,"major_hits":sum(c["level"]=="major" for c in cuts),
                           "free_cut_count":len(positions)+1-len(cuts), "max_error_seconds": max(errors)}
    return result


def validate_sync(plan):
    sync = plan.get("beat_sync")
    if not sync:
        return
    analysis = sync["analysis"]
    audio = plan["audio"][sync["audio_index"]]
    if analysis.get("method") != "librosa-beat-track" or analysis.get("fallback"):
        raise ValueError("不是实际检测的音乐拍点")
    if Path(audio["file"]).resolve() != Path(analysis["file"]).resolve() or hashlib.sha256(Path(audio["file"]).read_bytes()).hexdigest() != analysis["file_sha256"]:
        raise ValueError("音乐与拍点分析不一致，请重新检测")
    stages = sorted((a for a in plan["audio"] if Path(a["file"]).resolve() == Path(audio["file"]).resolve()), key=lambda a:a["start"])
    for a, b in zip(stages, stages[1:]):
        if abs(a["start"]+a["duration"]-b["start"]) <= 1e-6 and abs(a.get("source_start",0)+a["duration"]-b.get("source_start",0)) > 1e-6:
            raise ValueError("相邻配乐段的源时间不连续，会造成跳拍")
    boundaries = [0.0]
    for segment in plan["segments"]:
        seconds = segment["duration"] if segment["kind"] == "freeze" else segment["end"]-segment["start"]
        boundaries.append(boundaries[-1]+seconds)
    boundaries = [round(t*30)/30 for t in boundaries]
    times = [b["time"] for b in analysis["beats"]]+[e["time"] for e in analysis.get("events",[])]
    positions = [n for n, segment in enumerate(plan["segments"]) if segment["kind"] == "montage"]
    if not positions:
        raise ValueError("缺少快切画面")
    recorded = {c["segment_index"] for c in sync["cuts"]}
    if sync.get("mode") in {"music-first","hierarchical"}:
        mapping = sync["music_mapping"]
        if Path(mapping["file"]).resolve() != Path(audio["file"]).resolve() or abs(mapping["source_offset"]-(audio.get("source_start",0)-audio["start"]))>1e-6 or audio.get("speed",1) != 1:
            raise ValueError("音乐起点变化后需要重新计算卡点，音乐保持原速")
        required = {n+1 for n in positions if "music_end" in plan["segments"][n]}
        if positions[-1]+1 not in required or not required<=recorded or not recorded<={*positions,positions[-1]+1}:
            raise ValueError("关键音乐落点记录不完整")
        for n in positions:
            if "music_end" in plan["segments"][n] and not any(c["segment_index"]==n+1 and abs(c["source_beat"]-plan["segments"][n]["music_end"])<=1e-6 for c in sync["cuts"]):
                raise ValueError("关键落点与音乐编排标记不一致")
    elif recorded != {*positions, positions[-1]+1}:
        raise ValueError("卡点记录未覆盖全部快切边界")
    for cut in sync["cuts"]:
        actual = boundaries[cut["segment_index"]]
        expected = cut["source_beat"]-audio.get("source_start", 0)+audio["start"]
        if not math.isfinite(expected) or not audio["start"]-1/60-1e-6 <= actual <= audio["start"]+audio["duration"]+1/60+1e-6 or not audio["start"]-1e-6 <= expected <= audio["start"]+audio["duration"]+1e-6 or min(abs(t-cut["source_beat"]) for t in times) > 1e-6 or abs(actual-expected) > 1/60+1e-6:
            raise ValueError("快切边界未按绝对拍点对齐到视频帧")
