// Migrate nội dung Ngữ âm (folder `Ngu_Am/` ở repo root) lên DB + Vercel Blob.
//
// Nguồn dữ liệu là các file TS trong `Ngu_Am/` — chúng export `PhoneticsSection[]`
// nhưng kèm `import.meta.glob` của Vite nên không import trực tiếp từ Node được.
// Script này vì vậy khai báo lại mapping bài ↔ section bằng cách đọc chính các
// file đó qua tsx (xem `loadSections`), chỉ thay phần resolve audio.
//
// Mỗi section và câu hỏi được lưu thành các bản ghi quan hệ riêng.
//
// Audio được upload lên blob với key `audio/phonetics/<file>.mp3` (không random
// suffix) nên chạy lại script là idempotent — ghi đè cùng URL.
//
// Dry-run mặc định:  npx tsx prisma/migrate-phonetics.ts
// Ghi thật:          npx tsx prisma/migrate-phonetics.ts --apply

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const audioDir = path.join(root, "Ngu_Am", "audio");

const token = process.env.BLOB_READ_WRITE_TOKEN;
const databaseUrl = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
if (!token) throw new Error("Thiếu BLOB_READ_WRITE_TOKEN");
if (!databaseUrl) throw new Error("Thiếu TARGET_DATABASE_URL hoặc DATABASE_URL");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const COURSE_CODE = "HSK1-3.0";

/** Bài trong sách Ngữ âm ↔ `Lesson.order` trên DB. */
const LESSON_MAP = [
  { book: 1, lessonOrder: 1 },
  { book: 2, lessonOrder: 3 },
  { book: 3, lessonOrder: 5 },
] as const;

type Tone = 1 | 2 | 3 | 4;
type Item = { id: number; full: string; audioText: string } & (
  | { type: "initial" | "final"; given: string; answer: string }
  | { type: "tone"; syllable: string; answerTone: Tone }
);
type Section = {
  id: number;
  title: string;
  description: string;
  audio: string | null;
  items: Item[];
};

/**
 * Đọc `PhoneticsSection[]` của cả 3 bài từ folder `Ngu_Am/`.
 *
 * `Ngu_Am/audio.ts` dùng `import.meta.glob` của Vite nên Node/tsx không chạy
 * được. Ta copy folder sang temp dir và thay riêng `audio.ts` bằng một hàm trả
 * về tên file — tên file đó sau sẽ được map sang blob URL.
 */
async function loadSections(): Promise<Map<number, Section[]>> {
  const temp = await fs.mkdtemp(path.join(root, ".ngu-am-"));
  try {
    await fs.cp(path.join(root, "Ngu_Am"), temp, { recursive: true });
    await fs.writeFile(
      path.join(temp, "audio.ts"),
      "export function getPhoneticsAudio(fileName: string): string | null { return fileName; }\n",
      "utf8",
    );

    const load = (file: string) => import(pathToFileURL(path.join(temp, file)).href);
    const [book1, book2, book3] = await Promise.all([
      load("hsk1-3-0.ts"),
      load("hsk1-3-0-lesson2.ts"),
      load("hsk1-3-0-lesson3.ts"),
    ]);

    const entries: [number, Section[] | undefined][] = [
      [1, book1.hsk1Lesson1Phonetics],
      [2, book2.hsk1Lesson2Phonetics],
      [3, book3.hsk1Lesson3Phonetics],
    ];
    for (const [book, sections] of entries) {
      if (!Array.isArray(sections) || sections.length === 0) {
        throw new Error(`Bài ${book}: không đọc được section nào từ Ngu_Am/`);
      }
    }
    return new Map(entries as [number, Section[]][]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

/** Upload mp3 lên blob, trả map `<tên file> → blob URL`. */
async function uploadAudio(fileNames: string[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  for (const fileName of fileNames) {
    const key = `audio/phonetics/${fileName}`;
    if (!APPLY) {
      mapping.set(fileName, `https://blob.invalid/${key}`);
      continue;
    }
    const uploaded = await put(key, await fs.readFile(path.join(audioDir, fileName)), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "audio/mpeg",
      token,
    });
    mapping.set(fileName, uploaded.url);
    console.log(`  ↑ ${key} → ${uploaded.url}`);
  }
  return mapping;
}

async function main() {
  const host = databaseUrl!.match(/@([^/]+)\//)?.[1] ?? "(?)";
  console.log(`[phonetics] ${APPLY ? "APPLY" : "DRY-RUN"} | DB: ${host}\n`);

  const byBook = await loadSections();

  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: { id: true, title: true },
  });
  if (!course) throw new Error(`Không tìm thấy course ${COURSE_CODE}`);

  const fileNames = [...byBook.values()]
    .flat()
    .map((s) => s.audio)
    .filter((a): a is string => Boolean(a));
  for (const fileName of fileNames) {
    await fs.access(path.join(audioDir, fileName));
  }
  console.log(`Audio: ${fileNames.length} file (đã kiểm tra tồn tại)`);
  const audioMap = await uploadAudio(fileNames);

  for (const { book, lessonOrder } of LESSON_MAP) {
    const sections = byBook.get(book);
    if (!sections) throw new Error(`Thiếu data bài ${book}`);

    const lesson = await prisma.lesson.findFirst({
      where: { courseId: course.id, order: lessonOrder },
      select: { id: true, title: true },
    });
    if (!lesson) throw new Error(`Không tìm thấy lesson order=${lessonOrder} của ${COURSE_CODE}`);

    const config = {
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        audio: s.audio ? (audioMap.get(s.audio) ?? null) : null,
        items: s.items,
      })),
    };

    const itemCount = config.sections.reduce((n, s) => n + s.items.length, 0);
    console.log(
      `\nBài ${book} → L${lessonOrder} "${lesson.title}" | ${config.sections.length} section, ${itemCount} câu`,
    );
    for (const section of config.sections) {
      console.log(`    §${section.id} ${section.items.length} câu | audio=${section.audio ?? "(không)"}`);
    }

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      const sectionKeys = config.sections.map((section) => section.id);
      for (const [sectionOrder, section] of config.sections.entries()) {
        const savedSection = await tx.phoneticsSection.upsert({
          where: { lessonId_sectionKey: { lessonId: lesson.id, sectionKey: section.id } },
          create: {
            lessonId: lesson.id,
            sectionKey: section.id,
            title: section.title,
            description: section.description,
            audio: section.audio,
            order: sectionOrder,
          },
          update: {
            title: section.title,
            description: section.description,
            audio: section.audio,
            order: sectionOrder,
          },
          select: { id: true },
        });
        const questionKeys = section.items.map((item) => item.id);
        for (const [questionOrder, item] of section.items.entries()) {
          const data = item.type === "tone"
            ? {
                type: "TONE" as const,
                given: null,
                answer: null,
                syllable: item.syllable,
                answerTone: item.answerTone,
                full: item.full,
                audioText: item.audioText,
                order: questionOrder,
              }
            : {
                type: item.type === "initial" ? "INITIAL" as const : "FINAL" as const,
                given: item.given,
                answer: item.answer,
                syllable: null,
                answerTone: null,
                full: item.full,
                audioText: item.audioText,
                order: questionOrder,
              };
          await tx.phoneticsQuestion.upsert({
            where: { sectionId_questionKey: { sectionId: savedSection.id, questionKey: item.id } },
            create: {
              sectionId: savedSection.id,
              questionKey: item.id,
              ...data,
            },
            update: data,
          });
        }
        await tx.phoneticsQuestion.deleteMany({
          where: {
            sectionId: savedSection.id,
            ...(questionKeys.length > 0 ? { questionKey: { notIn: questionKeys } } : {}),
          },
        });
      }
      await tx.phoneticsSection.deleteMany({
        where: {
          lessonId: lesson.id,
          ...(sectionKeys.length > 0 ? { sectionKey: { notIn: sectionKeys } } : {}),
        },
      });
      await tx.learningBlock.deleteMany({ where: { lessonId: lesson.id, type: "PHONETICS" } });
    });
    console.log(`    ✓ ${config.sections.length} phần đã lưu vào các bảng Ngữ âm`);
  }

  console.log(
    APPLY
      ? "\n✅ Xong."
      : "\nDry-run xong. Thêm --apply để upload blob và ghi DB.",
  );
}

main()
  .catch((error) => {
    console.error("❌ Migration lỗi:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
