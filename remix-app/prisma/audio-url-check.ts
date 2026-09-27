import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioRoot = path.join(root, "public", "audio");
const databaseUrl = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu TARGET_DATABASE_URL");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function walk(dir: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) out.push(`/audio/${rel}`);
  }
  return out;
}

function decodeAudioUrl(value: string) {
  try {
    return decodeURIComponent(new URL(value, "https://local.invalid").pathname);
  } catch {
    return value.split("?")[0];
  }
}

function collectStrings(value: unknown, out: string[]) {
  if (typeof value === "string") {
    if (value.includes("/audio/")) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
}

async function main() {
  const onDisk = new Set(await walk(audioRoot));
  const refs: { source: string; raw: string }[] = [];

  const [scripts, vocab, sentences, blocks] = await Promise.all([
    prisma.lessonAudioScript.findMany({ select: { audioUrl: true } }),
    prisma.vocabItem.findMany({ select: { audioUrl: true } }),
    prisma.sentenceItem.findMany({ select: { audioUrl: true } }),
    prisma.learningBlock.findMany({ where: { type: "WORKBOOK" }, select: { config: true } }),
  ]);

  for (const [label, rows] of [
    ["lessonAudioScript", scripts],
    ["vocabItem", vocab],
    ["sentenceItem", sentences],
  ] as const) {
    for (const row of rows) if (row.audioUrl) refs.push({ source: label, raw: row.audioUrl });
  }
  for (const row of blocks) {
    const found: string[] = [];
    collectStrings(row.config, found);
    for (const raw of found) refs.push({ source: "learningBlock.config", raw });
  }

  const matched = refs.filter((r) => onDisk.has(decodeAudioUrl(r.raw)));
  const missing = refs.filter((r) => !onDisk.has(decodeAudioUrl(r.raw)));
  const used = new Set(matched.map((r) => decodeAudioUrl(r.raw)));

  console.log(`MP3 trên đĩa:        ${onDisk.size}`);
  console.log(`Tham chiếu trong DB: ${refs.length}`);
  console.log(`  khớp file:         ${matched.length}`);
  console.log(`  KHÔNG khớp:        ${missing.length}`);
  console.log(`File không ai dùng:  ${onDisk.size - used.size}`);

  const bySource = new Map<string, number>();
  for (const r of matched) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log("\nKhớp theo bảng:");
  for (const [k, v] of bySource) console.log(`  ${k}: ${v}`);

  if (missing.length) {
    console.log("\n20 tham chiếu không khớp đầu tiên:");
    for (const r of missing.slice(0, 20)) console.log(`  [${r.source}] ${r.raw}`);
  }
}

main().finally(() => prisma.$disconnect());
