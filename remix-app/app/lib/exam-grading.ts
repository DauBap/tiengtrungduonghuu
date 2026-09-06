/**
 * Chấm điểm bài thi. THUẦN — không import prisma, không đọc DB.
 *
 * Đây là nơi duy nhất quyết định một câu trả lời đúng hay sai và được mấy điểm.
 * Client KHÔNG BAO GIỜ gửi điểm lên; server luôn tự chấm lại từ snapshot.
 *
 * Vì sao chấm từ snapshot chứ không từ bảng Question: câu hỏi nằm trong kho
 * dùng chung, admin sửa hoặc xóa trong kho là lượt thi cũ đổi nghĩa. Snapshot
 * được đóng băng lúc publish nên lịch sử bất biến.
 */
import { isQuestionType, type ExamSettings, type QuestionType } from "~/lib/exams";

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * Nội dung câu hỏi đã đóng băng, lưu ở `ExamQuestion.snapshot`.
 *
 * Cố ý phẳng và tự chứa: chấm điểm và render đề đã publish chỉ cần đúng object
 * này, không join sang bảng nào.
 */
export interface QuestionSnapshot {
  /** Question.id gốc — chỉ để tra cứu/thống kê, không dùng khi chấm */
  questionId: string;
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  payload: { audioUrl: string; transcript: string; imageUrl: string };
  options: { id: string; content: string; isCorrect: boolean }[];
}

/** Phiên bản snapshot đã bỏ đáp án — đây là thứ duy nhất được gửi cho học viên. */
export type StudentQuestion = Omit<QuestionSnapshot, "options" | "explanation" | "payload"> & {
  options: { id: string; content: string }[];
  payload: { audioUrl: string; imageUrl: string };
};

/**
 * Đọc snapshot từ cột Json.
 *
 * Trả null khi dữ liệu không dùng được, để caller quyết định (bỏ qua câu, hay
 * báo lỗi cả đề) — throw ở đây thì một hàng hỏng làm sập cả lượt thi.
 */
export function readSnapshot(raw: unknown): QuestionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.questionId !== "string" || !isQuestionType(s.type)) return null;
  if (typeof s.prompt !== "string") return null;
  if (!Array.isArray(s.options)) return null;

  const options: QuestionSnapshot["options"] = [];
  for (const raw of s.options) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.content !== "string") return null;
    options.push({ id: o.id, content: o.content, isCorrect: o.isCorrect === true });
  }

  const payload = (s.payload ?? {}) as Record<string, unknown>;
  return {
    questionId: s.questionId,
    type: s.type,
    prompt: s.prompt,
    explanation: typeof s.explanation === "string" ? s.explanation : null,
    payload: {
      audioUrl: typeof payload.audioUrl === "string" ? payload.audioUrl : "",
      transcript: typeof payload.transcript === "string" ? payload.transcript : "",
      imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl : "",
    },
    options,
  };
}

/**
 * Bỏ mọi thứ tiết lộ đáp án: `isCorrect`, `explanation`, `transcript`.
 *
 * Đi qua một hàm riêng thay vì `select` rải rác ở từng loader, để chỉ cần audit
 * một chỗ là biết có lọt đáp án hay không.
 */
export function toStudentQuestion(snapshot: QuestionSnapshot): StudentQuestion {
  return {
    questionId: snapshot.questionId,
    type: snapshot.type,
    prompt: snapshot.prompt,
    payload: { audioUrl: snapshot.payload.audioUrl, imageUrl: snapshot.payload.imageUrl },
    options: snapshot.options.map((o) => ({ id: o.id, content: o.content })),
  };
}

// ─── Chấm một câu ────────────────────────────────────────────────────────────

/** Câu trả lời của học viên, đã đọc từ DB. */
export interface AnswerInput {
  selectedOptionIds: string[];
  textAnswer: string | null;
}

export interface QuestionGrade {
  /** null = chưa chấm được (dạng cần chấm tay) */
  isCorrect: boolean | null;
  /** Điểm thực nhận, đã áp trừ điểm và điểm một phần */
  pointsAwarded: number;
}

/** Câu chưa trả lời: 0 điểm, và KHÔNG bị trừ điểm — bỏ trống khác với trả lời sai. */
const UNANSWERED: QuestionGrade = { isCorrect: false, pointsAwarded: 0 };

function isBlank(answer: AnswerInput | null | undefined): boolean {
  if (!answer) return true;
  return answer.selectedOptionIds.length === 0 && !answer.textAnswer?.trim();
}

/**
 * Chấm các dạng chọn đáp án.
 *
 * So bằng **optionId**, không bao giờ so theo index — nhờ vậy trộn lựa chọn
 * không thể làm lệch đáp án.
 */
function gradeChoice(
  snapshot: QuestionSnapshot,
  answer: AnswerInput,
  maxPoints: number,
  settings: ExamSettings,
  allowMultiple: boolean
): QuestionGrade {
  const correctIds = new Set(snapshot.options.filter((o) => o.isCorrect).map((o) => o.id));
  const validIds = new Set(snapshot.options.map((o) => o.id));

  // Bỏ id không thuộc câu này (client sửa payload) để không tính là chọn đúng
  const picked = new Set(answer.selectedOptionIds.filter((id) => validIds.has(id)));

  // Câu không đánh đáp án đúng nào là lỗi soạn đề. Chấm mọi người sai hết thì
  // oan, nên trả 0 điểm và isCorrect = null để admin thấy có gì bất thường.
  if (correctIds.size === 0) return { isCorrect: null, pointsAwarded: 0 };
  if (picked.size === 0) return UNANSWERED;

  // Chọn nhiều ở câu chỉ cho chọn một → sai, không "lấy cái đầu"
  if (!allowMultiple && picked.size > 1) {
    return { isCorrect: false, pointsAwarded: -settings.scoring.negativeMarking };
  }

  const hit = [...picked].filter((id) => correctIds.has(id)).length;
  const miss = picked.size - hit;
  const exact = hit === correctIds.size && miss === 0;

  if (exact) return { isCorrect: true, pointsAwarded: maxPoints };

  // Điểm một phần: mỗi lựa chọn sai triệt tiêu một lựa chọn đúng, không âm.
  // Chỉ áp cho câu nhiều đáp án — câu một đáp án thì đúng/sai là nhị phân.
  if (allowMultiple && settings.scoring.partialCreditMultiChoice) {
    const net = Math.max(0, hit - miss);
    return { isCorrect: false, pointsAwarded: (net / correctIds.size) * maxPoints };
  }

  return { isCorrect: false, pointsAwarded: -settings.scoring.negativeMarking };
}

/**
 * Chấm một câu.
 *
 * `maxPoints` đến từ `ExamQuestion.points` (do admin đặt), không phải từ
 * settings — settings chỉ cho điểm mặc định lúc thêm câu vào đề.
 */
export function gradeQuestion(
  snapshot: QuestionSnapshot,
  answer: AnswerInput | null | undefined,
  maxPoints: number,
  settings: ExamSettings
): QuestionGrade {
  if (isBlank(answer)) return UNANSWERED;
  const a = answer as AnswerInput;

  switch (snapshot.type) {
    case "MULTIPLE_CHOICE":
      return gradeChoice(snapshot, a, maxPoints, settings, true);
    case "SINGLE_CHOICE":
    case "TRUE_FALSE":
    case "LISTENING":
      return gradeChoice(snapshot, a, maxPoints, settings, false);
    default: {
      // Dạng chưa có nhánh chấm (SPEAKING / WRITING sau này) → chờ chấm tay.
      // `never` ở đây khiến TS báo lỗi ngay khi thêm QuestionType mới mà quên
      // cập nhật hàm này.
      const _exhaustive: never = snapshot.type;
      void _exhaustive;
      return { isCorrect: null, pointsAwarded: 0 };
    }
  }
}

// ─── Chấm cả lượt thi ────────────────────────────────────────────────────────

export interface GradableItem {
  /** ExamQuestion.id */
  id: string;
  sectionId: string;
  sectionTitle: string;
  points: number;
  snapshot: QuestionSnapshot;
  /** Setting hiệu lực cho câu này, đã merge 3 tầng qua resolveSettings() */
  settings: ExamSettings;
}

export interface SectionBreakdown {
  sectionId: string;
  title: string;
  totalPoints: number;
  earnedPoints: number;
  correct: number;
  total: number;
}

export interface AttemptGrade {
  totalPoints: number;
  earnedPoints: number;
  percentage: number;
  passed: boolean;
  breakdown: SectionBreakdown[];
  /** Điểm từng câu để ghi lại vào ExamAnswer */
  perQuestion: Map<string, QuestionGrade>;
}

/**
 * Chấm toàn bộ lượt thi.
 *
 * `items` chỉ gồm những câu học viên THỰC SỰ được ra đề (theo
 * `ExamAttempt.questionOrder`) — rút đề ngẫu nhiên thì các câu không được rút
 * không được tính vào tổng điểm.
 *
 * `passScore` lấy từ setting cấp đề (`examSettings`), không lấy từ setting đã
 * merge của từng câu — điểm đạt là thuộc tính của cả đề.
 */
export function gradeAttempt(
  items: GradableItem[],
  answers: Map<string, AnswerInput>,
  examSettings: ExamSettings
): AttemptGrade {
  const perQuestion = new Map<string, QuestionGrade>();
  const bySection = new Map<string, SectionBreakdown>();

  let totalPoints = 0;
  let earnedPoints = 0;

  for (const item of items) {
    const grade = gradeQuestion(item.snapshot, answers.get(item.id), item.points, item.settings);
    perQuestion.set(item.id, grade);

    totalPoints += item.points;
    earnedPoints += grade.pointsAwarded;

    let section = bySection.get(item.sectionId);
    if (!section) {
      section = {
        sectionId: item.sectionId,
        title: item.sectionTitle,
        totalPoints: 0,
        earnedPoints: 0,
        correct: 0,
        total: 0,
      };
      bySection.set(item.sectionId, section);
    }
    section.totalPoints += item.points;
    section.earnedPoints += grade.pointsAwarded;
    section.total += 1;
    if (grade.isCorrect === true) section.correct += 1;
  }

  // Trừ điểm có thể đẩy tổng xuống âm; kẹp về 0 để không hiện điểm âm.
  earnedPoints = Math.max(0, earnedPoints);

  // Đề chưa có câu nào: 0% và không đạt. Chia cho 0 sẽ ra NaN rồi ghi vào DB.
  const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

  return {
    totalPoints: round2(totalPoints),
    earnedPoints: round2(earnedPoints),
    percentage: round2(percentage),
    passed: percentage >= examSettings.general.passScore,
    breakdown: [...bySection.values()].map((s) => ({
      ...s,
      totalPoints: round2(s.totalPoints),
      earnedPoints: round2(Math.max(0, s.earnedPoints)),
    })),
    perQuestion,
  };
}

/** Điểm một phần sinh ra số lẻ dài (1/3 điểm) — chốt 2 chữ số cho gọn và ổn định. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
