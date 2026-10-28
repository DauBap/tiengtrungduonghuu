import json
import logging
import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit


HOST = "127.0.0.1"
PORT = 8766
MAX_TEXT_LENGTH = 2_000
MAX_REQUEST_BYTES = 64 * 1024
SPEECH_SPEED = 0.85
LOGGER = logging.getLogger("melotts")


class MeloTTSHandler(BaseHTTPRequestHandler):
    model = None
    speaker_id = None

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

        audio_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
                audio_path = Path(audio_file.name)

            self.model.tts_to_file(
                text,
                self.speaker_id,
                str(audio_path),
                speed=SPEECH_SPEED,
                quiet=True,
            )
            audio = audio_path.read_bytes()
            if not audio:
                raise RuntimeError("MeloTTS generated an empty audio file")
        except Exception:
            LOGGER.exception("Speech synthesis failed")
            self._send_json(503, {"error": "Speech synthesis is temporarily unavailable"})
            return
        finally:
            if audio_path is not None:
                audio_path.unlink(missing_ok=True)

        try:
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception:
            LOGGER.exception("Could not send generated audio")

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
    from melo.api import TTS

    torch.set_num_threads(int(os.environ.get("MELO_TORCH_THREADS", "4")))
    torch.set_num_interop_threads(1)
    LOGGER.info("Loading MeloTTS Chinese model on CPU")
    model = TTS(language="ZH", device="cpu")
    MeloTTSHandler.model = model
    MeloTTSHandler.speaker_id = model.hps.data.spk2id["ZH"]
    LOGGER.info("MeloTTS model loaded")

    server = HTTPServer((HOST, PORT), MeloTTSHandler)
    LOGGER.info("MeloTTS API listening on http://%s:%s", HOST, PORT)
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
