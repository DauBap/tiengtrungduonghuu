// Map HSK1 2.0 lesson audio tracks 1–3 into the lesson tab.
//
// Dry-run by default; add --apply to write to the database:
//   npx tsx prisma/map-hsk1-2-0-lesson-audio.ts
//   npx tsx prisma/map-hsk1-2-0-lesson-audio.ts --apply

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK1-2.0";
const LESSON_COUNT = 15;
const TRACK_COUNT = 3;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(SCRIPT_DIR, "..", "public");
const AUDIO_DIRECTORY = path.join(PUBLIC_DIR, "audio", "lessons", "hsk1_2-0");
const prisma = new PrismaClient();

interface AudioScriptJob {
  lessonId: string;
  lessonOrder: number;
  title: string;
  order: number;
  audioUrl: string;
  existingId?: string;
  needsUpdate: boolean;
}

function assertMp3(filePath: string) {
  if (!fs.existsSync(filePath)) throw new Error(`Thiếu file audio ${filePath}`);
  const file = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(3);
    fs.readSync(file, header, 0, header.length, 0);
    const hasId3Header = header.toString("ascii") === "ID3";
    const hasMpegFrameHeader = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    if (fs.statSync(filePath).size <= 1000 || (!hasId3Header && !hasMpegFrameHeader)) {
      throw new Error(`File không phải MP3 hợp lệ: ${filePath}`);
    }
  } finally {
    fs.closeSync(file);
  }
}

async function main() {
  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: {
      lessons: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          audioScripts: {
            select: { id: true, title: true, audioUrl: true, order: true },
          },
        },
      },
    },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE}.`);
  if (course.lessons.length !== LESSON_COUNT) {
    throw new Error(`Khóa ${COURSE_CODE} cần ${LESSON_COUNT} bài, tìm thấy ${course.lessons.length}.`);
  }

  const jobs: AudioScriptJob[] = [];
  for (const lesson of course.lessons) {
    for (let track = 1; track <= TRACK_COUNT; track++) {
      const fileName = `${String(lesson.order).padStart(2, "0")}-${track}.mp3`;
      assertMp3(path.join(AUDIO_DIRECTORY, fileName));
      const title = `Bài khóa ${track}`;
      const audioUrl = `/audio/lessons/hsk1_2-0/${fileName}`;
      const existing = lesson.audioScripts.filter((script) => script.title === title);
      if (existing.length > 1) {
        throw new Error(`Bài ${lesson.order} có nhiều bản ghi "${title}".`);
      }

      const match = existing[0];
      jobs.push({
        lessonId: lesson.id,
        lessonOrder: lesson.order,
        title,
        order: track - 1,
        audioUrl,
        existingId: match?.id,
        needsUpdate: !match || match.audioUrl !== audioUrl || match.order !== track - 1,
      });
    }
  }

  const pending = jobs.filter((job) => job.needsUpdate);
  console.log(`\n=== Map audio bài khóa ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`  Khóa: ${COURSE_CODE} · ${course.lessons.length} bài`);
  console.log(`  File hợp lệ: ${jobs.length}`);
  console.log(`  Bản ghi cần thêm/cập nhật: ${pending.length}`);

  if (APPLY && pending.length > 0) {
    await prisma.$transaction(pending.map((job) => job.existingId
      ? prisma.lessonAudioScript.update({
          where: { id: job.existingId },
          data: { audioUrl: job.audioUrl, order: job.order },
        })
      : prisma.lessonAudioScript.create({
          data: {
            lessonId: job.lessonId,
            title: job.title,
            audioUrl: job.audioUrl,
            showScript: true,
            order: job.order,
          },
        })));
    console.log(`Đã map ${pending.length} bản ghi bài khóa.`);
  } else if (!APPLY) {
    console.log("Chưa ghi dữ liệu. Chạy lại với --apply để lưu.");
  }
}

main()
  .catch((error) => {
    console.error("Không thể map audio HSK1 2.0:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
