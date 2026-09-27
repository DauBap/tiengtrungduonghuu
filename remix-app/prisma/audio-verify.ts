import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu TARGET_DATABASE_URL");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function collect(value: unknown, out: string[]) {
  if (typeof value === "string") {
    if (value.includes("/audio/") || value.includes(".mp3")) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, out));
}

const [scripts, vocab, sentences, blocks] = await Promise.all([
  prisma.lessonAudioScript.findMany({ select: { audioUrl: true } }),
  prisma.vocabItem.findMany({ select: { audioUrl: true } }),
  prisma.sentenceItem.findMany({ select: { audioUrl: true } }),
  prisma.learningBlock.findMany({ where: { type: "WORKBOOK" }, select: { config: true } }),
]);

const all: string[] = [];
for (const rows of [scripts, vocab, sentences]) for (const r of rows) if (r.audioUrl) all.push(r.audioUrl);
for (const b of blocks) collect(b.config, all);

const blob = all.filter((u) => u.startsWith("https://") && u.includes(".blob.vercel-storage.com"));
const stillLocal = all.filter((u) => u.startsWith("/audio/"));
const other = all.filter((u) => !blob.includes(u) && !stillLocal.includes(u));

console.log(`Tổng URL audio:   ${all.length}`);
console.log(`  URL Blob:       ${blob.length}`);
console.log(`  còn /audio/:    ${stillLocal.length}`);
console.log(`  khác:           ${other.length}`);
if (stillLocal.length) console.log("\nCòn local:", stillLocal.slice(0, 10));
if (other.length) console.log("\nKhác:", other.slice(0, 10));

const sample = blob[0];
if (sample) {
  const res = await fetch(sample, { method: "HEAD" });
  console.log(`\nHEAD mẫu: ${res.status} ${res.headers.get("content-type")} ${res.headers.get("content-length")} bytes`);
  console.log(sample);
}

await prisma.$disconnect();
