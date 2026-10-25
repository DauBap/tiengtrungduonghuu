import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const applyChanges = process.argv.includes("--apply");
const uploadsDirectory = process.env.UPLOADS_DIR;
const manifestPath = process.env.BLOB_EXPORT_MANIFEST;
const prisma = new PrismaClient();

type Manifest = {
  entries: Array<{ pathname: string; size: number; sha256: string | null }>;
};

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
};

type PendingUpdate = {
  tableName: string;
  columnName: string;
  rowId: string;
  dataType: string;
  value: unknown;
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function urlForPath(pathname: string) {
  const segments = pathname.split("/");
  if (
    !pathname ||
    pathname.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Blob pathname không an toàn trong manifest: ${pathname}`);
  }
  return `/uploads/${segments.map(encodeURIComponent).join("/")}`;
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function loadManifest() {
  if (!uploadsDirectory) throw new Error("Thiếu UPLOADS_DIR");
  const resolvedUploads = path.resolve(uploadsDirectory);
  const resolvedManifest =
    manifestPath ||
    path.join(path.dirname(resolvedUploads), `${path.basename(resolvedUploads)}-manifest.json`);
  const parsed = JSON.parse(await readFile(resolvedManifest, "utf8")) as Manifest;
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Manifest không có danh sách blob hợp lệ");
  }

  const paths = new Map<string, string>();
  for (const entry of parsed.entries) {
    if (!entry.sha256 || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Manifest thiếu checksum hoặc kích thước hợp lệ: ${entry.pathname}`);
    }
    const urlPath = urlForPath(entry.pathname);
    const target = path.resolve(resolvedUploads, ...entry.pathname.split("/"));
    const relative = path.relative(resolvedUploads, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Blob pathname vượt khỏi thư mục uploads: ${entry.pathname}`);
    }
    const fileStat = await stat(target);
    if (!fileStat.isFile() || fileStat.size !== entry.size) {
      throw new Error(`File export thiếu hoặc sai kích thước: ${entry.pathname}`);
    }
    if ((await sha256(target)) !== entry.sha256) {
      throw new Error(`Checksum không khớp: ${entry.pathname}`);
    }
    paths.set(entry.pathname, urlPath);
  }
  console.log(`Đã xác minh checksum của ${paths.size} file trong manifest.`);
  return paths;
}

function replaceBlobUrls(value: unknown, paths: Map<string, string>): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const blobUrlPattern = /https?:\/\/[^\s"'<>]+\.blob\.vercel-storage\.com\/[^\s"'<>]*/gi;
    let changed = false;
    const next = value.replace(blobUrlPattern, (blobUrl) => {
      let parsed: URL;
      try {
        parsed = new URL(blobUrl);
      } catch {
        throw new Error(`URL Blob không hợp lệ trong dữ liệu: ${blobUrl}`);
      }
      const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
      const localUrl = paths.get(pathname);
      if (!localUrl) {
        throw new Error(`Không có file trong manifest cho Blob URL: ${blobUrl}`);
      }
      changed = true;
      return localUrl;
    });
    return { value: next, changed };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceBlobUrls(item, paths);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = replaceBlobUrls(item, paths);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

async function main() {
  const paths = await loadManifest();
  const columns = await prisma.$queryRaw<Column[]>`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
    ORDER BY table_name, ordinal_position
  `;
  const updates: PendingUpdate[] = [];

  for (const column of columns) {
    const table = quoteIdentifier(column.table_name);
    const field = quoteIdentifier(column.column_name);
    const candidates = await prisma.$queryRawUnsafe<Array<{ row_id: string; value: unknown }>>(
      `SELECT ctid::text AS row_id, ${field} AS value FROM ${table} WHERE ${field}::text ILIKE '%blob.vercel-storage.com%'`,
    );
    for (const row of candidates) {
      const result = replaceBlobUrls(row.value, paths);
      if (result.changed) {
        updates.push({
          tableName: column.table_name,
          columnName: column.column_name,
          rowId: row.row_id,
          dataType: column.data_type,
          value: result.value,
        });
      }
    }
  }

  const byColumn = new Map<string, number>();
  for (const update of updates) {
    const key = `${update.tableName}.${update.columnName}`;
    byColumn.set(key, (byColumn.get(key) ?? 0) + 1);
  }
  console.log(`${applyChanges ? "Sẽ cập nhật" : "Xem trước"} ${updates.length} ô dữ liệu:`);
  for (const [column, count] of byColumn) console.log(`  ${column}: ${count}`);

  if (!applyChanges) {
    console.log("Chưa thay đổi database. Chạy lại với --apply sau khi đã backup database.");
    return;
  }

  await prisma.$transaction(
    async (transaction) => {
      for (const update of updates) {
        const table = quoteIdentifier(update.tableName);
        const field = quoteIdentifier(update.columnName);
        const valueCast = update.dataType === "json" ? "::json" : update.dataType === "jsonb" ? "::jsonb" : "";
        const value =
          update.dataType === "json" || update.dataType === "jsonb"
            ? JSON.stringify(update.value)
            : update.value;
        const affectedRows = await transaction.$executeRawUnsafe(
          `UPDATE ${table} SET ${field} = $1${valueCast} WHERE ctid = $2::tid`,
          value,
          update.rowId,
        );
        if (affectedRows !== 1) {
          throw new Error(
            `Không cập nhật được chính xác một hàng tại ${update.tableName}.${update.columnName}`,
          );
        }
      }
    },
    { timeout: 300_000 },
  );
  console.log(`Đã cập nhật ${updates.length} ô dữ liệu.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
