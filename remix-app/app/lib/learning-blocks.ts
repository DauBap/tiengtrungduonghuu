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
import { Layers, Headphones, BookOpen, GraduationCap } from "lucide-react";

export const BLOCK_TYPES = ["FLASHCARD", "LISTENING", "VOCABULARY", "GRAMMAR"] as const;
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

/** Placeholder — sẽ hoàn thiện ở đợt sau */
export const listeningConfigSchema = z.object({
  vocabItemIds: z.array(z.string()).min(1, "Chọn ít nhất 1 từ vựng"),
});

/** Placeholder — sẽ hoàn thiện ở đợt sau */
export const vocabularyConfigSchema = z.object({
  vocabItemIds: z.array(z.string()).min(1, "Chọn ít nhất 1 từ vựng"),
});

/** Placeholder — sẽ hoàn thiện ở đợt sau */
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

export const BLOCK_CONFIG_SCHEMAS = {
  FLASHCARD: flashcardConfigSchema,
  LISTENING: listeningConfigSchema,
  VOCABULARY: vocabularyConfigSchema,
  GRAMMAR: grammarConfigSchema,
} satisfies Record<LearningBlockType, z.ZodTypeAny>;

export type FlashcardConfig = z.infer<typeof flashcardConfigSchema>;
export type ListeningConfig = z.infer<typeof listeningConfigSchema>;
export type VocabularyConfig = z.infer<typeof vocabularyConfigSchema>;
export type GrammarConfig = z.infer<typeof grammarConfigSchema>;

// ─── Metadata ────────────────────────────────────────────────────────────────

export interface BlockMeta {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** false = admin thấy nhưng chưa chọn được ("Sắp có") */
  implemented: boolean;
  defaultTitle: string;
}

export const BLOCK_META: Record<LearningBlockType, BlockMeta> = {
  FLASHCARD: {
    label: "Flashcard",
    description: "Thẻ lật hai mặt để ghi nhớ từ vựng.",
    icon: Layers,
    implemented: true,
    defaultTitle: "Flashcard từ vựng",
  },
  LISTENING: {
    label: "Nghe câu",
    description: "Nghe phát âm và kiểm tra khả năng nhận biết.",
    icon: Headphones,
    implemented: false,
    defaultTitle: "Luyện nghe",
  },
  VOCABULARY: {
    label: "Từ vựng",
    description: "Danh sách từ vựng kèm pinyin và nghĩa.",
    icon: BookOpen,
    implemented: false,
    defaultTitle: "Danh sách từ vựng",
  },
  GRAMMAR: {
    label: "Ngữ pháp",
    description: "Giải thích cấu trúc ngữ pháp kèm ví dụ.",
    icon: GraduationCap,
    implemented: false,
    defaultTitle: "Điểm ngữ pháp",
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
