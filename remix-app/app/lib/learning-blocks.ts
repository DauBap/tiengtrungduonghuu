/**
 * Registry các dạng bài học trong phần lý thuyết.
 *
 * Mỗi dạng (LearningBlockType) có:
 *  - một zod schema validate cột `LearningBlock.config` (Json ở DB, không được DB ép kiểu)
 *  - metadata (nhãn, icon, mô tả) dùng chung cho cả admin picker và student renderer
 *
 * Thêm dạng mới = thêm schema + entry trong BLOCK_META + component render.
 * Không cần migration.
 */
import { z } from "zod";
import { Layers, Headphones, BookOpen, GraduationCap, BookMarked } from "lucide-react";

export const BLOCK_TYPES = ["FLASHCARD", "LISTENING", "VOCABULARY", "GRAMMAR", "WORKBOOK"] as const;
export type LearningBlockType = (typeof BLOCK_TYPES)[number];

// ─── Config schemas ──────────────────────────────────────────────────────────

/** Flashcard: chọn từ trong kho từ vựng của bài, lật thẻ để ôn */
export const flashcardConfigSchema = z.object({
  vocabItemIds: z.array(z.string()).min(1, "Chọn ít nhất 1 từ vựng cho thẻ"),
  frontSide: z.enum(["chinese", "translation"]).default("chinese"),
  showPinyinOnFront: z.boolean().default(false),
  shuffle: z.boolean().default(false),
  autoSpeak: z.boolean().default(false),
});

/**
 * Nghe câu: phát audio, học viên nhập lại nội dung vừa nghe.
 *
 * Nguồn câu hỏi lấy từ kho từ vựng (`vocab`) hoặc kho câu mẫu (`sentence`) của
 * bài — hai kho khác bảng nên không gộp id chung một mảng được.
 * `answerMode` quyết định học viên nhập chữ Hán hay pinyin.
 */
export const listeningConfigSchema = z
  .object({
    source: z.enum(["vocab", "sentence"]).default("vocab"),
    vocabItemIds: z.array(z.string()).default([]),
    sentenceItemIds: z.array(z.string()).default([]),
    answerMode: z.enum(["chinese", "pinyin"]).default("chinese"),
    /** Cho nghe lại bao nhiêu lần mỗi câu; 0 = không giới hạn */
    maxReplays: z.number().int().min(0).default(0),
    shuffle: z.boolean().default(false),
  })
  .refine(
    (c) => (c.source === "vocab" ? c.vocabItemIds.length > 0 : c.sentenceItemIds.length > 0),
    { message: "Chọn ít nhất 1 câu hỏi cho phần nghe" }
  );

/**
 * Từ vựng và Ngữ pháp lấy nội dung thẳng từ bài học (`BlockMeta.source: "lesson"`)
 * nên không có block nào mang config hai dạng này. Hai schema dưới đây chỉ tồn
 * tại để `BLOCK_CONFIG_SCHEMAS` phủ đủ mọi LearningBlockType.
 */
export const vocabularyConfigSchema = z.object({
  vocabItemIds: z.array(z.string()).min(1, "Chọn ít nhất 1 từ vựng"),
});

export const grammarConfigSchema = z.object({
  points: z
    .array(
      z.object({
        pattern: z.string().min(1),
        explanation: z.string().min(1),
        examples: z.array(z.object({ chinese: z.string(), pinyin: z.string(), translation: z.string() })).default([]),
      })
    )
    .min(1, "Thêm ít nhất 1 điểm ngữ pháp"),
});

/** Sách bài tập: bài thi mô phỏng HSK với nhiều phần và câu hỏi */
export const workbookConfigSchema = z.object({
  audioUrl: z.string().url("URL audio không hợp lệ").or(z.string().startsWith("/")).optional().or(z.literal("")),
  /** Giới hạn thời gian làm bài (phút); 0 = không giới hạn */
  timeLimit: z.number().int().min(0).default(0),
  /** Số lần được phát lại audio; 0 = không giới hạn */
  maxReplays: z.number().int().min(0).default(0),
  /** Xáo trộn thứ tự câu hỏi */
  shuffleQuestions: z.boolean().default(false),
  /** Hiển thị kết quả ngay sau khi chọn đáp án */
  showResultsImmediately: z.boolean().default(false),
  /** Hiển thị phần dịch trong câu hỏi */
  showTranslation: z.boolean().default(true),
  /** Hiển thị pinyin */
  showPinyin: z.boolean().default(true),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string().min(1, "Tên phần không được trống"),
      titleChinese: z.string().default(""),
      description: z.string().default(""),
      descriptionVietnamese: z.string().default(""),
      /** Shared illustration displayed before the section questions */
      imageUrl: z.string().optional().or(z.literal("")),
      /** Câu ví dụ minh họa cách làm, không tính điểm */
      example: z.object({
        chinese: z.string().default(""),
        pinyin: z.string().default(""),
        translation: z.string().default(""),
        options: z.array(z.object({
          id: z.string(),
          label: z.enum(["A", "B", "C", "D", "E", "F"]),
          text: z.string().default(""),
          pinyin: z.string().default(""),
        })).default([]),
        correctAnswer: z.string().default(""),
      }).optional(),
      questions: z.array(
        z.object({
          id: z.string(),
          number: z.number().int().min(1),
          kind: z.enum(["choice", "input"]).default("choice"),
          prompt: z.string().default(""),
          pinyin: z.string().default(""),
          translation: z.string().default(""),
          passage: z.string().default(""),
          /** URL ảnh đơn (Section 1 style) */
          imageUrl: z.string().optional().or(z.literal("")),
          /** URL ảnh lưới A/B/C/D/E (Section 2 style) */
          images: z.array(z.object({
            label: z.enum(["A", "B", "C", "D", "E", "F"]),
            url: z.string(),
          })).optional(),
          /** Hội thoại kèm theo câu */
          dialogue: z.object({
            chinese: z.string().default(""),
            pinyin: z.string().default(""),
            translation: z.string().default(""),
          }).optional(),
          options: z.array(z.object({
            id: z.string(),
            label: z.enum(["A", "B", "C", "D", "E", "F"]),
            text: z.string().default(""),
            pinyin: z.string().default(""),
          })).default([]),
          gradable: z.boolean().default(true),
          correctAnswer: z.string().default(""),
        }).refine((question) => question.kind === "input" || question.options.length > 0, {
          message: "Câu trắc nghiệm cần có ít nhất một đáp án",
        }).refine((question) => !question.gradable || Boolean(question.correctAnswer.trim()), {
          message: "Câu có chấm điểm phải có đáp án đúng",
        })
      ).default([]),
    })
  ).default([]),
});

export const BLOCK_CONFIG_SCHEMAS = {
  FLASHCARD: flashcardConfigSchema,
  LISTENING: listeningConfigSchema,
  VOCABULARY: vocabularyConfigSchema,
  GRAMMAR: grammarConfigSchema,
  WORKBOOK: workbookConfigSchema,
} satisfies Record<LearningBlockType, z.ZodTypeAny>;

export type FlashcardConfig = z.infer<typeof flashcardConfigSchema>;
export type ListeningConfig = z.infer<typeof listeningConfigSchema>;
export type VocabularyConfig = z.infer<typeof vocabularyConfigSchema>;
export type GrammarConfig = z.infer<typeof grammarConfigSchema>;
export type WorkbookConfig = z.infer<typeof workbookConfigSchema>;

// ─── Metadata ────────────────────────────────────────────────────────────────

export interface BlockMeta {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** false = admin thấy nhưng chưa chọn được ("Sắp có") */
  implemented: boolean;
  /**
   * Nội dung dạng này đến từ đâu:
   *  - "block": admin tạo LearningBlock rồi chọn nội dung trong `config`
   *  - "lesson": đọc thẳng từ bài học (kho từ vựng, các section ngữ pháp),
   *    không cần tạo block — nên cũng không hiện trong picker "Thêm dạng bài học"
   */
  source: "block" | "lesson";
  defaultTitle: string;
}

export const BLOCK_META: Record<LearningBlockType, BlockMeta> = {
  FLASHCARD: {
    label: "Flashcard",
    description: "Thẻ lật hai mặt để ghi nhớ từ vựng.",
    icon: Layers,
    implemented: true,
    source: "block",
    defaultTitle: "Flashcard từ vựng",
  },
  LISTENING: {
    label: "Nghe câu",
    description: "Nghe phát âm rồi nhập lại nội dung để kiểm tra.",
    icon: Headphones,
    implemented: true,
    source: "block",
    defaultTitle: "Luyện nghe",
  },
  VOCABULARY: {
    label: "Từ vựng",
    description: "Danh sách từ vựng kèm pinyin và nghĩa.",
    icon: BookOpen,
    implemented: true,
    source: "lesson",
    defaultTitle: "Danh sách từ vựng",
  },
  GRAMMAR: {
    label: "Ngữ pháp",
    description: "Giải thích cấu trúc ngữ pháp kèm ví dụ và luyện tập.",
    icon: GraduationCap,
    implemented: true,
    source: "lesson",
    defaultTitle: "Điểm ngữ pháp",
  },
  WORKBOOK: {
    label: "Sách bài tập",
    description: "Bài thi mô phỏng HSK với nhiều phần và câu hỏi.",
    icon: BookMarked,
    implemented: true,
    source: "block",
    defaultTitle: "Sách bài tập",
  },
};

export function isLearningBlockType(value: unknown): value is LearningBlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

// ─── Parse ───────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Validate config đọc từ DB hoặc từ form admin.
 * Trả về message tiếng Việt đầu tiên để hiện trong banner lỗi.
 */
export function parseBlockConfig(type: LearningBlockType, config: unknown): ParseResult<unknown> {
  const result = BLOCK_CONFIG_SCHEMAS[type].safeParse(config);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: first?.message ?? "Cấu hình không hợp lệ" };
}

export function parseFlashcardConfig(config: unknown): ParseResult<FlashcardConfig> {
  const result = flashcardConfigSchema.safeParse(config);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cấu hình không hợp lệ" };
}

export function parseListeningConfig(config: unknown): ParseResult<ListeningConfig> {
  const result = listeningConfigSchema.safeParse(config);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cấu hình không hợp lệ" };
}

export function parseWorkbookConfig(config: unknown): ParseResult<WorkbookConfig> {
  const result = workbookConfigSchema.safeParse(config);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cấu hình không hợp lệ" };
}
