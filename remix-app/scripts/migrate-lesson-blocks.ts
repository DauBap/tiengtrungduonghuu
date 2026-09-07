/**
 * Migration script: Tạo VOCABULARY và GRAMMAR blocks cho bài cũ
 *
 * Sau khi thay đổi hệ thống, tất cả tabs đều cần LearningBlock để hiện.
 * Script này tự động tạo blocks cho các bài đã có nội dung nhưng chưa có block.
 *
 * Chạy: npx tsx scripts/migrate-lesson-blocks.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Scanning lessons for missing blocks...\n");

  const lessons = await prisma.lesson.findMany({
    select: {
      id: true,
      title: true,
      order: true,
      content: { select: { id: true } },
      grammarSections: { select: { id: true } },
      learningBlocks: { select: { id: true, type: true, order: true } },
    },
  });

  console.log(`Found ${lessons.length} lessons\n`);

  let createdVocab = 0;
  let createdGrammar = 0;
  let skippedVocab = 0;
  let skippedGrammar = 0;

  for (const lesson of lessons) {
    const hasContent = lesson.content.length > 0;
    const hasGrammar = lesson.grammarSections.length > 0;
    const hasVocabBlock = lesson.learningBlocks.some((b) => b.type === "VOCABULARY");
    const hasGrammarBlock = lesson.learningBlocks.some((b) => b.type === "GRAMMAR");

    // Tìm order cao nhất để insert block mới vào cuối
    const maxOrder = Math.max(
      0,
      ...lesson.learningBlocks.map((b) => b.order)
    );

    // Tạo VOCABULARY block nếu cần
    if (hasContent && !hasVocabBlock) {
      await prisma.learningBlock.create({
        data: {
          lessonId: lesson.id,
          type: "VOCABULARY",
          title: "Từ vựng bài học",
          order: maxOrder + 1,
          config: {},
          required: true,
        },
      });
      console.log(
        `✓ Created VOCABULARY block for "${lesson.title}" (${lesson.content.length} từ)`
      );
      createdVocab++;
    } else if (hasContent) {
      skippedVocab++;
    }

    // Tạo GRAMMAR block nếu cần
    if (hasGrammar && !hasGrammarBlock) {
      await prisma.learningBlock.create({
        data: {
          lessonId: lesson.id,
          type: "GRAMMAR",
          title: "Ngữ pháp",
          order: maxOrder + 100, // Để grammar ở cuối
          config: {},
          required: true,
        },
      });
      console.log(
        `✓ Created GRAMMAR block for "${lesson.title}" (${lesson.grammarSections.length} sections)`
      );
      createdGrammar++;
    } else if (hasGrammar) {
      skippedGrammar++;
    }
  }

  console.log("\n📊 Summary:");
  console.log(`  VOCABULARY blocks created: ${createdVocab}`);
  console.log(`  VOCABULARY blocks skipped: ${skippedVocab} (already exist)`);
  console.log(`  GRAMMAR blocks created: ${createdGrammar}`);
  console.log(`  GRAMMAR blocks skipped: ${skippedGrammar} (already exist)`);
  console.log(
    `\n✅ Migration complete! Total blocks created: ${createdVocab + createdGrammar}`
  );
}

main()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
