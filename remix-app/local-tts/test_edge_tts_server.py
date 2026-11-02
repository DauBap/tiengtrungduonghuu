import io
import json
import struct
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import HTTPServer
from subprocess import CompletedProcess
from unittest.mock import AsyncMock, patch

from edge_tts_server import EdgeTTSHandler, format_rate, is_wav_audio


def create_wav():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24_000)
        wav_file.writeframes(struct.pack("<hhhh", 1000, -1000, 500, -500))
    return output.getvalue()


class EdgeTTSHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), EdgeTTSHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:{}".format(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def post_json(self, payload):
        request = urllib.request.Request(
            self.base_url + "/synthesize",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return urllib.request.urlopen(request)

    def test_health_check(self):
        with urllib.request.urlopen(self.base_url + "/healthz") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"status": "ok"})

    def test_synthesis_converts_edge_audio_to_wav(self):
        wav = create_wav()
        fake_synthesis = AsyncMock(return_value=b"edge-mp3")
        fake_ffmpeg = CompletedProcess(
            args=["ffmpeg"],
            returncode=0,
            stdout=wav,
            stderr=b"",
        )
        with patch("edge_tts_server.synthesize_mp3", new=fake_synthesis):
            with patch("edge_tts_server.subprocess.run", return_value=fake_ffmpeg) as run:
                with self.post_json({
                    "text": "你好",
                    "voice": "zh-CN-YunxiNeural",
                    "speed": 1.1,
                }) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get_content_type(), "audio/wav")
                    self.assertEqual(response.read(), wav)

        self.assertEqual(
            fake_synthesis.await_args.args,
            ("你好", "zh-CN-YunxiNeural", "+10%"),
        )
        self.assertEqual(run.call_args.kwargs["input"], b"edge-mp3")

    def test_audio_validation_and_rate_conversion(self):
        self.assertTrue(is_wav_audio(create_wav()))
        self.assertFalse(is_wav_audio(b"not-a-wave"))
        self.assertEqual(format_rate(0.85), "-15%")
        self.assertEqual(format_rate(1.5), "+50%")

    def test_rejects_unsupported_voice(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post_json({"text": "你好", "voice": "unknown"})
        self.assertEqual(error.exception.code, 400)

    def test_rejects_invalid_speed(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post_json({"text": "你好", "speed": True})
        self.assertEqual(error.exception.code, 400)

    def test_reports_service_failure_without_returning_audio(self):
        with patch("edge_tts_server.synthesize_wav", side_effect=RuntimeError("unavailable")):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.post_json({"text": "你好"})
        self.assertEqual(error.exception.code, 503)
        self.assertEqual(
            json.loads(error.exception.read()),
            {"error": "Edge TTS is temporarily unavailable"},
        )


if __name__ == "__main__":
    unittest.main()
