// Migrate nội dung học từ folder `courses/` (repo root) vào DB.
//
// Nguồn: courses/<courseId>/course.json + lessons/<NN>/{vocab,dialogue}.json
// Đích:  Course → Lesson → VocabItem / LessonAudioScript+LessonAudioSpeaker
//        + FLASHCARD block, Exercise, Test cho mỗi bài.
//
// Phạm vi đợt này: vocab + dialogue + audio dialogue. Workbook (workbook.json)
// và ngữ pháp (grammar.ts.txt) CHƯA migrate — xem ghi chú cuối file.
//
// Nguyên tắc:
//  - Idempotent. Khóa theo Course.code và (courseId, order) của Lesson nên chạy
//    lại không nhân bản. Vocab/audio của một bài được thay toàn bộ (delete rồi
//    tạo lại) để lần chạy sau phản ánh đúng file nguồn.
//  - Không chạm data user (User/Enrollment/Progress/Exam).
//
// Dry-run mặc định; thêm --apply để ghi thật.
//   npx tsx prisma/migrate-courses.ts
//   npx tsx prisma/migrate-courses.ts --apply

import { PrismaClient, type WordType } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");

const COURSES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "courses");
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const prisma = new PrismaClient();

// ─── Mapping ─────────────────────────────────────────────────────────────────

/** Folder trong courses/ → metadata của Course. Thứ tự ở đây là thứ tự hiển thị. */
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

/**
 * `vocab.json` mang từ loại dưới dạng số (field `adj`) theo bảng 21 giá trị của
 * app cũ, còn enum WordType chỉ có 12. Các giá trị không có enum tương ứng được
 * gộp về nhóm gần nhất — ghi rõ ở đây vì đó là quyết định mất thông tin:
 *  - 5 động từ năng nguyện → VERB
 *  - 9 từ phương vị        → NOUN
 *  - 14/15 trợ từ nghi vấn / ngữ khí → PARTICLE
 *  - 17 cấu trúc câu, 19/20 tiền/hậu tố → PHRASE
 *  - 18 trạng từ → ADVERB (trùng nghĩa với 7 phó từ)
 */
const ADJ_TO_WORD_TYPE: Record<number, WordType> = {
  1: "PRONOUN",
  2: "NOUN",
  3: "NOUN", // tên riêng — enum không có PROPER_NOUN
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

/**
 * Thứ tự 课文 trong dialogue.json → hậu tố file mp3.
 * Audio đặt tên `<NN>-1/3/5/7.mp3`, đánh số lẻ chứ không liên tiếp, nên không
 * suy ra được từ index bằng phép tính — tra bảng cho khỏi đoán sai.
 */
const DIALOG_AUDIO_SUFFIX = [1, 3, 5, 7];

// ─── Types của file nguồn ────────────────────────────────────────────────────

interface VocabFile {
  id: number;
  label?: string;
  title: string;
  short_vi: string;
  data: Array<{ pos: number; hanzi: string; pinyin: string; vi: string; adj: number | number[] | null }>;
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function toWordTypes(adj: number | number[] | null | undefined): WordType[] {
  const raw = Array.isArray(adj) ? adj : adj == null ? [] : [adj];
  const mapped = raw
    .map((n) => ADJ_TO_WORD_TYPE[n])
    .filter((t): t is WordType => Boolean(t));
  return [...new Set(mapped)];
}

/**
 * URL audio của một 课文, hoặc null nếu file không có trên disk.
 * Kiểm tra sự tồn tại thật thay vì tin quy ước — thiếu file thì để null để
 * player không hiện thanh audio 404.
 */
function dialogAudioUrl(hskLevel: number, lessonOrder: number, dialogIndex: number): string | null {
  const suffix = DIALOG_AUDIO_SUFFIX[dialogIndex];
  if (suffix == null) return null;

  const hsk = `hsk${hskLevel}`;
  const name = `${String(lessonOrder).padStart(2, "0")}-${suffix}.mp3`;
  const onDisk = path.join(PUBLIC_DIR, "audio", "lessons", hsk, name);
  if (!fs.existsSync(onDisk)) return null;

  return `/audio/lessons/${hsk}/${name}`;
}

// ─── Migration ───────────────────────────────────────────────────────────────

const stats = {
  courses: 0,
  lessons: 0,
  vocab: 0,
  audioScripts: 0,
  speakers: 0,
  blocks: 0,
  missingAudio: [] as string[],
  unmappedAdj: new Map<string, number>(),
};

async function migrateLesson(
  courseFolder: string,
  courseId: string,
  hskLevel: number,
  lessonDir: string
) {
  const vocabPath = path.join(lessonDir, "vocab.json");
  const dialoguePath = path.join(lessonDir, "dialogue.json");

  // vocab.json là file duy nhất mang title/subtitle của bài nên không có nó thì
  // không dựng được Lesson.
  if (!fs.existsSync(vocabPath)) return;

  const vocab = readJson<VocabFile>(vocabPath);
  const order = vocab.id;
  const title = vocab.title.trim();
  const subtitle = vocab.short_vi.trim();

  if (!APPLY) {
    stats.lessons++;
    stats.vocab += vocab.data.length;
    for (const v of vocab.data) {
      const raw = Array.isArray(v.adj) ? v.adj : v.adj == null ? [] : [v.adj];
      for (const n of raw) {
        if (!ADJ_TO_WORD_TYPE[n]) {
          const key = `adj=${JSON.stringify(n)}`;
          stats.unmappedAdj.set(key, (stats.unmappedAdj.get(key) ?? 0) + 1);
        }
      }
    }
    if (fs.existsSync(dialoguePath)) {
      const dialogue = readJson<DialogueFile>(dialoguePath);
      dialogue.dialogs.forEach((d, i) => {
        stats.audioScripts++;
        stats.speakers += d.lines.length;
        if (!dialogAudioUrl(hskLevel, order, i)) {
          stats.missingAudio.push(`${courseFolder}/bài ${order}/${d.id}`);
        }
      });
    }
    return;
  }

  // Lesson: khóa theo (courseId, order) — chạy lại thì cập nhật, không thêm mới.
  const existing = await prisma.lesson.findFirst({ where: { courseId, order }, select: { id: true } });
  const lesson = existing
    ? await prisma.lesson.update({ where: { id: existing.id }, data: { title, subtitle } })
    : await prisma.lesson.create({ data: { courseId, order, title, subtitle } });
  stats.lessons++;

  // Vocab: thay toàn bộ. FLASHCARD config trỏ tới vocabItemIds nên block phải
  // được ghi lại sau, với id mới.
  await prisma.vocabItem.deleteMany({ where: { lessonId: lesson.id } });
  const vocabIds: string[] = [];
  for (const v of vocab.data) {
    const created = await prisma.vocabItem.create({
      data: {
        lessonId: lesson.id,
        chinese: v.hanzi.trim(),
        pinyin: v.pinyin.trim(),
        translation: v.vi.trim(),
        wordTypes: toWordTypes(v.adj),
        order: v.pos,
      },
      select: { id: true },
    });
    vocabIds.push(created.id);
    stats.vocab++;
  }

  // Dialogue → LessonAudioScript + speakers. Cascade xoá speakers theo script.
  await prisma.lessonAudioScript.deleteMany({ where: { lessonId: lesson.id } });
  if (fs.existsSync(dialoguePath)) {
    const dialogue = readJson<DialogueFile>(dialoguePath);
    for (const [i, dialog] of dialogue.dialogs.entries()) {
      const audioUrl = dialogAudioUrl(hskLevel, order, i);
      if (!audioUrl) stats.missingAudio.push(`${courseFolder}/bài ${order}/${dialog.id}`);

      await prisma.lessonAudioScript.create({
        data: {
          lessonId: lesson.id,
          title: `${dialog.id_vi} — ${dialog.id}`,
          audioUrl,
          showScript: true,
          order: i,
          speakers: {
            create: dialog.lines.map((line, lineIndex) => ({
              speakerName: line.speaker?.trim() ?? "",
              chinese: line.zh.trim(),
              pinyin: line.pinyin.trim(),
              translation: line.vi.trim(),
              order: lineIndex,
            })),
          },
        },
      });
      stats.audioScripts++;
      stats.speakers += dialog.lines.length;
    }
  }

  // FLASHCARD block: chỉ tạo khi bài có từ vựng — schema yêu cầu tối thiểu 1 id.
  if (vocabIds.length > 0) {
    await prisma.learningBlock.upsert({
      where: { lessonId_type: { lessonId: lesson.id, type: "FLASHCARD" } },
      update: {
        config: {
          vocabItemIds: vocabIds,
          frontSide: "chinese",
          showPinyinOnFront: false,
          shuffle: false,
          autoSpeak: false,
        },
      },
      create: {
        lessonId: lesson.id,
        type: "FLASHCARD",
        title: "Flashcard từ vựng",
        description: "Lật thẻ để ghi nhớ từ vựng của bài",
        order: 1,
        required: true,
        config: {
          vocabItemIds: vocabIds,
          frontSide: "chinese",
          showPinyinOnFront: false,
          shuffle: false,
          autoSpeak: false,
        },
      },
    });
    stats.blocks++;
  }

  // Exercise/Test rỗng để tab bài học hiện đúng khung, admin soạn nội dung sau.
  await prisma.exercise.upsert({
    where: { lessonId: lesson.id },
    update: {},
    create: { lessonId: lesson.id, title: `Bài tập — ${title}` },
  });
  await prisma.test.upsert({
    where: { lessonId: lesson.id },
    update: {},
    create: { lessonId: lesson.id, title: `Kiểm tra — ${title}`, passScore: 70 },
  });
}

async function main() {
  const host = /@([^/]+)\//.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(?)";
  console.log(`\n=== Migrate courses/ → DB ${APPLY ? "(APPLY)" : "(DRY RUN — thêm --apply để ghi)"} ===`);
  console.log(`  target: ${host}`);
  console.log(`  source: ${COURSES_DIR}\n`);

  if (!fs.existsSync(COURSES_DIR)) {
    throw new Error(`Không tìm thấy folder courses/ tại ${COURSES_DIR}`);
  }

  for (const [folder, meta] of Object.entries(COURSE_META)) {
    const courseDir = path.join(COURSES_DIR, folder);
    if (!fs.existsSync(courseDir)) {
      console.log(`  ⚠ ${folder}: không có folder, bỏ qua`);
      continue;
    }

    let courseId = "";
    if (APPLY) {
      const course = await prisma.course.upsert({
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
      });
      courseId = course.id;
    }
    stats.courses++;

    const lessonsRoot = path.join(courseDir, "lessons");
    if (!fs.existsSync(lessonsRoot)) {
      console.log(`  ⚠ ${folder}: không có lessons/, bỏ qua`);
      continue;
    }

    const before = stats.lessons;
    const lessonDirs = fs
      .readdirSync(lessonsRoot)
      .filter((d) => fs.statSync(path.join(lessonsRoot, d)).isDirectory())
      .sort();

    for (const d of lessonDirs) {
      await migrateLesson(folder, courseId, meta.hskLevel, path.join(lessonsRoot, d));
    }

    console.log(`  ✓ ${meta.code}: ${stats.lessons - before} bài`);
  }

  console.log(`\n  Courses:       ${stats.courses}`);
  console.log(`  Lessons:       ${stats.lessons}`);
  console.log(`  VocabItem:     ${stats.vocab}`);
  console.log(`  AudioScript:   ${stats.audioScripts} (${stats.speakers} dòng thoại)`);
  if (APPLY) console.log(`  Flashcard:     ${stats.blocks}`);

  if (stats.unmappedAdj.size > 0) {
    console.log(`\n  ⚠ Giá trị adj không map được (từ đó sẽ không có từ loại):`);
    for (const [key, count] of stats.unmappedAdj) console.log(`      ${key}: ${count} từ`);
  }

  if (stats.missingAudio.length > 0) {
    console.log(`\n  ⚠ Thiếu file audio cho ${stats.missingAudio.length} 课文 (audioUrl = null):`);
    for (const m of stats.missingAudio.slice(0, 10)) console.log(`      ${m}`);
    if (stats.missingAudio.length > 10) {
      console.log(`      … và ${stats.missingAudio.length - 10} mục nữa`);
    }
  }

  console.log(`\n  Chưa migrate đợt này: workbook.json (45 file), grammar.ts.txt (27 file).`);
  if (!APPLY) console.log(`  Chạy lại với --apply để ghi vào DB.`);
  console.log();
}

main()
  .catch((e) => {
    console.error("\n❌ Migration thất bại:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
