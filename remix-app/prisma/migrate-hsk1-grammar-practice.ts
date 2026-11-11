// Import bài luyện tập từ courses/hsk1_2-0/grammar-practice.json.
//
// Dry-run mặc định; thêm --apply để ghi vào DB:
//   npx tsx prisma/migrate-hsk1-grammar-practice.ts
//   npx tsx prisma/migrate-hsk1-grammar-practice.ts --apply
//
// Chỉ thêm section còn thiếu. Nếu section đã có nhưng nội dung khác nguồn,
// dừng thay vì ghi đè câu hỏi hoặc ảnh hưởng các lượt làm đã lưu.

import { GrammarQuestionType, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK1-2.0";
const SECTION_TITLE = "Luyện tập HSK1 2.0 — Bài";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(SCRIPT_DIR, "imports", "hsk1_2-0-grammar-practice.json");
const prisma = new PrismaClient();

interface SingleChoiceQuestion {
  prompt: string;
  options: string[];
  answer: string;
}

interface ArrangeQuestion {
  prompt: string;
  tokens: string[];
  answer: string;
}

interface FillQuestion {
  prompt: string;
  answer: string;
}

interface GrammarPracticeLesson {
  order: number;
  title: string;
  singleChoice: SingleChoiceQuestion[];
  arrange: ArrangeQuestion[];
  fill: FillQuestion[];
}

interface GrammarPracticeSource {
  lessons: GrammarPracticeLesson[];
}

interface ImportedQuestion {
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  order: number;
}

interface ImportJob {
  lessonId: string;
  lessonOrder: number;
  title: string;
  order: number;
  questions: ImportedQuestion[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validateSource(value: unknown): GrammarPracticeSource {
  if (!value || typeof value !== "object" || !Array.isArray((value as GrammarPracticeSource).lessons)) {
    throw new Error("Nguồn dữ liệu phải có danh sách lessons.");
  }

  const source = value as GrammarPracticeSource;
  if (source.lessons.length !== 15) {
    throw new Error(`Cần đúng 15 bài, tìm thấy ${source.lessons.length}.`);
  }

  for (const [index, lesson] of source.lessons.entries()) {
    if (lesson.order !== index + 1 || typeof lesson.title !== "string") {
      throw new Error(`Thứ tự hoặc tiêu đề không hợp lệ ở bài ${index + 1}.`);
    }
    if (lesson.singleChoice?.length !== 5 || lesson.arrange?.length !== 5 || lesson.fill?.length !== 5) {
      throw new Error(`Bài ${lesson.order} phải có 5 câu cho mỗi dạng luyện tập.`);
    }
    for (const question of lesson.singleChoice) {
      if (!question.prompt || !isStringArray(question.options) || question.options.length < 2
        || !question.options.includes(question.answer)) {
        throw new Error(`Câu chọn đáp án không hợp lệ ở bài ${lesson.order}.`);
      }
    }
    for (const question of lesson.arrange) {
      if (!question.prompt || !isStringArray(question.tokens) || question.tokens.join("") !== question.answer) {
        throw new Error(`Câu sắp xếp không khớp đáp án ở bài ${lesson.order}.`);
      }
    }
    for (const question of lesson.fill) {
      if (!question.prompt || !question.answer) {
        throw new Error(`Câu dịch không hợp lệ ở bài ${lesson.order}.`);
      }
    }
  }

  return source;
}

function questionsFor(lesson: GrammarPracticeLesson): ImportedQuestion[] {
  return [
    ...lesson.singleChoice.map((question, index) => ({
      type: "SINGLE_CHOICE" as const,
      prompt: question.prompt,
      options: question.options,
      answer: question.answer,
      order: index,
    })),
    ...lesson.arrange.map((question, index) => ({
      type: "ARRANGE" as const,
      prompt: question.prompt,
      options: question.tokens,
      answer: question.answer,
      order: lesson.singleChoice.length + index,
    })),
    ...lesson.fill.map((question, index) => ({
      type: "FILL" as const,
      prompt: question.prompt,
      options: [],
      answer: question.answer,
      order: lesson.singleChoice.length + lesson.arrange.length + index,
    })),
  ];
}

function matchesExisting(
  existing: Array<{ type: GrammarQuestionType; prompt: string; options: string[]; answer: string }>,
  expected: ImportedQuestion[],
): boolean {
  return existing.length === expected.length && existing.every((question, index) => {
    const wanted = expected[index];
    return question.type === wanted.type
      && question.prompt === wanted.prompt
      && question.answer === wanted.answer
      && JSON.stringify(question.options) === JSON.stringify(wanted.options);
  });
}

async function main() {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`Không tìm thấy nguồn dữ liệu: ${SOURCE_PATH}`);
  }
  const source = validateSource(JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")));
  const host = /@([^/]+)\//.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(?)";
  console.log(`\n=== Import luyện tập ngữ pháp ${APPLY ? "(APPLY)" : "(DRY RUN — thêm --apply để ghi)"} ===`);
  console.log(`  target: ${host}`);
  console.log(`  source: ${SOURCE_PATH}\n`);

  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: {
      id: true,
      lessons: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          grammarSections: {
            select: {
              id: true,
              title: true,
              order: true,
              questions: {
                orderBy: { order: "asc" },
                select: { type: true, prompt: true, options: true, answer: true },
              },
            },
          },
        },
      },
    },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE} trong DB.`);

  const jobs: ImportJob[] = [];
  let alreadyImported = 0;
  for (const sourceLesson of source.lessons) {
    const lesson = course.lessons.find((item) => item.order === sourceLesson.order);
    if (!lesson) throw new Error(`Khóa ${COURSE_CODE} không có bài ${sourceLesson.order}.`);

    const title = `${SECTION_TITLE} ${sourceLesson.order}: ${sourceLesson.title}`;
    const expected = questionsFor(sourceLesson);
    const existing = lesson.grammarSections.find((section) => section.title === title);
    if (existing) {
      if (!matchesExisting(existing.questions, expected)) {
        throw new Error(`Section "${title}" đã tồn tại nhưng khác nguồn; không ghi đè dữ liệu.`);
      }
      alreadyImported++;
      continue;
    }

    jobs.push({
      lessonId: lesson.id,
      lessonOrder: lesson.order,
      title,
      order: Math.max(0, ...lesson.grammarSections.map((section) => section.order)) + 1,
      questions: expected,
    });
  }

  if (APPLY && jobs.length > 0) {
    await prisma.$transaction(
      jobs.map((job) => prisma.grammarSection.create({
        data: {
          lessonId: job.lessonId,
          title: job.title,
          order: job.order,
          questions: {
            create: job.questions.map((question) => ({
              type: question.type,
              prompt: question.prompt,
              options: question.options,
              answer: question.answer,
              order: question.order,
            })),
          },
        },
      })),
    );
  }

  console.log(`  Khóa: ${COURSE_CODE}`);
  console.log(`  Bài đã có đúng dữ liệu: ${alreadyImported}`);
  console.log(`  Bài sẽ thêm: ${jobs.length}`);
  console.log(`  Câu hỏi sẽ thêm: ${jobs.reduce((total, job) => total + job.questions.length, 0)}`);
  if (!APPLY) console.log("  Chạy lại với --apply để ghi vào DB.");
  console.log();
}

main()
  .catch((error) => {
    console.error("\n❌ Import luyện tập thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
