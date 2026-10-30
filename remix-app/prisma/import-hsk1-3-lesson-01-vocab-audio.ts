import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK1-3.0";
const LESSON_ORDER = 1;
const ASSET_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
  "hsk1-3-0-lesson-01-vocabulary",
);
const UPLOADS_DIRECTORY = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL;

const VOCAB_AUDIO_FILES = [
  { chinese: "再见", fileName: "再见.MP3" },
  { chinese: "同学", fileName: "同学.MP3" },
  { chinese: "不客气", fileName: "不客气.MP3" },
  { chinese: "谢谢", fileName: "谢谢.MP3" },
  { chinese: "你们", fileName: "你们.MP3" },
  { chinese: "您", fileName: "您.MP3" },
  { chinese: "老师", fileName: "老师.MP3" },
  { chinese: "们", fileName: "们.MP3" },
  { chinese: "学生", fileName: "学生.MP3" },
  { chinese: "好", fileName: "好.MP3" },
  { chinese: "大家", fileName: "大家.MP3" },
  { chinese: "王老师", fileName: "王老师.MP3" },
  { chinese: "你好", fileName: "你好.MP3" },
] as const;

if (!TARGET_DATABASE_URL) {
  throw new Error("Hãy đặt TARGET_DATABASE_URL tường minh cho production trước khi chạy script.");
}

const prisma = new PrismaClient({
  datasources: { db: { url: TARGET_DATABASE_URL } },
});

function getSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeAssetOnce(destination: string, bytes: Buffer) {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
  try {
    const existing = await readFile(destination);
    if (getSha256(existing) !== getSha256(bytes)) {
      throw new Error(`Tệp đích đã tồn tại nhưng nội dung khác: ${destination}`);
    }
    return;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o640 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function main() {
  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: { id: true, code: true, title: true, hskLevel: true },
  });
  if (!course || course.hskLevel !== 1) {
    throw new Error(`Không tìm thấy khóa HSK 1 có mã ${COURSE_CODE} trong database đích.`);
  }

  const lessons = await prisma.lesson.findMany({
    where: { courseId: course.id, order: LESSON_ORDER },
    select: {
      id: true,
      order: true,
      title: true,
      content: { select: { id: true, chinese: true, audioUrl: true } },
    },
  });
  if (lessons.length !== 1) {
    throw new Error(
      `Cần đúng một bài ${LESSON_ORDER} trong ${COURSE_CODE}, tìm thấy ${lessons.length}. Không có dữ liệu nào được sửa.`,
    );
  }
  const lesson = lessons[0];
  const vocabByChinese = new Map<string, typeof lesson.content>();
  for (const vocab of lesson.content) {
    vocabByChinese.set(vocab.chinese, [...(vocabByChinese.get(vocab.chinese) ?? []), vocab]);
  }

  const updates: Array<{
    id: string;
    chinese: string;
    audioUrl: string;
    bytes: Buffer;
    destination: string;
  }> = [];
  for (const item of VOCAB_AUDIO_FILES) {
    const matches = vocabByChinese.get(item.chinese) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `Từ “${item.chinese}” phải khớp đúng một lần trong bài ${LESSON_ORDER}; tìm thấy ${matches.length}. Không có dữ liệu nào được sửa.`,
      );
    }

    const sourcePath = path.join(ASSET_DIRECTORY, item.fileName);
    const fileInfo = await stat(sourcePath);
    if (!fileInfo.isFile() || fileInfo.size < 4) {
      throw new Error(`Tệp audio thiếu hoặc không hợp lệ: ${sourcePath}`);
    }
    const bytes = await readFile(sourcePath);
    const contentHash = getSha256(bytes);
    const storedFileName = `hsk1-lesson01-${contentHash.slice(0, 20)}.mp3`;
    const storedPathSegments = ["audio", "lessons", lesson.id, storedFileName];
    const relativeAssetPath = path.join(...storedPathSegments);
    const destination = path.resolve(UPLOADS_DIRECTORY, relativeAssetPath);
    const pathFromUploads = path.relative(UPLOADS_DIRECTORY, destination);
    if (pathFromUploads.startsWith("..") || path.isAbsolute(pathFromUploads)) {
      throw new Error(`Đường dẫn lưu tệp vượt khỏi uploads: ${item.chinese}`);
    }
    const audioUrl = `/uploads/${storedPathSegments.map(encodeURIComponent).join("/")}`;
    updates.push({
      id: matches[0].id,
      chinese: item.chinese,
      audioUrl,
      bytes,
      destination,
    });
  }

  console.log(`${APPLY ? "Applying" : "Dry run"} vocabulary audio import`);
  console.log(`Course: ${course.code} — ${course.title}`);
  console.log(`Lesson: ${lesson.order} — ${lesson.title}`);
  console.log(`Uploads directory: ${UPLOADS_DIRECTORY}`);
  for (const update of updates) {
    console.log(`  ${update.chinese}: ${update.audioUrl}`);
  }
  if (!APPLY) {
    console.log(`Dry run complete: ${updates.length} word-audio mappings validated. No files or database rows changed.`);
    console.log("Add --apply to upload files and update VocabItem.audioUrl.");
    return;
  }

  for (const update of updates) {
    await writeAssetOnce(update.destination, update.bytes);
  }

  await prisma.$transaction(
    updates.map(({ id, audioUrl }) =>
      prisma.vocabItem.update({ where: { id }, data: { audioUrl } }),
    ),
  );
  console.log(`Imported ${updates.length} MP3 files and updated the matching vocabulary rows.`);
}

main()
  .catch((error: unknown) => {
    console.error("HSK 1 vocabulary audio import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
