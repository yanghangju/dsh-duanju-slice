"""Offline checks for the explicit Slice sources and deferred episode assets."""
import array
import shutil
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from PIL import Image

import runner
from test_runner import bundled_tools


class EpisodeIntakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parent = Path(__file__).resolve().parent
        # A normal directory inherits the workspace ACL on Windows, unlike mkdtemp's owner-only mode.
        cls.root = parent / ("episode-intake-" + uuid.uuid4().hex)
        cls.root.mkdir()
        cls.addClassCleanup(shutil.rmtree, runner.no_links(cls.root))
        cls.ffmpeg, cls.ffprobe = bundled_tools()
        cls.drama = cls.root / "剧集素材"
        folder = cls.drama / "第2集"
        (folder / "后段").mkdir(parents=True)
        cls.first, cls.second = folder / "片段2.webm", folder / "后段" / "片段10.m4v"
        runner.promo.run([cls.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i",
                          "color=red:s=128x72:r=17:d=0.45", "-c:v", "libvpx-vp9", cls.first])
        runner.promo.run([cls.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i",
                          "color=blue:s=54x96:r=24:d=0.7", "-itsoffset", "0.15", "-f", "lavfi", "-i",
                          "sine=frequency=660:sample_rate=44100:duration=0.45", "-c:v", "libx264", "-c:a", "aac", cls.second])
        cls.flat = cls.drama / "ep001.mp4"
        cls.single_webm = cls.drama / "第3集" / "全片.webm"
        cls.single_m4v = cls.drama / "第5集" / "全片.m4v"
        cls.unstaged = [cls.drama / "第4集" / "1.webm", cls.drama / "第4集" / "2.m4v"]
        cls.unmatched = cls.drama / "ep099.mp4"
        cls.outside = cls.root / "outside.mp4"
        for source, target in ((cls.second, cls.flat), (cls.first, cls.single_webm), (cls.second, cls.single_m4v),
                               (cls.first, cls.unstaged[0]), (cls.second, cls.unstaged[1]),
                               (cls.second, cls.unmatched), (cls.second, cls.outside)):
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        cls.script = cls.root / "台词.docx"
        paragraphs = ["第一集", "甲：等一下。", "第 二 话", "乙：再见。", "EP03", "甲：走吧。",
                      "第四集", "乙：等等。", "第五集", "甲：好的。", "第八集", "甲：无视频。"]
        with ZipFile(cls.script, "w") as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                             + "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in paragraphs) + "</w:body></w:document>")

    def setUp(self):
        self.work = self.root / (self._testMethodName + " 任务's") / "tmp"
        self.index_path = self.work / "index.json"
        self.sources = [{"number": number, "files": [str(file) for file in files]} for number, files in (
            (99, [self.unmatched]), (2, [self.first, self.second]), (1, [self.flat]), (5, [self.single_m4v]),
            (4, self.unstaged), (3, [self.single_webm]))]

    def call(self, action, data):
        return runner.execute({"action": action, "data": data, "workDir": str(self.work),
                               "scriptPath": str(self.script), "dramaDir": str(self.drama),
                               "ffmpegPath": self.ffmpeg, "ffprobePath": self.ffprobe})

    def index_episodes(self):
        return {episode["number"]: episode for episode in runner.promo.load_json(self.index_path)["episodes"]}

    def test_probe_only_then_selectively_stage_mixed_media(self):
        with patch.object(runner.promo, "run", wraps=runner.promo.run) as media:
            self.assertEqual(5, self.call("prepare", {"sources": self.sources})["episodes"])
        self.assertEqual(7, media.call_count)
        self.assertTrue(all(command[0] == self.ffprobe and "-count_frames" not in command
                            for call in media.call_args_list for command in call.args))
        pending = self.index_episodes()
        self.assertEqual([1, 2, 3, 4, 5], list(pending))
        self.assertEqual(["index.json"], [path.name for path in self.work.iterdir()])
        for number, file in ((1, self.flat), (3, self.single_webm), (5, self.single_m4v)):
            self.assertEqual(str(file), pending[number]["file"])
            self.assertNotIn("parts", pending[number])
            self.assertEqual(file.stat().st_mtime_ns, pending[number]["mtime_ns"])
        episode = pending[2]
        composite = Path(episode["file"])
        self.assertEqual(self.work / "assets" / "episodes" / "episode-2.mp4", composite)
        self.assertFalse(composite.exists())
        self.assertTrue(episode["duration_estimated"])
        self.assertAlmostEqual(sum(p["duration"] for p in episode["parts"]), episode["duration"])
        self.assertEqual([str(self.first), str(self.second)], [p["file"] for p in episode["parts"]])
        source_stats = [runner.promo.fingerprint(file) for file in (self.first, self.second)]

        def plan(number):
            return {"plan": {"segments": [{"kind": "picture", "episode": number, "start": 0, "end": 0.3, "volume": 0}]}}

        self.assertEqual(9, self.call("validate", plan(1))["frames"])
        with self.assertRaisesRegex(ValueError, "尚未合成"):
            self.call("validate", plan(2))
        with self.assertRaisesRegex(ValueError, "没有第99集"):
            self.call("stage_episodes", {"episodes": [2, 99]})
        self.assertFalse((self.work / "assets").exists())
        self.assertEqual({"index": str(self.index_path), "staged": []}, self.call("stage_episodes", {"episodes": [3, 5]}))
        self.assertFalse((self.work / "assets").exists())
        self.assertEqual({"index": str(self.index_path), "staged": [2]}, self.call("stage_episodes", {"episodes": [1, 2, 5]}))
        episodes = self.index_episodes()
        staged = episodes[2]
        self.assertEqual(pending[4], episodes[4])
        self.assertFalse(Path(episodes[4]["file"]).exists())
        self.assertTrue(staged["staged"])
        self.assertFalse(staged["duration_estimated"])
        self.assertEqual(str(composite), staged["file"])
        identity = runner.promo.fingerprint(composite)
        self.assertEqual(identity, {key: staged[key] for key in identity})
        self.assertEqual(source_stats, [runner.promo.fingerprint(file) for file in (self.first, self.second)])
        self.assertEqual([composite], list(composite.parent.iterdir()))
        self.assertEqual([], self.call("stage_episodes", {"episodes": [1, 2]})["staged"])
        self.assertEqual(identity, runner.promo.fingerprint(composite))
        self.assertEqual(9, self.call("validate", plan(2))["frames"])

        first, second = staged["parts"]
        self.assertEqual([str(self.first), str(self.second)], [first["file"], second["file"]])
        self.assertEqual((0, first["target_end"], staged["duration"]), (first["target_start"], second["target_start"], second["target_end"]))
        for part in (first, second):
            self.assertAlmostEqual(part["source_end"] - part["source_start"], part["target_end"] - part["target_start"])
        timeline = runner.promo.video_frames(composite, self.ffprobe)
        self.assertAlmostEqual(timeline["frames"] / 30, staged["duration"])
        self.assertEqual({"width": 1080, "height": 1920, "has_audio": True}, {key: staged[key] for key in ("width", "height", "has_audio")})
        for part, dominant in ((first, 0), (second, 2)):
            frame = self.work / f"frame-{dominant}.png"
            runner.promo.run([self.ffmpeg, "-v", "error", "-n", "-ss", part["target_start"] + 0.2,
                              "-i", composite, "-frames:v", "1", frame])
            with Image.open(frame) as image:
                middle, top = image.getpixel((540, 960)), image.getpixel((540, 50))
                self.assertGreater(middle[dominant], 150)
                if dominant == 0:
                    self.assertLess(max(top), 10)
                else:
                    self.assertGreater(top[dominant], 150)
        for n, (start, audible) in enumerate(((0.1, False), (second["target_start"] + 0.01, False), (second["target_start"] + 0.3, True))):
            track = self.work / f"audio-{n}.wav"
            runner.promo.run([self.ffmpeg, "-v", "error", "-n", "-ss", start, "-i", composite,
                              "-t", "0.06", "-map", "0:a:0", "-c:a", "pcm_s16le", track])
            with wave.open(str(track), "rb") as stream:
                self.assertEqual((48000, 2), (stream.getframerate(), stream.getnchannels()))
                samples = array.array("h", stream.readframes(stream.getnframes()))
            self.assertEqual(audible, max(map(abs, samples)) > 50)
        self.call("stage_episodes", {"episodes": [2]})
        self.call("clean", {})
        self.assertEqual(identity, runner.promo.fingerprint(composite))
        self.assertEqual([2], [e["number"] for e in self.index_episodes().values() if e.get("staged")])
        with composite.open("ab") as stream:
            stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "素材已改变"):
            self.call("stage_episodes", {"episodes": [1]})

    def test_source_ranges_preserve_original_video_start_offset(self):
        media = self.drama / "offset.mkv"
        runner.promo.run([self.ffmpeg, "-v", "error", "-n", "-f", "lavfi", "-i",
                          "sine=frequency=660:sample_rate=44100:duration=0.75", "-itsoffset", "0.17", "-f", "lavfi", "-i",
                          "color=blue:s=54x96:r=24:d=0.5", "-map", "1:v:0", "-map", "0:a:0", "-fps_mode", "passthrough",
                          "-c:v", "libx264", "-c:a", "pcm_s16le", media])
        self.call("prepare", {"sources": [{"number": 2, "files": [str(self.first), str(media)]}]})
        self.call("stage_episodes", {"episodes": [2]})
        episode = self.index_episodes()[2]
        part = episode["parts"][1]
        self.assertAlmostEqual(0.167, part["source_start"], places=3)
        self.assertAlmostEqual(0.667, part["source_end"], places=3)
        self.assertAlmostEqual(0.5, part["target_end"] - part["target_start"])
        self.assertAlmostEqual(episode["duration"], part["target_end"])

    def test_invalid_supplied_sources_are_rejected(self):
        single = self.sources[2]
        cases = (None, [], {}, [single, single], [dict(single, number=True)], [dict(single, number=0)],
                 [dict(single, number=1.0)], [dict(single, files=[])], [dict(single, files="ep001.mp4")],
                 [dict(single, files=["ep001.mp4"])], [dict(single, files=[str(self.outside)])],
                 [dict(single, files=[str(self.drama / "missing.webm")])],
                 [single, dict(single, number=2)], [dict(single, files=single["files"] * 2)], [self.sources[0]])
        for sources in cases:
            with self.subTest(sources=sources), self.assertRaises(ValueError):
                self.call("prepare", {"sources": sources})
            self.assertFalse(self.index_path.exists())

    def test_original_fingerprint_is_required_even_without_materialized_episode(self):
        # Use independent files; other tests never see these mutations.
        folder = self.drama / "identity"
        folder.mkdir()
        copies = [Path(shutil.copy2(file, folder)) for file in (self.first, self.second)]
        self.call("prepare", {"sources": [{"number": 2, "files": list(map(str, copies))}]})
        before = self.index_path.read_bytes()
        with copies[0].open("ab") as stream:
            stream.write(b"modified")
        with self.assertRaisesRegex(ValueError, "素材已改变"):
            self.call("stage_episodes", {"episodes": [2]})
        self.assertEqual(before, self.index_path.read_bytes())
        self.assertFalse((self.work / "assets").exists())

    def test_failed_index_commit_leaves_no_published_media(self):
        self.call("prepare", {"sources": self.sources})
        before = self.index_path.read_bytes()

        def mock_encode(episode, target, *_):
            target.write_bytes(b"example")
            return {**episode, "staged": True}

        with patch.object(runner.promo, "stage_episode", side_effect=mock_encode), patch.object(runner, "write_json", side_effect=OSError("simulated commit error")):
            with self.assertRaisesRegex(OSError, "simulated commit error"):
                self.call("stage_episodes", {"episodes": [4, 2]})
        self.assertEqual(before, self.index_path.read_bytes())
        self.assertEqual([], list((self.work / "assets" / "episodes").iterdir()))


if __name__ == "__main__":
    unittest.main()
