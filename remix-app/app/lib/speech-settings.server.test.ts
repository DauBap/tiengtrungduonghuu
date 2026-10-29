import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getSpeechProviderSettings,
  saveSpeechProviderSettings,
} from "./speech-settings.server";
import { parseSpeechProviderSettings } from "./speech-settings";

test("speech provider settings default safely and persist validated values", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "speech-settings-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  assert.deepEqual(await getSpeechProviderSettings("kokoro"), {
    speaker: "zf_xiaobei",
    speed: 0.85,
  });

  await saveSpeechProviderSettings("kokoro", { speaker: "zm_yunxi", speed: "1.1" });
  assert.deepEqual(await getSpeechProviderSettings("kokoro"), {
    speaker: "zm_yunxi",
    speed: 1.1,
  });

  await saveSpeechProviderSettings("kokoro", { speaker: "zf_xiaoni", speed: 0.9 });
  assert.deepEqual(await getSpeechProviderSettings("kokoro"), {
    speaker: "zf_xiaoni",
    speed: 0.9,
  });

  const settingsFile = path.join(directory, ".config", "tts", "kokoro.json");
  assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), {
    speaker: "zf_xiaoni",
    speed: 0.9,
  });
  await assert.rejects(
    saveSpeechProviderSettings("kokoro", { speaker: "not-a-voice", speed: 0.85 }),
    /không hợp lệ/i,
  );
});

test("speech provider settings reject unsupported voices and out-of-range speeds", () => {
  assert.equal(parseSpeechProviderSettings("melo", "EN", 0.85), null);
  assert.equal(parseSpeechProviderSettings("kokoro", "zf_xiaobei", 2), null);
  assert.deepEqual(parseSpeechProviderSettings("melo", "ZH", "1.25"), {
    speaker: "ZH",
    speed: 1.25,
  });
});
