import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getSpeechAudioCacheKey,
  isWavAudio,
} from "./speech-audio.server";
import {
  getCachedSpeechAudioFileInfo,
  readCachedSpeechAudio,
  replaceCachedSpeechAudio,
  writeCachedSpeechAudio,
} from "./storage.server";

test("speech audio cache keys are stable per text", () => {
  assert.equal(getSpeechAudioCacheKey("你好"), getSpeechAudioCacheKey("你好"));
  assert.notEqual(getSpeechAudioCacheKey("你好"), getSpeechAudioCacheKey("你好。"));
  assert.notEqual(
    getSpeechAudioCacheKey("你好", "melo"),
    getSpeechAudioCacheKey("你好", "kokoro"),
  );
  assert.notEqual(
    getSpeechAudioCacheKey("你好", "kokoro", { speaker: "zf_xiaobei", speed: 0.85 }),
    getSpeechAudioCacheKey("你好", "kokoro", { speaker: "zm_yunxi", speed: 0.85 }),
  );
  assert.notEqual(
    getSpeechAudioCacheKey("你好", "melo", { speaker: "ZH", speed: 0.85 }),
    getSpeechAudioCacheKey("你好", "melo", { speaker: "ZH", speed: 1 }),
  );
});

test("WAV validation checks RIFF and WAVE signatures", () => {
  assert.equal(isWavAudio(Buffer.from("RIFFxxxxWAVE")), true);
  assert.equal(isWavAudio(Buffer.from("not-a-wave")), false);
  assert.equal(isWavAudio(Buffer.from("RIFF")), false);
});

test("speech audio is stored under a deterministic uploads path", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "speech-audio-cache-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  const cacheKey = getSpeechAudioCacheKey("你好");
  const audio = Buffer.from("RIFFxxxxWAVE");
  const filePath = await writeCachedSpeechAudio(cacheKey, audio);

  assert.equal(filePath, `/uploads/audio/tts/${cacheKey}.wav`);
  assert.deepEqual(await readCachedSpeechAudio(cacheKey), audio);
  assert.deepEqual(await getCachedSpeechAudioFileInfo(cacheKey), { size: audio.length });
  const replacementAudio = Buffer.from("RIFFyyyyWAVE");
  await replaceCachedSpeechAudio(cacheKey, replacementAudio);
  assert.deepEqual(await readCachedSpeechAudio(cacheKey), replacementAudio);
  await assert.rejects(writeCachedSpeechAudio("../invalid", audio), /không hợp lệ/i);
});
