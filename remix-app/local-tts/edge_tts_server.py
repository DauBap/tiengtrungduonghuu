import asyncio
import json
import logging
import math
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


HOST = "127.0.0.1"
PORT = int(os.environ.get("EDGE_TTS_PORT", "8768"))
MAX_TEXT_LENGTH = 2_000
MAX_REQUEST_BYTES = 64 * 1024
MAX_MP3_BYTES = 20 * 1024 * 1024
MAX_SYNTHESIS_SECONDS = 45
MAX_CONVERSION_SECONDS = 30
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
SUPPORTED_VOICES = {
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-XiaoxuanNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunyangNeural",
}
LOGGER = logging.getLogger("edge_tts")


def is_wav_audio(audio):
    return (
        len(audio) >= 12
        and audio[:4] == b"RIFF"
        and audio[8:12] == b"WAVE"
    )


def format_rate(speed):
    return "{:+d}%".format(round((speed - 1) * 100))


async def synthesize_mp3(text, voice, rate):
    import edge_tts

    communicator = edge_tts.Communicate(text, voice, rate=rate)
    chunks = []
    total_bytes = 0
    async for chunk in communicator.stream():
        if chunk.get("type") != "audio":
            continue
        audio = chunk.get("data", b"")
        total_bytes += len(audio)
        if total_bytes > MAX_MP3_BYTES:
            raise RuntimeError("Edge TTS audio exceeded the size limit")
        chunks.append(audio)

    if not chunks:
        raise RuntimeError("Edge TTS returned no audio")
    return b"".join(chunks)


def convert_mp3_to_wav(audio):
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "mp3",
            "-i",
            "pipe:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "pipe:1",
        ],
        input=audio,
        capture_output=True,
        timeout=MAX_CONVERSION_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("ffmpeg could not convert Edge TTS audio")
    if not is_wav_audio(result.stdout):
        raise RuntimeError("ffmpeg returned an invalid WAV file")
    return result.stdout


def synthesize_wav(text, voice, speed):
    mp3 = asyncio.run(
        asyncio.wait_for(
            synthesize_mp3(text, voice, format_rate(speed)),
            timeout=MAX_SYNTHESIS_SECONDS,
        )
    )
    return convert_mp3_to_wav(mp3)


class EdgeTTSHandler(BaseHTTPRequestHandler):
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

        if content_length <= 0:
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

        voice = payload.get("voice", DEFAULT_VOICE)
        speed = payload.get("speed", 0.85)
        if not isinstance(voice, str) or voice not in SUPPORTED_VOICES:
            self._send_json(400, {"error": "Unsupported Edge TTS Chinese voice"})
            return
        try:
            numeric_speed = float(speed)
        except (TypeError, ValueError, OverflowError):
            self._send_json(400, {"error": "Speed must be between 0.5 and 1.5"})
            return
        if (
            isinstance(speed, bool)
            or not isinstance(speed, (int, float))
            or not math.isfinite(numeric_speed)
            or numeric_speed < 0.5
            or numeric_speed > 1.5
        ):
            self._send_json(400, {"error": "Speed must be between 0.5 and 1.5"})
            return

        try:
            audio = synthesize_wav(text, voice, numeric_speed)
        except Exception:
            LOGGER.exception("Edge TTS synthesis failed")
            self._send_json(503, {"error": "Edge TTS is temporarily unavailable"})
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
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    server = ThreadingHTTPServer((HOST, PORT), EdgeTTSHandler)
    LOGGER.info("Edge TTS service listening on %s:%s", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
