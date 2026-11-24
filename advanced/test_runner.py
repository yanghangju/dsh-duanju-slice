"""Offline regression checks: synthetic media only, no model or real drafts."""
import copy
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

import runner

# The bundled runtime is the default: no external NarratoAI install or PATH entry.
PLUGIN_ROOT = Path(runner.__file__).resolve().parents[1]
BUNDLED_FFMPEG = PLUGIN_ROOT / "runtime" / "ffmpeg" / "ffmpeg.exe"
BUNDLED_FFPROBE = PLUGIN_ROOT / "runtime" / "ffmpeg" / "ffprobe.exe"


def bundled_tools():
    for tool in (BUNDLED_FFMPEG, BUNDLED_FFPROBE):
        if not tool.is_file():
            raise FileNotFoundError(f"内置媒体工具缺失：{tool}")
    return str(BUNDLED_FFMPEG), str(BUNDLED_FFPROBE)


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="runner-tests-", dir=Path(__file__).parent)
        cls.root = Path(cls.temporary.name)
        cls.ffmpeg, cls.ffprobe = bundled_tools()
        cls.videos = cls.root / "episodes"
        cls.videos.mkdir()
        cls.video = cls.videos / "ep001.mp4"
        runner.promo.run([cls.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=red:s=108x192:r=30:d=3",
                          "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=3",
                          "-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", cls.video])
        shutil.copy2(cls.video, cls.videos / "ep099.mp4")
        for name, color in (("003.mp4", "blue"), ("第十二集.mp4", "green")):
            runner.promo.run([cls.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i", f"color=c={color}:s=108x192:r=30:d=3",
                              "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=3",
                              "-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", cls.videos / name])
        cls.script = cls.root / "原稿.docx"
        paragraphs = ["测试短剧", "第一集", "甲：别走。", "ALICE: Don't go.",
                      "第三集", "乙：回来。", "BOB: Come back.", "第十二集", "甲：等一下。", "ALICE: Wait.",
                      "第八集", "甲：没有视频。"]
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        xml += "".join(f"<w:p><w:r><w:t>{escape(p)}</w:t></w:r></w:p>" for p in paragraphs) + "</w:body></w:document>"
        with ZipFile(cls.script, "w") as archive:
            archive.writestr("word/document.xml", xml)
        cls.base = cls.root / "prepared"
        cls.prepared = runner.execute({"action": "prepare", "workDir": str(cls.base), "scriptPath": str(cls.script),
                                       "dramaDir": str(cls.videos), "ffmpegPath": cls.ffmpeg, "ffprobePath": cls.ffprobe})
        cls.index = runner.promo.load_json(cls.base / "index.json")
        cls.music = cls.root / "pulse.wav"
        runner.promo.run([cls.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i",
                          "aevalsrc=0.8*sin(2*PI*160*t)*exp(-80*mod(t\\,0.5)):s=22050:d=12", cls.music])

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.work = self.root / self._testMethodName
        self.work.mkdir()
        runner.write_json(self.work / "index.json", self.index)

    def call(self, action, data=None, **extra):
        return runner.execute({"action": action, "workDir": str(self.work), "ffmpegPath": self.ffmpeg,
                               "ffprobePath": self.ffprobe, "data": data or {}, **extra})

    def plan(self, kind="continuation", duration=1):
        segment = {"episode": 1, "start": 0, "end": duration, "kind": kind, "volume": 0.8}
        if kind == "dialogue":
            segment["alignment"] = {"method": "video-frames", "reviewed": True, "complete": True,
                                    "dialogueEnd": duration, "ending": "no-action", "confidence": 0.9,
                                    "evidence": "Synthetic test only; no claim of human video review."}
        return {"segments": [segment]}

    def analysis(self):
        result = {"method": "librosa-beat-track", "fallback": False, "file": str(self.music), "duration": 12,
                  "file_sha256": hashlib.sha256(self.music.read_bytes()).hexdigest(),
                  "beats": [{"time": n / 2, "strength": 1, "beat_type": "normal"} for n in range(24)],
                  "events": [{"time": n / 2, "level": "major" if n % 4 == 0 else "minor", "strength": 1} for n in range(24)]}
        output = self.work / "beats.json"
        runner.write_json(output, result)
        return output, result

    def sync_plan(self):
        plan = {"segments": [{"episode": 1, "start": 0, "end": 1, "kind": "montage", "volume": 0} for _ in range(10)],
                "audio": [{"file": str(self.music), "start": 0, "duration": 11, "role": "bgm", "volume_db": -3}]}
        plan["segments"][-1]["music_end"] = 5
        plan["segments"].append({"episode": 1, "start": 1, "end": 2, "kind": "continuation", "volume": 1})
        return plan

    def test_prepare_episode_numbers_and_environment_only(self):
        self.assertEqual([1, 3, 12], [e["number"] for e in self.index["episodes"]])
        self.assertEqual(["E1L1", "E3L1", "E12L1"], [e["lines"][0]["id"] for e in self.index["episodes"]])
        self.assertEqual(3, self.prepared["episodes"])
        self.assertEqual({"ffmpeg": self.ffmpeg, "ffprobe": self.ffprobe}, self.prepared["runtime"])
        self.assertEqual(2, runner.promo.episode_number("EP002-subtitled.mp4"))
        self.assertEqual(12, runner.promo.episode_number("第十二集.mp4"))
        self.assertEqual(3, runner.promo.episode_number("003.mp4"))

    def test_prepare_refuses_existing_index_and_material_directory(self):
        before = (self.work / "index.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "已存在"):
            self.call("prepare", scriptPath=str(self.script), dramaDir=str(self.videos))
        self.assertEqual(before, (self.work / "index.json").read_bytes())
        with self.assertRaisesRegex(ValueError, "独立"):
            runner.execute({"action": "prepare", "workDir": str(self.videos), "scriptPath": str(self.script), "dramaDir": str(self.videos)})

    def test_sample_action_is_retired(self):
        with self.assertRaisesRegex(ValueError, "action 只允许"):
            self.call("sample", {"episode": 1})

    def test_beats_is_real_and_task_local(self):
        result = self.call("beats", {"audio": str(self.music)})
        analysis = runner.promo.load_json(result["analysis"])
        self.assertFalse(analysis["fallback"])
        self.assertEqual("librosa-beat-track", analysis["method"])
        self.assertGreaterEqual(len(analysis["beats"]), 4)
        self.assertTrue(analysis["energy_envelope"]["db"])
        self.assertTrue(all(b["time"] > a["time"] for a, b in zip(analysis["beats"], analysis["beats"][1:])))
        self.assertTrue(Path(result["analysis"]).parent == self.work)
        self.assertEqual(hashlib.sha256(self.music.read_bytes()).hexdigest(), result["file_sha256"])
        original = Path(result["analysis"]).read_bytes()
        with self.assertRaisesRegex(ValueError, "已存在"):
            self.call("beats", {"audio": str(self.music), "output": result["analysis"]})
        self.assertEqual(original, Path(result["analysis"]).read_bytes())
        for output in (str(self.root / "outside.json"), "../outside.json", "work/temporary.json"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.call("beats", {"audio": str(self.music), "output": output})
        self.assertFalse((self.root / "outside.json").exists())

    def test_sync_returns_candidate_without_writing_fixed_plan(self):
        beats, analysis = self.analysis()
        original = self.sync_plan()
        plan_path = self.work / "plan.json"
        result = self.call("sync", {"plan": original, "beats": str(beats)})
        self.assertFalse(plan_path.exists())
        synced = result["synced_plan"]
        self.assertEqual(original["segments"][-1], synced["segments"][-1])
        self.assertEqual(5, sum(runner.promo.clip_duration(s) for s in synced["segments"][:-1]))
        self.assertGreaterEqual(result["major_hits"], 2)
        self.assertLessEqual(result["max_error_seconds"], 1 / 60 + 1e-9)
        self.assertEqual(6, self.call("validate", {"plan": synced})["duration"])
        runner.write_json(plan_path, synced)
        saved = plan_path.read_bytes()
        original["title"] = "updated"
        candidate = self.call("sync", {"plan": original, "beats": str(beats)})
        self.assertEqual("updated", candidate["synced_plan"]["title"])
        self.assertEqual(saved, plan_path.read_bytes())
        self.assertEqual(analysis, runner.promo.load_json(beats))
        self.assertFalse(list(self.work.glob("*.writing")))
        for data in ({"plan": original, "beats": str(beats), "audioIndex": -1},
                     {"plan": original, "beats": "beats.json"}, {"plan": original, "beats": str(beats), "output": "elsewhere"}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.call("sync", data)

    def test_validate_original_alignment_audio_and_source_bounds(self):
        plan = self.plan("dialogue")
        self.assertEqual((1, 1, 30), tuple(self.call("validate", {"plan": plan})[k] for k in ("duration", "segments", "frames")))
        for update in ({"end": 4}, {"end": float("nan")}, {"volume": 0}, {"kind": "freeze"}, {"flash": 0.8}):
            bad = copy.deepcopy(plan)
            bad["segments"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.call("validate", {"plan": bad})
        for update in ({"complete": False}, {"confidence": float("inf")}, {"postDialogueCut": 0.5}):
            bad = copy.deepcopy(plan)
            bad["segments"][0]["alignment"].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.call("validate", {"plan": bad})
        plan["audio"] = [{"file": str(self.music), "start": 0, "duration": 0.5, "role": "bgm", "volume_db": -3}]
        self.call("validate", {"plan": plan})
        for update in ({"volume_db": -6}, {"source_start": 20}, {"fade_in": 0.4, "fade_out": 0.4}, {"speed": 2}):
            bad = copy.deepcopy(plan)
            bad["audio"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.call("validate", {"plan": bad})

    def test_validate_configurable_bgm_gain_and_muted_policy(self):
        policy = {"single_song": True, "song_sha256": hashlib.sha256(self.music.read_bytes()).hexdigest()}
        plan = self.plan()
        plan["audio"] = [{"file": str(self.music), "start": 0, "duration": 0.9, "role": "bgm",
                          "volume_db": -9.473204, "volume": 0.336}]
        plan["music_policy"] = {**policy, "bgm_db": -9.473204}
        self.assertEqual(30, self.call("validate", {"plan": plan})["frames"])
        plan["music_policy"]["bgm_db"] = -0.175482
        with self.assertRaisesRegex(ValueError, "本任务"):
            self.call("validate", {"plan": plan})
        muted = self.plan()
        muted["audio"] = [{"file": str(self.music), "start": 0, "duration": 0.9, "role": "bgm",
                           "volume": 0, "volume_db": None}]
        muted["music_policy"] = {**policy, "bgm_db": None}
        self.call("validate", {"plan": muted})
        muted["audio"][0]["volume_db"] = -3
        with self.assertRaisesRegex(ValueError, "静音"):
            self.call("validate", {"plan": muted})
        muted["audio"][0].update(volume=0.5, volume_db=None)
        with self.assertRaisesRegex(ValueError, "不一致"):
            self.call("validate", {"plan": muted})

    def test_cumulative_frame_boundaries_do_not_independently_round(self):
        plan = {"segments": [{"episode": 1, "start": 0.1 * n, "end": 0.1 * n + 0.21, "kind": "picture", "volume": 0}
                              for n in range(8)] + self.plan()["segments"]}
        result = self.call("validate", {"plan": plan})
        self.assertEqual(80, result["frames"])
        self.assertEqual([6, 7, 6, 6, 7, 6, 6, 6, 30], [s["frames"] for s in result["encoded_boundaries"]])
        self.assertEqual(2.68, result["planned_duration"])
        self.assertEqual(80 / 30, result["duration"])
        for kind in ("dialogue", "continuation"):
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "截短"):
                self.call("validate", {"plan": self.plan(kind, 1.01)})
        self.assertEqual(31 / 30, self.call("validate", {"plan": self.plan("dialogue", 1.02)})["duration"])

    def test_render_quantized_frames_pts_source_mapping_and_clean(self):
        plan = {"segments": [{"episode": (1, 3, 12)[n % 3], "start": 0.1 * n, "end": 0.1 * n + 0.21, "kind": "picture", "volume": 0}
                              for n in range(8)] + [{"episode": 1, "start": 2, "end": 3, "kind": "continuation", "volume": 0.8}]}
        runner.write_json(self.work / "plan.json", plan)
        source_before = self.video.read_bytes()
        result = self.call("render")
        self.assertTrue(result["body_only"])
        self.assertFalse(result["final_completed"])
        self.assertTrue(result["requires_native_ending"])
        self.assertEqual((80, 80 / 30), (result["frames"], result["duration"]))
        self.assertEqual("正文中间片.mp4", Path(result["video"]).name)
        actual = runner.promo.video_frames(result["video"], self.ffprobe)
        self.assertEqual(80, actual["frames"])
        self.assertEqual(0, actual["start"])
        self.assertAlmostEqual(80 / 30, actual["duration"], places=6)
        # Inspect every encoded frame numerically: all hard cuts are on the cumulative grid.
        raw = subprocess.run([self.ffmpeg, "-v", "error", "-i", result["video"], "-an", "-vf", "scale=2:2",
                              "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], capture_output=True, check=True).stdout
        colors = [max(range(3), key=lambda channel: sum(raw[n + channel:n + 12:3])) for n in range(0, len(raw), 12)]
        for segment in result["encoded_segments"]:
            expected = {1: 0, 3: 2, 12: 1}[segment["episode"]]
            self.assertEqual([expected] * segment["frames"], colors[segment["timeline_start_frame"]:segment["timeline_end_frame"]])
            self.assertAlmostEqual(segment["frames"] / 30, segment["end"] - segment["start"])
            self.assertLessEqual(segment["source_mapping"]["actual_end"], segment["source"]["end"] + 1e-9)
            self.assertEqual(1 if segment["volume_baked"] else 0.8, segment["volume"])
        self.assertEqual(0.8, result["encoded_segments"][-1]["volume"])
        self.assertEqual(str(self.video), result["encoded_segments"][-1]["file"])
        assets = [Path(p) for p in result["normalized"].values()]
        self.assertTrue(assets and all(self.work / "assets" in p.parents for p in assets))
        before = Path(result["video"]).read_bytes()
        self.assertTrue(self.call("render")["resumed"])
        self.assertEqual(before, Path(result["video"]).read_bytes())
        self.call("clean")
        self.assertFalse((self.work / "work").exists())
        self.assertTrue(all(p.is_file() for p in assets))
        self.assertTrue(Path(result["result"]).is_file())
        self.assertTrue(self.call("render")["resumed"])
        self.assertFalse((self.work / "work").exists())
        self.assertEqual(source_before, self.video.read_bytes())

    def test_render_upward_dialogue_keeps_verified_source_end(self):
        plan = self.plan("dialogue", 1.02)
        plan["audio"] = [{"role": "bgm", "file": str(self.music), "start": 0, "duration": 31 / 30 - 0.4,
                          "volume_db": -3, "fade_out": 0.2},
                         {"role": "sfx", "file": str(self.music), "source_start": 1, "start": 0.1, "duration": 0.1, "volume": 0.25}]
        runner.write_json(self.work / "plan.json", plan)
        result = self.call("render")
        segment = result["encoded_segments"][0]
        self.assertEqual(31, segment["frames"])
        self.assertEqual(1.02, segment["source_mapping"]["actual_end"])
        self.assertGreater(segment["source_mapping"]["output_frame_padding"], 0)
        self.assertEqual(1, segment["volume"])
        self.assertTrue(segment["volume_baked"])

    def test_render_upward_resume_and_revised_plan_use_isolated_bodies(self):
        plan = self.plan("dialogue", 1.02)
        runner.write_json(self.work / "plan.json", plan)
        first = self.call("render")
        self.assertFalse(first["resumed"])
        video, record = Path(first["video"]), Path(first["result"])
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (video, record)}
        with patch.object(runner.promo, "render", side_effect=AssertionError("resume must never re-encode")):
            resumed = self.call("render")
        self.assertTrue(resumed["resumed"])
        self.assertEqual((31, 31 / 30), (resumed["frames"], resumed["duration"]))
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (video, record)})
        plan["notes"] = "Execution revised from actual material; continue without another review."
        plan["segments"][0]["start"] = 0.5
        plan["segments"][0]["end"] = 1.52
        plan["segments"][0]["alignment"]["dialogueEnd"] = 1.52
        runner.write_json(self.work / "plan.json", plan, replace=True)
        revised = self.call("render")
        self.assertFalse(revised["resumed"])
        self.assertNotEqual(first["video"], revised["video"])
        self.assertNotEqual(first["result"], revised["result"])
        self.assertEqual(0.5, revised["encoded_segments"][0]["source"]["start"])
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (video, record)})
        with patch.object(runner.promo, "render", side_effect=AssertionError("revised body must resume")):
            self.assertTrue(self.call("render")["resumed"])
        plan = self.plan("dialogue", 1.02)
        runner.write_json(self.work / "plan.json", plan, replace=True)
        cached = runner.promo.load_json(record)
        cached["frames"] += 1
        runner.write_json(record, cached, replace=True)
        tampered = record.read_bytes()
        with self.assertRaisesRegex(ValueError, "不匹配"):
            self.call("render")
        self.assertEqual(tampered, record.read_bytes())
        self.assertEqual(before[video][0], video.read_bytes())

    def test_blackouts_stay_in_montage_and_cannot_overlay_sfx(self):
        analysis_file, analysis = self.analysis()
        analysis["energy_envelope"] = {"step": 0.02, "db": [-3.0] * 600}
        analysis["energy_envelope"]["db"][25:35] = [-160.0] * 10
        runner.write_json(analysis_file, analysis, replace=True)
        plan = {"segments": [{"episode": 1, "start": 0, "end": 1, "kind": "montage", "volume": 0} for _ in range(5)]
                            + self.plan()["segments"],
                "audio": [{"role": "bgm", "file": str(self.music), "start": 0, "duration": 6, "volume_db": -3}],
                "music_cues": {"audio_index": 0, "analysis_file": str(analysis_file),
                               "blackouts": [{"source_start": 0.5, "source_end": 0.7, "reviewed": True,
                                              "evidence": "Synthetic energy fixture; test manual mute and recovery only."}]}}
        self.call("validate", {"plan": plan})
        sfx = {"role": "sfx", "file": str(self.music), "start": 0.6, "duration": 0.2}
        plan["audio"].append(sfx)
        with self.assertRaisesRegex(ValueError, "SFX"):
            self.call("validate", {"plan": plan})
        plan["audio"].pop()
        plan["segments"].insert(0, {"episode": 1, "start": 0, "end": 1, "kind": "picture", "volume": 0})
        plan["audio"][0]["duration"] = 7
        with self.assertRaisesRegex(ValueError, "只能覆盖"):
            self.call("validate", {"plan": plan})

    def test_clean_refuses_unmarked_or_original_dependencies(self):
        temporary = self.work / "work"
        temporary.mkdir()
        keep = temporary / "do-not-delete.mp4"
        keep.write_bytes(b"original")
        with self.assertRaisesRegex(ValueError, "标记"):
            self.call("clean")
        (temporary / ".duanju-promo-work").touch()
        plan = self.plan()
        plan["audio"] = [{"file": str(keep), "start": 0, "duration": 1}]
        runner.write_json(self.work / "plan.json", plan)
        with self.assertRaisesRegex(ValueError, "work目录"):
            self.call("clean")
        self.assertEqual(b"original", keep.read_bytes())

    def test_clean_rejects_junction_without_deleting_target(self):
        if os.name != "nt":
            self.skipTest("Windows junction check")
        target = self.root / "junction-target"
        target.mkdir()
        (target / ".duanju-promo-work").touch()
        keep = target / "keep.txt"
        keep.write_text("keep", encoding="utf-8")
        junction = self.work / "work"
        subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(target)], check=True, capture_output=True)
        try:
            with self.assertRaisesRegex(ValueError, "联接"):
                self.call("clean")
            self.assertEqual("keep", keep.read_text(encoding="utf-8"))
        finally:
            # Exact, already inspected junction; rmdir removes only the link.
            os.rmdir(junction)

    def test_cli_emits_one_json_and_errors_exit_nonzero(self):
        with self.assertRaisesRegex(ValueError, "不加载NarratoAI业务模块"):
            runner.promo.export({}, {}, str(self.work), str(self.root / "must-not-create-a-draft"))
        request = self.work / "request.json"
        runner.write_json(request, {"action": "validate", "workDir": str(self.work), "data": {"plan": self.plan()},
                                    "ffmpegPath": self.ffmpeg, "ffprobePath": self.ffprobe})
        process = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(runner.__file__)), "--request", str(request)],
                                 capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(0, process.returncode, process.stderr)
        self.assertEqual(30, json.loads(process.stdout)["frames"])
        runner.write_json(request, {"action": "export", "workDir": str(self.work)}, replace=True)
        failed = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(runner.__file__)), "--request", str(request)],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(0, failed.returncode)
        self.assertEqual("", failed.stdout)
        self.assertFalse(json.loads(failed.stderr)["final_completed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
