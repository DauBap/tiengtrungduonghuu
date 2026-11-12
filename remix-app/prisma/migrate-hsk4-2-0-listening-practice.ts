import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(SCRIPT_DIR, "imports", "hsk4_2-0-listening-practice.json");
const COURSE_CODE = "HSK4-2.0";
const prisma = new PrismaClient();

interface ListeningPracticeLesson {
  order: number;
  title: string;
  sentences: string[];
}

interface ListeningPracticeSource {
  courseCode: string;
  lessons: ListeningPracticeLesson[];
}

interface ExistingLesson {
  id: string;
  order: number;
  title: string;
  sentences: Array<{ id: string; chinese: string; order: number }>;
  learningBlocks: Array<{ id: string; type: string; order: number; config: Prisma.JsonValue }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSource(value: unknown): ListeningPracticeSource {
  if (!isRecord(value) || value.courseCode !== COURSE_CODE || !Array.isArray(value.lessons)) {
    throw new Error("Nguồn phải có courseCode HSK4-2.0 và danh sách lessons.");
  }
  if (value.lessons.length !== 20) {
    throw new Error(`HSK4-2.0 cần 20 bài, tìm thấy ${value.lessons.length}.`);
  }

  const titles = new Set<string>();
  const lessons = value.lessons.map((rawLesson, index) => {
    if (!isRecord(rawLesson)
      || rawLesson.order !== index + 1
      || typeof rawLesson.title !== "string"
      || !Array.isArray(rawLesson.sentences)) {
      throw new Error(`Nguồn bài ${index + 1} không hợp lệ.`);
    }
    if (titles.has(rawLesson.title)) throw new Error(`Tiêu đề bài bị trùng: ${rawLesson.title}`);
    titles.add(rawLesson.title);
    if (rawLesson.sentences.length !== 15
      || !rawLesson.sentences.every((sentence) => typeof sentence === "string" && sentence.trim())) {
      throw new Error(`Bài ${index + 1} phải có đúng 15 câu chữ Hán.`);
    }
    return {
      order: rawLesson.order,
      title: rawLesson.title,
      sentences: rawLesson.sentences.map((sentence) => sentence.trim()),
    };
  });

  return { courseCode: COURSE_CODE, lessons };
}

function blockQuestionIds(config: Prisma.JsonValue): string[] | null {
  if (!isRecord(config) || config.source !== "sentence" || !Array.isArray(config.sentenceItemIds)) {
    return null;
  }
  return config.sentenceItemIds.every((id) => typeof id === "string")
    ? config.sentenceItemIds
    : null;
}

async function main() {
  const source = validateSource(JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")) as unknown);
  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: {
      id: true,
      lessons: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          sentences: {
            orderBy: { order: "asc" },
            select: { id: true, chinese: true, order: true },
          },
          learningBlocks: {
            select: { id: true, type: true, order: true, config: true },
          },
        },
      },
    },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE} trong database.`);

  const lessonByTitle = new Map<string, ExistingLesson>();
  for (const lesson of course.lessons) {
    if (lessonByTitle.has(lesson.title)) throw new Error(`Tiêu đề bài trong database bị trùng: ${lesson.title}`);
    lessonByTitle.set(lesson.title, lesson);
  }
  const plans = source.lessons.map((sourceLesson) => {
    const lesson = lessonByTitle.get(sourceLesson.title);
    if (!lesson) throw new Error(`Không tìm thấy bài trong database: ${sourceLesson.title}`);

    const sentencesMatch = lesson.sentences.length === sourceLesson.sentences.length
      && lesson.sentences.every((sentence, index) => (
        sentence.order === index
        && sentence.chinese.trim() === sourceLesson.sentences[index]
      ));
    if (lesson.sentences.length > 0 && !sentencesMatch) {
      throw new Error(`Bài ${sourceLesson.order} đã có câu khác nguồn; không ghi đè: ${sourceLesson.title}`);
    }

    const listeningBlocks = lesson.learningBlocks.filter((block) => block.type === "LISTENING");
    if (listeningBlocks.length > 1) {
      throw new Error(`Bài ${sourceLesson.order} có nhiều block Nghe câu: ${sourceLesson.title}`);
    }
    const listeningBlock = listeningBlocks[0];
    const ids = lesson.sentences.map((sentence) => sentence.id);
    const blockMatches = listeningBlock
      ? JSON.stringify(blockQuestionIds(listeningBlock.config)) === JSON.stringify(ids)
      : false;
    if (listeningBlock && (!sentencesMatch || !blockMatches)) {
      throw new Error(`Bài ${sourceLesson.order} đã có block Nghe câu khác nguồn; không ghi đè: ${sourceLesson.title}`);
    }

    return {
      sourceLesson,
      lesson,
      createSentences: lesson.sentences.length === 0,
      createListeningBlock: !listeningBlock,
      blockOrder: Math.max(0, ...lesson.learningBlocks.map((block) => block.order)) + 1,
    };
  });

  const newSentences = plans.reduce(
    (total, plan) => total + (plan.createSentences ? plan.sourceLesson.sentences.length : 0),
    0,
  );
  const newBlocks = plans.filter((plan) => plan.createListeningBlock).length;
  console.log(`\n=== Import Nghe câu HSK4 2.0 (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`  Bài đối chiếu: ${plans.length}/${source.lessons.length}`);
  console.log(`  Câu mới: ${newSentences}`);
  console.log(`  Block Nghe câu mới: ${newBlocks}`);

  if (!APPLY) {
    console.log("  Chạy lại với --apply để ghi database.");
    return;
  }

  for (const plan of plans) {
    await prisma.$transaction(async (tx) => {
      let sentenceIds = plan.lesson.sentences.map((sentence) => sentence.id);
      if (plan.createSentences) {
        sentenceIds = [];
        for (const [index, chinese] of plan.sourceLesson.sentences.entries()) {
          const sentence = await tx.sentenceItem.create({
            data: {
              lessonId: plan.lesson.id,
              chinese,
              pinyin: "",
              translation: "",
              audioUrl: null,
              order: index,
            },
            select: { id: true },
          });
          sentenceIds.push(sentence.id);
        }
      }

      if (plan.createListeningBlock) {
        await tx.learningBlock.create({
          data: {
            lessonId: plan.lesson.id,
            type: "LISTENING",
            title: "Luyện nghe",
            description: "Nghe câu và nhập lại nội dung vừa nghe",
            order: plan.blockOrder,
            required: true,
            config: {
              source: "sentence",
              vocabItemIds: [],
              sentenceItemIds: sentenceIds,
              answerMode: "chinese",
              maxReplays: 0,
              shuffle: false,
            },
          },
        });
      }
    });
  }

  console.log(`  Đã ghi ${newSentences} câu và ${newBlocks} block Nghe câu.`);
}

main()
  .catch((error) => {
    console.error("\n❌ Import Nghe câu HSK4 2.0 thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
