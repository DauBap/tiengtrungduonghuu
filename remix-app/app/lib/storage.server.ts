import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";

export type AssetKind = "workbook-image" | "lesson-audio";

export interface SaveAssetOptions {
  kind: AssetKind;
  lessonId?: string;
  sectionId?: string;
  questionId?: string;
  speakerId?: string;
}

const uploadsPrefix = "/uploads";

export function getUploadsDirectory() {
  return path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
}

function mimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".aac": "audio/aac",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
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
  if (options.kind === "lesson-audio" && !file.type.startsWith("audio/")) return null;

  const folder =
    options.kind === "lesson-audio"
      ? path.join("audio", "lessons", options.lessonId || "lesson")
      : path.join("images", "workbooks", options.lessonId || "lesson");
  const extension = path.extname(file.name).replace(/[^a-z0-9.]/gi, "") || ".bin";
  const pathname = path.join(folder, `${randomUUID()}${extension}`).split(path.sep).join("/");
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

export async function serveStoredAsset(request: Request, storedUrl: string) {
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
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": mimeType(filePath),
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
