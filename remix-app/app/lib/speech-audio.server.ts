import { createHash } from "node:crypto";
import { prisma } from "~/lib/prisma.server";
import {
  readCachedSpeechAudio,
  removeCachedSpeechAudio,
  writeCachedSpeechAudio,
} from "~/lib/storage.server";

const ENGINE = "melotts";
const MODEL_VERSION = "myshell-ai/MeloTTS@209145371cff8fc3bd60d7be902ea69cbdb7965a";
const SPEAKER = "ZH";
const SPEED = 0.85;
const MELO_TTS_URL = process.env.MELO_TTS_URL ?? "http://127.0.0.1:8766/synthesize";

const inFlight = new Map<string, Promise<Buffer>>();

export function getSpeechAudioCacheKey(text: string) {
  return createHash("sha256")
    .update(JSON.stringify({ engine: ENGINE, modelVersion: MODEL_VERSION, speaker: SPEAKER, speed: SPEED, text }))
    .digest("hex");
}

export function isWavAudio(audio: Uint8Array) {
  return audio.byteLength >= 12
    && audio[0] === 0x52
    && audio[1] === 0x49
    && audio[2] === 0x46
    && audio[3] === 0x46
    && audio[8] === 0x57
    && audio[9] === 0x41
    && audio[10] === 0x56
    && audio[11] === 0x45;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

async function readValidCachedFile(cacheKey: string) {
  try {
    const audio = await readCachedSpeechAudio(cacheKey);
    if (isWavAudio(audio)) return audio;
    await removeCachedSpeechAudio(cacheKey);
    return null;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function getOrCreateSpeechAudioUncached(text: string, cacheKey: string) {
  const cachedRecord = await prisma.speechAudioCache.findUnique({ where: { cacheKey } });
  if (cachedRecord) {
    if (cachedRecord.filePath !== `/uploads/audio/tts/${cacheKey}.wav`) {
      throw new Error(`TTS cache path does not match cache key ${cacheKey}`);
    }
    const cachedAudio = await readValidCachedFile(cacheKey);
    if (cachedAudio) return cachedAudio;
    await prisma.speechAudioCache.deleteMany({ where: { cacheKey } });
  }

  const orphanedAudio = await readValidCachedFile(cacheKey);
  if (orphanedAudio) {
    await prisma.speechAudioCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        text,
        engine: ENGINE,
        modelVersion: MODEL_VERSION,
        speaker: SPEAKER,
        speed: SPEED,
        filePath: `/uploads/audio/tts/${cacheKey}.wav`,
      },
      update: {},
    });
    return orphanedAudio;
  }

  const response = await fetch(MELO_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`MeloTTS returned HTTP ${response.status}`);
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/wav")) {
    throw new Error("MeloTTS returned an unsupported audio type");
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!isWavAudio(audio)) {
    throw new Error("MeloTTS returned an invalid WAV file");
  }
  const filePath = await writeCachedSpeechAudio(cacheKey, audio);
  const storedAudio = await readCachedSpeechAudio(cacheKey);
  if (!isWavAudio(storedAudio)) {
    throw new Error(`Cached TTS file is not a valid WAV file: ${cacheKey}`);
  }
  await prisma.speechAudioCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      text,
      engine: ENGINE,
      modelVersion: MODEL_VERSION,
      speaker: SPEAKER,
      speed: SPEED,
      filePath,
    },
    update: {},
  });
  return audio;
}

export function getOrCreateSpeechAudio(text: string) {
  const cacheKey = getSpeechAudioCacheKey(text);
  const existingRequest = inFlight.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = getOrCreateSpeechAudioUncached(text, cacheKey).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, request);
  return request;
}
