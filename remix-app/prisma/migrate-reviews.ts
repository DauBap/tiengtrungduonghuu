import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const prisma = new PrismaClient();

const courseCodeByFolder: Record<string, string> = {
  "hsk1_3-0": "HSK1-3.0",
  "hsk2_3-0": "HSK2-3.0",
};

function loadReviewTemplates(courseFolder: string) {
  const reviewsPath = path.join(repoRoot, "courses", courseFolder, "reviews.ts.txt");
  const source = fs.readFileSync(reviewsPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const moduleObject = { exports: {} as Record<string, unknown> };
  const require = createRequire(import.meta.url);
  const fn = new Function("require", "module", "exports", outputText);
  fn(require, moduleObject, moduleObject.exports);

  return (moduleObject.exports as { courseReviewTemplates?: Record<string, Record<string, any>> }).courseReviewTemplates ?? {};
}

function normalizeSetId(courseCode: string, setId: string) {
  return `${courseCode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${setId}`;
}

function questionTypeFromValue(value?: string) {
  return value === "reorder" ? "REORDER" : "TRANSLATION";
}

function directionFromValue(value?: string) {
  return value === "zh2vi" ? "ZH2VI" : "VI2ZH";
}

async function upsertReviewSets() {
  const courseNames = Object.keys(courseCodeByFolder);

  for (const folder of courseNames) {
    const courseCode = courseCodeByFolder[folder];
    const course = await prisma.course.findUnique({ where: { code: courseCode } });
    if (!course) {
      console.warn(`Skipping ${folder}: course ${courseCode} not found`);
      continue;
    }

    const templates = loadReviewTemplates(folder);
    const reviewEntries = Object.values(templates).flatMap((entry) => Object.values(entry ?? {}));

    for (const set of reviewEntries) {
      const allQuestions = (set.sections ?? []).flatMap((section: any) => section.questions ?? []);
      const flatQuestions = allQuestions.length > 0 ? allQuestions : set.questions ?? set.legacyQuestions ?? [];

      const setId = normalizeSetId(courseCode, String(set.id));
      const setTitle = String(set.title ?? "ÔN TẬP");
      const setSubtitle = String(set.subtitle ?? "");
      const order = Number(set.order ?? Number(set.id));

      if (!APPLY) {
        console.log(`[dry-run] ${courseCode} / ${setTitle} => ${setId} (${flatQuestions.length} câu)`);
        continue;
      }

      // Chỉ thay dữ liệu của bộ hiện tại; xóa theo courseId sẽ làm mất câu hỏi
      // của các bộ đã migrate trước đó trong cùng một khóa học.
      await prisma.courseReviewSet.deleteMany({ where: { id: setId, courseId: course.id } });

      const reviewSet = await prisma.courseReviewSet.create({
        data: {
          id: setId,
          courseId: course.id,
          title: setTitle,
          subtitle: setSubtitle,
          order,
          questions: {
            create: flatQuestions.map((question: any, index: number) => ({
              id: `${setId}-${question.id ?? index + 1}`,
              direction: directionFromValue(question.direction),
              type: questionTypeFromValue(question.type),
              prompt: String(question.prompt ?? ""),
              answer: String(question.answer ?? ""),
              acceptedAnswers: Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.map(String) : [],
              explanation: question.explanation ? String(question.explanation) : null,
              tokens: Array.isArray(question.tokens) ? question.tokens.map(String) : [],
              lesson: typeof question.lesson === "number" ? question.lesson : null,
              order: index,
            })),
          },
        },
      });

      console.log(`✅ Created review set ${reviewSet.id} with ${flatQuestions.length} questions`);
    }
  }
}

async function main() {
  console.log(APPLY ? "Applying review migration" : "Dry run: review migration preview");
  await upsertReviewSets();
}

main()
  .catch((error) => {
    console.error("Review migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
