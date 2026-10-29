import json
import logging
import math
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
from urllib.parse import urlsplit


HOST = "127.0.0.1"
PORT = 8767
MAX_TEXT_LENGTH = 2_000
MAX_REQUEST_BYTES = 64 * 1024
SAMPLE_RATE = 24_000
VOICE = os.environ.get("KOKORO_VOICE", "zf_xiaobei")
SPEECH_SPEED = float(os.environ.get("KOKORO_SPEED", "0.85"))
VOICES = {
    "zf_xiaobei",
    "zf_xiaoni",
    "zf_xiaoxiao",
    "zf_xiaoyi",
    "zm_yunjian",
    "zm_yunxi",
    "zm_yunxia",
    "zm_yunyang",
}
LOGGER = logging.getLogger("kokoro")


class KokoroTTSHandler(BaseHTTPRequestHandler):
    pipeline = None

    def do_GET(self):
        if urlsplit(self.path).path == "/healthz":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if urlsplit(self.path).path != "/synthesize":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_json(400, {"error": "Invalid Content-Length"})
            return

        if content_length < 0:
            self._send_json(400, {"error": "Invalid Content-Length"})
            return
        if content_length > MAX_REQUEST_BYTES:
            self._send_json(413, {"error": "Request too large"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "Invalid JSON"})
            return

        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str):
            self._send_json(400, {"error": "Text is required"})
            return
        text = text.strip()
        if not text or len(text) > MAX_TEXT_LENGTH:
            self._send_json(400, {"error": "Text must be between 1 and 2000 characters"})
            return

        voice = payload.get("voice", VOICE) if isinstance(payload, dict) else VOICE
        speed = payload.get("speed", SPEECH_SPEED) if isinstance(payload, dict) else SPEECH_SPEED
        if not isinstance(voice, str) or voice not in VOICES:
            self._send_json(400, {"error": "Unsupported Kokoro Mandarin voice"})
            return
        if (
            isinstance(speed, bool)
            or not isinstance(speed, (int, float))
            or not math.isfinite(speed)
            or speed < 0.5
            or speed > 1.5
        ):
            self._send_json(400, {"error": "Speed must be between 0.5 and 1.5"})
            return

        try:
            audio = self._synthesize(text, voice, float(speed))
        except Exception:
            LOGGER.exception("Speech synthesis failed")
            self._send_json(503, {"error": "Speech synthesis is temporarily unavailable"})
            return

        try:
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception:
            LOGGER.exception("Could not send generated audio")

    def _synthesize(self, text, voice, speed):
        import numpy as np
        import soundfile as sf

        chunks = []
        for _, _, audio in self.pipeline(
            text,
            voice=voice,
            speed=speed,
            split_pattern=r"\n+",
        ):
            if audio is None:
                continue
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            samples = np.asarray(audio, dtype=np.float32).reshape(-1)
            if samples.size:
                chunks.append(samples)

        if not chunks:
            raise RuntimeError("Kokoro generated no audio samples")

        output = BytesIO()
        sf.write(
            output,
            np.concatenate(chunks),
            SAMPLE_RATE,
            format="WAV",
            subtype="PCM_16",
        )
        audio_bytes = output.getvalue()
        if not audio_bytes:
            raise RuntimeError("Kokoro generated an empty WAV file")
        return audio_bytes

    def _send_json(self, status, payload):
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format_string, *args):
        LOGGER.info("%s - %s", self.address_string(), format_string % args)


def main():
    import torch
    from kokoro import KPipeline

    torch.set_num_threads(int(os.environ.get("KOKORO_TORCH_THREADS", "4")))
    torch.set_num_interop_threads(1)
    LOGGER.info("Loading Kokoro Mandarin model on CPU")
    KokoroTTSHandler.pipeline = KPipeline(lang_code="z", device="cpu")
    LOGGER.info("Kokoro model loaded with voice %s", VOICE)

    server = HTTPServer((HOST, PORT), KokoroTTSHandler)
    LOGGER.info("Kokoro API listening on http://%s:%s", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    main()
