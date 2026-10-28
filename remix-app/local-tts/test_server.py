import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path

from server import MeloTTSHandler


class FakeModel:
    def __init__(self):
        self.request = None

    def tts_to_file(self, text, speaker_id, output_path, speed, quiet):
        self.request = (text, speaker_id, speed, quiet)
        Path(output_path).write_bytes(b"RIFF-test-wave")


class MeloTTSHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = FakeModel()
        MeloTTSHandler.model = cls.model
        MeloTTSHandler.speaker_id = 7
        cls.server = HTTPServer(("127.0.0.1", 0), MeloTTSHandler)
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

    def test_synthesis_returns_wav_and_uses_chinese_speaker(self):
        request = urllib.request.Request(
            self.base_url + "/synthesize",
            data=json.dumps({"text": "你好"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "audio/wav")
            self.assertEqual(response.read(), b"RIFF-test-wave")
        self.assertEqual(self.model.request, ("你好", 7, 0.85, True))

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
