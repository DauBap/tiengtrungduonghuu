# Local SenseVoice API

The lesson pronunciation screen can send an existing recording to this API as an optional fallback when browser speech recognition does not work. The browser-recognition flow remains unchanged. The local API returns a transcript; the lesson page displays it and the script as ASCII Pinyin, compares their syllables, and lets the student submit through the existing scoring flow.

## Requirements

- Python 3.10-3.12.
- FFmpeg, including `ffprobe`, available on `PATH`.
- An HTTPS tunnel from Vercel to local port `8765` (for example, ngrok).
- FunASR downloads `iic/SenseVoiceSmall` on first startup and runs it with CPU-only PyTorch. No CUDA runtime or GPU is used.

Install FFmpeg on Windows if needed:

```powershell
winget install --id Gyan.FFmpeg.Shared --exact
```

## Install

From `remix-app/local-asr`, create a virtual environment and install the CPU-only dependencies.

Linux:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-cpu.txt
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-cpu.txt
```

The requirements pin PyTorch and torchaudio to CPU wheels. The SenseVoice model files are downloaded and cached by FunASR at first startup.

## Start the service

Linux:

```bash
test -f .asr-token || (umask 077 && openssl rand -hex 32 > .asr-token)
export ASR_TOKEN="$(<.asr-token)"
.venv/bin/python server.py
```

Windows PowerShell:

```powershell
./run.ps1
```

The Windows script creates a 48-byte random bearer token in `.asr-token` the first time it runs. Both commands start an API bound to `127.0.0.1:8765`. Keep the process open while using the feature. The service accepts audio up to 3 MB and 60 seconds, converts it to mono 16 kHz WAV, runs SenseVoice on CPU, and deletes temporary files after each request.

To check the service locally, use the token stored in `.asr-token`:

```powershell
$token = (Get-Content .\.asr-token -Raw).Trim()
Invoke-RestMethod http://127.0.0.1:8765/healthz -Headers @{ Authorization = "Bearer $token" }
```

On Linux, read the token with `cat .asr-token` and send it as a bearer token to the same endpoint.

## Connect Vercel

In a second PowerShell window, expose local port `8765` through an HTTPS tunnel:

```powershell
ngrok http 8765
```

Use the HTTPS forwarding origin printed by ngrok. Keep both the service and tunnel windows open while testing. Do not expose the Python server directly to the public network. Configure these server-side Vercel environment variables:

- `LOCAL_ASR_URL`: the tunnel's HTTPS origin, for example `https://your-domain.ngrok-free.app` (no `/transcribe` suffix).
- `LOCAL_ASR_TOKEN`: the exact token stored in `.asr-token`.

Redeploy after changing environment variables. The lesson action sends audio only from the authenticated server-side route, with the bearer token kept off the browser.

## API

- `GET /healthz` — bearer-token protected health check.
- `POST /transcribe` — bearer-token protected raw audio body. Set `Content-Type` to a supported audio MIME type (`audio/mp4`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/wav`, or `audio/aac`). Success response: `{"transcript":"..."}`.

The service intentionally binds only to loopback. The machine must stay online, awake, and connected to the tunnel for Vercel requests to succeed.
