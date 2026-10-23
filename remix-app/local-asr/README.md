# Local SenseVoice API

The lesson pronunciation screen can send an existing recording to this API as an optional fallback when browser speech recognition does not work. The browser-recognition flow remains unchanged. The local API returns a transcript; the lesson page displays it and the script as ASCII Pinyin, compares their syllables, and lets the student submit through the existing scoring flow.

## Requirements

- Windows with the SenseVoice runtime and model in `E:\SenseVoiceLocal`:
  - `runtime\llama-funasr-sensevoice.exe`
  - `sensevoice-small-q8.gguf`
- Python 3.10 or newer; the service uses only the Python standard library.
- FFmpeg, including `ffprobe`, available on `PATH`.
- An HTTPS tunnel from Vercel to local port `8765` (for example, ngrok).

Install FFmpeg on Windows if needed:

```powershell
winget install --id Gyan.FFmpeg.Shared --exact
```

## Start the service

From PowerShell:

```powershell
.\remix-app\local-asr\run.ps1
```

The script creates a 48-byte random bearer token at `E:\SenseVoiceLocal\asr-token.txt` the first time it runs, then starts an API bound to `127.0.0.1:8765`. Keep the window open while using the feature. The service accepts audio up to 3 MB and 60 seconds, converts it to mono 16 kHz WAV, runs SenseVoice, and deletes temporary files after each request.

To check the service locally, use the same token from `asr-token.txt`:

```powershell
$token = (Get-Content E:\SenseVoiceLocal\asr-token.txt -Raw).Trim()
Invoke-RestMethod http://127.0.0.1:8765/healthz -Headers @{ Authorization = "Bearer $token" }
```

## Connect Vercel

In a second PowerShell window, expose local port `8765` through an HTTPS tunnel:

```powershell
ngrok http 8765
```

Use the HTTPS forwarding origin printed by ngrok. Keep both the service and tunnel windows open while testing. Do not expose the Python server directly to the public network. Configure these server-side Vercel environment variables:

- `LOCAL_ASR_URL`: the tunnel's HTTPS origin, for example `https://your-domain.ngrok-free.app` (no `/transcribe` suffix).
- `LOCAL_ASR_TOKEN`: the exact token stored in `E:\SenseVoiceLocal\asr-token.txt`.

Redeploy after changing environment variables. The lesson action sends audio only from the authenticated server-side route, with the bearer token kept off the browser.

## API

- `GET /healthz` — bearer-token protected health check.
- `POST /transcribe` — bearer-token protected raw audio body. Set `Content-Type` to a supported audio MIME type (`audio/mp4`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/wav`, or `audio/aac`). Success response: `{"transcript":"..."}`.

The service intentionally binds only to loopback. The machine must stay online, awake, and connected to the tunnel for Vercel requests to succeed.
