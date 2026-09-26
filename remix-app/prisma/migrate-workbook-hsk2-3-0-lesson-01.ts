import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkbookConfig, type WorkbookConfig } from "../app/lib/learning-blocks";

const APPLY = process.argv.includes("--apply");
const REPAIR_IMAGES = process.argv.includes("--repair-images");
const REPAIR_OPTION_PINYIN = process.argv.includes("--repair-option-pinyin");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const COURSE_FOLDER = "hsk2_3-0";
const COURSE_CODE = "HSK2-3.0";
const LESSON_ORDER = 1;
const SOURCE_FILE = path.join(PROJECT_ROOT, "courses", COURSE_FOLDER, "lessons", "01", "workbook.json");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const IMAGE_DIR = path.join(PUBLIC_DIR, "images", "workbooks", "hsk2", "bài 1");
const AUDIO_FILE = path.join(PUBLIC_DIR, "audio", "workbooks", "hsk2", "第01课.mp3");
const AUDIO_URL = `/audio/workbooks/hsk2/${encodeURIComponent("第01课.mp3")}`;
const prisma = new PrismaClient();

type OptionLabel = "A" | "B" | "C" | "D" | "E";
type WorkbookOption = WorkbookConfig["sections"][number]["questions"][number]["options"][number];
type LegacyOption = string | { label?: string; text?: string; pinyin?: string; meaning?: string };

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
  correct_label?: string;
  options?: LegacyOption[];
}

interface LegacyPart {
  part?: string;
  description?: string;
  options_pool?: LegacyOption[];
  example?: LegacyQuestion;
  questions?: LegacyQuestion[];
}

interface LegacySection {
  section?: string;
  parts?: LegacyPart[];
  questions?: LegacyQuestion[];
}

interface LegacyWorkbook {
  title?: string;
  lesson: number;
  lesson_title?: string;
  sections: LegacySection[];
}

const OPTION_LABELS = new Set<OptionLabel>(["A", "B", "C", "D", "E"]);

function labelOf(value: LegacyOption): OptionLabel {
  const label = (typeof value === "string" ? value : value.label ?? "").toUpperCase();
  if (!OPTION_LABELS.has(label as OptionLabel)) throw new Error(`Nhãn đáp án không hỗ trợ: ${label || "(trống)"}`);
  return label as OptionLabel;
}

function toOptions(
  rawOptions: LegacyOption[] | undefined,
  pool: LegacyOption[] | undefined,
  idPrefix: string,
) {
  const rawHasText = rawOptions?.some((option) => typeof option !== "string" && Boolean(option.text));
  const selected = rawOptions?.length && (rawHasText || !pool?.length) ? rawOptions : pool ?? rawOptions ?? [];
  return selected.map((option) => ({
    id: `${idPrefix}-${labelOf(option).toLowerCase()}`,
    label: labelOf(option),
    text: typeof option === "string" ? "" : option.text ?? "",
    pinyin: typeof option === "string" ? "" : option.pinyin ?? "",
  }));
}

function mergeOptionPinyin(targetOptions: WorkbookOption[], sourceOptions: WorkbookOption[]) {
  const sourceByLabel = new Map(sourceOptions.map((option) => [option.label, option]));
  let updated = 0;
  const options = targetOptions.map((option) => {
    const sourceOption = sourceByLabel.get(option.label);
    if (!sourceOption?.pinyin) return option;
    if (option.pinyin !== sourceOption.pinyin) updated++;
    return { ...option, pinyin: sourceOption.pinyin };
  });
  return { options, updated };
}

function imageFor(sectionName: string, questionNumber: number): string | undefined {
  let fileName: string | undefined;
  if (sectionName.includes("听力") && questionNumber >= 1 && questionNumber <= 3) {
    fileName = `n1_${questionNumber}.jpeg`;
  }

  if (!fileName) return undefined;
  if (!fs.existsSync(path.join(IMAGE_DIR, fileName))) throw new Error(`Thiếu asset ảnh public: ${fileName}`);
  return `/images/workbooks/hsk2/${encodeURIComponent("bài 1")}/${fileName}`;
}

function sectionImageFor(sectionName: string, questions: LegacyQuestion[]): string | undefined {
  let fileName: string | undefined;
  if (sectionName.includes("听力") && questions.some((question) => question.number === 4)) {
    fileName = "n2.jpeg";
  } else if (sectionName.includes("阅读") && questions.some((question) => question.number === 11)) {
    fileName = "d1.jpeg";
  } else if (sectionName.includes("书写") && questions.some((question) => question.number === 25)) {
    fileName = "v1.jpeg";
  }

  if (!fileName) return undefined;
  if (!fs.existsSync(path.join(IMAGE_DIR, fileName))) throw new Error(`Thiếu asset ảnh public: ${fileName}`);
  return `/images/workbooks/hsk2/${encodeURIComponent("bài 1")}/${fileName}`;
}

function convertExample(example: LegacyQuestion | undefined, part: LegacyPart, id: string) {
  if (!example) return undefined;
  const options = toOptions(example.options, part.options_pool, id);
  if (options.length === 0) return undefined;
  const correctLabel = (example.correct_label ?? example.answer ?? "").toUpperCase();
  const correctAnswer = options.find((option) => option.label === correctLabel)?.id ?? "";
  if (!correctAnswer) throw new Error(`Ví dụ ${id} thiếu đáp án đúng trong options.`);

  return {
    chinese: example.sentence ?? example.question ?? "",
    pinyin: example.pinyin ?? example.question_pinyin ?? "",
    translation: example.meaning ?? example.question_meaning ?? "",
    options,
    correctAnswer,
  };
}

function convertQuestion(
  question: LegacyQuestion,
  part: LegacyPart,
  sectionName: string,
  index: number,
) {
  const number = question.number;
  if (!number) throw new Error(`Câu hỏi thứ ${index + 1} thiếu số câu.`);

  const id = `hsk2-3-0-l01-q${number}`;
  const kind = question.type === "writing_input" ? "input" : "choice";
  const options = kind === "input" ? [] : toOptions(question.options, part.options_pool, id);
  const correctLabel = (question.answer ?? question.correct_label ?? "").toUpperCase();
  const correctAnswer = kind === "input"
    ? (question.answer ?? "").trim()
    : options.find((option) => option.label === correctLabel)?.id ?? "";

  if (!correctAnswer) throw new Error(`Câu ${number} thiếu đáp án đúng hoặc đáp án không nằm trong lựa chọn.`);
  if (kind === "choice" && options.length === 0) throw new Error(`Câu ${number} thiếu các lựa chọn.`);

  const hasPassage = Boolean(question.sentence && question.question);
  const pinyin = [question.pinyin, question.question_pinyin ?? question.prompt_pinyin]
    .filter(Boolean)
    .join("\n");
  const translation = [question.meaning, question.question_meaning].filter(Boolean).join("\n");
  const imageUrl = imageFor(sectionName, number);

  return {
    id,
    number,
    kind,
    prompt: question.question ?? (hasPassage ? "" : question.sentence ?? ""),
    pinyin,
    translation,
    passage: hasPassage ? question.sentence ?? "" : "",
    ...(imageUrl ? { imageUrl } : {}),
    options,
    correctAnswer,
  };
}

function convertWorkbook(source: LegacyWorkbook) {
  const sections = source.sections.flatMap((section, sectionIndex) => {
    const parts = section.parts?.length
      ? section.parts
      : [{ questions: section.questions ?? [] }];

    return parts.map((part, partIndex) => {
      const [description = "", descriptionVietnamese = ""] = (part.description ?? "").split(/\r?\n/, 2);
      const id = `hsk2-3-0-l01-s${sectionIndex + 1}-p${partIndex + 1}`;
      const partQuestions = part.questions ?? [];
      const imageUrl = sectionImageFor(section.section ?? "", partQuestions);
      return {
        id,
        title: part.part ?? section.section ?? `Phần ${sectionIndex + 1}.${partIndex + 1}`,
        titleChinese: "",
        description,
        descriptionVietnamese,
        ...(imageUrl ? { imageUrl } : {}),
        ...(convertExample(part.example, part, `${id}-example`) ? { example: convertExample(part.example, part, `${id}-example`) } : {}),
        questions: partQuestions.map((question, index) =>
          convertQuestion(question, part, section.section ?? "", index),
        ),
      };
    });
  });

  return {
    audioUrl: AUDIO_URL,
    timeLimit: 0,
    maxReplays: 0,
    shuffleQuestions: false,
    showResultsImmediately: false,
    showTranslation: true,
    showPinyin: true,
    sections,
  };
}

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) throw new Error(`Không tìm thấy nguồn: ${SOURCE_FILE}`);
  if (!fs.existsSync(AUDIO_FILE)) throw new Error(`Không tìm thấy audio public: ${AUDIO_FILE}`);

  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8")) as LegacyWorkbook;
  if (source.lesson !== LESSON_ORDER) throw new Error(`Nguồn không phải bài ${LESSON_ORDER}.`);

  const parsed = parseWorkbookConfig(convertWorkbook(source));
  if (!parsed.ok) throw new Error(`Config workbook không hợp lệ: ${parsed.error}`);
  const config = parsed.data;
  const questions = config.sections.flatMap((section) => section.questions);
  const inputCount = questions.filter((question) => question.kind === "input").length;
  const choiceCount = questions.length - inputCount;

  const course = await prisma.course.findUnique({ where: { code: COURSE_CODE }, select: { id: true } });
  if (!course) throw new Error(`Không có course ${COURSE_CODE} trong DB.`);
  const lesson = await prisma.lesson.findFirst({
    where: { courseId: course.id, order: LESSON_ORDER },
    select: { id: true, title: true, learningBlocks: { where: { type: "WORKBOOK" }, select: { id: true, config: true } } },
  });
  if (!lesson) throw new Error(`${COURSE_CODE} chưa có lesson ${LESSON_ORDER} trong DB.`);

  const existingBlock = lesson.learningBlocks[0];
  if (REPAIR_OPTION_PINYIN) {
    if (!existingBlock) throw new Error("Không tìm thấy WORKBOOK block để cập nhật pinyin.");
    const existingConfig = parseWorkbookConfig(existingBlock.config);
    if (!existingConfig.ok) throw new Error(`Config đang lưu không hợp lệ: ${existingConfig.error}`);

    const repairedConfig = structuredClone(existingConfig.data);
    let updatedOptions = 0;
    for (const section of repairedConfig.sections) {
      const sourceSection = config.sections.find((item) => item.id === section.id);
      if (!sourceSection) continue;

      if (section.example && sourceSection.example) {
        const merged = mergeOptionPinyin(section.example.options, sourceSection.example.options);
        section.example.options = merged.options;
        updatedOptions += merged.updated;
      }

      for (const question of section.questions) {
        const sourceQuestion = sourceSection.questions.find((item) => item.number === question.number);
        if (!sourceQuestion) continue;
        const merged = mergeOptionPinyin(question.options, sourceQuestion.options);
        question.options = merged.options;
        updatedOptions += merged.updated;
      }
    }

    const validatedConfig = parseWorkbookConfig(repairedConfig);
    if (!validatedConfig.ok) throw new Error(`Config sau merge pinyin không hợp lệ: ${validatedConfig.error}`);
    console.log(`Target: ${COURSE_CODE} bài ${LESSON_ORDER} — ${lesson.title}`);
    console.log(`Dry-run pinyin: cập nhật pinyin cho ${updatedOptions} lựa chọn; nội dung và ảnh được giữ nguyên.`);
    if (!APPLY) {
      console.log("Chưa ghi database. Dùng --repair-option-pinyin --apply để lưu thay đổi.");
      return;
    }

    const updated = await prisma.learningBlock.update({
      where: { id: existingBlock.id },
      data: { config: validatedConfig.data as Prisma.InputJsonValue },
      select: { id: true },
    });
    console.log(`Đã cập nhật pinyin cho block ${updated.id}.`);
    return;
  }

  if (REPAIR_IMAGES) {
    if (!existingBlock) throw new Error("Không tìm thấy WORKBOOK block để sửa ảnh.");
    const existingConfig = parseWorkbookConfig(existingBlock.config);
    if (!existingConfig.ok) throw new Error(`Config đang lưu không hợp lệ: ${existingConfig.error}`);

    const repairedConfig = structuredClone(existingConfig.data);
    const questionsByNumber = new Map(
      repairedConfig.sections.flatMap((section) => section.questions).map((question) => [question.number, question]),
    );
    const question4 = questionsByNumber.get(4);
    const question5 = questionsByNumber.get(5);
    const question6 = questionsByNumber.get(6);
    const question11 = questionsByNumber.get(11);
    const question12 = questionsByNumber.get(12);
    const question13 = questionsByNumber.get(13);
    const question25 = questionsByNumber.get(25);
    const question26 = questionsByNumber.get(26);
    const question27 = questionsByNumber.get(27);
    const listeningSection = repairedConfig.sections.find((section) =>
      section.questions.some((question) => question.number === 4),
    );
    const readingSection = repairedConfig.sections.find((section) =>
      section.questions.some((question) => question.number === 11),
    );
    const writingSection = repairedConfig.sections.find((section) =>
      section.questions.some((question) => question.number === 25),
    );
    const listeningImage = sectionImageFor("听力", [{ number: 4 }]);
    const readingImage = sectionImageFor("阅读", [{ number: 11 }]);
    const writingImage = sectionImageFor("书写", [{ number: 25 }]);
    if (!question4 || !question5 || !question6 || !question11 || !question12 || !question13
      || !question25 || !question26 || !question27
      || !listeningSection || !readingSection || !writingSection
      || !listeningImage || !readingImage || !writingImage
      || (listeningSection.imageUrl && listeningSection.imageUrl !== listeningImage)
      || (readingSection.imageUrl && readingSection.imageUrl !== readingImage)
      || (question4.imageUrl && question4.imageUrl !== listeningImage)
      || (question5.imageUrl && question5.imageUrl !== listeningImage)
      || (question6.imageUrl && question6.imageUrl !== listeningImage)
      || (question11.imageUrl && question11.imageUrl !== readingImage)
      || (question12.imageUrl && question12.imageUrl !== readingImage)
      || (question13.imageUrl && question13.imageUrl !== readingImage)
      || (writingSection.imageUrl && writingSection.imageUrl !== writingImage)
      || (question25.imageUrl && question25.imageUrl !== writingImage)
      || (question26.imageUrl && question26.imageUrl !== writingImage)
      || (question27.imageUrl && question27.imageUrl !== writingImage)) {
      throw new Error("Ảnh trong nhóm câu 4–6, 11–13 hoặc 25–27 khác trạng thái dự kiến; dừng để tránh ghi đè thay đổi khác.");
    }

    listeningSection.imageUrl = listeningImage;
    readingSection.imageUrl = readingImage;
    writingSection.imageUrl = writingImage;
    delete question4.imageUrl;
    delete question5.imageUrl;
    delete question6.imageUrl;
    delete question11.imageUrl;
    delete question12.imageUrl;
    delete question13.imageUrl;
    delete question25.imageUrl;
    delete question26.imageUrl;
    delete question27.imageUrl;
    const validatedConfig = parseWorkbookConfig(repairedConfig);
    if (!validatedConfig.ok) throw new Error(`Config sau sửa không hợp lệ: ${validatedConfig.error}`);

    console.log(`Target: ${COURSE_CODE} bài ${LESSON_ORDER} — ${lesson.title}`);
    console.log("Dry-run ảnh: đưa n2.jpeg lên đầu nhóm 4–6, d1.jpeg lên đầu nhóm 11–13 và v1.jpeg lên đầu nhóm 25–27; xóa imageUrl riêng ở các câu trong ba nhóm.");
    if (!APPLY) {
      console.log("Chưa ghi database. Dùng --repair-images --apply để lưu các thay đổi này.");
      return;
    }

    const updated = await prisma.learningBlock.update({
      where: { id: existingBlock.id },
      data: { config: validatedConfig.data as Prisma.InputJsonValue },
      select: { id: true },
    });
    console.log(`Đã cập nhật ảnh cho block ${updated.id}.`);
    return;
  }

  if (existingBlock) throw new Error(`Lesson đã có WORKBOOK block; không ghi đè.`);

  const lastBlock = await prisma.learningBlock.findFirst({
    where: { lessonId: lesson.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const host = /@([^/]+)\//.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(không rõ)";
  console.log(`Target: ${COURSE_CODE} bài ${LESSON_ORDER} — ${lesson.title}`);
  console.log(`DB endpoint: ${host}`);
  console.log(`Source: ${path.relative(PROJECT_ROOT, SOURCE_FILE)}`);
  console.log(`Config hợp lệ: ${config.sections.length} phần, ${questions.length} câu (${choiceCount} trắc nghiệm, ${inputCount} điền chữ).`);
  console.log(`Audio: ${AUDIO_URL}`);
  console.log(`Order block: ${(lastBlock?.order ?? 0) + 1}`);

  if (!APPLY) {
    console.log("Dry-run; chưa ghi database. Dùng --apply để tạo đúng một WORKBOOK block.");
    return;
  }

  const block = await prisma.learningBlock.create({
    data: {
      lessonId: lesson.id,
      type: "WORKBOOK",
      title: "Sách bài tập HSK2.3 - Bài 1",
      description: source.title ?? "Sách bài tập HSK2 bài 1",
      required: true,
      order: (lastBlock?.order ?? 0) + 1,
      config: config as Prisma.InputJsonValue,
    },
    select: { id: true, title: true },
  });
  console.log(`Đã tạo block ${block.id}: ${block.title}`);
}

main().catch((error) => {
  console.error("Workbook import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});