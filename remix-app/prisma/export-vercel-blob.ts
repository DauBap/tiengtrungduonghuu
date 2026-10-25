import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { list } from "@vercel/blob";

const token = process.env.BLOB_READ_WRITE_TOKEN;
const exportDirectory = process.env.BLOB_EXPORT_DIR;
const shouldDownload = process.argv.includes("--download");

if (!token) throw new Error("Thiếu BLOB_READ_WRITE_TOKEN");
if (!exportDirectory) throw new Error("Thiếu BLOB_EXPORT_DIR");

type BlobEntry = {
  pathname: string;
  url: string;
  size: number;
};

function resolveBlobPath(root: string, pathname: string) {
  const segments = pathname.split("/");
  if (
    !pathname ||
    pathname.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Blob pathname không an toàn: ${pathname}`);
  }

  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Blob pathname vượt khỏi thư mục export: ${pathname}`);
  }
  return target;
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function getBlobEntries() {
  const entries: BlobEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ token, cursor, limit: 1000 });
    entries.push(...page.blobs.map(({ pathname, url, size }) => ({ pathname, url, size })));
    cursor = page.cursor;
  } while (cursor);

  return entries;
}

async function downloadBlob(root: string, entry: BlobEntry) {
  const target = resolveBlobPath(root, entry.pathname);
  const temporary = `${target}.partial`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });

  try {
    const existing = await stat(target);
    if (existing.size === entry.size) {
      return {
        pathname: entry.pathname,
        size: existing.size,
        sha256: await hashFile(target),
      };
    }
    throw new Error(`File đích đã tồn tại nhưng kích thước khác: ${entry.pathname}`);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const response = await fetch(entry.url);
  if (!response.ok || !response.body) {
    throw new Error(`Không tải được ${entry.pathname}: HTTP ${response.status}`);
  }

  const hash = createHash("sha256");
  let bytes = 0;
  const hashTransform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(response.body, hashTransform, createWriteStream(temporary, { mode: 0o600 }));
    if (bytes !== entry.size) {
      throw new Error(
        `Kích thước tải về không khớp cho ${entry.pathname}: ${bytes} != ${entry.size}`,
      );
    }
    await rename(temporary, target);
    return { pathname: entry.pathname, size: bytes, sha256: hash.digest("hex") };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main() {
  const root = path.resolve(exportDirectory);
  const entries = await getBlobEntries();
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  console.log(
    `Tìm thấy ${entries.length} blob, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`,
  );

  if (!shouldDownload) {
    console.log("Chưa tải file. Chạy lại với --download để export.");
    return;
  }

  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const downloaded: Array<{ pathname: string; size: number; sha256: string }> = [];

  for (const [index, entry] of entries.entries()) {
    const result = await downloadBlob(root, entry);
    downloaded.push(result);
    console.log(`[${index + 1}/${entries.length}] ${entry.pathname}`);
  }

  const downloadedByPath = new Map(downloaded.map((entry) => [entry.pathname, entry]));
  const manifest = {
    exportedAt: new Date().toISOString(),
    totalBlobs: entries.length,
    totalBytes,
    entries: entries.map((entry) => {
      const downloadedEntry = downloadedByPath.get(entry.pathname);
      return {
        pathname: entry.pathname,
        url: entry.url,
        size: entry.size,
        sha256: downloadedEntry?.sha256 ?? null,
      };
    }),
  };
  const manifestPath = path.join(
    path.dirname(root),
    `${path.basename(root)}-manifest.json`,
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  console.log(`Export hoàn tất: ${root}`);
  console.log(`Manifest kiểm tra: ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
