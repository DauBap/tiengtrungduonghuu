// Map HSK3 2.0 workbook audio to version-specific public assets.
//
// Dry-run by default; add --apply to write to the database:
//   npx tsx prisma/map-hsk3-2-0-workbook-audio.ts
//   npx tsx prisma/map-hsk3-2-0-workbook-audio.ts --apply

import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbookConfig } from "../app/lib/learning-blocks";

const APPLY = process.argv.includes("--apply");
const COURSE_CODE = "HSK3-2.0";
const WORKBOOK_COUNT = 18;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIRECTORY = path.resolve(
  SCRIPT_DIR,
  "..",
  "public",
  "audio",
  "workbooks",
  "hsk3_2-0",
);
const prisma = new PrismaClient();

interface WorkbookAudioJob {
  id: string;
  lessonOrder: number;
  bookNumber: number;
  audioUrl: string;
  config: Prisma.InputJsonObject;
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

function workbookNumber(audioUrl: string | undefined, lessonOrder: number): number {
  if (!audioUrl) throw new Error(`Bài DB ${lessonOrder} chưa có URL audio để xác định số bài sách.`);

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(audioUrl);
  } catch {
    throw new Error(`URL audio không hợp lệ ở bài DB ${lessonOrder}: ${audioUrl}`);
  }

  const sharedFolderMatch = /^\/audio\/workbooks\/hsk3\/第(\d+)课\.mp3$/.exec(decodedUrl);
  const versionedFolderMatch = /^\/audio\/workbooks\/hsk3_2-0\/(\d{2})\.mp3$/.exec(decodedUrl);
  const match = sharedFolderMatch ?? versionedFolderMatch;
  if (!match) {
    throw new Error(`URL audio không đúng định dạng ở bài DB ${lessonOrder}: ${audioUrl}`);
  }

  return Number(match[1]);
}

async function main() {
  const course = await prisma.course.findUnique({
    where: { code: COURSE_CODE },
    select: {
      lessons: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          learningBlocks: {
            where: { type: "WORKBOOK" },
            select: { id: true, config: true },
          },
        },
      },
    },
  });
  if (!course) throw new Error(`Không tìm thấy khóa ${COURSE_CODE}.`);

  const blocks = course.lessons.flatMap((lesson) =>
    lesson.learningBlocks.map((block) => ({ ...block, lessonOrder: lesson.order })),
  );
  if (blocks.length !== WORKBOOK_COUNT) {
    throw new Error(`Khóa ${COURSE_CODE} cần ${WORKBOOK_COUNT} block sách bài tập, tìm thấy ${blocks.length}.`);
  }

  const jobs: WorkbookAudioJob[] = [];
  const bookNumbers = new Set<number>();
  for (const block of blocks) {
    if (typeof block.config !== "object" || block.config === null || Array.isArray(block.config)) {
      throw new Error(`Config sách bài tập không hợp lệ ở bài DB ${block.lessonOrder}.`);
    }

    const parsed = parseWorkbookConfig(block.config);
    if (!parsed.ok) {
      throw new Error(`Config sách bài tập không hợp lệ ở bài DB ${block.lessonOrder}: ${parsed.error}`);
    }

    const bookNumber = workbookNumber(parsed.data.audioUrl || undefined, block.lessonOrder);
    if (bookNumber < 1 || bookNumber > WORKBOOK_COUNT || bookNumbers.has(bookNumber)) {
      throw new Error(`Số bài sách bài tập không hợp lệ hoặc bị trùng: ${bookNumber}.`);
    }
    bookNumbers.add(bookNumber);

    const fileName = `${String(bookNumber).padStart(2, "0")}.mp3`;
    assertMp3(path.join(AUDIO_DIRECTORY, fileName));
    const audioUrl = `/audio/workbooks/hsk3_2-0/${fileName}`;
    const config = { ...block.config, audioUrl } satisfies Prisma.InputJsonObject;
    const validated = parseWorkbookConfig(config);
    if (!validated.ok) {
      throw new Error(`Config sách bài tập không hợp lệ sau khi map bài ${bookNumber}: ${validated.error}`);
    }

    jobs.push({
      id: block.id,
      lessonOrder: block.lessonOrder,
      bookNumber,
      audioUrl,
      config,
      needsUpdate: parsed.data.audioUrl !== audioUrl,
    });
  }

  if (bookNumbers.size !== WORKBOOK_COUNT) {
    throw new Error(`Cần ${WORKBOOK_COUNT} số bài sách riêng biệt, tìm thấy ${bookNumbers.size}.`);
  }

  const pending = jobs.filter((job) => job.needsUpdate);
  console.log(`\n=== Map audio sách bài tập ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`  Khóa: ${COURSE_CODE} · ${jobs.length} bài`);
  console.log(`  File hợp lệ: ${jobs.length}`);
  console.log(`  Block cần cập nhật: ${pending.length}`);

  if (APPLY && pending.length > 0) {
    await prisma.$transaction(pending.map((job) =>
      prisma.learningBlock.update({
        where: { id: job.id },
        data: { config: job.config },
      }),
    ));
    console.log(`Đã map ${pending.length} block sách bài tập.`);
  } else if (!APPLY) {
    console.log("Chưa ghi dữ liệu. Chạy lại với --apply để lưu.");
  }
}

main()
  .catch((error) => {
    console.error("Không thể map audio sách bài tập HSK3 2.0:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
