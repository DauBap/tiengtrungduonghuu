import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";
import { PrismaClient, Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioRoot = path.join(root, "public", "audio");
const token = process.env.BLOB_READ_WRITE_TOKEN;
const databaseUrl = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;

if (!token) throw new Error("Thiếu BLOB_READ_WRITE_TOKEN");
if (!databaseUrl) throw new Error("Thiếu TARGET_DATABASE_URL hoặc DATABASE_URL");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

type AudioFile = { absolutePath: string; relativePath: string; oldUrl: string; blobUrl: string };

async function walk(dir: string, prefix = ""): Promise<AudioFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: AudioFile[] = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, relativePath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) {
      files.push({
        absolutePath,
        relativePath,
        oldUrl: `/audio/${relativePath}`,
        blobUrl: "",
      });
    }
  }
  return files;
}

function decodeAudioUrl(value: string) {
  try {
    return decodeURIComponent(new URL(value, "https://local.invalid").pathname);
  } catch {
    return value.split("?")[0];
  }
}

function replaceAudio(value: unknown, mapping: Map<string, string>): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const decoded = decodeAudioUrl(value);
    const replacement = mapping.get(decoded);
    return replacement ? { value: replacement, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceAudio(item, mapping);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = replaceAudio(item, mapping);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

async function main() {
  const files = await walk(audioRoot);
  const mapping = new Map<string, string>();
  console.log(`${APPLY ? "Uploading" : "Previewing"} ${files.length} MP3 files`);

  for (const file of files) {
    const key = `audio/${file.relativePath}`;
    if (APPLY) {
      const uploaded = await put(key, await fs.readFile(file.absolutePath), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
        contentType: "audio/mpeg",
      });
      file.blobUrl = uploaded.url;
    } else {
      file.blobUrl = `https://blob.invalid/${key}`;
    }
    mapping.set(file.oldUrl, file.blobUrl);
  }

  if (!APPLY) {
    console.log("Dry run complete. Add --apply to upload and update the database.");
    return;
  }

  let updated = 0;
  const [scripts, vocab, sentences, blocks] = await Promise.all([
    prisma.lessonAudioScript.findMany({ select: { id: true, audioUrl: true } }),
    prisma.vocabItem.findMany({ select: { id: true, audioUrl: true } }),
    prisma.sentenceItem.findMany({ select: { id: true, audioUrl: true } }),
    prisma.learningBlock.findMany({ where: { type: "WORKBOOK" }, select: { id: true, config: true } }),
  ]);

  for (const row of scripts) {
    if (!row.audioUrl) continue;
    const next = replaceAudio(row.audioUrl, mapping);
    if (next.changed) { await prisma.lessonAudioScript.update({ where: { id: row.id }, data: { audioUrl: next.value as string } }); updated++; }
  }
  for (const row of vocab) {
    if (!row.audioUrl) continue;
    const next = replaceAudio(row.audioUrl, mapping);
    if (next.changed) { await prisma.vocabItem.update({ where: { id: row.id }, data: { audioUrl: next.value as string } }); updated++; }
  }
  for (const row of sentences) {
    if (!row.audioUrl) continue;
    const next = replaceAudio(row.audioUrl, mapping);
    if (next.changed) { await prisma.sentenceItem.update({ where: { id: row.id }, data: { audioUrl: next.value as string } }); updated++; }
  }
  for (const row of blocks) {
    const next = replaceAudio(row.config, mapping);
    if (next.changed) { await prisma.learningBlock.update({ where: { id: row.id }, data: { config: next.value as Prisma.InputJsonValue } }); updated++; }
  }
  console.log(`Updated ${updated} database records`);
}

main().finally(() => prisma.$disconnect());
