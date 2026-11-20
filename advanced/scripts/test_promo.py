# Original NarratoAI duanju-promo regression tests, bundled with their implementation.
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile


class PromoTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.find_spec("promo")
        self.assertIsNotNone(spec, "宣传片 Skill 的执行器尚未实现")
        import promo
        self.promo = promo
        media = Path(__file__).resolve().parents[2] / "runtime" / "ffmpeg"
        environment = patch.dict("os.environ", {"FFMPEG_PATH": str(media / "ffmpeg.exe"), "FFPROBE_PATH": str(media / "ffprobe.exe")})
        environment.start()
        self.addCleanup(environment.stop)

    def test_bilingual_script_retains_source_line_and_action(self):
        paragraphs = ["测试短剧", "第一集", "1-1 门口 日 外", "▲他转身。", "马修：别走。", "MATTHEW: Don't go."]
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        xml += "".join(f"<w:p><w:r><w:t>{escape(p)}</w:t></w:r></w:p>" for p in paragraphs)
        xml += "</w:body></w:document>"
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source.docx"
            with ZipFile(path, "w") as archive:
                archive.writestr("word/document.xml", xml)
            result = self.promo.parse_script(path)
        line = result["episodes"][0]["lines"][0]
        self.assertEqual((1, "马修", "别走。", ["Don't go."]), (line["episode"], line["speaker"], line["zh"], line["en"]))
        self.assertEqual("他转身。", line["context"])

    def test_budget_shrinks_windows_without_thinning_five_fps(self):
        windows = list(self.promo.windows(0, 10, fps=5, max_frames=8, overlap=1))
        self.assertEqual(0, windows[0][0])
        self.assertEqual(10, windows[-1][1])
        for start, end in windows:
            self.assertLessEqual((end - start) * 5, 7.0001)
        for previous, following in zip(windows, windows[1:]):
            self.assertLess(following[0], previous[1])

    def test_chinese_and_english_episode_filenames(self):
        self.assertEqual(2, self.promo.episode_number("ep002   (英文字幕版）.mp4"))
        self.assertEqual(12, self.promo.episode_number("第十二集.mp4"))
        self.assertIsNone(self.promo.episode_number("宣传片.mp4"))

    def _plan(self):
        index = {"episodes": [{"number": 1, "duration": 10, "file": "source.mp4", "has_audio": True}]}
        plan = {"segments": [{"episode": 1, "start": 1, "end": 4, "kind": "dialogue", "quote_zh": "别走。", "alignment": {
            "method": "video-frames", "reviewed": True, "complete": True,
            "dialogueEnd": 3.5, "ending": "shot-cut", "postDialogueCut": 4,
            "confidence": 0.9, "evidence": "字幕完整，4 秒开始新镜头。"
        }}]}
        return index, plan

    def test_rejects_cut_beyond_source_duration(self):
        index, plan = self._plan()
        plan["segments"][0]["end"] = 11
        with self.assertRaisesRegex(ValueError, "越界"):
            self.promo.validate_plan(index, plan)

    def test_rejects_unfinished_visual_alignment(self):
        index, plan = self._plan()
        plan["segments"][0]["alignment"]["complete"] = False
        with self.assertRaisesRegex(ValueError, "完整"):
            self.promo.validate_plan(index, plan)

    def test_rejects_tail_past_confirmed_shot_cut(self):
        index, plan = self._plan()
        plan["segments"][0]["alignment"]["postDialogueCut"] = 3.8
        with self.assertRaisesRegex(ValueError, "切镜"):
            self.promo.validate_plan(index, plan)

    def test_accepts_verified_dialogue(self):
        index, plan = self._plan()
        result = self.promo.validate_plan(index, plan)
        self.assertAlmostEqual(3, result)

    def test_freeze_must_be_last_picture(self):
        index, plan = self._plan()
        plan["segments"] += [{"episode": 1, "start": 4, "duration": 2, "kind": "freeze"},
                             {"episode": 1, "start": 5, "end": 9, "kind": "continuation"}]
        with self.assertRaisesRegex(ValueError, "定格"):
            self.promo.validate_plan(index, plan)

    def test_bgm_gain_defaults_to_legacy_minus_three_db(self):
        self.assertAlmostEqual(10**(-3/20),self.promo.audio_gain({"role":"bgm"}))
        self.assertAlmostEqual(10**(-3/20),self.promo.audio_gain({"role":"bgm","volume_db":-3}))
        self.assertAlmostEqual(10**(-3/20),self.promo.audio_gain({"role":"bgm","volume_db":None}))
        self.assertEqual(0.35,self.promo.audio_gain({"role":"sfx","volume":0.35}))
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume_db":-6})
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume":0.14})
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume_db":None,"volume":0.14})

    def test_bgm_gain_follows_task_scale_and_supports_mute(self):
        import math
        suspense = 20 * math.log10(0.336)
        louder = 20 * math.log10(0.98)
        self.assertAlmostEqual(0.336,self.promo.audio_gain({"role":"bgm","volume_db":suspense},suspense))
        self.assertAlmostEqual(0.98,self.promo.audio_gain({"role":"bgm","volume_db":louder,"volume":0.98},louder))
        self.assertAlmostEqual(10**(-3/20),self.promo.audio_gain({"role":"bgm","volume_db":-3},-3))
        self.assertEqual(0,self.promo.audio_gain({"role":"bgm","volume":0,"volume_db":None},None))
        self.assertEqual(0,self.promo.audio_gain({"role":"bgm"},None))
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume_db":-3},suspense)
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume_db":-3},None)
        with self.assertRaises(ValueError):
            self.promo.audio_gain({"role":"bgm","volume_db":float("nan")},-3)

    def test_plan_uses_music_policy_bgm_db_not_fixed_minus_three(self):
        import hashlib
        import math
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "music.wav"
            audio.write_bytes(b"music")
            index, plan = self._plan()
            db = 20 * math.log10(0.336)
            plan["audio"] = [{"role":"bgm","file":str(audio),"start":0,"source_start":0,"duration":2,
                              "volume_db":db,"volume":0.336}]
            plan["music_policy"] = {"single_song":True,
                "song_sha256":hashlib.sha256(b"music").hexdigest(),"bgm_db":db}
            with patch.object(self.promo,"tools",return_value=("ffmpeg","ffprobe")), \
                 patch.object(self.promo,"probe",return_value={"has_audio":True,"duration":10}):
                self.assertEqual(3,self.promo.validate_plan(index,plan))
                plan["music_policy"]["bgm_db"] = -3
                with self.assertRaisesRegex(ValueError,"本任务"):
                    self.promo.validate_plan(index,plan)
                plan["music_policy"]["bgm_db"] = None
                plan["audio"][0].update(volume=0,volume_db=None)
                self.assertEqual(3,self.promo.validate_plan(index,plan))
                plan["audio"][0]["volume"] = 0.336
                with self.assertRaisesRegex(ValueError,"不一致"):
                    self.promo.validate_plan(index,plan)

    def test_music_drop_blackout_and_final_hit_protect_complete_dialogue(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "music.wav"
            audio.write_bytes(b"music")
            analysis = Path(folder) / "beats.json"
            db = [-3.0] * 250
            db[161:171] = [-13.0] * 10
            analysis.write_text(json.dumps({"file":str(audio), "file_sha256":hashlib.sha256(b"music").hexdigest(),
                "energy_envelope":{"step":0.02,"db":db}}),encoding="utf-8")
            index, plan = self._plan()
            plan["segments"].append({"episode":1,"start":4,"duration":2,"kind":"freeze","volume":0})
            plan["audio"] = [{"role":"bgm","file":str(audio),"start":0,"source_start":0,"duration":5,"volume_db":-3}]
            plan["music_policy"] = {"preserve_audio":True}
            plan["music_cues"] = {"audio_index":0,"analysis_file":str(analysis),
                "blackouts":[{"source_start":3.22,"source_end":3.42,"reviewed":True,"evidence":"20ms RMS falls by 10dB then recovers."}],
                "final_hit":{"source_time":3.42,"reviewed":True,"evidence":"The returning attack starts here."}}
            with patch.object(self.promo,"tools",return_value=("ffmpeg","ffprobe")), patch.object(self.promo,"probe",return_value={"has_audio":True,"duration":10}):
                self.assertEqual(5,self.promo.validate_plan(index,plan))
                plan["music_cues"]["final_hit"]["source_time"] = 2.9
                with self.assertRaisesRegex(ValueError,"重击"):
                    self.promo.validate_plan(index,plan)
                plan["music_cues"]["final_hit"]["source_time"] = 3.42
                plan["music_cues"]["blackouts"][0].update(source_start=1.4,source_end=1.6)
                with self.assertRaisesRegex(ValueError,"落差|原声"):
                    self.promo.validate_plan(index,plan)
                plan["music_cues"]["blackouts"][0].update(source_start=3.22,source_end=3.42)
                plan["audio"][0].update(start=0.5,source_start=0.5,duration=4.5)
                self.assertEqual(5,self.promo.validate_plan(index,plan))
                plan["audio"][0]["fade_out"] = 0.5
                with self.assertRaisesRegex(ValueError,"原样"):
                    self.promo.validate_plan(index,plan)

    def test_montage_total_cannot_exceed_ten_seconds(self):
        index, plan = self._plan()
        plan["segments"] += [{"episode": 1, "start": 0, "end": 1, "kind": "montage", "volume": 0}
                             for _ in range(10)]
        plan["segments"] += [{"episode": 1, "start": 4, "end": 6, "kind": "continuation", "volume": 1},
                             {"episode": 1, "start": 6, "duration": 1, "kind": "freeze", "volume": 0}]
        self.assertEqual(16, self.promo.validate_plan(index, plan))
        plan["segments"][5]["end"] += 1 / 30
        with self.assertRaisesRegex(ValueError, "5.*10秒"):
            self.promo.validate_plan(index, plan)

    def test_montage_requires_original_sound_climax_before_freeze(self):
        index, plan = self._plan()
        plan["segments"] += [{"episode": 1, "start": 0, "end": 1, "kind": "montage", "volume": 0},
                             {"episode": 1, "start": 6, "duration": 1, "kind": "freeze", "volume": 0}]
        with self.assertRaisesRegex(ValueError, "高潮"):
            self.promo.validate_plan(index, plan)

    def test_sync_rejects_montage_longer_than_ten_seconds(self):
        import hashlib
        from music import sync_montage
        plan = {"segments": [
            {"episode": 1, "start": 0, "end": 12, "kind": "montage", "music_end": 11},
            {"episode": 1, "start": 8, "end": 9, "kind": "continuation", "volume": 1},
            {"episode": 1, "start": 9, "duration": 1, "kind": "freeze", "volume": 0}],
            "audio": [{"role": "bgm", "file": "music.wav", "start": 0, "duration": 12}]}
        analysis = {"method": "librosa-beat-track", "duration": 20, "file": "music.wav",
                    "file_sha256": hashlib.sha256(b"music").hexdigest(),
                    "beats": [{"time": n, "strength": 1, "beat_type": "normal"} for n in range(20)]}
        with self.assertRaisesRegex(ValueError, "5.*10秒"):
            sync_montage(plan, analysis)
        plan["segments"][0]["music_end"] = 5
        index, _ = self._plan()
        for duration, expected in ((12, 5), (14, 7)):
            with self.subTest(bgm_duration=duration):
                plan["audio"][0]["duration"] = duration
                plan["music_policy"] = {"preserve_audio": duration == 14}
                synced = sync_montage(plan, analysis)
                self.assertEqual(5, synced["segments"][0]["end"])
                self.assertEqual(expected, synced["audio"][0]["duration"])
                self.assertEqual(plan["segments"][1], synced["segments"][1])
                with patch.object(Path, "is_file", return_value=True), patch.object(Path, "read_bytes", return_value=b"music"), \
                     patch.object(self.promo, "tools", return_value=("ffmpeg", "ffprobe")), \
                     patch.object(self.promo, "probe", return_value={"has_audio": True, "duration": 20}):
                    self.assertEqual(7, self.promo.validate_plan(index, synced))

    def test_selected_fast_window_can_be_partial_but_must_stay_aligned(self):
        import copy
        import hashlib
        import json
        from music import sync_montage,validate_cues
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "music.wav"
            audio.write_bytes(b"music")
            analysis_file = Path(folder) / "beats.json"
            beats = [{"time":t,"strength":1,"beat_type":"normal"} for t in (0,1,2,3,4.8,6.8,8.5)]
            analysis = {"file":str(audio),"file_sha256":hashlib.sha256(b"music").hexdigest(),
                "method":"librosa-beat-track","duration":20,"beats":beats,
                "rhythm_sections":[{"start":1,"end":9,"onsets_per_second":4}],
                "events":[{"time":b["time"],"level":"minor","strength":1} for b in beats]}
            analysis_file.write_text(json.dumps(analysis),encoding="utf-8")
            _,plan = self._plan()
            plan["segments"][0].update(start=1,end=2)
            plan["segments"][0]["alignment"].update(dialogueEnd=2,ending="no-action",postDialogueCut=None)
            plan["segments"] += [{"episode":1,"start":3,"end":4.2,"kind":"montage","volume":0} for _ in range(6)]
            plan["segments"][-1]["music_end"] = 6.8
            plan["segments"] += [{"episode":1,"start":4,"end":5,"kind":"continuation","volume":1},
                                 {"episode":1,"start":5,"duration":2,"kind":"freeze","volume":0}]
            plan["audio"] = [{"role":"bgm","file":str(audio),"start":0,"duration":11.2}]
            plan["music_cues"] = {"audio_index":0,"analysis_file":str(analysis_file),
                "fast_section":{"source_start":1,"source_end":6.8,"reviewed":True,"evidence":"Use 1 to 6.8 seconds from the longer fast section."}}
            synced = sync_montage(plan,analysis)
            validate_cues(synced)
            index,_ = self._plan()
            with_picture = copy.deepcopy(synced)
            with_picture["segments"].insert(-1,{"episode":1,"start":5,"end":6,"kind":"picture","volume":0})
            with_picture["audio"][0]["duration"] = 10.8
            with patch.object(self.promo,"tools",return_value=("ffmpeg","ffprobe")),patch.object(self.promo,"probe",return_value={"has_audio":True,"duration":20}):
                self.assertEqual(10.8,self.promo.validate_plan(index,with_picture))
                with_picture["segments"][-2]["volume"] = 1
                with self.assertRaisesRegex(ValueError,"静音画面"):
                    self.promo.validate_plan(index,with_picture)
            broken = copy.deepcopy(synced)
            broken["segments"][6]["end"] -= 0.1
            with self.assertRaisesRegex(ValueError,"快切区间"):
                validate_cues(broken)
            broken = copy.deepcopy(plan)
            broken["audio"][0]["source_start"] = 0.1
            with self.assertRaisesRegex(ValueError,"快切区间"):
                sync_montage(broken,analysis)
            broken = copy.deepcopy(plan)
            broken["segments"][6]["music_end"] = 3
            with self.assertRaisesRegex(ValueError,"快切区间"):
                sync_montage(broken,analysis)
            broken = copy.deepcopy(plan)
            for segment in broken["segments"][1:7]:
                segment["end"] = segment["start"]+0.2
            with self.assertRaisesRegex(ValueError,"补充"):
                sync_montage(broken,analysis)

    def test_blackout_cannot_hide_dialogue_even_with_real_energy_drop(self):
        from music import validate_cues
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "music.wav"
            audio.write_bytes(b"music")
            analysis = Path(folder) / "beats.json"
            db = [-3.0] * 250
            db[111:121] = [-13.0] * 10
            analysis.write_text(json.dumps({"file":str(audio),"file_sha256":hashlib.sha256(b"music").hexdigest(),
                "energy_envelope":{"step":0.02,"db":db}}),encoding="utf-8")
            _, plan = self._plan()
            plan["segments"].append({"episode":1,"start":4,"duration":2,"kind":"freeze","volume":0})
            plan["audio"] = [{"role":"bgm","file":str(audio),"start":0,"duration":5}]
            plan["music_cues"] = {"analysis_file":str(analysis),"audio_index":0,
                "blackouts":[{"source_start":2.22,"source_end":2.42,"reviewed":True,"evidence":"Energy valley."}]}
            with self.assertRaisesRegex(ValueError,"原声"):
                validate_cues(plan)

    def test_encoded_blackout_is_black_and_recovery_starts_with_flash(self):
        import subprocess
        ffmpeg, _ = self.promo.tools()
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.mp4"
            self.promo.run([ffmpeg,"-v","error","-f","lavfi","-i","color=c=red:s=108x192:r=30:d=1",
                "-c:v","libx264","-pix_fmt","yuv420p",source])
            stat = source.stat()
            index = {"episodes":[{"number":1,"file":str(source),"duration":1,"width":108,"height":192,
                "has_audio":False,"size":stat.st_size,"mtime_ns":stat.st_mtime_ns}]}
            plan = {"segments":[{"episode":1,"start":0,"kind":"freeze","duration":0.6,
                "volume":0,"flash":0.3,"flash_start":0.266666669}]}
            with patch("music.mapped_blackouts",return_value=[{"start":2/30,"end":8/30}]):
                result = self.promo.render(index,plan,Path(folder))
            raw = subprocess.run([ffmpeg,"-v","error","-i",result["video"],"-an","-vf","scale=36:64",
                "-pix_fmt","rgb24","-f","rawvideo","pipe:1"],capture_output=True,check=True).stdout
            size = 36*64*3
            frames = [raw[n:n+size] for n in range(0,len(raw),size)]
            self.assertEqual(list(range(2,8)),[n for n,frame in enumerate(frames) if max(frame)<4])
            self.assertGreater(sum(frames[8])/size,245)

    def test_draft_file_permission_retry_is_bounded(self):
        calls=[]
        def transient():
            calls.append(1)
            if len(calls)==1:
                raise PermissionError("temporarily busy")
            return "written"
        with patch("time.sleep"):
            self.assertEqual("written",self.promo.retry_file_write(transient))
            self.assertEqual(2,len(calls))
            def denied():
                calls.append(1)
                raise PermissionError("busy")
            calls.clear()
            with self.assertRaises(PermissionError):
                self.promo.retry_file_write(denied)
            self.assertEqual(5,len(calls))

    def test_major_music_accents_have_priority_over_minor_hits(self):
        from music import arrange_group, sync_montage
        group=[{"start":0,"end":1.2,"rhythm_weight":1} for _ in range(3)]
        events=[{"time":t,"level":level,"strength":1} for t,level in (
            (0,"minor"),(0.5,"minor"),(0.8,"minor"),(1.1,"major"),(1.4,"minor"),(1.7,"minor"),(2,"minor"))]
        boundaries=arrange_group(group,0,2,events)
        self.assertEqual(3,len(boundaries))
        self.assertTrue(any(abs(t-1.1)<1/60 for t in boundaries))
        self.assertEqual(2,boundaries[-1])
        events.append({"time":2,"level":"major","strength":2})
        plan={"segments":[{**s,"end":s["end"]*3,"episode":1,"kind":"montage"} for s in group],
              "audio":[{"file":"music.wav","start":0,"source_start":0,"duration":6}]}
        plan["segments"][-1]["music_end"]=6
        analysis={"method":"librosa-beat-track","beats":[{"time":t*3,"strength":1,"beat_type":"normal"} for t in (0,0.5,1,1.5,2)],"events":[{**e,"time":e["time"]*3} for e in events]}
        synced=sync_montage(plan,analysis)
        self.assertEqual("hierarchical",synced["beat_sync"]["mode"])
        self.assertGreaterEqual(synced["beat_sync"]["major_hits"],2)

    def test_single_song_policy_rejects_another_bgm(self):
        import hashlib
        index,plan=self._plan()
        plan["music_policy"]={"single_song":True,"song_sha256":hashlib.sha256(b"a").hexdigest()}
        plan["audio"]=[{"role":"bgm","file":file,"start":n,"duration":1,"volume_db":-3} for n,file in enumerate(("a.wav","b.wav"))]
        def content(path):
            return b"a" if path.name=="a.wav" else b"b"
        with patch.object(Path,"is_file",return_value=True),patch.object(Path,"read_bytes",content),patch.object(self.promo,"tools",return_value=("ffmpeg","ffprobe")),patch.object(self.promo,"probe",return_value={"has_audio":True,"duration":10}):
            with self.assertRaisesRegex(ValueError,"同一首"):
                self.promo.validate_plan(index,plan)
            plan["audio"][1]["file"]="a.wav"
            self.assertEqual(3,self.promo.validate_plan(index,plan))

    def test_beat_sync_quantizes_absolute_boundaries_without_drift(self):
        from music import sync_montage
        index, plan = self._plan()
        plan["segments"][0].update(start=1, end=2)
        plan["segments"][0]["alignment"].update(dialogueEnd=2, ending="no-action", postDialogueCut=None)
        plan["segments"] += [{"episode": 1, "start": 3, "end": 3.8, "kind": "montage", "volume": 0} for _ in range(10)]
        plan["segments"][-1]["music_end"] = 7.12
        plan["segments"] += [{"episode": 1, "start": 5, "duration": 2, "kind": "freeze", "volume": 0}]
        plan["audio"] = [{"file": "music.wav", "start": 0, "duration": 7.9, "source_start":0.22}]
        analysis = {"method": "librosa-beat-track", "file": "music.wav", "duration": 30,
                    "beats": [{"time": 0.04+i*0.59, "beat_type": "strong", "strength": 1} for i in range(50)]}
        synced = sync_montage(plan, analysis)
        self.assertEqual(plan["segments"][0], synced["segments"][0])
        self.assertEqual(plan["audio"][0]["source_start"],synced["audio"][0]["source_start"])
        duration = sum(self.promo.clip_duration(s) for s in synced["segments"][1:-1])
        self.assertAlmostEqual(5.9, duration)
        self.assertLessEqual(synced["beat_sync"]["max_error_seconds"], 1/60)
        at = 1
        for n, segment in enumerate(synced["segments"][1:-1],1):
            at += self.promo.clip_duration(segment)
            self.assertLessEqual(abs(at-(1+n*0.59)),1/60+1e-8)
        plan["audio"] = [{"file":"music.wav", "start":0, "duration":1, "source_start":0.22},
                         {"file":"music.wav", "start":1, "duration":5.9, "source_start":1.22},
                         {"file":"music.wav", "start":9, "duration":2, "source_start":9.22}]
        split = sync_montage(plan, analysis, audio_index=1)["audio"]
        for a, b in zip(split, split[1:]):
            self.assertAlmostEqual(a["start"]+a["duration"], b["start"])
            self.assertAlmostEqual(a["source_start"]+a["duration"], b["source_start"])

    def test_music_first_allows_free_cuts_and_keeps_music_mapping(self):
        from music import sync_montage
        _, plan = self._plan()
        plan["segments"][0].update(start=1,end=2)
        plan["segments"][0]["alignment"].update(dialogueEnd=2,ending="no-action",postDialogueCut=None)
        plan["segments"] += [{"episode":1,"start":3,"end":4,"kind":"montage","volume":0} for _ in range(6)]
        plan["segments"][3]["music_end"] = 12.6
        plan["segments"][6]["music_end"] = 15.2
        plan["segments"] += [{"episode":1,"start":5,"duration":2,"kind":"freeze","volume":0}]
        plan["audio"] = [{"file":"music.wav","start":1,"source_start":10,"duration":5.2}]
        analysis = {"method":"librosa-beat-track","file":"music.wav","duration":20,
                    "beats":[{"time":t,"strength":1,"beat_type":"strong"} for t in (10,11.2,12.6,13.8,15.2,16.3)]}
        synced = sync_montage(plan,analysis)
        self.assertEqual(("music.wav",1,10),(synced["audio"][0]["file"],synced["audio"][0]["start"],synced["audio"][0]["source_start"]))
        self.assertEqual(5.2,synced["audio"][0]["duration"])
        self.assertEqual([1,4,7],[c["segment_index"] for c in synced["beat_sync"]["cuts"]])
        self.assertEqual(4,synced["beat_sync"]["free_cut_count"])
        self.assertEqual(plan["segments"][0],synced["segments"][0])
        import copy
        defaults = copy.deepcopy(plan)
        defaults["audio"][0].pop("source_start")
        for s in defaults["segments"]:
            if "music_end" in s:
                s["music_end"] -= 10
        shifted = {**analysis,"beats":[{**b,"time":b["time"]-10} for b in analysis["beats"]]}
        self.assertEqual(0,sync_montage(defaults,shifted)["audio"][0].get("source_start",0))
        from music import validate_sync
        import hashlib
        synced["beat_sync"]["analysis"]["file_sha256"] = hashlib.sha256(b"music").hexdigest()
        with patch.object(Path,"read_bytes",return_value=b"music"):
            validate_sync(synced)
            synced["segments"][1]["end"] += 0.05
            synced["segments"][2]["end"] -= 0.05
            validate_sync(synced)
            synced["audio"][0]["source_start"] += 0.1
            with self.assertRaisesRegex(ValueError,"音乐"):
                validate_sync(synced)

    def test_music_endpoint_accepts_frame_quantization(self):
        import hashlib
        from music import sync_montage, validate_sync
        plan = {"segments":[{"episode":1,"start":0,"end":6,"kind":"montage","music_end":5.02},
                            {"episode":1,"start":3,"duration":1,"kind":"freeze"}],
                "audio":[{"file":"music.wav","start":0,"duration":5.02}]}
        analysis = {"method":"librosa-beat-track","file":"music.wav","duration":10,
                    "file_sha256":hashlib.sha256(b"music").hexdigest(),
                    "beats":[{"time":t,"beat_type":"strong","strength":1} for t in (0,2.51,5.02,7.53)]}
        synced = sync_montage(plan,analysis)
        self.assertEqual(5.02,synced["audio"][0]["duration"])
        with patch.object(Path,"read_bytes",return_value=b"music"):
            validate_sync(synced)

    def test_checks_audio_source_range_and_fades(self):
        index, plan = self._plan()
        audio = {"file": "music.mp3", "start": 0, "duration": 2, "source_start": 1, "fade_in": 0.2, "fade_out": 0.5}
        with patch.object(Path, "is_file", return_value=True), patch.object(self.promo, "tools", return_value=("ffmpeg", "ffprobe")), patch.object(self.promo, "probe", return_value={"has_audio": True, "duration": 10}):
            for invalid in ({"source_start": -1}, {"source_start": 9}, {"fade_in": -2}, {"fade_out": 3}, {"volume": float("nan")}):
                with self.subTest(invalid=invalid):
                    plan["audio"] = [{**audio, **invalid}]
                    with self.assertRaises(ValueError):
                        self.promo.validate_plan(index, plan)
            plan["audio"] = [audio]
            self.assertEqual(3, self.promo.validate_plan(index, plan))

    def test_original_dialogue_requires_source_audio(self):
        index, plan = self._plan()
        index["episodes"][0]["has_audio"] = False
        with self.assertRaisesRegex(ValueError, "原声"):
            self.promo.validate_plan(index, plan)

    def test_registration_preserves_bom_index_and_concurrent_entries(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "root_meta_info.json"
            old = {"draft_id": "old", "draft_name": "Old", "draft_fold_path": "old"}
            concurrent = {"draft_id": "concurrent", "draft_name": "Concurrent", "draft_fold_path": "concurrent"}
            before = {"all_draft_store": [old], "draft_ids": 1}
            self.promo.save_json(path, {**before, "all_draft_store": [old, concurrent], "custom": "keep"})
            path.write_bytes(b'\xef\xbb\xbf' + path.read_bytes())
            new = {"draft_id": "new", "draft_name": "New", "draft_fold_path": "new"}
            self.promo.register_draft(path, before, new)
            result = self.promo.load_json(path)
            self.assertEqual({"old", "concurrent", "new"}, {e["draft_id"] for e in result["all_draft_store"]})
            self.assertEqual("keep", result["custom"])
            original = path.read_bytes()
            with self.assertRaises(ValueError):
                self.promo.register_draft(path, before, new)
            self.assertEqual(original, path.read_bytes())

    def test_registration_refuses_unreadable_index(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "root_meta_info.json"
            path.write_text("encrypted", encoding="utf-8")
            with self.assertRaises(ValueError):
                self.promo.register_draft(path, {"all_draft_store": []}, {"draft_id": "new"})
            self.assertEqual("encrypted", path.read_text(encoding="utf-8"))

    def test_does_not_mark_unrelated_work_directory_for_deletion(self):
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / "work"
            existing.mkdir()
            unrelated = existing / "keep.txt"
            unrelated.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "未标记"):
                self.promo.work_dir(folder)
            self.assertEqual("keep", unrelated.read_text(encoding="utf-8"))
            self.assertFalse((existing / ".duanju-promo-work").exists())

    def test_rejects_sources_changed_after_visual_review(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.mp4"
            source.write_bytes(b"first")
            info = source.stat()
            index = {"episodes": [{"number": 1, "file": str(source), "size": info.st_size, "mtime_ns": info.st_mtime_ns}]}
            self.promo.verify_sources(index)
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "素材已改变"):
                self.promo.verify_sources(index)


    def test_montage_duration_accepts_five_to_ten_seconds(self):
        for seconds in (5, 7.25, 10):
            with self.subTest(seconds=seconds):
                index, plan = self._plan()
                index["episodes"][0]["duration"] = 30
                plan["segments"] = [
                    {"episode": 1, "start": 0, "end": seconds, "kind": "montage", "volume": 0},
                    {"episode": 1, "start": 20, "end": 21, "kind": "continuation", "volume": 1}]
                self.assertAlmostEqual(seconds + 1, self.promo.validate_plan(index, plan))

    def test_montage_duration_rejects_outside_five_to_ten_seconds(self):
        for seconds in (5 - 1 / 30, 10 + 1 / 30):
            with self.subTest(seconds=seconds):
                index, plan = self._plan()
                index["episodes"][0]["duration"] = 30
                plan["segments"] = [
                    {"episode": 1, "start": 0, "end": seconds, "kind": "montage", "volume": 0},
                    {"episode": 1, "start": 20, "end": 21, "kind": "continuation", "volume": 1}]
                with self.assertRaisesRegex(ValueError, "5.*10秒"):
                    self.promo.validate_plan(index, plan)

    def test_sync_uses_music_window_between_five_and_ten_seconds(self):
        from music import sync_montage
        analysis = {"method": "librosa-beat-track", "duration": 30,
                    "beats": [{"time": n / 4, "strength": 1, "beat_type": "normal"} for n in range(120)]}
        for seconds in (4.75, 5, 7.25, 10, 10.25):
            with self.subTest(seconds=seconds):
                plan = {"segments": [
                    {"episode": 1, "start": 0, "end": 20, "kind": "montage", "music_end": seconds},
                    {"episode": 1, "start": 20, "end": 21, "kind": "continuation", "volume": 1}],
                    "audio": [{"file": "music.wav", "start": 0, "duration": 21}]}
                if 5 <= seconds <= 10:
                    synced = sync_montage(plan, analysis)
                    actual = synced["segments"][0]["end"]
                    self.assertLessEqual(abs(seconds - actual), 1 / 60 + 1e-8)
                    self.assertTrue(5 <= actual <= 10)
                    self.assertEqual(plan["segments"][1], synced["segments"][1])
                else:
                    with self.assertRaisesRegex(ValueError, "5.*10秒"):
                        sync_montage(plan, analysis)

    def test_fast_section_duration_requires_five_to_ten_seconds(self):
        import hashlib
        import json
        from music import validate_cues
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "music.wav"
            audio.write_bytes(b"music")
            analysis = Path(folder) / "beats.json"
            analysis.write_text(json.dumps({"file": str(audio), "duration": 30,
                "file_sha256": hashlib.sha256(b"music").hexdigest()}), encoding="utf-8")
            for seconds in (4.75, 5, 7.25, 10, 10.25):
                with self.subTest(seconds=seconds):
                    plan = {"segments": [
                        {"kind": "montage", "start": 0, "end": seconds, "volume": 0},
                        {"kind": "continuation", "start": 20, "end": 21, "volume": 1}],
                        "audio": [{"role": "bgm", "file": str(audio), "start": 0, "duration": seconds + 1}],
                        "music_cues": {"audio_index": 0, "analysis_file": str(analysis),
                            "fast_section": {"source_start": 0, "source_end": seconds,
                                "reviewed": True, "evidence": "Use the actual selected fast music window."}}}
                    if 5 <= seconds <= 10:
                        validate_cues(plan)
                    else:
                        with self.assertRaisesRegex(ValueError, "5.*10秒"):
                            validate_cues(plan)


    def test_sync_quantizes_montage_start_and_preserves_audio_length(self):
        import hashlib
        import json
        from music import sync_montage, validate_sync, validate_cues
        for prefix in (1.01, 1.02):
            for seconds in (5, 5.26, 7.25, 10):
                with self.subTest(prefix=prefix, seconds=seconds):
                    plan = {"segments": [
                        {"episode": 1, "start": 0, "end": prefix, "kind": "picture", "volume": 0},
                        {"episode": 1, "start": 2, "end": 22, "kind": "montage", "music_end": prefix + seconds},
                        {"episode": 1, "start": 23, "end": 24, "kind": "continuation", "volume": 1}],
                        "audio": [{"role": "bgm", "file": "music.wav", "start": 0, "duration": prefix + 21}],
                        "music_cues": {"audio_index": 0, "analysis_file": "beats.json",
                            "fast_section": {"source_start": prefix, "source_end": prefix + seconds,
                                "reviewed": True, "evidence": "Use the actual fast music section."}}}
                    analysis = {"method": "librosa-beat-track", "duration": 30, "file": "music.wav",
                        "file_sha256": hashlib.sha256(b"music").hexdigest(),
                        "beats": [{"time": t, "strength": 1, "beat_type": "normal"}
                                  for t in sorted({prefix + n / 4 for n in range(80)} | {prefix + seconds})]}
                    synced = sync_montage(plan, analysis)
                    actual = self.promo.clip_duration(synced["segments"][1])
                    self.assertTrue(5 <= actual <= 10)
                    self.assertLessEqual(abs(seconds - actual), 1 / 30 + 1e-8)
                    if seconds in (5, 10):
                        self.assertAlmostEqual(seconds, actual)
                    self.assertAlmostEqual(prefix + actual + 1, synced["audio"][0]["duration"])
                    self.assertEqual(plan["segments"][0], synced["segments"][0])
                    self.assertEqual(plan["segments"][2], synced["segments"][2])

                    with patch.object(Path, "read_bytes", return_value=b"music"):
                        validate_sync(synced)
                    with patch.object(Path, "read_bytes", return_value=b"music"), \
                         patch.object(Path, "read_text", return_value=json.dumps(analysis)):
                        validate_cues(synced)
                    self.assertLessEqual(synced["beat_sync"]["max_error_seconds"], 1 / 60 + 1e-8)


if __name__ == "__main__":
    unittest.main()
