import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  removeCourseDocumentAsset,
  saveCourseDocumentMultipart,
  saveUploadedAsset,
  serveStoredAsset,
  validateCourseDocumentFile,
} from "./storage.server";

test("validates course document formats and MIME types", () => {
  assert.deepEqual(
    validateCourseDocumentFile(new File(["pdf"], "Tài liệu.PDF", { type: "application/pdf" })),
    {
      ok: true,
      fileName: "Tài liệu.pdf",
      extension: ".pdf",
      mimeType: "application/pdf",
    },
  );
  assert.equal(
    validateCourseDocumentFile(new File(["x"], "notes.exe", { type: "application/octet-stream" })).ok,
    false,
  );
  assert.equal(
    validateCourseDocumentFile(new File(["x"], "notes.pdf", { type: "image/png" })).ok,
    false,
  );
  assert.equal(validateCourseDocumentFile(new File([], "empty.pdf", { type: "application/pdf" })).ok, false);
});

test("stores, serves, and removes course documents from private upload storage", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "course-documents-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  const boundary = "course-document-test";
  async function* multipartBody() {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nupload\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lesson.pdf"\r\n` +
      "Content-Type: application/pdf\r\n\r\n",
    );
    yield Buffer.from("pdf-content");
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }

  const asset = await saveCourseDocumentMultipart(
    Readable.from(multipartBody()),
    `multipart/form-data; boundary=${boundary}`,
    "course-123",
  );
  assert.match(asset.fileUrl, /^\/uploads\/courses\/course-123\/documents\/[0-9a-f-]+\.pdf$/);
  const response = await serveStoredAsset(new Request("http://localhost"), asset.fileUrl, {
    cacheControl: "private, no-store",
    contentType: asset.mimeType,
  });
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await response.text(), "pdf-content");

  await removeCourseDocumentAsset(asset.fileUrl);
  await assert.rejects(
    serveStoredAsset(new Request("http://localhost"), asset.fileUrl),
    (error: unknown) => error instanceof Response && error.status === 404,
  );
  await assert.rejects(removeCourseDocumentAsset("/uploads/audio/lesson.mp3"), /không hợp lệ/);
  await removeCourseDocumentAsset("/uploads/course-documents/legacy.pdf");
});

test("streams an 80 MB course document without a size cap", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "large-course-document-"));
  const previousDirectory = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  const boundary = "large-course-document-test";
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  async function* multipartBody() {
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\nupload\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.pdf"\r\n` +
      "Content-Type: application/pdf\r\n\r\n",
    );
    for (let index = 0; index < 80; index += 1) yield chunk;
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }

  const asset = await saveCourseDocumentMultipart(
    Readable.from(multipartBody()),
    `multipart/form-data; boundary=${boundary}`,
    "course-123",
  );
  assert.equal(asset.fileSize, 80 * 1024 * 1024);
  await removeCourseDocumentAsset(asset.fileUrl);
});

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

test("serves legacy public audio files stored with an uploads URL", async () => {
  const response = await serveStoredAsset(
    new Request("http://localhost", { headers: { Range: "bytes=0-3" } }),
    "/uploads/audio/workbooks/hsk1/bai9.mp3",
  );

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.equal((await response.arrayBuffer()).byteLength, 4);
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
