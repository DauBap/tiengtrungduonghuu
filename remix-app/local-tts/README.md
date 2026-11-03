# Speech synthesis services

The default `/api/tts` provider is Microsoft Edge online TTS, served through a
local adapter at `http://127.0.0.1:8768`. Edge TTS returns MP3; the adapter
converts it to WAV with `ffmpeg`, then the app stores the WAV and its provider,
voice, speed, and cache key. Repeated requests use the cached file without
calling the online service again. The adapter binds only to loopback and does
not log submitted text. A first-generation error is reported to the learner;
the app does not silently substitute a browser voice.

Admins can pre-generate vocabulary audio from **Admin → Audio TTS → Tạo cache từ vựng**.
The batch deduplicates Chinese terms, processes one term at a time, skips existing
Edge cache entries, and can be paused or retried. Keep the page open while it runs;
if it is closed, starting again skips audio already cached. Vocabulary playback uses
Edge cache when available; while an uncached term is being generated, its existing
recording is played when available.

The production app can also call this CPU-only Chinese MeloTTS service through
`http://127.0.0.1:8766`. MeloTTS remains available as a legacy provider and
continues to use its existing WAV cache entries.

The app's `/api/tts` route requires an authenticated user. On first use, it
generates a WAV and caches it under `UPLOADS_DIR/audio/tts/`; PostgreSQL stores
the text, engine/model/voice settings, and file path. Requests for the same
uncached text within one app process share a single generation. Existing Melo
and Kokoro service deployments are not replaced by the Edge adapter.

## Edge TTS service on Ubuntu

Edge TTS uses the third-party `edge-tts` Python client to reach Microsoft's
online speech service. It is not a self-hosted model: initial generation needs
outbound Internet access and depends on that service being available. Cached
audio remains playable if the online service later becomes unavailable.

Install `ffmpeg` and create an isolated Python 3.11 environment:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg

cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
uv python install 3.11
uv venv --python 3.11 edge-venv
uv pip install --python edge-venv/bin/python -r requirements-edge.txt
```

Install and start the user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/apps/tiengtrungduonghuu/remix-app/local-tts/tiengtrung-edge-tts.service \
  ~/.config/systemd/user/tiengtrung-edge-tts.service
systemctl --user daemon-reload
systemctl --user enable --now tiengtrung-edge-tts.service
```

Confirm the service is running and bound locally:

```bash
systemctl --user status tiengtrung-edge-tts.service --no-pager -l
journalctl --user -u tiengtrung-edge-tts.service -n 50 --no-pager
curl --fail --silent --show-error http://127.0.0.1:8768/healthz
```

Do not expose port `8768` through the firewall or reverse proxy. The default
application endpoint is `http://127.0.0.1:8768/synthesize`; set `EDGE_TTS_URL`
only if the adapter runs at a different private address. Admins can choose the
Edge voice and speed under **Admin → Audio AI → Cấu hình giọng**. A setting
change affects future cache entries only and does not replace existing audio.

Run the adapter unit tests without making an online TTS request:

```bash
cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
edge-venv/bin/python -m unittest test_edge_tts_server.py
```

## Install on Ubuntu

MeloTTS's documented environment is Python 3.9. Use a separate Python 3.9
virtual environment; do not install its dependencies into the system Python or
the SenseVoice environment. This server uses CPU inference because no NVIDIA
GPU is present.

Install `uv` using its official instructions if it is not already available:
<https://docs.astral.sh/uv/getting-started/installation/>.

Install the system audio/build libraries:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libsndfile1
```

Clone the tested MeloTTS source revision outside the application repository:

```bash
git clone https://github.com/myshell-ai/MeloTTS.git ~/apps/MeloTTS
git -C ~/apps/MeloTTS checkout 209145371cff8fc3bd60d7be902ea69cbdb7965a
```

From `~/apps/tiengtrungduonghuu/remix-app`, create an isolated Python 3.9
environment and install CPU-only PyTorch plus MeloTTS dependencies:

```bash
uv python install 3.9
uv venv --python 3.9 local-tts/.venv

uv pip install --python local-tts/.venv/bin/python \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.5.1+cpu torchaudio==2.5.1+cpu
uv pip install --python local-tts/.venv/bin/python \
  --constraint local-tts/constraints.txt 'setuptools<81'
grep -v -E '^(torch|torchaudio)$' ~/apps/MeloTTS/requirements.txt \
  > /tmp/melotts-requirements.txt
uv pip install --python local-tts/.venv/bin/python \
  --constraint local-tts/constraints.txt -r /tmp/melotts-requirements.txt
uv pip install --python local-tts/.venv/bin/python \
  --no-deps -e ~/apps/MeloTTS
local-tts/.venv/bin/python -m unidic download
```

The constraints pin a mutually compatible AWS SDK set. The MeloTTS dependency
resolver may otherwise select an old `botocore` version that prevents
`cached_path` from importing.

Warm the Chinese model cache once before enabling the service. This downloads
the model from the official MeloTTS model source:

```bash
cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
HF_HOME="$HOME/.cache/huggingface" .venv/bin/python -c \
  'import torch; torch.set_num_threads(4); from melo.api import TTS; TTS(language="ZH", device="cpu")'
```

Install and start the user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/apps/tiengtrungduonghuu/remix-app/local-tts/tiengtrung-melotts.service \
  ~/.config/systemd/user/tiengtrung-melotts.service
systemctl --user daemon-reload
systemctl --user enable --now tiengtrung-melotts.service
```

Check model/service startup and the local health endpoint:

```bash
systemctl --user status tiengtrung-melotts.service --no-pager -l
journalctl --user -u tiengtrung-melotts.service -n 50 --no-pager
curl --fail --silent --show-error http://127.0.0.1:8766/healthz
```

After deploying the app changes, test through the authenticated app. A
temporary Edge TTS outage must show an error without switching to the browser
voice; existing cached files should still play. MeloTTS legacy requests may
continue to fall back to the browser voice. Do not expose port `8766` through
the firewall or reverse proxy.

MeloTTS output is peak-normalized to approximately `-1 dBFS` before it is sent
to the app and cached, which raises quiet generations without clipping. This
only applies to newly generated audio. To replace a quiet cached sentence, open
**Admin → Audio AI → Audio cache**, search for the sentence, delete its cache,
then play it again so the normalized version is generated.

The admin **Audio AI → Cấu hình giọng** page can preview and save a voice and
speed for each model. MeloTTS's Chinese model currently exposes only the `ZH`
speaker; Kokoro offers the Mandarin voices listed in the admin selector. The
supported speed range is `0.5`–`1.5`. Saved settings are written to
`$UPLOADS_DIR/.config/tts/` (or `uploads/.config/tts/` when `UPLOADS_DIR` is
unset), so keep that directory persistent and shared by the app process. The
preview endpoint generates a temporary response and does not add it to the
audio cache. Saving settings affects future synthesis only; existing cached
audio remains unchanged. No database migration is needed for these settings.

The application deployment must persist the configured `UPLOADS_DIR`, since
the database stores cache metadata while the WAV data lives on disk. When an
application revision changes the Prisma schema, run `npx prisma db push` from
the application directory before building and restarting the app. The admin
voice-settings feature itself does not change the database schema.

Run the API unit tests without loading the model:

```bash
cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
.venv/bin/python -m unittest test_server.py
```

## Optional Kokoro service for vocabulary audio

The vocabulary flashcards and vocabulary table can use a separate Kokoro
service. Listening questions continue using MeloTTS at port `8766`. Kokoro
runs in its own CPU-only virtual environment on loopback port `8767`, so it
does not replace or stop the existing MeloTTS service.

Kokoro's Mandarin voice data can be weaker for very short utterances. Test
single-character words, multi-character words, and short phrases before
switching student traffic. The default voice is `zf_xiaobei`; change
`KOKORO_VOICE` in the user service if another Mandarin voice sounds better.

The Kokoro model is Apache-licensed. Keep its license and attribution notices
when redistributing the model or derived materials.

### Install on Ubuntu

Run these commands on the Ubuntu production host after deploying the app
revision that contains `kokoro_server.py`. This leaves the MeloTTS virtual
environment and systemd service untouched.

Install the runtime libraries and create an isolated Python 3.11 environment:

```bash
sudo apt-get update
sudo apt-get install -y espeak-ng libsndfile1

cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
uv python install 3.11
uv venv --python 3.11 kokoro-venv
uv pip install --python kokoro-venv/bin/python \
  --index-url https://download.pytorch.org/whl/cpu \
  torch
uv pip install --python kokoro-venv/bin/python \
  -r requirements-kokoro.txt
```

Download and warm the Mandarin model and voice once. This generates a short
sample WAV in `/tmp` so it can be listened to before enabling the service:

```bash
HF_HOME="$HOME/.cache/huggingface" kokoro-venv/bin/python - <<'PY'
import numpy as np
import soundfile as sf
import torch
from kokoro import KPipeline

torch.set_num_threads(4)
pipeline = KPipeline(lang_code="z", device="cpu")
chunks = [
    audio
    for _, _, audio in pipeline("你好。谢谢。", voice="zf_xiaobei", speed=0.85)
    if audio is not None
]
if not chunks:
    raise RuntimeError("Kokoro did not generate any audio")
sf.write("/tmp/kokoro-zh-test.wav", np.concatenate(chunks), 24_000)
print("Wrote /tmp/kokoro-zh-test.wav")
PY
```

Install and start the separate user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/apps/tiengtrungduonghuu/remix-app/local-tts/tiengtrung-kokoro.service \
  ~/.config/systemd/user/tiengtrung-kokoro.service
systemctl --user daemon-reload
systemctl --user enable --now tiengtrung-kokoro.service
```

Check startup and the local health endpoint:

```bash
systemctl --user status tiengtrung-kokoro.service --no-pager -l
journalctl --user -u tiengtrung-kokoro.service -n 50 --no-pager
curl --fail --silent --show-error http://127.0.0.1:8767/healthz
```

Do not expose port `8767` through the firewall or reverse proxy. After
deploying the app code, the `/api/tts` route sends vocabulary requests to
Kokoro and listening requests to MeloTTS. If Kokoro is unavailable, the client
falls back to the browser's Chinese voice. Stop Kokoro without affecting Melo:

```bash
systemctl --user disable --now tiengtrung-kokoro.service
```

## API

- `GET /healthz` returns `{"status":"ok"}` after the model has loaded.
- `POST /synthesize` accepts `{"text":"...","voice":"ZH","speed":0.85}` and
  returns WAV audio. `voice` and `speed` are optional for backward compatibility.
- Requests are limited to 2,000 text characters and 64 KiB.
- Generated speech is cached by text and provider/model/voice configuration in the
  app's persistent uploads directory.
- The Kokoro service uses the same health and synthesis paths on port `8767`.

After pulling updates to the Python service scripts, restart each enabled
user service so it loads the updated request validation and voice/speed support:

```bash
systemctl --user restart tiengtrung-melotts.service
systemctl --user restart tiengtrung-kokoro.service
```
