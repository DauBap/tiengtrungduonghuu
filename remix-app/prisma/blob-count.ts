import { list } from "@vercel/blob";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("Thiếu BLOB_READ_WRITE_TOKEN");

let cursor: string | undefined;
let count = 0;
let bytes = 0;
do {
  const page = await list({ token, cursor, limit: 1000, prefix: "audio/" });
  count += page.blobs.length;
  for (const b of page.blobs) bytes += b.size;
  cursor = page.cursor;
} while (cursor);

console.log(`Blob đã upload: ${count} file, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
