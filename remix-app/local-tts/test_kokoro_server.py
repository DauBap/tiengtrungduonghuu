import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from types import SimpleNamespace
from unittest.mock import patch

from kokoro_server import KokoroTTSHandler


class FakePipeline:
    def __init__(self):
        self.request = None

    def __call__(self, text, voice, speed, split_pattern):
        self.request = (text, voice, speed, split_pattern)
        return iter([("你好", "ni hao", [0.0, 0.25, -0.25])])


class FakeSamples(list):
    @property
    def size(self):
        return len(self)

    def reshape(self, _shape):
        return self


class FakeNumpy:
    float32 = "float32"

    @staticmethod
    def asarray(samples, dtype):
        return FakeSamples(samples)

    @staticmethod
    def concatenate(chunks):
        return FakeSamples(sample for chunk in chunks for sample in chunk)


class FakeSoundFile:
    @staticmethod
    def write(output, samples, sample_rate, format, subtype):
        if sample_rate != 24_000 or format != "WAV" or subtype != "PCM_16":
            raise AssertionError("Unexpected WAV output configuration")
        output.write(b"RIFF-test-wave")


class KokoroTTSHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = FakePipeline()
        KokoroTTSHandler.pipeline = cls.pipeline
        cls.server = HTTPServer(("127.0.0.1", 0), KokoroTTSHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:{}".format(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_health_check(self):
        with urllib.request.urlopen(self.base_url + "/healthz") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"status": "ok"})

    def test_synthesis_returns_wav_and_uses_chinese_voice(self):
        request = urllib.request.Request(
            self.base_url + "/synthesize",
            data=json.dumps({"text": "你好"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        fake_modules = {
            "numpy": FakeNumpy,
            "soundfile": FakeSoundFile,
        }
        with patch.dict(sys.modules, fake_modules):
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), "audio/wav")
                self.assertEqual(response.read(), b"RIFF-test-wave")
        self.assertEqual(
            self.pipeline.request,
            ("你好", "zf_xiaobei", 0.85, r"\n+"),
        )

    def test_rejects_empty_text(self):
        request = urllib.request.Request(
            self.base_url + "/synthesize",
            data=json.dumps({"text": "  "}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
