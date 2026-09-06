/**
 * Registry của module Bài thi.
 *
 * Nguồn duy nhất cho:
 *  - metadata từng dạng câu hỏi (nhãn, cách nhập lựa chọn, có chấm tự động hay không)
 *  - zod schema cho payload riêng của từng dạng
 *  - zod schema cho toàn bộ setting, chia theo nhóm để UI dựng từng form nhỏ
 *  - `resolveSettings()` merge ba tầng đề → phần → câu
 *
 * File này THUẦN, không import gì server-side, để cả admin form và student
 * runner dùng chung. Lệch nhau thì admin soạn một kiểu, học viên bị chấm kiểu
 * khác.
 *
 * Thêm dạng câu hỏi mới:
 *  1. thêm giá trị vào enum QuestionType trong prisma/schema.prisma
 *  2. thêm vào QUESTION_TYPES + QUESTION_TYPE_META ở đây
 *  3. thêm payload schema nếu dạng đó cần dữ liệu riêng
 *  4. thêm nhánh trong ~/lib/exam-grading.ts
 *  5. thêm component trong app/components/exams/types/
 * Không cần đổi cấu trúc bảng.
 */
import { z } from "zod";
import { CircleDot, ListChecks, ToggleLeft, Headphones } from "lucide-react";

// ─── Dạng câu hỏi ────────────────────────────────────────────────────────────

export const QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "LISTENING",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === "string" && (QUESTION_TYPES as readonly string[]).includes(value);
}

/** Đọc giá trị từ form; không hợp lệ → null để caller báo lỗi. */
export function parseQuestionType(value: unknown): QuestionType | null {
  return isQuestionType(value) ? value : null;
}

export interface QuestionTypeMeta {
  /** Nhãn cho admin khi chọn dạng câu hỏi */
  label: string;
  /** Mô tả cho admin, nói rõ cần nhập gì */
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Cách admin nhập lựa chọn:
   *  - "single": nhập tự do, đánh dấu đúng 1 đáp án
   *  - "multi": nhập tự do, đánh dấu ≥1 đáp án
   *  - "fixed-boolean": hệ thống tự tạo Đúng/Sai, admin chỉ chọn cái nào đúng
   *  - "none": không có lựa chọn (dạng nhập tự do, để dành cho FILL_BLANK…)
   */
  optionMode: "none" | "single" | "multi" | "fixed-boolean";
  /** Có ô nhập tự do cho học viên hay không */
  needsText: boolean;
  /** false = phải chờ giáo viên chấm tay (SPEAKING / WRITING sau này) */
  autoGradable: boolean;
  /** false = admin thấy nhưng chưa chọn được ("Sắp có") */
  implemented: boolean;
  /** Câu dẫn hiện cho học viên phía trên phần trả lời */
  studentHint: string;
}

export const QUESTION_TYPE_META: Record<QuestionType, QuestionTypeMeta> = {
  SINGLE_CHOICE: {
    label: "Chọn một đáp án",
    description: "Học viên chọn 1 trong các lựa chọn. Đúng hoàn toàn hoặc sai.",
    icon: CircleDot,
    optionMode: "single",
    needsText: false,
    autoGradable: true,
    implemented: true,
    studentHint: "Chọn một đáp án đúng",
  },
  MULTIPLE_CHOICE: {
    label: "Chọn nhiều đáp án",
    description: "Có từ 2 đáp án đúng. Chấm toàn phần hoặc một phần tùy cài đặt.",
    icon: ListChecks,
    optionMode: "multi",
    needsText: false,
    autoGradable: true,
    implemented: true,
    studentHint: "Chọn tất cả đáp án đúng",
  },
  TRUE_FALSE: {
    label: "Đúng / Sai",
    description: "Hệ thống tự tạo hai lựa chọn Đúng và Sai, chỉ cần chọn cái đúng.",
    icon: ToggleLeft,
    optionMode: "fixed-boolean",
    needsText: false,
    autoGradable: true,
    implemented: true,
    studentHint: "Nhận định này đúng hay sai?",
  },
  LISTENING: {
    label: "Nghe rồi chọn",
    description: "Phát audio rồi cho học viên chọn đáp án. Cần nhập link audio.",
    icon: Headphones,
    optionMode: "single",
    needsText: false,
    autoGradable: true,
    implemented: true,
    studentHint: "Nghe rồi chọn đáp án đúng",
  },
};

/** Nhãn cố định của dạng Đúng/Sai — dùng chung để admin và student không lệch. */
export const TRUE_FALSE_OPTIONS = ["Đúng", "Sai"] as const;

// ─── Payload riêng của câu hỏi ───────────────────────────────────────────────

/**
 * Dữ liệu riêng theo dạng, lưu ở `Question.payload`.
 *
 * Một schema chung với mọi field optional (thay vì union theo type) để câu hỏi
 * đổi dạng không mất dữ liệu đã nhập, và để đọc payload không phải narrow theo
 * type ở mọi call site. Ràng buộc riêng của từng dạng (LISTENING phải có
 * audioUrl) kiểm ở tầng form, nơi có message tiếng Việt cụ thể.
 */
export const questionPayloadSchema = z.object({
  /** LISTENING: link file audio. Dự án không xử lý upload, chỉ nhận URL. */
  audioUrl: z.string().default(""),
  /** LISTENING: nội dung audio, hiện sau khi công bố kết quả */
  transcript: z.string().default(""),
  /** Ảnh minh họa cho câu hỏi (mọi dạng) */
  imageUrl: z.string().default(""),
});

export type QuestionPayload = z.infer<typeof questionPayloadSchema>;

export const DEFAULT_QUESTION_PAYLOAD: QuestionPayload = questionPayloadSchema.parse({});

export function parseQuestionPayload(payload: unknown): QuestionPayload {
  const result = questionPayloadSchema.safeParse(payload ?? {});
  return result.success ? result.data : DEFAULT_QUESTION_PAYLOAD;
}

// ─── Setting ─────────────────────────────────────────────────────────────────

/**
 * Setting chia theo nhóm, mỗi nhóm là một form nhỏ ở trang cài đặt.
 *
 * MỌI field đều có `.default()` → thêm setting mới không cần backfill dữ liệu
 * cũ, hàng cũ parse ra vẫn đủ field.
 *
 * Quy ước xuyên suốt: số 0 nghĩa là "không giới hạn" (thời gian, số lượt, số
 * lần nghe lại). Không dùng null để khỏi phải kiểm hai kiểu ở mọi nơi.
 */

export const generalSettingsSchema = z.object({
  /** % tối thiểu để đạt */
  passScore: z.number().min(0).max(100).default(50),
  showQuestionNumbers: z.boolean().default(true),
  /** Hướng dẫn hiện ở trang giới thiệu trước khi bấm Bắt đầu */
  intro: z.string().default(""),
});

export const timingSettingsSchema = z.object({
  /** 0 = không giới hạn thời gian */
  durationMinutes: z.number().int().min(0).default(0),
  /** Nhắc học viên khi còn N phút; 0 = không nhắc */
  warnBeforeMinutes: z.number().int().min(0).default(5),
  /** Hết giờ server tự nộp. Tắt thì hết giờ chỉ khóa không cho trả lời thêm. */
  autoSubmitOnExpire: z.boolean().default(true),
});

export const navigationSettingsSchema = z.object({
  /** "free" = nhảy câu tùy ý; "sequential" = phải theo thứ tự */
  mode: z.enum(["free", "sequential"]).default("free"),
  allowBack: z.boolean().default(true),
  allowSkip: z.boolean().default(true),
  showProgress: z.boolean().default(true),
});

export const scoringSettingsSchema = z.object({
  /** Điểm gán cho câu mới thêm vào đề */
  defaultPoints: z.number().min(0).default(1),
  /** Trừ điểm khi trả lời sai (0 = không trừ) */
  negativeMarking: z.number().min(0).default(0),
  /** Câu nhiều đáp án: cho điểm theo tỷ lệ đúng thay vì tất-cả-hoặc-không */
  partialCreditMultiChoice: z.boolean().default(false),
});

export const attemptsSettingsSchema = z.object({
  /** 0 = thi lại không giới hạn */
  maxAttempts: z.number().int().min(0).default(1),
  /** Nhiều lượt thì lấy điểm nào làm điểm chính thức */
  keepScore: z.enum(["best", "latest"]).default("best"),
  /** Phải chờ bao lâu mới được thi lại; 0 = thi lại ngay */
  cooldownMinutes: z.number().int().min(0).default(0),
});

export const randomizationSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  /** Lấy ngẫu nhiên N câu từ đề; 0 = lấy hết */
  pickCount: z.number().int().min(0).default(0),
  /** Trộn trong từng phần, giữ nguyên thứ tự các phần */
  shufflePerSection: z.boolean().default(true),
});

export const resultSettingsSchema = z.object({
  /**
   *  - IMMEDIATE: nộp là thấy điểm
   *  - AFTER_EXAM_CLOSE: chờ qua `endAt` của rule phân quyền
   *  - MANUAL_RELEASE: admin bấm công bố
   */
  mode: z.enum(["IMMEDIATE", "AFTER_EXAM_CLOSE", "MANUAL_RELEASE"]).default("IMMEDIATE"),
  showScore: z.boolean().default(true),
  showCorrectAnswers: z.boolean().default(true),
  showExplanation: z.boolean().default(true),
});

export const securitySettingsSchema = z.object({
  /**
   * Ba mục dưới đây chỉ là NHẮC NHỞ, không phải chống gian lận thật —
   * học viên vẫn có thể xem đề bằng devtools. UI phải nói rõ điều này.
   */
  blockCopy: z.boolean().default(false),
  singleSessionOnly: z.boolean().default(false),
  warnOnTabBlur: z.boolean().default(false),
});

export const audioSettingsSchema = z.object({
  /** Số lần nghe lại mỗi câu; 0 = không giới hạn */
  maxReplays: z.number().int().min(0).default(0),
  autoPlayFirst: z.boolean().default(false),
});

export const examSettingsSchema = z.object({
  general: generalSettingsSchema.default(generalSettingsSchema.parse({})),
  timing: timingSettingsSchema.default(timingSettingsSchema.parse({})),
  navigation: navigationSettingsSchema.default(navigationSettingsSchema.parse({})),
  scoring: scoringSettingsSchema.default(scoringSettingsSchema.parse({})),
  attempts: attemptsSettingsSchema.default(attemptsSettingsSchema.parse({})),
  randomization: randomizationSettingsSchema.default(randomizationSettingsSchema.parse({})),
  result: resultSettingsSchema.default(resultSettingsSchema.parse({})),
  security: securitySettingsSchema.default(securitySettingsSchema.parse({})),
  audio: audioSettingsSchema.default(audioSettingsSchema.parse({})),
});

export type ExamSettings = z.infer<typeof examSettingsSchema>;
export type ExamSettingsGroup = keyof ExamSettings;

export const DEFAULT_EXAM_SETTINGS: ExamSettings = examSettingsSchema.parse({});

/** Thứ tự các nhóm hiện ở trang cài đặt, kèm nhãn tiếng Việt. */
export const SETTINGS_GROUPS = [
  { key: "general", label: "Chung", description: "Điểm đạt và hướng dẫn trước khi thi." },
  { key: "timing", label: "Thời gian", description: "Thời lượng, nhắc hết giờ, tự động nộp." },
  { key: "navigation", label: "Điều hướng", description: "Cách học viên di chuyển giữa các câu." },
  { key: "scoring", label: "Tính điểm", description: "Điểm mặc định, trừ điểm, điểm một phần." },
  { key: "attempts", label: "Số lượt thi", description: "Số lần thi lại và khoảng chờ." },
  { key: "randomization", label: "Trộn đề", description: "Trộn câu hỏi, trộn lựa chọn, rút đề." },
  { key: "result", label: "Kết quả", description: "Khi nào và những gì học viên được xem." },
  { key: "security", label: "Bảo mật", description: "Các biện pháp nhắc nhở khi làm bài." },
  { key: "audio", label: "Âm thanh", description: "Số lần nghe lại, tự phát." },
] as const satisfies readonly { key: ExamSettingsGroup; label: string; description: string }[];

/**
 * Override cấp phần và cấp câu: mọi field optional, field nào không đặt thì
 * lấy của tầng trên. Chỉ mở những field thực sự có nghĩa khi override — cho
 * override `passScore` ở từng câu là vô nghĩa.
 */
export const sectionSettingsSchema = z.object({
  timing: timingSettingsSchema.partial().optional(),
  navigation: navigationSettingsSchema.partial().optional(),
  randomization: randomizationSettingsSchema.partial().optional(),
  audio: audioSettingsSchema.partial().optional(),
});

export const questionSettingsSchema = z.object({
  audio: audioSettingsSchema.partial().optional(),
  scoring: scoringSettingsSchema.partial().optional(),
});

export type SectionSettings = z.infer<typeof sectionSettingsSchema>;
export type QuestionSettings = z.infer<typeof questionSettingsSchema>;

// ─── Parse ───────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Đọc setting từ DB. Dữ liệu hỏng thì trả mặc định thay vì throw — một hàng
 * settings sai không được làm sập cả trang đề.
 */
export function readExamSettings(raw: unknown): ExamSettings {
  const result = examSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_EXAM_SETTINGS;
}

export function readSectionSettings(raw: unknown): SectionSettings {
  const result = sectionSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}

export function readQuestionSettings(raw: unknown): QuestionSettings {
  const result = questionSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}

/** Validate setting từ form admin — sai thì báo lỗi chứ không im lặng lấy mặc định. */
export function parseExamSettings(raw: unknown): ParseResult<ExamSettings> {
  const result = examSettingsSchema.safeParse(raw ?? {});
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cài đặt không hợp lệ" };
}

export function parseSectionSettings(raw: unknown): ParseResult<SectionSettings> {
  const result = sectionSettingsSchema.safeParse(raw ?? {});
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cài đặt phần thi không hợp lệ" };
}

export function parseQuestionSettings(raw: unknown): ParseResult<QuestionSettings> {
  const result = questionSettingsSchema.safeParse(raw ?? {});
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Cài đặt câu hỏi không hợp lệ" };
}

// ─── Merge ba tầng ───────────────────────────────────────────────────────────

/**
 * Setting hiệu lực cho một câu hỏi: đề → phần → câu, tầng sau override tầng trước.
 *
 * MỌI chỗ đọc setting phải đi qua đây, không đọc trực tiếp cột Json — nếu
 * không thì override cấp phần/cấp câu sẽ bị bỏ qua ở đúng chỗ nó cần có tác dụng.
 */
export function resolveSettings(
  examRaw: unknown,
  sectionRaw?: unknown,
  questionRaw?: unknown
): ExamSettings {
  const base = readExamSettings(examRaw);
  const section = readSectionSettings(sectionRaw);
  const question = readQuestionSettings(questionRaw);

  return {
    ...base,
    timing: { ...base.timing, ...section.timing },
    navigation: { ...base.navigation, ...section.navigation },
    randomization: { ...base.randomization, ...section.randomization },
    scoring: { ...base.scoring, ...question.scoring },
    audio: { ...base.audio, ...section.audio, ...question.audio },
  };
}

// ─── Vòng đời đề ─────────────────────────────────────────────────────────────

export const EXAM_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export interface ExamStatusMeta {
  label: string;
  description: string;
  /** Lớp Tailwind cho badge — gom về đây để mọi nơi hiện giống nhau */
  className: string;
}

export const EXAM_STATUS_META: Record<ExamStatus, ExamStatusMeta> = {
  DRAFT: {
    label: "Bản nháp",
    description: "Đang soạn, học viên chưa thấy.",
    className: "bg-muted text-muted-foreground",
  },
  PUBLISHED: {
    label: "Đang phát hành",
    description: "Học viên đủ điều kiện có thể vào thi.",
    className: "bg-success/10 text-success",
  },
  ARCHIVED: {
    label: "Lưu trữ",
    description: "Đã dừng, lượt thi cũ vẫn giữ nguyên.",
    className: "bg-warning/10 text-warning",
  },
};

export function isExamStatus(value: unknown): value is ExamStatus {
  return typeof value === "string" && (EXAM_STATUSES as readonly string[]).includes(value);
}

/** Nhãn phiên bản: "v2 · Đang phát hành". */
export function formatVersionLabel(version: number, status: ExamStatus) {
  return `v${version} · ${EXAM_STATUS_META[status].label}`;
}
