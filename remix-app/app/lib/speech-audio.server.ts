import { createHash } from "node:crypto";
import { prisma } from "~/lib/prisma.server";
import {
  readCachedSpeechAudio,
  removeCachedSpeechAudio,
  replaceCachedSpeechAudio,
  writeCachedSpeechAudio,
} from "~/lib/storage.server";

const ENGINE = "melotts";
const MODEL_VERSION = "myshell-ai/MeloTTS@209145371cff8fc3bd60d7be902ea69cbdb7965a";
const SPEAKER = "ZH";
const SPEED = 0.85;
const MELO_TTS_URL = process.env.MELO_TTS_URL ?? "http://127.0.0.1:8766/synthesize";
const KOKORO_ENGINE = "kokoro";
const KOKORO_MODEL_VERSION = "hexgrad/Kokoro-82M@v1.0";
const KOKORO_SPEAKER = "zf_xiaobei";
const KOKORO_SPEED = 0.85;
const KOKORO_TTS_URL = process.env.KOKORO_TTS_URL ?? "http://127.0.0.1:8767/synthesize";

export type SpeechAudioProvider = "melo" | "kokoro";

type CacheOperation =
  | { kind: "synthesis"; promise: Promise<Buffer> }
  | { kind: "deletion"; promise: Promise<void> };

const activeOperations = new Map<string, CacheOperation>();

function getProviderSettings(provider: SpeechAudioProvider) {
  return provider === "kokoro"
    ? {
      engine: KOKORO_ENGINE,
      modelVersion: KOKORO_MODEL_VERSION,
      speaker: KOKORO_SPEAKER,
      speed: KOKORO_SPEED,
    }
    : { engine: ENGINE, modelVersion: MODEL_VERSION, speaker: SPEAKER, speed: SPEED };
}

function getProviderFromEngine(engine: string): SpeechAudioProvider {
  if (engine === KOKORO_ENGINE) return "kokoro";
  if (engine === ENGINE) return "melo";
  throw new Error(`Unsupported speech audio engine: ${engine}`);
}

export function getSpeechAudioCacheKey(text: string, provider: SpeechAudioProvider = "melo") {
  const settings = getProviderSettings(provider);
  return createHash("sha256")
    .update(JSON.stringify({ ...settings, text }))
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

async function synthesizeSpeechAudio(text: string, provider: SpeechAudioProvider) {
  const endpoint = provider === "kokoro" ? KOKORO_TTS_URL : MELO_TTS_URL;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`${provider} returned HTTP ${response.status}`);
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/wav")) {
    throw new Error(`${provider} returned an unsupported audio type`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!isWavAudio(audio)) {
    throw new Error(`${provider} returned an invalid WAV file`);
  }
  return audio;
}

async function generateAndStoreSpeechAudio(
  text: string,
  cacheKey: string,
  replace: boolean,
  provider: SpeechAudioProvider,
) {
  const audio = await synthesizeSpeechAudio(text, provider);
  const providerSettings = getProviderSettings(provider);
  const filePath = replace
    ? await replaceCachedSpeechAudio(cacheKey, audio)
    : await writeCachedSpeechAudio(cacheKey, audio);
  const storedAudio = await readCachedSpeechAudio(cacheKey);
  if (!isWavAudio(storedAudio)) {
    throw new Error(`Cached TTS file is not a valid WAV file: ${cacheKey}`);
  }
  await prisma.speechAudioCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      text,
      ...providerSettings,
      filePath,
    },
    update: {
      text,
      ...providerSettings,
      filePath,
      updatedAt: new Date(),
    },
  });
  return audio;
}

export async function hasCachedSpeechAudio(text: string, provider: SpeechAudioProvider = "melo") {
  const cacheKey = getSpeechAudioCacheKey(text, provider);
  const cachedRecord = await prisma.speechAudioCache.findUnique({ where: { cacheKey } });
  if (cachedRecord && cachedRecord.filePath !== `/uploads/audio/tts/${cacheKey}.wav`) {
    throw new Error(`TTS cache path does not match cache key ${cacheKey}`);
  }
  return Boolean(await readValidCachedFile(cacheKey));
}

async function getOrCreateSpeechAudioUncached(
  text: string,
  cacheKey: string,
  provider: SpeechAudioProvider,
) {
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
    const providerSettings = getProviderSettings(provider);
    await prisma.speechAudioCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        text,
        ...providerSettings,
        filePath: `/uploads/audio/tts/${cacheKey}.wav`,
      },
      update: {},
    });
    return orphanedAudio;
  }

  return generateAndStoreSpeechAudio(text, cacheKey, false, provider);
}

export function getOrCreateSpeechAudio(
  text: string,
  provider: SpeechAudioProvider = "melo",
): Promise<Buffer> {
  const cacheKey = getSpeechAudioCacheKey(text, provider);
  const activeOperation = activeOperations.get(cacheKey);
  if (activeOperation) {
    if (activeOperation.kind === "synthesis") return activeOperation.promise;
    return activeOperation.promise.then(() => getOrCreateSpeechAudio(text, provider));
  }

  const request = getOrCreateSpeechAudioUncached(text, cacheKey, provider).finally(() => {
    if (activeOperations.get(cacheKey)?.promise === request) {
      activeOperations.delete(cacheKey);
    }
  });
  activeOperations.set(cacheKey, { kind: "synthesis", promise: request });
  return request;
}

export async function deleteSpeechAudioCache(cacheKey: string) {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Khóa cache TTS không hợp lệ");
  }

  const activeOperation = activeOperations.get(cacheKey);
  if (activeOperation) {
    if (activeOperation.kind === "synthesis") {
      await activeOperation.promise.catch(() => undefined);
      return deleteSpeechAudioCache(cacheKey);
    }
    await activeOperation.promise;
    return;
  }

  const deletion = (async () => {
    const record = await prisma.speechAudioCache.findUnique({ where: { cacheKey } });
    if (record && record.filePath !== `/uploads/audio/tts/${cacheKey}.wav`) {
      throw new Error(`TTS cache path does not match cache key ${cacheKey}`);
    }
    await removeCachedSpeechAudio(cacheKey);
    await prisma.speechAudioCache.deleteMany({ where: { cacheKey } });
  })();
  activeOperations.set(cacheKey, { kind: "deletion", promise: deletion });

  try {
    await deletion;
  } finally {
    if (activeOperations.get(cacheKey)?.promise === deletion) {
      activeOperations.delete(cacheKey);
    }
  }
}

export async function regenerateSpeechAudioCache(cacheKey: string) {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Khóa cache TTS không hợp lệ");
  }

  const activeOperation = activeOperations.get(cacheKey);
  if (activeOperation) {
    await activeOperation.promise.catch(() => undefined);
    return regenerateSpeechAudioCache(cacheKey);
  }

  const record = await prisma.speechAudioCache.findUnique({ where: { cacheKey } });
  if (!record) throw new Error("Không tìm thấy mục audio cần tạo lại");
  if (record.filePath !== `/uploads/audio/tts/${cacheKey}.wav`) {
    throw new Error(`TTS cache path does not match cache key ${cacheKey}`);
  }

  const concurrentOperation = activeOperations.get(cacheKey);
  if (concurrentOperation) {
    await concurrentOperation.promise.catch(() => undefined);
    return regenerateSpeechAudioCache(cacheKey);
  }

  const request = generateAndStoreSpeechAudio(
    record.text,
    cacheKey,
    true,
    getProviderFromEngine(record.engine),
  ).finally(() => {
    if (activeOperations.get(cacheKey)?.promise === request) {
      activeOperations.delete(cacheKey);
    }
  });
  activeOperations.set(cacheKey, { kind: "synthesis", promise: request });
  return request;
}
