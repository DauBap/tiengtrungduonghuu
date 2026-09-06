/**
 * Kho câu hỏi — CRUD trên `Question` + `QuestionOption`.
 *
 * Kho độc lập với mọi đề: một câu dùng lại được ở nhiều `ExamVersion` qua bảng
 * nối `ExamQuestion`. Vì vậy có hai luật bảo vệ lịch sử thi:
 *
 *  - **Không xóa cứng** câu đã dùng ở đâu đó → chỉ set `deletedAt`.
 *  - **Không cho sửa** câu đang nằm trong version đã PUBLISHED. Bản thân đề đã
 *    publish chấm từ `ExamQuestion.snapshot` nên sửa không làm sai điểm, nhưng
 *    admin sẽ tưởng mình vừa sửa được đề đang chạy. Chặn ở đây rồi gợi ý nhân
 *    bản câu là rõ ràng hơn.
 */
import { prisma } from "~/lib/prisma.server";
import {
  QUESTION_TYPE_META,
  TRUE_FALSE_OPTIONS,
  parseQuestionPayload,
  type QuestionPayload,
  type QuestionType,
} from "~/lib/exams";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

// ─── Đọc ─────────────────────────────────────────────────────────────────────

export interface QuestionFilter {
  type?: QuestionType;
  tag?: string;
  difficulty?: number;
  /** Tìm trong nội dung câu hỏi */
  keyword?: string;
  page?: number;
  perPage?: number;
}

export const QUESTIONS_PER_PAGE = 20;

/** Include dùng chung để mọi chỗ trả về cùng một hình dạng dữ liệu. */
const questionInclude = {
  options: { orderBy: { order: "asc" } },
  _count: { select: { usages: true } },
} as const;

export async function listQuestions(filter: QuestionFilter = {}) {
  const perPage = filter.perPage ?? QUESTIONS_PER_PAGE;
  const page = Math.max(1, filter.page ?? 1);

  // Câu đã xóa mềm không bao giờ hiện trong kho
  const where = {
    deletedAt: null,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.tag ? { tags: { has: filter.tag } } : {}),
    ...(filter.difficulty ? { difficulty: filter.difficulty } : {}),
    ...(filter.keyword
      ? { prompt: { contains: filter.keyword, mode: "insensitive" as const } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: questionInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.question.count({ where }),
  ]);

  return { items, total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getQuestion(id: string) {
  return prisma.question.findFirst({ where: { id, deletedAt: null }, include: questionInclude });
}

/** Mọi tag đang dùng, để dựng dropdown lọc thay vì bắt admin nhớ tag. */
export async function listQuestionTags(): Promise<string[]> {
  const rows = await prisma.question.findMany({
    where: { deletedAt: null },
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "vi"));
}

/**
 * Câu này đang được dùng ở đâu.
 *
 * `publishedUsages > 0` là điều kiện chặn sửa; `usages` chỉ để hiện cho admin
 * biết xóa sẽ ảnh hưởng bao nhiêu đề.
 */
export async function getQuestionUsage(questionId: string) {
  const [usages, publishedUsages] = await Promise.all([
    prisma.examQuestion.count({ where: { questionId } }),
    prisma.examQuestion.count({
      where: { questionId, version: { status: { not: "DRAFT" } } },
    }),
  ]);
  return { usages, publishedUsages };
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────

export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  payload: QuestionPayload;
  explanation: string | null;
  difficulty: number | null;
  tags: string[];
  /** Nội dung lựa chọn theo thứ tự, và chỉ số nào là đáp án đúng */
  options: { content: string; isCorrect: boolean }[];
}

/**
 * Kiểm ràng buộc mà zod không diễn đạt được vì nó phụ thuộc `type`.
 *
 * Trả message tiếng Việt cụ thể + tên field để form highlight đúng chỗ.
 */
export function validateQuestionInput(input: QuestionInput): Result<QuestionInput> {
  const meta = QUESTION_TYPE_META[input.type];
  if (!meta.implemented) return { ok: false, error: "Dạng câu hỏi này đang được phát triển" };

  if (!input.prompt.trim()) {
    return { ok: false, error: "Vui lòng nhập nội dung câu hỏi", field: "prompt" };
  }
  if (input.difficulty !== null && (input.difficulty < 1 || input.difficulty > 5)) {
    return { ok: false, error: "Độ khó phải từ 1 đến 5", field: "difficulty" };
  }
  if (input.type === "LISTENING" && !input.payload.audioUrl.trim()) {
    return { ok: false, error: "Câu nghe cần link audio", field: "audioUrl" };
  }

  if (meta.optionMode === "none") return { ok: true, data: input };

  // Không lọc bỏ lựa chọn rỗng: đáp án đúng đánh dấu theo VỊ TRÍ, lọc xong là
  // lệch chỉ số và chấm sai câu. Báo lỗi để admin tự xóa dòng trống.
  if (input.options.some((o) => !o.content.trim())) {
    return { ok: false, error: "Có lựa chọn còn để trống", field: "option" };
  }
  if (input.options.length < 2) {
    return { ok: false, error: "Cần ít nhất 2 lựa chọn", field: "option" };
  }

  const contents = input.options.map((o) => o.content.trim());
  if (new Set(contents).size !== contents.length) {
    return { ok: false, error: "Có hai lựa chọn trùng nội dung", field: "option" };
  }

  const correctCount = input.options.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    return { ok: false, error: "Chọn đáp án đúng", field: "correct" };
  }
  if (meta.optionMode === "multi" && correctCount < 2) {
    return { ok: false, error: "Câu chọn nhiều đáp án cần ít nhất 2 đáp án đúng", field: "correct" };
  }
  if (meta.optionMode !== "multi" && correctCount > 1) {
    return { ok: false, error: "Dạng này chỉ được có 1 đáp án đúng", field: "correct" };
  }
  // Mọi lựa chọn đều đúng thì học viên chọn gì cũng đúng — không còn là câu hỏi
  if (meta.optionMode === "multi" && correctCount === input.options.length) {
    return { ok: false, error: "Cần ít nhất 1 lựa chọn sai", field: "correct" };
  }

  return { ok: true, data: input };
}

/**
 * Đúng/Sai có lựa chọn cố định — admin chỉ chọn nhận định đúng hay sai, không
 * tự nhập chữ, để nhãn không lệch giữa các câu.
 */
export function buildTrueFalseOptions(answerIsTrue: boolean) {
  return TRUE_FALSE_OPTIONS.map((content, i) => ({
    content,
    isCorrect: i === 0 ? answerIsTrue : !answerIsTrue,
  }));
}

export async function createQuestion(input: QuestionInput, createdById: string) {
  const valid = validateQuestionInput(input);
  if (!valid.ok) return valid;

  const question = await prisma.question.create({
    data: {
      type: input.type,
      prompt: input.prompt.trim(),
      payload: input.payload,
      explanation: input.explanation?.trim() || null,
      difficulty: input.difficulty,
      tags: input.tags,
      createdById,
      options: {
        create: input.options.map((o, i) => ({
          content: o.content.trim(),
          isCorrect: o.isCorrect,
          order: i,
        })),
      },
    },
  });
  return { ok: true as const, data: question };
}

/**
 * Sửa câu hỏi.
 *
 * Lựa chọn được xóa hết rồi tạo lại: `QuestionOption.id` mới toanh. An toàn vì
 * đáp án đã lưu của học viên trỏ vào id trong `ExamQuestion.snapshot` (bản đóng
 * băng), không trỏ vào bảng này — và câu đang nằm trong đề đã publish thì đã bị
 * chặn sửa ngay dưới đây.
 */
export async function updateQuestion(id: string, input: QuestionInput) {
  const existing = await prisma.question.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { ok: false as const, error: "Không tìm thấy câu hỏi" };

  const { publishedUsages } = await getQuestionUsage(id);
  if (publishedUsages > 0) {
    return {
      ok: false as const,
      error:
        `Câu này đang nằm trong ${publishedUsages} đề đã phát hành nên không sửa được. ` +
        "Hãy nhân bản câu rồi sửa bản mới.",
    };
  }

  const valid = validateQuestionInput(input);
  if (!valid.ok) return valid;

  await prisma.$transaction([
    prisma.questionOption.deleteMany({ where: { questionId: id } }),
    prisma.question.update({
      where: { id },
      data: {
        type: input.type,
        prompt: input.prompt.trim(),
        payload: input.payload,
        explanation: input.explanation?.trim() || null,
        difficulty: input.difficulty,
        tags: input.tags,
        options: {
          create: input.options.map((o, i) => ({
            content: o.content.trim(),
            isCorrect: o.isCorrect,
            order: i,
          })),
        },
      },
    }),
  ]);
  return { ok: true as const, data: { id } };
}

/** Nhân bản để sửa bản mới khi câu gốc đã bị đóng băng trong đề đã publish. */
export async function duplicateQuestion(id: string, createdById: string) {
  const source = await getQuestion(id);
  if (!source) return { ok: false as const, error: "Không tìm thấy câu hỏi" };

  const copy = await prisma.question.create({
    data: {
      type: source.type,
      prompt: `${source.prompt} (bản sao)`,
      payload: source.payload ?? {},
      explanation: source.explanation,
      difficulty: source.difficulty,
      tags: source.tags,
      createdById,
      options: {
        create: source.options.map((o) => ({
          content: o.content,
          isCorrect: o.isCorrect,
          order: o.order,
        })),
      },
    },
  });
  return { ok: true as const, data: copy };
}

/**
 * Xóa câu hỏi.
 *
 * Chưa dùng ở đâu → xóa cứng cho kho gọn. Đã dùng → xóa mềm, vì
 * `ExamQuestion.questionId` là `onDelete: Restrict`; xóa cứng sẽ lỗi FK và làm
 * đứt liên kết của các đề đang tham chiếu.
 */
export async function deleteQuestion(id: string) {
  const existing = await prisma.question.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { ok: false as const, error: "Không tìm thấy câu hỏi" };

  const { usages } = await getQuestionUsage(id);
  if (usages === 0) {
    await prisma.question.delete({ where: { id } });
    return { ok: true as const, data: { softDeleted: false } };
  }

  await prisma.question.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const, data: { softDeleted: true } };
}

// ─── Đọc form ────────────────────────────────────────────────────────────────

/**
 * FormData → QuestionInput.
 *
 * Lựa chọn gửi bằng nhiều input cùng tên `option` rồi đọc qua `getAll` — nội
 * dung có thể chứa dấu phẩy nên không dùng lối comma-split như `idList()` ở
 * block-form.server.ts. Ô nào trống vẫn giữ lại để chỉ số `correct` không lệch;
 * `validateQuestionInput` sẽ báo lỗi.
 */
export function parseQuestionForm(form: FormData): Result<QuestionInput> {
  const rawType = String(form.get("type") ?? "");
  const meta = (QUESTION_TYPE_META as Record<string, unknown>)[rawType];
  if (!meta) return { ok: false, error: "Dạng câu hỏi không hợp lệ" };
  const type = rawType as QuestionType;

  const difficultyRaw = String(form.get("difficulty") ?? "").trim();
  const difficulty = difficultyRaw ? Number(difficultyRaw) : null;
  if (difficulty !== null && !Number.isInteger(difficulty)) {
    return { ok: false, error: "Độ khó phải là số nguyên", field: "difficulty" };
  }

  const payload = parseQuestionPayload({
    audioUrl: String(form.get("audioUrl") ?? "").trim(),
    transcript: String(form.get("transcript") ?? "").trim(),
    imageUrl: String(form.get("imageUrl") ?? "").trim(),
  });

  const optionMode = QUESTION_TYPE_META[type].optionMode;
  let options: QuestionInput["options"];

  if (optionMode === "fixed-boolean") {
    options = buildTrueFalseOptions(String(form.get("answerIsTrue") ?? "true") === "true");
  } else if (optionMode === "none") {
    options = [];
  } else {
    const contents = form.getAll("option").map((v) => String(v));
    // Checkbox/radio chỉ gửi các chỉ số được chọn
    const correct = new Set(form.getAll("correct").map((v) => Number(v)));
    options = contents.map((content, i) => ({ content, isCorrect: correct.has(i) }));
  }

  return {
    ok: true,
    data: {
      type,
      prompt: String(form.get("prompt") ?? "").trim(),
      payload,
      explanation: String(form.get("explanation") ?? "").trim() || null,
      difficulty,
      // Tag nhập một dòng phân tách bằng dấu phẩy — tag không chứa dấu phẩy
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      options,
    },
  };
}
