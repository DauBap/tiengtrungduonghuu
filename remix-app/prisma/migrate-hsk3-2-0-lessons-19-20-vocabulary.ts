// Import vocabulary for HSK3 2.0 lessons 19 and 20 without rewriting other lessons.
//
// Dry-run by default; add --apply to write to the database:
//   npx tsx prisma/migrate-hsk3-2-0-lessons-19-20-vocabulary.ts
//   npx tsx prisma/migrate-hsk3-2-0-lessons-19-20-vocabulary.ts --apply

import { Prisma, PrismaClient, type WordType } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK3-2.0";
const SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "imports",
  "hsk3_2-0-lessons-19-20-vocabulary.json",
);
const EXPECTED_LESSONS = [
  { number: 19, title: "你没看出来吗？", count: 14 },
  { number: 20, title: "我被他影响了", count: 11 },
] as const;
const ADJ_TO_WORD_TYPE: Record<number, WordType> = {
  1: "PRONOUN",
  2: "NOUN",
  3: "NOUN",
  4: "VERB",
  5: "VERB",
  6: "ADJECTIVE",
  7: "ADVERB",
  8: "MEASURE",
  9: "NOUN",
  10: "CONJUNCTION",
  11: "PARTICLE",
  12: "PHRASE",
  13: "PREPOSITION",
  14: "PARTICLE",
  15: "PARTICLE",
  16: "INTERJECTION",
  17: "PHRASE",
  18: "ADVERB",
  19: "PHRASE",
  20: "PHRASE",
  21: "NUMERAL",
};
const prisma = new PrismaClient();

interface SourceLessonVocab {
  id: number;
  title: string;
  data: Array<{
    pos: number;
    hanzi: string;
    pinyin: string;
    vi: string;
    adj: number | number[] | null;
    note?: string | null;
  }>;
}

interface VocabularyImport {
  courseCode: string;
  lessons: SourceLessonVocab[];
}

interface VocabularyJob {
  lessonId: string;
  lessonNumber: number;
  records: Prisma.VocabItemCreateManyInput[];
  needsCreate: boolean;
}

function readSource(
  importData: VocabularyImport,
  lessonNumber: number,
  expectedTitle: string,
  expectedCount: number,
) {
  const matchingLessons = importData.lessons.filter((lesson) => lesson.id === lessonNumber);
  if (matchingLessons.length !== 1) {
    throw new Error(`Nguồn import cần đúng một mục cho bài ${lessonNumber}, tìm thấy ${matchingLessons.length}.`);
  }
  const source = matchingLessons[0];
  if (source.id !== lessonNumber || source.title.trim() !== expectedTitle) {
    throw new Error(`Thông tin nguồn import không khớp bài ${lessonNumber}.`);
  }
  if (source.data.length !== expectedCount) {
    throw new Error(`Bài ${lessonNumber} cần ${expectedCount} từ, tìm thấy ${source.data.length}.`);
  }

  const records = source.data.map((vocab) => {
    if (!Number.isInteger(vocab.pos) || vocab.pos < 1) {
      throw new Error(`Thứ tự từ không hợp lệ ở bài ${lessonNumber}: ${vocab.pos}.`);
    }
    const wordTypes = (Array.isArray(vocab.adj) ? vocab.adj : vocab.adj == null ? [] : [vocab.adj])
      .map((type) => {
        const mapped = ADJ_TO_WORD_TYPE[type];
        if (!mapped) throw new Error(`Không hỗ trợ từ loại ${type} trong bài ${lessonNumber}.`);
        return mapped;
      });

    return {
      chinese: vocab.hanzi.trim(),
      pinyin: vocab.pinyin.trim(),
      translation: vocab.vi.trim(),
      wordTypes: [...new Set(wordTypes)],
      note: vocab.note?.trim() || null,
      order: vocab.pos,
    } satisfies Omit<Prisma.VocabItemCreateManyInput, "lessonId">;
  });

  if (
    records.some((record) => !record.chinese || !record.pinyin || !record.translation)
    || new Set(records.map((record) => record.order)).size !== records.length
  ) {
    throw new Error(`Dữ liệu từ vựng bài ${lessonNumber} có trường trống hoặc thứ tự trùng.`);
  }

  return records;
}

async function main() {
  if (!fs.existsSync(SOURCE_PATH)) throw new Error(`Không tìm thấy nguồn import ${SOURCE_PATH}.`);
  const importData = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")) as VocabularyImport;
  if (importData.courseCode !== COURSE_CODE) {
    throw new Error(`Nguồn import thuộc khóa ${importData.courseCode}, cần ${COURSE_CODE}.`);
  }
  if (importData.lessons.length !== EXPECTED_LESSONS.length) {
    throw new Error(`Nguồn import cần đúng ${EXPECTED_LESSONS.length} bài.`);
  }

  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: { id: true },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE}.`);

  const jobs: VocabularyJob[] = [];
  for (const target of EXPECTED_LESSONS) {
    const records = readSource(importData, target.number, target.title, target.count);
    const lessons = await prisma.lesson.findMany({
      where: { courseId: course.id, title: target.title },
      select: {
        id: true,
        order: true,
        content: {
          orderBy: { order: "asc" },
          select: {
            chinese: true,
            pinyin: true,
            translation: true,
            wordTypes: true,
            note: true,
            order: true,
          },
        },
      },
    });
    if (lessons.length !== 1) {
      throw new Error(`Cần đúng một bài "${target.title}" trong ${COURSE_CODE}, tìm thấy ${lessons.length}.`);
    }
    const lesson = lessons[0];
    if (lesson.order !== target.number + 3) {
      throw new Error(`Bài ${target.number} dự kiến có thứ tự DB ${target.number + 3}, hiện là ${lesson.order}.`);
    }

    const existing = lesson.content;
    const sameAsSource = existing.length === records.length
      && existing.every((item, index) => {
        const source = records[index];
        return item.chinese === source.chinese
          && item.pinyin === source.pinyin
          && item.translation === source.translation
          && item.note === source.note
          && item.order === source.order
          && item.wordTypes.length === source.wordTypes.length
          && item.wordTypes.every((type, typeIndex) => type === source.wordTypes[typeIndex]);
      });
    if (existing.length > 0 && !sameAsSource) {
      throw new Error(
        `Bài ${target.number} đã có ${existing.length} mục từ vựng khác nguồn; không ghi đè dữ liệu hiện có.`,
      );
    }

    jobs.push({
      lessonId: lesson.id,
      lessonNumber: target.number,
      records: records.map((record) => ({ ...record, lessonId: lesson.id })),
      needsCreate: existing.length === 0,
    });
  }

  const pending = jobs.filter((job) => job.needsCreate);
  console.log(`\n=== Import từ vựng HSK3 2.0 ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  for (const job of jobs) {
    console.log(`  Bài ${job.lessonNumber}: ${job.records.length} từ${job.needsCreate ? " (sẽ thêm)" : " (đã khớp)"}`);
  }
  console.log(`  Bài cần thêm: ${pending.length}`);

  if (APPLY && pending.length > 0) {
    await prisma.$transaction(pending.map((job) =>
      prisma.vocabItem.createMany({ data: job.records }),
    ));
    console.log("Đã import từ vựng bài 19–20.");
  } else if (!APPLY) {
    console.log("Chưa ghi dữ liệu. Chạy lại với --apply để lưu.");
  }
}

main()
  .catch((error) => {
    console.error("Không thể import từ vựng HSK3 2.0 bài 19–20:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
