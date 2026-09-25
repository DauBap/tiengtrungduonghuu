import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const COURSES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "courses");
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const prisma = new PrismaClient();

const COURSE_META: Record<string, { code: string; title: string; hskLevel: number; order: number }> = {
  "hsk1_2-0": { code: "HSK1-2.0", title: "HSK 1 (2.0)", hskLevel: 1, order: 1 },
  "hsk1_3-0": { code: "HSK1-3.0", title: "HSK 1 (3.0)", hskLevel: 1, order: 2 },
  "hsk2_2-0": { code: "HSK2-2.0", title: "HSK 2 (2.0)", hskLevel: 2, order: 3 },
  "hsk2_3-0": { code: "HSK2-3.0", title: "HSK 2 (3.0)", hskLevel: 2, order: 4 },
  "hsk3_2-0": { code: "HSK3-2.0", title: "HSK 3 (2.0)", hskLevel: 3, order: 5 },
  "hsk3_3-0": { code: "HSK3-3.0", title: "HSK 3 (3.0)", hskLevel: 3, order: 6 },
  "hsk4_2-0": { code: "HSK4-2.0", title: "HSK 4 (2.0)", hskLevel: 4, order: 7 },
  "hsk4_3-0": { code: "HSK4-3.0", title: "HSK 4 (3.0)", hskLevel: 4, order: 8 },
  "hsk5_2.0": { code: "HSK5-2.0", title: "HSK 5 (2.0)", hskLevel: 5, order: 9 },
};

const DIALOG_AUDIO_SUFFIX = [1, 3, 5, 7];

interface DialogueFile {
  lesson: number;
  title: string;
  title_pinyin: string;
  title_vi: string;
  dialogs: Array<{
    id: string;
    id_vi: string;
    lines: Array<{ speaker?: string; zh: string; pinyin: string; vi: string }>;
  }>;
}

function dialogAudioUrl(hskLevel: number, lessonOrder: number, dialogIndex: number): string | null {
  const suffix = DIALOG_AUDIO_SUFFIX[dialogIndex];
  if (suffix == null) return null;

  const hsk = `hsk${hskLevel}`;
  const name = `${String(lessonOrder).padStart(2, "0")}-${suffix}.mp3`;
  const onDisk = path.join(PROJECT_ROOT, "public", "audio", "lessons", hsk, name);
  if (!fs.existsSync(onDisk)) return null;

  return `/audio/lessons/${hsk}/${name}`;
}

async function ensureListeningBlock(lessonId: string, sentenceIds: string[]) {
  await prisma.learningBlock.upsert({
    where: { lessonId_type: { lessonId, type: "LISTENING" } },
    update: {
      title: "Luyện nghe",
      description: "Nghe câu và nhập lại nội dung vừa nghe",
      order: 2,
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
    create: {
      lessonId,
      type: "LISTENING",
      title: "Luyện nghe",
      description: "Nghe câu và nhập lại nội dung vừa nghe",
      order: 2,
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

function readLegacyListeningPractice(courseDir: string, lessonNumber: number): string[] | null {
  const practicePath = path.join(courseDir, "listening-practice.ts.txt");
  if (!fs.existsSync(practicePath)) return null;

  try {
    const source = fs.readFileSync(practicePath, "utf8");
    const body = source
      .replace(/import\s+type\s+.*?;\s*/gs, "")
      .replace(/^export\s+const\s+\w+\s*:\s*Record<number,\s*[^=]+>\s*=\s*/, "")
      .replace(/;\s*$/s, "");

    const parsed = Function(`"use strict"; return (${body});`)() as Record<number, Array<{ zh?: string } | string>>;
    const lessonQuestions = parsed?.[lessonNumber];
    if (!Array.isArray(lessonQuestions)) return null;

    const values = lessonQuestions
      .map((item) => (typeof item === "string" ? item : item?.zh))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    return values;
  } catch (error) {
    console.warn(`  ⚠ ${path.basename(courseDir)}: không đọc được listening-practice.ts.txt, fallback về dialogue.json`);
    return null;
  }
}

function normalizeSentenceEntry(sentence: string | {
  chinese: string;
  pinyin?: string;
  translation?: string;
  note?: string | null;
  audioUrl?: string | null;
}) {
  const entry = typeof sentence === "string" ? { chinese: sentence } : sentence;

  return {
    chinese: entry.chinese.trim(),
    pinyin: entry.pinyin?.trim() ?? "",
    translation: entry.translation?.trim() ?? "",
    note: entry.note ?? null,
    audioUrl: entry.audioUrl ?? null,
  };
}

async function migrateCourseListening(folder: string) {
  const courseDir = path.join(COURSES_DIR, folder);
  const lessonsRoot = path.join(courseDir, "lessons");
  if (!fs.existsSync(lessonsRoot)) {
    console.log(`  ⚠ ${folder}: không có lessons/, bỏ qua`);
    return 0;
  }

  const meta = COURSE_META[folder];
  const course = APPLY
    ? await prisma.course.upsert({
        where: { code: meta.code },
        update: { title: meta.title, hskLevel: meta.hskLevel, order: meta.order },
        create: {
          code: meta.code,
          title: meta.title,
          description: `Khóa học ${meta.title}`,
          hskLevel: meta.hskLevel,
          status: "PUBLISHED",
          order: meta.order,
        },
      })
    : null;

  let migratedLessons = 0;
  let sentenceCount = 0;

  for (const lessonDirName of fs.readdirSync(lessonsRoot).filter((name) => fs.statSync(path.join(lessonsRoot, name)).isDirectory()).sort()) {
    const lessonDir = path.join(lessonsRoot, lessonDirName);
    const dialoguePath = path.join(lessonDir, "dialogue.json");
    if (!fs.existsSync(dialoguePath)) continue;

    const dialogue = JSON.parse(fs.readFileSync(dialoguePath, "utf8")) as DialogueFile;
    const lessonNumber = dialogue.lesson;
    const lesson = course
      ? await prisma.lesson.findFirst({ where: { courseId: course.id, order: lessonNumber } })
      : await prisma.lesson.findFirst({ where: { course: { code: meta.code }, order: lessonNumber } });

    if (!lesson) {
      console.log(`  ⚠ ${folder}/lesson ${lessonNumber}: không tìm thấy lesson trong DB`);
      continue;
    }

    const sentenceIds: string[] = [];
    let order = 0;

    if (APPLY) {
      await prisma.sentenceItem.deleteMany({ where: { lessonId: lesson.id } });

      const legacySentences = readLegacyListeningPractice(courseDir, lessonNumber);
      const sentences = (legacySentences ?? dialogue.dialogs.flatMap((dialog, dialogIndex) => {
        const dialogAudio = dialog.lines.length === 1 ? dialogAudioUrl(meta.hskLevel, lessonNumber, dialogIndex) : null;

        return dialog.lines.map((line) => ({
          chinese: line.zh.trim(),
          pinyin: line.pinyin.trim(),
          translation: line.vi.trim(),
          note: line.speaker ? `Speaker: ${line.speaker}` : null,
          audioUrl: dialog.lines.length === 1 ? dialogAudio : null,
        }));
      })).map(normalizeSentenceEntry);

      for (const sentence of sentences) {
        const created = await prisma.sentenceItem.create({
          data: {
            lessonId: lesson.id,
            chinese: sentence.chinese,
            pinyin: sentence.pinyin,
            translation: sentence.translation,
            note: sentence.note,
            audioUrl: sentence.audioUrl,
            order: order++,
          },
          select: { id: true },
        });
        sentenceIds.push(created.id);
        sentenceCount++;
      }

      await ensureListeningBlock(lesson.id, sentenceIds);
    }

    migratedLessons++;
  }

  if (!APPLY) {
    console.log(`  ✓ ${meta.code}: dry-run, không ghi DB`);
    return 0;
  }

  console.log(`  ✓ ${meta.code}: ${migratedLessons} bài, ${sentenceCount} câu`);
  return sentenceCount;
}

async function main() {
  console.log(`\n=== Migrate listening data from courses/ → DB ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);

  if (!fs.existsSync(COURSES_DIR)) {
    throw new Error(`Không tìm thấy folder courses/ tại ${COURSES_DIR}`);
  }

  let total = 0;
  for (const folder of Object.keys(COURSE_META)) {
    const courseDir = path.join(COURSES_DIR, folder);
    if (!fs.existsSync(courseDir)) continue;
    total += await migrateCourseListening(folder);
  }

  console.log(`\nTotal sentences migrated: ${total}`);
  if (!APPLY) {
    console.log("Chạy lại với --apply để ghi dữ liệu vào DB.");
  }
}

main()
  .catch((error) => {
    console.error("\n❌ Migration nghe câu thất bại:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
