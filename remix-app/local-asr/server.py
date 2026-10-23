import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


MAX_AUDIO_BYTES = 3_000_000
MAX_AUDIO_SECONDS = 60
MAX_CONCURRENT_REQUESTS = 2
REQUEST_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)
MIME_EXTENSIONS = {
    "audio/aac": ".aac",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/x-m4a": ".m4a",
    "audio/webm": ".webm",
    "video/mp4": ".m4a",
}


def required_path(name: str) -> Path:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required setting: {name}")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise RuntimeError(f"{name} does not point to a file")
    return path


ASR_TOKEN = os.environ.get("ASR_TOKEN", "")
if len(ASR_TOKEN) < 32:
    raise RuntimeError("ASR_TOKEN must contain at least 32 characters")

SENSEVOICE_EXE = required_path("SENSEVOICE_EXE")
SENSEVOICE_MODEL = required_path("SENSEVOICE_MODEL")
FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
if not FFMPEG or not Path(FFMPEG).is_file():
    raise RuntimeError("FFMPEG_PATH must point to an installed ffmpeg executable")
if not FFPROBE or not Path(FFPROBE).is_file():
    raise RuntimeError("FFPROBE_PATH must point to an installed ffprobe executable")

BACKEND = os.environ.get("SENSEVOICE_BACKEND", "cuda")
if BACKEND not in {"cpu", "cuda", "vulkan"}:
    raise RuntimeError("SENSEVOICE_BACKEND must be cpu, cuda, or vulkan")


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class ASRHandler(BaseHTTPRequestHandler):
    server_version = "LocalSenseVoice/1.0"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(30)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        expected = f"Bearer {ASR_TOKEN}"
        return hmac.compare_digest(authorization.encode(), expected.encode())

    def do_GET(self) -> None:
        if urlparse(self.path).path != "/healthz":
            self._send_json(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._send_json(401, {"error": "Unauthorized"})
            return
        self._send_json(200, {"status": "ok"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/transcribe":
            self._send_json(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._send_json(401, {"error": "Unauthorized"})
            return
        if not REQUEST_SLOTS.acquire(timeout=2):
            self._send_json(503, {"error": "ASR server is busy. Try again shortly."})
            return

        try:
            self._transcribe()
        finally:
            REQUEST_SLOTS.release()

    def _transcribe(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send_json(411, {"error": "Content-Length is required"})
            return
        if content_length < 1 or content_length > MAX_AUDIO_BYTES:
            self._send_json(413, {"error": "Audio must be between 1 byte and 3 MB"})
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        extension = MIME_EXTENSIONS.get(content_type)
        if not extension:
            self._send_json(415, {"error": "Unsupported audio format"})
            return

        started_at = time.monotonic()
        try:
            audio_bytes = self.rfile.read(content_length)
            if len(audio_bytes) != content_length:
                self._send_json(400, {"error": "Incomplete audio upload"})
                return

            with tempfile.TemporaryDirectory(prefix="sensevoice-") as temp_dir:
                input_path = Path(temp_dir) / f"recording{extension}"
                wav_path = Path(temp_dir) / "converted.wav"
                input_path.write_bytes(audio_bytes)

                probe = subprocess.run(
                    [
                        str(FFPROBE),
                        "-v", "error",
                        "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1",
                        str(input_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if probe.returncode != 0:
                    self._send_json(422, {"error": "Audio file could not be read"})
                    return
                try:
                    duration = float(probe.stdout.strip())
                except ValueError:
                    self._send_json(422, {"error": "Audio duration could not be determined"})
                    return
                if duration <= 0 or duration > MAX_AUDIO_SECONDS:
                    self._send_json(413, {"error": "Audio must be no longer than 60 seconds"})
                    return

                converted = subprocess.run(
                    [
                        str(FFMPEG),
                        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(input_path),
                        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                        str(wav_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if converted.returncode != 0 or not wav_path.is_file():
                    print(f"[asr] audio conversion failed with exit code {converted.returncode}: {converted.stderr[-2000:]}", flush=True)
                    self._send_json(422, {"error": "Audio could not be converted for recognition"})
                    return

                result = subprocess.run(
                    [
                        str(SENSEVOICE_EXE),
                        "-m", str(SENSEVOICE_MODEL),
                        "-a", str(wav_path),
                        "--backend", BACKEND,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=45,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if result.returncode != 0:
                    print(f"[asr] inference failed with exit code {result.returncode}: {result.stderr[-2000:]}", flush=True)
                    self._send_json(502, {"error": "Speech recognition failed"})
                    return

                transcript = re.sub(r"<\|[^|]+\|>", "", result.stdout).strip()
                if not transcript:
                    self._send_json(422, {"error": "No speech was recognized"})
                    return

                elapsed_ms = round((time.monotonic() - started_at) * 1000)
                print(f"[asr] transcribed {duration:.1f}s in {elapsed_ms}ms", flush=True)
                self._send_json(200, {"transcript": transcript})
        except subprocess.TimeoutExpired:
            print("[asr] audio processing timed out", flush=True)
            self._send_json(504, {"error": "Audio processing timed out"})
        except OSError as error:
            print(f"[asr] local processing error: {error}", flush=True)
            self._send_json(500, {"error": "Local audio processing failed"})

    def log_message(self, format: str, *args) -> None:
        print(f"[http] {self.address_string()} {format % args}", flush=True)


def main() -> None:
    host = os.environ.get("ASR_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("ASR_HOST must remain loopback-only; expose it through an authenticated tunnel")
    port = int(os.environ.get("ASR_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), ASRHandler)
    print(f"SenseVoice API listening on http://{host}:{port}", flush=True)
    print("Audio is processed in temporary files and deleted after each request.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SenseVoice API.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
