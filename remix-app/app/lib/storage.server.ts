import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { COURSE_DOCUMENT_MAX_BYTES } from "~/lib/course-documents";

export type AssetKind = "workbook-image" | "lesson-audio" | "vocab-audio";

export interface SaveAssetOptions {
  kind: AssetKind;
  lessonId?: string;
  sectionId?: string;
  questionId?: string;
  speakerId?: string;
}

const courseDocumentMimeTypes: Record<string, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type CourseDocumentFileValidation =
  | { ok: true; fileName: string; extension: string; mimeType: string }
  | { ok: false; error: string };

export function validateCourseDocumentFile(file: File | null): CourseDocumentFileValidation {
  if (!file || !file.name) return { ok: false, error: "Vui lòng chọn tệp tài liệu." };
  if (file.size === 0) return { ok: false, error: "Tệp đang trống, vui lòng chọn tệp khác." };
  if (file.size > COURSE_DOCUMENT_MAX_BYTES) {
    return { ok: false, error: "Tệp vượt quá giới hạn 25 MB." };
  }

  const sourceName = file.name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const sourceExtension = path.extname(sourceName).toLowerCase();
  const mimeType = courseDocumentMimeTypes[sourceExtension];
  if (!mimeType) {
    return { ok: false, error: "Chỉ nhận PDF, Word, Excel, PowerPoint và ảnh JPG, PNG, GIF, WEBP." };
  }

  const suppliedMimeType = file.type.toLowerCase();
  if (suppliedMimeType && suppliedMimeType !== "application/octet-stream" && suppliedMimeType !== mimeType) {
    return { ok: false, error: "Định dạng tệp không khớp với phần mở rộng." };
  }

  const baseName = path.basename(sourceName, path.extname(sourceName))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180);
  return {
    ok: true,
    fileName: `${baseName || "Tai lieu"}${sourceExtension}`,
    extension: sourceExtension,
    mimeType,
  };
}

export async function saveCourseDocumentAsset(
  file: File,
  validation: Extract<CourseDocumentFileValidation, { ok: true }>,
  courseId: string,
) {
  if (!/^[A-Za-z0-9_-]+$/.test(courseId)) {
    throw new Error("Mã khóa học không hợp lệ");
  }

  const fileName = `${randomUUID()}${validation.extension}`;
  const relativePath = path.join("courses", courseId, "documents", fileName);
  const destination = path.resolve(getUploadsDirectory(), relativePath);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  await writeFile(destination, Buffer.from(await file.arrayBuffer()), { mode: 0o640, flag: "wx" });

  return {
    fileName: validation.fileName,
    fileUrl: `${uploadsPrefix}/${relativePath.split(path.sep).join("/")}`,
    fileSize: file.size,
    mimeType: validation.mimeType,
  };
}

export async function removeCourseDocumentAsset(storedUrl: string) {
  const filePath = safeStoredPath(storedUrl);
  const relativePath = path.relative(getUploadsDirectory(), filePath);
  const segments = relativePath.split(path.sep);
  const isLegacyCourseDocument = segments.length === 2 && segments[0] === "course-documents";
  const isCourseDocument =
    segments.length === 4 &&
    segments[0] === "courses" &&
    /^[A-Za-z0-9_-]+$/.test(segments[1]) &&
    segments[2] === "documents";
  if (!isLegacyCourseDocument && !isCourseDocument) {
    throw new Error("Đường dẫn tài liệu khóa học không hợp lệ");
  }
  await rm(filePath, { force: true });
}

const uploadsPrefix = "/uploads";
const speechCacheDirectory = path.join("audio", "tts");

function getSpeechCacheFilePath(cacheKey: string) {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Khóa cache TTS không hợp lệ");
  }
  return path.join(getUploadsDirectory(), speechCacheDirectory, `${cacheKey}.wav`);
}

export async function readCachedSpeechAudio(cacheKey: string) {
  return readFile(getSpeechCacheFilePath(cacheKey));
}

export async function getCachedSpeechAudioFileInfo(cacheKey: string) {
  try {
    const file = await stat(getSpeechCacheFilePath(cacheKey));
    if (!file.isFile()) return null;
    return { size: file.size };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeCachedSpeechAudio(cacheKey: string, audio: Uint8Array) {
  return storeCachedSpeechAudio(cacheKey, audio, false);
}

export async function replaceCachedSpeechAudio(cacheKey: string, audio: Uint8Array) {
  return storeCachedSpeechAudio(cacheKey, audio, true);
}

async function storeCachedSpeechAudio(cacheKey: string, audio: Uint8Array, replace: boolean) {
  const destination = getSpeechCacheFilePath(cacheKey);
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o750 });

  const temporaryPath = path.join(directory, `.${cacheKey}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, audio, { mode: 0o640, flag: "wx" });
  try {
    if (replace) {
      await rename(temporaryPath, destination);
    } else {
      try {
        await link(temporaryPath, destination);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return `${uploadsPrefix}/${speechCacheDirectory.split(path.sep).join("/")}/${cacheKey}.wav`;
}

export async function removeCachedSpeechAudio(cacheKey: string) {
  await rm(getSpeechCacheFilePath(cacheKey), { force: true });
}

export function getUploadsDirectory() {
  return path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
}

function mimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".aac": "audio/aac",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".webp": "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

function safeStoredPath(storedUrl: string) {
  let pathname: string;
  try {
    pathname = storedUrl.startsWith("/")
      ? new URL(storedUrl, "http://localhost").pathname
      : new URL(storedUrl).pathname;
  } catch {
    throw new Response("Đường dẫn tệp không hợp lệ", { status: 404 });
  }

  if (!pathname.startsWith(`${uploadsPrefix}/`)) {
    const segments = pathname.split("/").filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
      throw new Response("Không tìm thấy tệp", { status: 404 });
    }
    pathname = `${uploadsPrefix}/${segments.join("/")}`;
  }

  const relativePath = pathname.slice(uploadsPrefix.length + 1);
  const segments = relativePath.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new Response("Đường dẫn tệp không hợp lệ", { status: 404 });
    }
  });
  if (
    !relativePath ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    throw new Response("Không tìm thấy tệp", { status: 404 });
  }

  const root = getUploadsDirectory();
  const filePath = path.resolve(root, ...segments);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Response("Không tìm thấy tệp", { status: 404 });
  }
  return filePath;
}

export async function saveUploadedAsset(
  file: File | null,
  options: SaveAssetOptions,
): Promise<string | null> {
  if (!file || !file.name) return null;

  if (options.kind === "workbook-image" && !file.type.startsWith("image/")) return null;
  if (
    (options.kind === "lesson-audio" || options.kind === "vocab-audio")
    && !file.type.startsWith("audio/")
  ) return null;

  const folder =
    options.kind === "lesson-audio"
      ? path.join("audio", "lessons", options.lessonId || "lesson")
      : options.kind === "vocab-audio"
        ? path.join("audio", "vocab", options.lessonId || "lesson")
        : path.join("images", "workbooks", options.lessonId || "lesson");
  const sourceName = file.name.replace(/\\/g, "/").split("/").pop() || "audio";
  const sourceExtension = path.extname(sourceName);
  const extension = sourceExtension.replace(/[^a-z0-9.]/gi, "") || ".bin";
  const fileName =
    options.kind === "vocab-audio"
      ? `${path.basename(sourceName, sourceExtension).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120) || "audio"}${extension}`
      : `${randomUUID()}${extension}`;
  const uniqueFolder =
    options.kind === "vocab-audio" ? path.join(folder, randomUUID()) : folder;
  const pathname = path.join(uniqueFolder, fileName).split(path.sep).join("/");
  const uploadsDirectory = getUploadsDirectory();
  const destination = path.resolve(uploadsDirectory, pathname);
  const relative = path.relative(uploadsDirectory, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Đường dẫn lưu tệp vượt khỏi thư mục uploads");
  }

  await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(destination, bytes, { mode: 0o640, flag: "wx" });
  return `${uploadsPrefix}/${pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export async function serveStoredAsset(
  request: Request,
  storedUrl: string,
  options: { cacheControl?: string; contentType?: string } = {},
) {
  let filePath = safeStoredPath(storedUrl);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      const relativePath = path.relative(getUploadsDirectory(), filePath);
      if (!relativePath.startsWith(`audio${path.sep}`)) {
        throw new Response("Không tìm thấy tệp", { status: 404 });
      }
      filePath = path.resolve(process.cwd(), "public", relativePath);
      try {
        fileStat = await stat(filePath);
      } catch (fallbackError) {
        if (
          fallbackError &&
          typeof fallbackError === "object" &&
          "code" in fallbackError &&
          fallbackError.code === "ENOENT"
        ) {
          throw new Response("Không tìm thấy tệp", { status: 404 });
        }
        throw fallbackError;
      }
    }
    else throw error;
  }
  if (!fileStat.isFile()) throw new Response("Không tìm thấy tệp", { status: 404 });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": options.cacheControl ?? "public, max-age=31536000, immutable",
    "Content-Type": options.contentType ?? mimeType(filePath),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  });
  const range = request.headers.get("Range");
  let start = 0;
  let end = fileStat.size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      throw new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileStat.size}` } });
    }
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    } else {
      const suffixLength = Number(match[2]);
      start = Math.max(fileStat.size - suffixLength, 0);
    }
    if (start > end || start >= fileStat.size) {
      throw new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileStat.size}` } });
    }
    end = Math.min(end, fileStat.size - 1);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
  }

  const contentLength = fileStat.size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(contentLength));
  const body =
    request.method === "HEAD" || contentLength === 0
      ? null
      : Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(body, { status, headers });
}
