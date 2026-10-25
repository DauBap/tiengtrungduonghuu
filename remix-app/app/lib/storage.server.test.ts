import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveUploadedAsset, serveStoredAsset } from "./storage.server";

test("saves local uploads and serves byte ranges for audio", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-assets-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  const url = await saveUploadedAsset(
    new File(["audio-data"], "lesson.mp3", { type: "audio/mpeg" }),
    { kind: "lesson-audio", lessonId: "lesson-1" },
  );
  assert.ok(url);
  assert.match(url, /^\/uploads\/audio\/lessons\/lesson-1\/[0-9a-f-]+\.mp3$/);

  const response = await serveStoredAsset(
    new Request("http://localhost", { headers: { Range: "bytes=0-4" } }),
    url,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-4/10");
  assert.equal(await response.text(), "audio");
});

test("rejects paths escaping the uploads directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-assets-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  try {
    await assert.rejects(
      serveStoredAsset(new Request("http://localhost"), "/uploads/%2e%2e%2fsecret.txt"),
      (error: unknown) => error instanceof Response && error.status === 404,
    );
  } finally {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
