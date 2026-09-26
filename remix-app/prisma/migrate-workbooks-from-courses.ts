import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbookConfig, type WorkbookConfig } from "../app/lib/learning-blocks";

// Dry-run all sources by default. Use --all --apply only after reviewing the report.
const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const COURSES_DIR = path.join(PROJECT_ROOT, "courses");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const COURSE_MAP = {
  "hsk1_3-0": { code: "HSK1-3.0", level: 1 },
  "hsk2_3-0": { code: "HSK2-3.0", level: 2 },
  "hsk3_3-0": { code: "HSK3-3.0", level: 3 },
} as const;
const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"] as const;
const prisma = new PrismaClient();

type OptionLabel = (typeof OPTION_LABELS)[number];
type WorkbookOption = WorkbookConfig["sections"][number]["questions"][number]["options"][number];
type LegacyOption = string | {
  label?: string;
  text?: string;
  word?: string;
  pinyin?: string;
  meaning?: string;
  correct?: boolean;
};

interface LegacyVocabulary {
  word?: string;
  pinyin?: string;
  meaning?: string;
}

interface LegacySpeaker {
  text?: string;
  pinyin?: string;
  meaning?: string;
}

interface LegacyQuestion {
  number?: number;
  type?: string;
  question?: string;
  question_pinyin?: string;
  question_meaning?: string;
  sentence?: string;
  pinyin?: string;
  prompt_pinyin?: string;
  meaning?: string;
  answer?: string;
  answer_word?: string;
  answer_pinyin?: string;
  answer_meaning?: string;
  correct_label?: string;
  options?: LegacyOption[];
  speakers?: LegacySpeaker[];
}

interface LegacyPart {
  part?: string;
  description?: string;
  hide_images?: boolean;
  options_pool?: LegacyOption[];
  vocabulary?: LegacyVocabulary[];
  shared_passage?: string;
  shared_passage_start?: number;
  example?: LegacyQuestion;
  questions?: LegacyQuestion[];
}

interface LegacySection {
  section?: string;
  options_pool?: LegacyOption[];
  vocabulary?: LegacyVocabulary[];
  parts?: LegacyPart[];
  questions?: LegacyQuestion[];
}

interface LegacyWorkbook {
  title?: string;
  lesson: number;
  lesson_title?: string;
  grading_pending?: boolean;
  sections: LegacySection[];
}

interface CourseTarget {
  id: string;
  code: string;
  lessons: Array<{
    id: string;
    order: number;
    title: string;
    learningBlocks: Array<{ id: string; type: string; order: number }>;
  }>;
}

interface MigrationJob {
  courseFolder: keyof typeof COURSE_MAP;
  courseCode: string;
  lessonOrder: number;
  lessonId: string;
  lessonTitle: string;
  sourcePath: string;
  title: string;
  description: string;
  order: number;
  config: WorkbookConfig;
  questionCount: number;
  ungradedCount: number;
  optionFCount: number;
  warnings: string[];
}

function labelOf(option: LegacyOption): OptionLabel {
  const label = (typeof option === "string" ? option : option.label ?? "").toUpperCase();
  if (!OPTION_LABELS.includes(label as OptionLabel)) {
    throw new Error(`Unsupported option label '${label || "(empty)"}'`);
  }
  return label as OptionLabel;
}

function vocabularyPool(part: LegacyPart, section: LegacySection): LegacyOption[] | undefined {
  const pool = part.options_pool ?? section.options_pool;
  if (pool?.length) return pool;

  const vocabulary = part.vocabulary ?? section.vocabulary;
  if (!vocabulary?.length) return undefined;
  return vocabulary.map((entry, index) => ({
    label: OPTION_LABELS[index],
    text: entry.word ?? "",
    pinyin: entry.pinyin ?? "",
    meaning: entry.meaning ?? "",
  }));
}

function toOptions(
  rawOptions: LegacyOption[] | undefined,
  pool: LegacyOption[] | undefined,
  idPrefix: string,
): WorkbookOption[] {
  const rawHasText = rawOptions?.some((option) =>
    typeof option !== "string" && Boolean(option.text || option.word),
  );
  const selected = rawOptions?.length && (rawHasText || !pool?.length)
    ? rawOptions
    : pool ?? rawOptions ?? [];

  return selected.map((option) => ({
    id: `${idPrefix}-${labelOf(option).toLowerCase()}`,
    label: labelOf(option),
    text: typeof option === "string" ? "" : option.text ?? option.word ?? "",
    pinyin: typeof option === "string" ? "" : option.pinyin ?? "",
  }));
}

function publicImageUrl(
  courseFolder: keyof typeof COURSE_MAP,
  lessonOrder: number,
  mediaDir: string,
  fileName: string,
): string {
  const level = COURSE_MAP[courseFolder].level;
  const directoryNames = level === 1
    ? [`bai${lessonOrder}`, `bai ${lessonOrder}`]
    : level === 2
      ? [`bài ${lessonOrder}`, `bai ${lessonOrder}`, `bai${lessonOrder}`]
      : [`bai ${lessonOrder}`, `bài ${lessonOrder}`];
  const publicRoot = path.join(PUBLIC_DIR, "images", "workbooks", `hsk${level}`);
  const sourcePath = path.join(mediaDir, fileName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Image source missing: ${sourcePath}`);

  const publicPath = directoryNames
    .map((directory) => path.join(publicRoot, directory, fileName))
    .find((candidate) => fs.existsSync(candidate));
  if (!publicPath) throw new Error(`Public image missing for ${courseFolder}/lesson ${lessonOrder}: ${fileName}`);

  return `/${path.relative(PUBLIC_DIR, publicPath).split(path.sep).map(encodeURIComponent).join("/")}`;
}

function mediaFileForStem(mediaFiles: Map<string, string>, stem: string): string | undefined {
  return mediaFiles.get(stem.toLowerCase());
}

function sharedImageFor(
  courseFolder: keyof typeof COURSE_MAP,
  sectionName: string,
  part: LegacyPart,
  partQuestions: LegacyQuestion[],
  readingPartIndex: number,
  mediaFiles: Map<string, string>,
  lessonOrder: number,
  mediaDir: string,
): string | undefined {
  if (part.hide_images || partQuestions.length === 0) return undefined;
  const numbers = new Set(partQuestions.map((question) => question.number).filter((n): n is number => n != null));
  let stem: string | undefined;

  if (sectionName.includes("听力")) {
    if (numbers.has(1)) stem = "n1_q1-3";
    if (numbers.has(4)) stem = "n2";
    if (numbers.has(6)) stem = "n3";
  } else if (sectionName.includes("阅读")) {
    stem = `d${readingPartIndex + 1}`;
  } else if (sectionName.includes("书写") && (numbers.has(25) || numbers.has(26) || numbers.has(27))) {
    stem = "v1";
  }

  if (!stem) return undefined;
  const fileName = mediaFileForStem(mediaFiles, stem);
  return fileName ? publicImageUrl(courseFolder, lessonOrder, mediaDir, fileName) : undefined;
}

function questionImageFor(
  courseFolder: keyof typeof COURSE_MAP,
  questionNumber: number,
  part: LegacyPart,
  mediaFiles: Map<string, string>,
  lessonOrder: number,
  mediaDir: string,
): string | undefined {
  if (part.hide_images) return undefined;
  const level = COURSE_MAP[courseFolder].level;
  const stem = level < 3 && questionNumber >= 1 && questionNumber <= 3
    ? `n1_${questionNumber}`
    : level === 3 && questionNumber >= 28 && questionNumber <= 30
      ? `v1_${questionNumber}`
      : undefined;
  if (!stem) return undefined;
  const fileName = mediaFileForStem(mediaFiles, stem);
  return fileName ? publicImageUrl(courseFolder, lessonOrder, mediaDir, fileName) : undefined;
}

function findCorrectOption(answer: string, options: WorkbookOption[]) {
  const normalized = answer.trim();
  if (!normalized) return undefined;
  const byLabel = options.find((option) => option.label === normalized.toUpperCase());
  return byLabel ?? options.find((option) => option.text.trim() === normalized);
}

function convertExample(
  example: LegacyQuestion | undefined,
  pool: LegacyOption[] | undefined,
  idPrefix: string,
) {
  if (!example) return undefined;
  const options = toOptions(example.options, pool, idPrefix);
  const answer = example.correct_label ?? example.answer ?? "";
  const correctOption = findCorrectOption(answer, options)
    ?? options.find((option) => option.text === example.answer_word);
  const speakers = example.speakers ?? [];
  const chinese = [example.sentence, example.question, ...speakers.map((speaker) => speaker.text)]
    .filter(Boolean)
    .join("\n");
  const pinyin = [example.pinyin, example.question_pinyin, ...speakers.map((speaker) => speaker.pinyin)]
    .filter(Boolean)
    .join("\n");
  const translation = [example.meaning, example.question_meaning, ...speakers.map((speaker) => speaker.meaning)]
    .filter(Boolean)
    .join("\n");

  return {
    chinese,
    pinyin,
    translation,
    options,
    correctAnswer: correctOption?.id ?? "",
  };
}

function convertQuestion(
  courseFolder: keyof typeof COURSE_MAP,
  lessonOrder: number,
  question: LegacyQuestion,
  part: LegacyPart,
  pool: LegacyOption[] | undefined,
  sectionName: string,
  index: number,
  mediaFiles: Map<string, string>,
  mediaDir: string,
  warnings: string[],
) {
  const number = question.number;
  if (!number) throw new Error(`Question ${index + 1} has no number`);

  const id = `${courseFolder}-l${String(lessonOrder).padStart(2, "0")}-q${number}`;
  const kind = question.type === "writing_input" ? "input" : "choice";
  const options = kind === "input" ? [] : toOptions(question.options, pool, id);
  if (kind === "choice" && options.length === 0) throw new Error(`Question ${number} has no options or option pool`);

  const answer = (question.answer ?? question.correct_label ?? "").trim();
  const correctOption = kind === "choice" ? findCorrectOption(answer, options) : undefined;
  const correctAnswer = kind === "input" ? answer : correctOption?.id ?? "";
  const gradable = Boolean(correctAnswer);
  if (kind === "choice" && answer && !correctOption) {
    warnings.push(`Q${number}: source answer '${answer}' does not match options ${options.map((option) => option.label).join("/")}; imported ungraded`);
  }
  const numberStartsSharedPassage = part.shared_passage_start ?? Number.POSITIVE_INFINITY;
  const hasOwnPassage = Boolean(question.sentence && question.question);
  const sharedPassage = part.shared_passage && number >= numberStartsSharedPassage
    ? part.shared_passage
    : "";
  const passage = hasOwnPassage ? question.sentence ?? "" : sharedPassage;
  const prompt = question.question ?? (hasOwnPassage || sharedPassage ? "" : question.sentence ?? "");
  const imageUrl = questionImageFor(courseFolder, number, part, mediaFiles, lessonOrder, mediaDir);

  return {
    id,
    number,
    kind,
    gradable,
    prompt,
    pinyin: [question.pinyin, question.question_pinyin ?? question.prompt_pinyin].filter(Boolean).join("\n"),
    translation: [question.meaning, question.question_meaning].filter(Boolean).join("\n"),
    passage,
    ...(imageUrl ? { imageUrl } : {}),
    options,
    correctAnswer,
  };
}

function audioUrlFor(courseFolder: keyof typeof COURSE_MAP, lessonOrder: number): string | undefined {
  const level = COURSE_MAP[courseFolder].level;
  const fileName = level === 1
    ? `bai${lessonOrder}.mp3`
    : level === 2
      ? `第${String(lessonOrder).padStart(2, "0")}课.mp3`
      : `第${lessonOrder}课.mp3`;
  const filePath = path.join(PUBLIC_DIR, "audio", "workbooks", `hsk${level}`, fileName);
  if (!fs.existsSync(filePath)) return undefined;
  return `/audio/workbooks/hsk${level}/${encodeURIComponent(fileName)}`;
}

function convertWorkbook(
  courseFolder: keyof typeof COURSE_MAP,
  lessonOrder: number,
  source: LegacyWorkbook,
  mediaDir: string,
  warnings: string[],
) {
  const mediaFiles = new Map<string, string>();
  if (fs.existsSync(mediaDir)) {
    for (const name of fs.readdirSync(mediaDir)) {
      if (fs.statSync(path.join(mediaDir, name)).isFile()) {
        mediaFiles.set(path.parse(name).name.toLowerCase(), name);
      }
    }
  }

  let readingPartIndex = 0;
  const sections = (source.sections ?? []).flatMap((section, sectionIndex) => {
    const parts = section.parts?.length ? section.parts : [{ questions: section.questions ?? [] }];
    return parts.map((part, partIndex) => {
      const isReading = (section.section ?? "").includes("阅读");
      const currentReadingIndex = isReading ? readingPartIndex++ : 0;
      const partQuestions = part.questions ?? [];
      const pool = vocabularyPool(part, section);
      const id = `${courseFolder}-l${String(lessonOrder).padStart(2, "0")}-s${sectionIndex + 1}-p${partIndex + 1}`;
      const imageUrl = sharedImageFor(
        courseFolder,
        section.section ?? "",
        part,
        partQuestions,
        currentReadingIndex,
        mediaFiles,
        lessonOrder,
        mediaDir,
      );
      const [description = "", descriptionVietnamese = ""] = (part.description ?? "").split(/\r?\n/, 2);

      return {
        id,
        title: part.part ?? section.section ?? `Phần ${sectionIndex + 1}.${partIndex + 1}`,
        titleChinese: "",
        description,
        descriptionVietnamese,
        ...(imageUrl ? { imageUrl } : {}),
        ...(part.example ? { example: convertExample(part.example, pool, `${id}-example`) } : {}),
        questions: partQuestions.map((question, index) =>
          convertQuestion(courseFolder, lessonOrder, question, part, pool, section.section ?? "", index, mediaFiles, mediaDir, warnings),
        ),
      };
    });
  });

  if (sections.length === 0) throw new Error("Workbook has no sections");
  const audioUrl = audioUrlFor(courseFolder, lessonOrder);
  return {
    ...(audioUrl ? { audioUrl } : {}),
    timeLimit: 0,
    maxReplays: 0,
    shuffleQuestions: false,
    showResultsImmediately: false,
    showTranslation: true,
    showPinyin: true,
    sections,
  };
}

function sourceWorkbooks(courseFolder?: keyof typeof COURSE_MAP) {
  const folders = courseFolder ? [courseFolder] : Object.keys(COURSE_MAP) as Array<keyof typeof COURSE_MAP>;
  return folders.flatMap((folder) => {
    const lessonsDir = path.join(COURSES_DIR, folder, "lessons");
    if (!fs.existsSync(lessonsDir)) return [];
    return fs.readdirSync(lessonsDir)
      .filter((name) => /^\d+$/.test(name))
      .sort()
      .flatMap((lessonDir) => {
        const sourcePath = path.join(lessonsDir, lessonDir, "workbook.json");
        return fs.existsSync(sourcePath) ? [{ folder, lessonDir, sourcePath }] : [];
      });
  });
}

async function main() {
  if (!ALL) throw new Error("Pass --all to inventory/migrate the three 3.0 workbook sets.");
  const sources = sourceWorkbooks();
  const courseCodes = Object.values(COURSE_MAP).map((item) => item.code);
  const targetCourses = await prisma.course.findMany({
    where: { code: { in: courseCodes } },
    select: {
      id: true,
      code: true,
      lessons: {
        select: {
          id: true,
          order: true,
          title: true,
          learningBlocks: { select: { id: true, type: true, order: true } },
        },
      },
    },
  }) as CourseTarget[];
  const coursesByCode = new Map(targetCourses.map((course) => [course.code, course]));
  const jobs: MigrationJob[] = [];
  const skipped: Array<{ source: string; reason: string }> = [];
  const errors: Array<{ source: string; reason: string }> = [];
  const statsByCourse = new Map<string, { sources: number; create: number; existing: number; questions: number; ungraded: number }>();

  for (const sourceFile of sources) {
    const sourceLabel = path.relative(PROJECT_ROOT, sourceFile.sourcePath);
    const meta = COURSE_MAP[sourceFile.folder];
    const lessonOrder = Number(sourceFile.lessonDir);
    const course = coursesByCode.get(meta.code);
    const stats = statsByCourse.get(meta.code) ?? { sources: 0, create: 0, existing: 0, questions: 0, ungraded: 0 };
    stats.sources++;
    statsByCourse.set(meta.code, stats);

    try {
      if (!course) throw new Error(`Target course ${meta.code} missing`);
      const lesson = course.lessons.find((item) => item.order === lessonOrder);
      if (!lesson) throw new Error(`Target lesson ${lessonOrder} missing in ${meta.code}`);

      const source = JSON.parse(fs.readFileSync(sourceFile.sourcePath, "utf8")) as LegacyWorkbook;
      if (source.lesson !== lessonOrder) throw new Error(`File lesson=${source.lesson}, folder lesson=${lessonOrder}`);
      const mediaDir = path.join(path.dirname(sourceFile.sourcePath), "media");
      const warnings: string[] = [];
      const parsed = parseWorkbookConfig(convertWorkbook(sourceFile.folder, lessonOrder, source, mediaDir, warnings));
      if (!parsed.ok) throw new Error(`WorkbookConfig invalid: ${parsed.error}`);

      const questions = parsed.data.sections.flatMap((section) => section.questions);
      const existingBlock = lesson.learningBlocks.find((block) => block.type === "WORKBOOK");
      if (existingBlock) {
        stats.existing++;
        stats.questions += questions.length;
        skipped.push({ source: sourceLabel, reason: `WORKBOOK block already exists (${existingBlock.id}); left untouched` });
        continue;
      }

      const order = Math.max(0, ...lesson.learningBlocks.map((block) => block.order)) + 1;
      const job: MigrationJob = {
        courseFolder: sourceFile.folder,
        courseCode: meta.code,
        lessonOrder,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        sourcePath: sourceLabel,
        title: `Sách bài tập ${meta.code} - Bài ${lessonOrder}`,
        description: source.lesson_title ?? source.title ?? "Sách bài tập",
        order,
        config: parsed.data,
        questionCount: questions.length,
        ungradedCount: questions.filter((question) => !question.gradable).length,
        optionFCount: questions.reduce((count, question) => count + question.options.filter((option) => option.label === "F").length, 0),
        warnings,
      };
      jobs.push(job);
      stats.create++;
      stats.questions += questions.length;
      stats.ungraded += job.ungradedCount;
    } catch (error) {
      errors.push({ source: sourceLabel, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  console.log(`Sources: ${sources.length}; create: ${jobs.length}; existing skipped: ${skipped.length}; errors: ${errors.length}`);
  console.log(`New questions: ${jobs.reduce((sum, job) => sum + job.questionCount, 0)}; ungraded: ${jobs.reduce((sum, job) => sum + job.ungradedCount, 0)}; F options: ${jobs.reduce((sum, job) => sum + job.optionFCount, 0)}`);
  console.log("By course:");
  for (const [code, stats] of statsByCourse) console.log(`  ${code}: sources=${stats.sources}, create=${stats.create}, existing=${stats.existing}, questions=${stats.questions}, ungraded=${stats.ungraded}`);
  const answerWarnings = jobs.flatMap((job) => job.warnings.map((warning) => `${job.sourcePath}: ${warning}`));
  if (answerWarnings.length) {
    console.log(`Answer-key mismatches: ${answerWarnings.length}`);
    for (const warning of answerWarnings) console.log(`  ${warning}`);
  }
  if (skipped.length) console.log(`Skipped existing examples: ${skipped.slice(0, 5).map((entry) => entry.source).join(", ")}${skipped.length > 5 ? ", ..." : ""}`);
  if (errors.length) {
    console.log("Errors:");
    for (const error of errors) console.log(`  ${error.source}: ${error.reason}`);
  }

  if (!APPLY) {
    console.log("Dry-run only; no database changes made. Use --all --apply after reviewing the report.");
    return;
  }
  if (errors.length) throw new Error("Apply aborted because one or more source workbooks failed preflight.");
  if (jobs.length === 0) {
    console.log("No new workbook blocks to create.");
    return;
  }

  const creates = jobs.map((job) => prisma.learningBlock.create({
    data: {
      lessonId: job.lessonId,
      type: "WORKBOOK",
      title: job.title,
      description: job.description,
      order: job.order,
      required: true,
      config: job.config as Prisma.InputJsonValue,
    },
    select: { id: true },
  }));
  const created = await prisma.$transaction(creates);
  console.log(`Created ${created.length} workbook blocks in one transaction.`);
}

main().catch((error) => {
  console.error("Workbook migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});