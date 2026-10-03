import { PrismaClient } from "@prisma/client";
import { parsePhoneticsConfig } from "../app/lib/learning-blocks";

const prisma = new PrismaClient();

async function main() {
  const legacyBlocks = await prisma.learningBlock.findMany({
    where: { type: "PHONETICS" },
    select: { id: true, lessonId: true, config: true },
  });

  let migrated = 0;
  for (const block of legacyBlocks) {
    const existingCount = await prisma.phoneticsSection.count({ where: { lessonId: block.lessonId } });
    if (existingCount > 0) continue;

    const parsed = parsePhoneticsConfig(block.config);
    if (!parsed.ok) {
      throw new Error(`Ngữ âm bài ${block.lessonId} không hợp lệ: ${parsed.error}`);
    }

    await prisma.$transaction(async (tx) => {
      const sections = await tx.phoneticsSection.createManyAndReturn({
        data: parsed.data.sections.map((section, order) => ({
          lessonId: block.lessonId,
          sectionKey: section.id,
          title: section.title,
          description: section.description,
          audio: section.audio,
          order,
        })),
        select: { id: true, sectionKey: true },
      });
      const sectionIds = new Map(sections.map((section) => [section.sectionKey, section.id]));
      await tx.phoneticsQuestion.createMany({
        data: parsed.data.sections.flatMap((section) => section.items.map((item, order) => ({
          sectionId: sectionIds.get(section.id)!,
          questionKey: item.id,
          type: item.type === "tone" ? "TONE" : item.type === "initial" ? "INITIAL" : "FINAL",
          given: item.type === "tone" ? null : item.given,
          answer: item.type === "tone" ? null : item.answer,
          syllable: item.type === "tone" ? item.syllable : null,
          answerTone: item.type === "tone" ? item.answerTone : null,
          full: item.full,
          audioText: item.audioText,
          order,
        }))),
      });
      await tx.learningBlock.delete({ where: { id: block.id } });
    });

    migrated += 1;
    console.log(`Migrated phonetics for lesson ${block.lessonId}`);
  }

  console.log(`Phonetics migration complete: ${migrated} lesson(s) migrated.`);
}

main()
  .catch((error) => {
    console.error("Phonetics migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
