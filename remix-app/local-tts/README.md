# Local MeloTTS service

The production app calls this CPU-only Chinese MeloTTS service through
`http://127.0.0.1:8766`. The service binds only to loopback and loads one model
at startup. It does not expose a public endpoint or log submitted text.

The app's `/api/tts` route requires an authenticated user. On first use, it
generates a WAV and caches it under `UPLOADS_DIR/audio/tts/`; PostgreSQL stores
the text, engine/model/voice settings, and file path. Later requests reuse that
file instead of running inference again. Requests for the same uncached text
within one app process share a single generation. If MeloTTS is unavailable,
the browser uses its built-in Chinese speech voice.

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

After deploying the app changes, test through the authenticated app and confirm
that a temporary MeloTTS outage falls back to the browser voice. Do not expose
port `8766` through the firewall or reverse proxy.

The application deployment must persist the configured `UPLOADS_DIR`, since
the database stores cache metadata while the WAV data lives on disk. After
pulling the application change to Ubuntu, run `npx prisma db push` from the
application directory before building and restarting the app.

Run the API unit tests without loading the model:

```bash
cd ~/apps/tiengtrungduonghuu/remix-app/local-tts
.venv/bin/python -m unittest test_server.py
```

## API

- `GET /healthz` returns `{"status":"ok"}` after the model has loaded.
- `POST /synthesize` accepts `{"text":"..."}` and returns WAV audio.
- Requests are limited to 2,000 text characters and 64 KiB.
- Generated speech is cached by text and MeloTTS configuration in the
  app's persistent uploads directory.
