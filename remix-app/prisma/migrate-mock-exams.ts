import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";

const APPLY = process.argv.includes("--apply");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const sourceRoot = path.join(repoRoot, "de_thi_thu");
const targetDatabaseUrl = process.env.TARGET_DATABASE_URL;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

type SourceOption = string | { hanzi: string; pinyin?: string }[];

interface ManifestEntry {
  id: string;
  level: string;
  type: string;
  lessonTitle: string;
  questionsFile: string;
  audioFile: string;
  questionCount: number;
  status: string;
}

interface SourceQuestion {
  number: number;
  options: string[];
  answer: string;
}

interface SourcePart {
  start: number;
  end: number;
  title: string;
}

interface SourceExam {
  id: string;
  level: string;
  question_count: number;
  audio_file: string;
  image_files: string[];
  questions: SourceQuestion[];
  answers: Record<string, string>;
  parts: SourcePart[];
  content: Record<string, { text?: string; options?: SourceOption[] }>;
  shared_options: Record<string, SourceOption[]>;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function readManifest(): Promise<ManifestEntry[]> {
  const text = await fs.readFile(path.join(sourceRoot, "manifest.csv"), "utf8");
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) throw new Error("manifest.csv is empty.");
  const headers = parseCsvLine(headerLine);
  const requiredHeaders = ["id", "level", "type", "lesson_title", "questions_file", "audio_file", "question_count", "status"];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`manifest.csv is missing column "${header}".`);
  }

  return lines.filter(Boolean).map((line) => {
    const columns = parseCsvLine(line);
    const value = (key: string) => columns[headers.indexOf(key)] ?? "";
    return {
      id: value("id"),
      level: value("level"),
      type: value("type"),
      lessonTitle: value("lesson_title"),
      questionsFile: value("questions_file"),
      audioFile: value("audio_file"),
      questionCount: Number(value("question_count")),
      status: value("status"),
    };
  });
}

function contentText(option: SourceOption): string {
  if (typeof option === "string") return option;
  const hanzi = option.map((token) => token.hanzi).join("");
  const pinyin = option.map((token) => token.pinyin).filter((value): value is string => Boolean(value)).join(" ");
  return pinyin ? `${hanzi}\n${pinyin}` : hanzi;
}

function getImageForQuestion(exam: SourceExam, number: number): string | null {
  const suffix = number >= 1 && number <= 5
    ? `_image_n${number}.jpg`
    : number >= 11 && number <= 15
      ? "_image_n11-15.jpg"
      : number >= 21 && number <= 25
        ? "_image_d1.jpg"
        : null;
  return suffix ? exam.image_files.find((file) => file.endsWith(suffix)) ?? null : null;
}

function validateExam(entry: ManifestEntry, exam: SourceExam) {
  if (exam.id !== entry.id) throw new Error(`ID mismatch between manifest and JSON for ${entry.id}.`);
  if (!Array.isArray(exam.questions) || exam.questions.length !== entry.questionCount || exam.question_count !== entry.questionCount) {
    throw new Error(`${entry.id}: manifest and JSON question counts do not match.`);
  }
  if (!Array.isArray(exam.parts) || !exam.parts.length) throw new Error(`${entry.id}: no question sections found.`);
  const questionNumbers = new Set(exam.questions.map((question) => question.number));
  const coveredNumbers = new Set<number>();
  for (let number = 1; number <= entry.questionCount; number += 1) {
    if (!questionNumbers.has(number)) throw new Error(`${entry.id}: missing question ${number}.`);
    const question = exam.questions.find((item) => item.number === number);
    if (!question) throw new Error(`${entry.id}: missing question ${number}.`);
    const correctAnswer = exam.answers[String(number)] ?? question.answer;
    const options = exam.content[String(number)]?.options
      ?? exam.shared_options[String(number)]
      ?? question.options;
    if (!correctAnswer || !options || options.length < 2 || options.length !== question.options.length || !question.options.includes(correctAnswer)) {
      throw new Error(`${entry.id}: question ${number} has invalid options or answer.`);
    }
  }
  for (const part of exam.parts) {
    if (part.start < 1 || part.end < part.start || part.end > entry.questionCount) {
      throw new Error(`${entry.id}: section "${part.title}" has an invalid question range.`);
    }
    for (let number = part.start; number <= part.end; number += 1) {
      if (!questionNumbers.has(number)) throw new Error(`${entry.id}: section "${part.title}" references missing question ${number}.`);
      if (coveredNumbers.has(number)) throw new Error(`${entry.id}: question ${number} belongs to multiple sections.`);
      coveredNumbers.add(number);
    }
  }
  if (coveredNumbers.size !== entry.questionCount) throw new Error(`${entry.id}: one or more questions are not assigned to a section.`);
}

async function uploadMedia(filePath: string, blobPath: string, contentType: string): Promise<string> {
  if (!APPLY) return `https://dry-run.invalid/${blobPath}`;
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN is required when using --apply.");
  const uploaded = await put(blobPath, await fs.readFile(filePath), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
    contentType,
  });
  return uploaded.url;
}

async function main() {
  const manifest = await readManifest();
  const importable = manifest.filter((entry) =>
    entry.type === "mock_test" && entry.questionsFile && entry.status === "questions_and_audio",
  );
  const skipped = manifest.filter((entry) => !importable.includes(entry));
  if (!importable.length) throw new Error("No complete mock exams were found in manifest.csv.");
  if (APPLY && !targetDatabaseUrl) throw new Error("Set TARGET_DATABASE_URL explicitly to the dev database before using --apply.");
  if (APPLY && !blobToken) throw new Error("Set BLOB_READ_WRITE_TOKEN before using --apply.");

  const exams: Array<{ entry: ManifestEntry; data: SourceExam; directory: string }> = [];
  for (const entry of importable) {
    const directory = path.join(sourceRoot, entry.level.toLowerCase(), entry.id);
    const jsonPath = path.join(directory, path.basename(entry.questionsFile));
    const data = JSON.parse(await fs.readFile(jsonPath, "utf8")) as SourceExam;
    validateExam(entry, data);
    if (!entry.audioFile || entry.audioFile !== data.audio_file) {
      throw new Error(`${entry.id}: audio filename does not match between manifest and JSON.`);
    }
    await fs.access(path.join(directory, path.basename(entry.audioFile)));
    for (const imageFile of data.image_files) {
      await fs.access(path.join(directory, "images", path.basename(imageFile)));
    }
    exams.push({ entry, data, directory });
    console.log(`${entry.id}: validated ${data.questions.length} questions, ${data.parts.length} sections, ${data.image_files.length} images.`);
  }
  for (const entry of skipped) console.log(`${entry.id}: skipped (${entry.status || "no source status"}).`);

  if (!APPLY) {
    console.log(`Dry run complete: ${exams.length} exam(s) ready. Set TARGET_DATABASE_URL and BLOB_READ_WRITE_TOKEN, then rerun with --apply to upload media and import into the database.`);
    return;
  }

  if (!targetDatabaseUrl) throw new Error("Set TARGET_DATABASE_URL explicitly to the dev database before using --apply.");
  const prisma = new PrismaClient({ datasources: { db: { url: targetDatabaseUrl } } });
  try {
    const levels = [...new Set(exams.map(({ entry }) => Number(entry.level.replace(/\D/g, ""))))];
    const courses = await prisma.course.findMany({
      where: { code: { in: levels.map((level) => `HSK-${level}`) } },
      select: { id: true, code: true },
    });
    const courseByCode = new Map(courses.map((course) => [course.code, course.id]));
    const existingExams = await prisma.mockExam.findMany({
      where: { id: { in: exams.map(({ entry }) => entry.id) } },
      select: { id: true, courseId: true, isPublished: true, _count: { select: { attempts: true } } },
    });
    const existingById = new Map(existingExams.map((exam) => [exam.id, exam]));

    for (const { entry, data, directory } of exams) {
      const level = Number(entry.level.replace(/\D/g, ""));
      const courseId = courseByCode.get(`HSK-${level}`);
      if (!courseId) throw new Error(`${entry.id}: required course HSK-${level} is missing on the target database.`);
      const existing = existingById.get(entry.id);
      if (existing && existing.courseId !== courseId) {
        throw new Error(`${entry.id}: stable exam ID is already used by another course.`);
      }
      if (existing?._count.attempts) {
        throw new Error(`${entry.id}: refusing to replace an exam that already has student attempts.`);
      }
      if (existing?.isPublished) {
        throw new Error(`${entry.id}: unpublish the exam before replacing its imported content.`);
      }
      const audioUrl = await uploadMedia(
        path.join(directory, path.basename(entry.audioFile)),
        `mock-exams/${entry.id}/${path.basename(entry.audioFile)}`,
        "audio/mpeg",
      );
      const imageUrls = new Map<string, string>();
      for (const imageFile of data.image_files) {
        imageUrls.set(imageFile, await uploadMedia(
          path.join(directory, "images", path.basename(imageFile)),
          `mock-exams/${entry.id}/images/${path.basename(imageFile)}`,
          "image/jpeg",
        ));
      }

      const sections = data.parts.map((part, sectionIndex) => ({
        id: `${entry.id}_section_${sectionIndex + 1}`,
        title: part.title,
        order: sectionIndex + 1,
        questions: {
          create: data.questions
            .filter((question) => question.number >= part.start && question.number <= part.end)
            .map((question) => {
            const questionNumber = String(question.number);
            const sourceContent = data.content[questionNumber];
            const sourceOptions = sourceContent?.options
              ?? data.shared_options[questionNumber]
              ?? question.options;
            const correctAnswer = data.answers[questionNumber] ?? question.answer;
            const imageFile = getImageForQuestion(data, question.number);
            return {
              id: `${entry.id}_question_${question.number}`,
              type: question.number <= 20 ? "LISTENING" as const : "SINGLE_CHOICE" as const,
              prompt: sourceContent?.text ?? "",
              imageUrl: imageFile ? imageUrls.get(imageFile) ?? null : null,
              audioUrl: question.number === 1 ? audioUrl : null,
              points: 5,
              order: question.number,
              options: {
                create: sourceOptions.map((option, optionIndex) => ({
                  id: `${entry.id}_question_${question.number}_option_${optionIndex + 1}`,
                  content: contentText(option),
                  isCorrect: question.options[optionIndex] === correctAnswer,
                  order: optionIndex + 1,
                })),
              },
            };
          }),
        },
      }));

      await prisma.$transaction(async (tx) => {
        const existing = await tx.mockExam.findUnique({
          where: { id: entry.id },
          select: { id: true, courseId: true, isPublished: true, _count: { select: { attempts: true } } },
        });
        if (existing && existing.courseId !== courseId) throw new Error(`${entry.id}: exam course changed during import.`);
        if (existing?._count.attempts) throw new Error(`${entry.id}: exam received an attempt during import.`);
        if (existing?.isPublished) throw new Error(`${entry.id}: exam was published during import.`);
        await tx.mockExamSection.deleteMany({ where: { mockExamId: entry.id } });
        await tx.mockExam.upsert({
          where: { id: entry.id },
          create: {
            id: entry.id,
            courseId,
            title: entry.lessonTitle,
            description: `${data.questions.length} câu · Phần nghe: 20 câu · Phần đọc: 20 câu · Mỗi câu đúng 5 điểm · Tổng ${data.questions.length * 5} điểm`,
            durationMinutes: 0,
            passScore: 50,
            maxAttempts: 0,
            shuffleQuestions: false,
            showAnswers: true,
            isPublished: false,
            sections: { create: sections },
          },
          update: {
            title: entry.lessonTitle,
            description: `${data.questions.length} câu · Phần nghe: 20 câu · Phần đọc: 20 câu · Mỗi câu đúng 5 điểm · Tổng ${data.questions.length * 5} điểm`,
            durationMinutes: 0,
            passScore: 50,
            maxAttempts: 0,
            shuffleQuestions: false,
            showAnswers: true,
            sections: { create: sections },
          },
        });
      });
      console.log(`${entry.id}: imported into HSK-${level} as unpublished.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Mock exam migration failed:", error);
  process.exitCode = 1;
});
