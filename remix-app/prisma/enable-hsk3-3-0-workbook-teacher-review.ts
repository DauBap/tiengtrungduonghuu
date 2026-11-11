// Enable teacher grading for workbook questions 28–30 in every HSK3 3.0 lesson.
//
// Dry-run by default; add --apply to write changes:
//   npx tsx prisma/enable-hsk3-3-0-workbook-teacher-review.ts
//   npx tsx prisma/enable-hsk3-3-0-workbook-teacher-review.ts --apply

import { Prisma, PrismaClient } from "@prisma/client";
import { parseWorkbookConfig } from "../app/lib/learning-blocks";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK3-3.0";
const TARGET_QUESTION_NUMBERS = new Set([28, 29, 30]);
const EXPECTED_LESSON_COUNT = 18;
const prisma = new PrismaClient();

async function main() {
  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: {
      code: true,
      lessons: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          learningBlocks: {
            where: { type: "WORKBOOK" },
            select: { id: true, config: true },
          },
        },
      },
    },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE}.`);
  if (course.lessons.length !== EXPECTED_LESSON_COUNT) {
    throw new Error(`Khóa ${COURSE_CODE} cần ${EXPECTED_LESSON_COUNT} bài, tìm thấy ${course.lessons.length}.`);
  }

  const updates: Array<{ id: string; title: string; config: Prisma.InputJsonValue; changed: number }> = [];
  let alreadyEnabled = 0;
  for (const lesson of course.lessons) {
    if (lesson.learningBlocks.length !== 1) {
      throw new Error(`Bài ${lesson.order} cần đúng một sách bài tập, tìm thấy ${lesson.learningBlocks.length}.`);
    }

    const block = lesson.learningBlocks[0];
    const parsed = parseWorkbookConfig(block.config);
    if (!parsed.ok) {
      throw new Error(`Cấu hình sách bài tập bài ${lesson.order} không hợp lệ: ${parsed.error}`);
    }

    let found = 0;
    let changed = 0;
    const config = {
      ...parsed.data,
      sections: parsed.data.sections.map((section) => ({
        ...section,
        questions: section.questions.map((question) => {
          if (!TARGET_QUESTION_NUMBERS.has(question.number)) return question;
          if (question.kind !== "input") {
            throw new Error(`Câu ${question.number} bài ${lesson.order} không phải câu điền chữ.`);
          }
          found++;
          if (!question.teacherReview || !question.gradable) changed++;
          return { ...question, gradable: true, teacherReview: true };
        }),
      })),
    };

    if (found !== TARGET_QUESTION_NUMBERS.size) {
      throw new Error(`Bài ${lesson.order} cần đủ câu 28–30, tìm thấy ${found} câu.`);
    }
    const validated = parseWorkbookConfig(config);
    if (!validated.ok) {
      throw new Error(`Cấu hình sau cập nhật bài ${lesson.order} không hợp lệ: ${validated.error}`);
    }

    if (changed > 0) {
      updates.push({
        id: block.id,
        title: `${lesson.order} — ${lesson.title}`,
        config: validated.data as Prisma.InputJsonValue,
        changed,
      });
    } else {
      alreadyEnabled += found;
    }
  }

  console.log(`\n=== Bật giáo viên chấm câu 28–30 ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`  Khóa: ${COURSE_CODE} · ${course.lessons.length} bài`);
  console.log(`  Câu đã bật sẵn: ${alreadyEnabled}`);
  console.log(`  Câu cần bật: ${updates.reduce((sum, update) => sum + update.changed, 0)}`);
  for (const update of updates) {
    console.log(`  Bài ${update.title}: ${update.changed} câu`);
  }

  if (APPLY && updates.length > 0) {
    await prisma.$transaction(updates.map((update) =>
      prisma.learningBlock.update({
        where: { id: update.id },
        data: { config: update.config },
      }),
    ));
    console.log(`Đã cập nhật ${updates.length} sách bài tập.`);
  } else if (!APPLY) {
    console.log("Chưa ghi dữ liệu. Chạy lại với --apply để lưu.");
  }
}

main()
  .catch((error) => {
    console.error("Không thể cập nhật cờ chấm giáo viên:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
