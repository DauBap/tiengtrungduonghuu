import json
import logging
import math
import os
import struct
import tempfile
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit


HOST = "127.0.0.1"
PORT = 8766
MAX_TEXT_LENGTH = 2_000
MAX_REQUEST_BYTES = 64 * 1024
SPEECH_SPEED = float(os.environ.get("MELO_SPEED", "0.85"))
LOGGER = logging.getLogger("melotts")
TARGET_PEAK = 10 ** (-1 / 20)


def normalize_wav_peak(audio_path):
    with wave.open(str(audio_path), "rb") as wav_file:
        params = wav_file.getparams()
        if params.comptype != "NONE":
            raise RuntimeError("MeloTTS generated a compressed WAV file")
        sample_width = params.sampwidth
        frames = wav_file.readframes(params.nframes)

    if sample_width not in (1, 2, 3, 4):
        raise RuntimeError("MeloTTS generated an unsupported PCM sample width")
    if not frames or len(frames) % sample_width:
        raise RuntimeError("MeloTTS generated an invalid PCM WAV file")

    if sample_width == 1:
        samples = [sample - 128 for sample in frames]
    elif sample_width == 3:
        samples = [
            int.from_bytes(frames[offset:offset + 3], "little", signed=True)
            for offset in range(0, len(frames), 3)
        ]
    else:
        code = "<h" if sample_width == 2 else "<i"
        samples = [
            sample[0]
            for sample in struct.iter_unpack(code, frames)
        ]

    peak = max(abs(sample) for sample in samples)
    if peak == 0:
        raise RuntimeError("MeloTTS generated silent audio")

    positive_peak = (1 << (sample_width * 8 - 1)) - 1
    negative_peak = -(1 << (sample_width * 8 - 1))
    gain = TARGET_PEAK * positive_peak / peak
    if gain == 1.0:
        return

    adjusted = bytearray()
    for sample in samples:
        scaled = round(sample * gain)
        scaled = max(negative_peak, min(positive_peak, scaled))
        if sample_width == 1:
            adjusted.append(scaled + 128)
        elif sample_width == 3:
            adjusted.extend(scaled.to_bytes(3, "little", signed=True))
        else:
            adjusted.extend(struct.pack("<h" if sample_width == 2 else "<i", scaled))

    with wave.open(str(audio_path), "wb") as wav_file:
        wav_file.setparams(params)
        wav_file.writeframes(adjusted)


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

        voice = payload.get("voice", "ZH") if isinstance(payload, dict) else "ZH"
        speed = payload.get("speed", SPEECH_SPEED) if isinstance(payload, dict) else SPEECH_SPEED
        if voice != "ZH":
            self._send_json(400, {"error": "Unsupported MeloTTS Chinese voice"})
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

        audio_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
                audio_path = Path(audio_file.name)

            self.model.tts_to_file(
                text,
                self.speaker_id,
                str(audio_path),
                speed=float(speed),
                quiet=True,
            )
            normalize_wav_peak(audio_path)
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
