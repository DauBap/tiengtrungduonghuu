import { GrammarQuestionType, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_DIR = path.join(SCRIPT_DIR, "imports");
const prisma = new PrismaClient();

const COURSE_CODES = ["HSK2-2.0", "HSK3-2.0", "HSK4-2.0", "HSK5-2.0"] as const;
const PRACTICE_SECTION_TITLE = "Luyện tập tổng hợp";
const SOURCE_FILES: Record<(typeof COURSE_CODES)[number], string> = {
  "HSK2-2.0": "hsk2_2-0-grammar-practice.json",
  "HSK3-2.0": "hsk3_2-0-grammar-practice.json",
  "HSK4-2.0": "hsk4_2-0-grammar-practice.json",
  "HSK5-2.0": "hsk5_2-0-grammar-practice.json",
};

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

interface QuestionRow {
  id: string;
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  acceptedAnswers: string[];
  order: number;
  sectionId: string;
}

interface PracticeSectionRow {
  id: string;
  title: string;
  order: number;
  questions: QuestionRow[];
}

interface LessonRow {
  id: string;
  order: number;
  title: string;
  grammarSections: PracticeSectionRow[];
}

interface ImportJob {
  lessonId: string;
  lessonOrder: number;
  title: string;
  order: number;
  questions: ImportedQuestion[];
}

interface QuestionCorrection {
  id: string;
  courseCode: string;
  lessonOrder: number;
  from: Pick<QuestionRow, "type" | "prompt" | "options" | "answer">;
  to: ImportedQuestion;
}

const CORRECTION_SPECS = [
  {
    courseCode: "HSK5-2.0",
    lessonIndex: 0,
    sourceType: "FILL",
    sourcePrompt: "___和___都认为这个作品很好。 (评委 / 入围 / 对比)",
    sourceAnswer: "评委入围了对比。",
    targetType: "SINGLE_CHOICE",
    targetPrompt: "他虽然没有获奖，但能够___已经很不简单了。",
    targetOptions: ["评委", "入围", "对比"],
    targetAnswer: "入围",
  },
  {
    courseCode: "HSK5-2.0",
    lessonIndex: 7,
    sourceType: "FILL",
    sourcePrompt: "猴子们跳___跳___。 (来 / 去)",
    sourceAnswer: "来去",
    targetType: "ARRANGE",
    targetPrompt: "猴子们跳___跳___。",
    targetOptions: ["来", "去"],
    targetAnswer: "来去",
  },
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validateSource(value: unknown, courseCode: string): GrammarPracticeSource {
  if (!value || typeof value !== "object" || !Array.isArray((value as GrammarPracticeSource).lessons)) {
    throw new Error(`${courseCode}: nguồn phải có danh sách lessons.`);
  }

  const source = value as GrammarPracticeSource;
  const expectedLessonCount = courseCode === "HSK2-2.0" ? 15 : courseCode === "HSK5-2.0" ? 36 : 20;
  if (source.lessons.length !== expectedLessonCount) {
    throw new Error(`${courseCode}: cần ${expectedLessonCount} bài, tìm thấy ${source.lessons.length}.`);
  }

  for (const [index, lesson] of source.lessons.entries()) {
    if (lesson.order !== index + 1 || typeof lesson.title !== "string") {
      throw new Error(`${courseCode}: thứ tự hoặc tiêu đề không hợp lệ ở bài ${index + 1}.`);
    }
    if (!Array.isArray(lesson.singleChoice) || !Array.isArray(lesson.arrange) || !Array.isArray(lesson.fill)) {
      throw new Error(`${courseCode} bài ${lesson.order}: thiếu danh sách câu hỏi.`);
    }
    if (courseCode !== "HSK5-2.0"
      && (lesson.singleChoice.length !== 5 || lesson.arrange.length !== 5 || lesson.fill.length !== 5)) {
      throw new Error(`${courseCode} bài ${lesson.order}: phải có 5 câu mỗi dạng.`);
    }
    for (const question of lesson.singleChoice) {
      if (!question.prompt || !isStringArray(question.options) || question.options.length < 2
        || !question.options.includes(question.answer)) {
        throw new Error(`${courseCode} bài ${lesson.order}: câu chọn đáp án không hợp lệ.`);
      }
    }
    for (const question of lesson.arrange) {
      if (!question.prompt || !isStringArray(question.tokens) || question.tokens.join("") !== question.answer) {
        throw new Error(`${courseCode} bài ${lesson.order}: câu sắp xếp không khớp đáp án.`);
      }
    }
    for (const question of lesson.fill) {
      if (!question.prompt || !question.answer) {
        throw new Error(`${courseCode} bài ${lesson.order}: câu điền/dịch không hợp lệ.`);
      }
    }
  }

  return source;
}

function questionsFor(lesson: GrammarPracticeLesson): ImportedQuestion[] {
  let order = 0;
  return [
    ...lesson.singleChoice.map((question) => ({
      type: "SINGLE_CHOICE" as const,
      prompt: question.prompt,
      options: question.options,
      answer: question.answer,
      order: order++,
    })),
    ...lesson.arrange.map((question) => ({
      type: "ARRANGE" as const,
      prompt: question.prompt,
      options: question.tokens,
      answer: question.answer,
      order: order++,
    })),
    ...lesson.fill.map((question) => ({
      type: "FILL" as const,
      prompt: question.prompt,
      options: [],
      answer: question.answer,
      order: order++,
    })),
  ];
}

function sameQuestionSet(existing: QuestionRow[], expected: ImportedQuestion[]) {
  if (existing.length !== expected.length) return false;
  const signature = (question: Pick<ImportedQuestion, "type" | "answer" | "options">) => (
    JSON.stringify([
      question.type,
      question.type === "ARRANGE" ? question.options.join("") : question.answer,
    ])
  );
  const counts = new Map<string, number>();
  for (const question of existing) {
    const key = signature(question);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const question of expected) {
    const key = signature(question);
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

function correctionQuestion(correction: QuestionCorrection): ImportedQuestion {
  return {
    ...correction.to,
    order: 0,
  };
}

async function main() {
  const sources = new Map<string, GrammarPracticeSource>();
  for (const courseCode of COURSE_CODES) {
    const pathToSource = path.join(IMPORT_DIR, SOURCE_FILES[courseCode]);
    if (!fs.existsSync(pathToSource)) throw new Error(`Không tìm thấy nguồn dữ liệu: ${pathToSource}`);
    sources.set(courseCode, validateSource(JSON.parse(fs.readFileSync(pathToSource, "utf8")), courseCode));
  }

  const databaseHost = /@([^/]+)\//.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(?)";
  console.log(`\n=== Import luyện tập ngữ pháp ${APPLY ? "(APPLY)" : "(DRY RUN — thêm --apply để ghi)"} ===`);
  console.log(`  target: ${databaseHost}`);

  const jobs: ImportJob[] = [];
  const corrections: QuestionCorrection[] = [];
  let alreadyComplete = 0;

  for (const courseCode of COURSE_CODES) {
    const course = await prisma.course.findUnique({
      where: { code: courseCode },
      select: {
        id: true,
        lessons: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            title: true,
            grammarSections: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                order: true,
                questions: {
                  orderBy: { order: "asc" },
                  select: {
                    id: true,
                    sectionId: true,
                    type: true,
                    prompt: true,
                    options: true,
                    answer: true,
                    acceptedAnswers: true,
                    order: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!course) throw new Error(`Không tìm thấy khóa ${courseCode} trong DB.`);

    const sourceLessons = sources.get(courseCode)!.lessons;
    if (course.lessons.length !== sourceLessons.length) {
      throw new Error(`${courseCode}: ${course.lessons.length} bài trong DB, ${sourceLessons.length} bài trong tài liệu.`);
    }

    for (const [index, sourceLesson] of sourceLessons.entries()) {
      const lesson = course.lessons[index] as LessonRow;
      const expected = questionsFor(sourceLesson);
      const allQuestions = lesson.grammarSections.flatMap((section) => section.questions);

      for (const spec of CORRECTION_SPECS.filter((item) => item.courseCode === courseCode && item.lessonIndex === index)) {
        const target = expected.find((question) => (
          question.type === spec.targetType && question.answer === spec.targetAnswer
          && question.prompt === spec.targetPrompt
        ));
        if (!target || target.type !== spec.targetType) {
          throw new Error(`${courseCode} bài ${sourceLesson.order}: không khớp câu sửa với tài liệu.`);
        }
        const current = allQuestions.filter((question) => (
          question.type === spec.sourceType
          && question.prompt === spec.sourcePrompt
          && question.answer === spec.sourceAnswer
        ));
        if (current.length === 1) {
          corrections.push({
            id: current[0].id,
            courseCode,
            lessonOrder: lesson.order,
            from: current[0],
            to: {
              type: target.type,
              prompt: target.prompt,
              options: target.options,
              answer: target.answer,
              order: target.order,
            },
          });
          allQuestions[allQuestions.indexOf(current[0])] = {
            ...current[0],
            type: target.type,
            prompt: target.prompt,
            options: target.options,
            answer: target.answer,
          };
        } else {
          const alreadyCorrect = allQuestions.some((question) => (
            question.type === target.type
            && question.prompt === target.prompt
            && question.answer === target.answer
            && JSON.stringify(question.options) === JSON.stringify(target.options)
          ));
          if (!alreadyCorrect) {
            throw new Error(`${courseCode} bài ${sourceLesson.order}: không tìm thấy câu cũ để sửa hoặc câu đã sửa đúng.`);
          }
        }
      }

      const practiceTitle = `${PRACTICE_SECTION_TITLE} — Bài ${sourceLesson.order}`;
      const practiceSection = lesson.grammarSections.find((section) => section.title === practiceTitle);
      if (practiceSection) {
        if (!sameQuestionSet(practiceSection.questions, expected)) {
          throw new Error(`Section "${practiceTitle}" đã tồn tại nhưng khác nguồn; không ghi đè.`);
        }
        alreadyComplete++;
        continue;
      }

      if (sameQuestionSet(allQuestions, expected)) {
        alreadyComplete++;
        continue;
      }

      if (allQuestions.length > 0) {
        throw new Error(`${courseCode} bài ${sourceLesson.order}: câu hiện có không khớp tài liệu; không ghi đè.`);
      }

      if (courseCode !== "HSK2-2.0" || sourceLesson.order > 2) {
        throw new Error(`${courseCode} bài ${sourceLesson.order}: thiếu câu hiện có ngoài hai bài HSK2 đã xác minh.`);
      }

      jobs.push({
        lessonId: lesson.id,
        lessonOrder: lesson.order,
        title: practiceTitle,
        order: Math.max(0, ...lesson.grammarSections.map((section) => section.order)) + 1,
        questions: expected,
      });
    }
    console.log(`  ${courseCode}: ${sourceLessons.length} bài đã đối chiếu.`);
  }

  if (APPLY && (jobs.length > 0 || corrections.length > 0)) {
    const operations = [
      ...corrections.map((correction) => prisma.grammarQuestion.update({
        where: { id: correction.id },
        data: {
          type: correction.to.type,
          prompt: correction.to.prompt,
          options: correction.to.options,
          answer: correction.to.answer,
          acceptedAnswers: [],
        },
      })),
      ...jobs.map((job) => prisma.grammarSection.create({
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
    ];
    await prisma.$transaction(operations);
  }

  console.log(`  Bộ câu hỏi đã khớp: ${alreadyComplete}`);
  console.log(`  Section mới: ${jobs.length} (${jobs.reduce((sum, job) => sum + job.questions.length, 0)} câu)`);
  console.log(`  Câu HSK5 cần chuẩn hóa: ${corrections.length}`);
  for (const correction of corrections) {
    console.log(`    ${correction.courseCode} bài ${correction.lessonOrder}: ${correction.from.type} → ${correction.to.type}`);
  }
  if (!APPLY) console.log("  Chạy lại với --apply để ghi vào DB.");
  console.log();
}

main()
  .catch((error) => {
    console.error("\n❌ Import luyện tập thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
