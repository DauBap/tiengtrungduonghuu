// Map HSK3 2.0 lesson audio tracks to their version-specific public assets.
//
// Dry-run by default; add --apply to write to the database:
//   npx tsx prisma/map-hsk3-2-0-lesson-audio.ts
//   npx tsx prisma/map-hsk3-2-0-lesson-audio.ts --apply

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK3-2.0";
const LESSON_COUNT = 20;
const TRACK_COUNT = 4;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIRECTORY = path.resolve(
  SCRIPT_DIR,
  "..",
  "public",
  "audio",
  "lessons",
  "hsk3_2-0",
);
const prisma = new PrismaClient();

interface AudioScriptJob {
  id: string;
  lessonOrder: number;
  track: number;
  audioUrl: string;
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
          order: true,
          audioScripts: {
            select: { id: true, audioUrl: true, order: true },
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
  const fileNumbers = new Set<number>();
  for (const lesson of course.lessons) {
    if (lesson.audioScripts.length !== TRACK_COUNT) {
      throw new Error(`Bài ${lesson.order} cần ${TRACK_COUNT} script audio, tìm thấy ${lesson.audioScripts.length}.`);
    }

    for (let track = 1; track <= TRACK_COUNT; track++) {
      const script = lesson.audioScripts.find((item) => item.order === track - 1);
      if (!script) throw new Error(`Bài ${lesson.order} thiếu script audio thứ ${track}.`);

      const currentFile = /^\/audio\/lessons\/hsk3(?:_2-0)?\/(\d{2})-(\d)\.mp3$/.exec(script.audioUrl ?? "");
      if (!currentFile || Number(currentFile[2]) !== track) {
        throw new Error(`Bài ${lesson.order}, track ${track} có URL hiện tại không đúng định dạng: ${script.audioUrl ?? "(trống)"}.`);
      }

      const fileNumber = Number(currentFile[1]);
      fileNumbers.add(fileNumber);
      const fileName = `${currentFile[1]}-${track}.mp3`;
      assertMp3(path.join(AUDIO_DIRECTORY, fileName));
      const audioUrl = `/audio/lessons/hsk3_2-0/${fileName}`;
      jobs.push({
        id: script.id,
        lessonOrder: lesson.order,
        track,
        audioUrl,
        needsUpdate: script.audioUrl !== audioUrl,
      });
    }
  }

  if (fileNumbers.size !== LESSON_COUNT) {
    throw new Error(`Cần ${LESSON_COUNT} số bài audio riêng biệt, tìm thấy ${fileNumbers.size}.`);
  }

  const pending = jobs.filter((job) => job.needsUpdate);
  console.log(`\n=== Map audio bài khóa ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`  Khóa: ${COURSE_CODE} · ${course.lessons.length} bài`);
  console.log(`  File hợp lệ: ${jobs.length}`);
  console.log(`  Bản ghi cần cập nhật: ${pending.length}`);

  if (APPLY && pending.length > 0) {
    await prisma.$transaction(pending.map((job) =>
      prisma.lessonAudioScript.update({
        where: { id: job.id },
        data: { audioUrl: job.audioUrl },
      }),
    ));
    console.log(`Đã map ${pending.length} bản ghi bài khóa.`);
  } else if (!APPLY) {
    console.log("Chưa ghi dữ liệu. Chạy lại với --apply để lưu.");
  }
}

main()
  .catch((error) => {
    console.error("Không thể map audio HSK3 2.0:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
