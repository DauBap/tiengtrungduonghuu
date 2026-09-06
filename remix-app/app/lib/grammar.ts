/**
 * Dạng câu hỏi luyện tập ngữ pháp. Giá trị khớp enum GrammarQuestionType
 * trong prisma/schema.prisma.
 *
 * Cả admin và student đều import từ đây để nhãn và luật so đáp án chỉ có một
 * nguồn — lệch nhau thì admin soạn một kiểu, học viên bị chấm một kiểu khác.
 */
import { isAnswerCorrect } from "~/lib/listening-answer";

export const GRAMMAR_QUESTION_TYPES = ["SINGLE_CHOICE", "ARRANGE", "FILL"] as const;

export type GrammarQuestionType = (typeof GRAMMAR_QUESTION_TYPES)[number];

export const GRAMMAR_QUESTION_META: Record<
  GrammarQuestionType,
  {
    /** Nhãn cho admin khi chọn dạng câu hỏi */
    label: string;
    /** Mô tả cho admin, nói rõ cần nhập gì */
    description: string;
    /** Câu dẫn hiện cho học viên phía trên phần trả lời */
    studentHint: string;
  }
> = {
  SINGLE_CHOICE: {
    label: "Chọn đáp án",
    description: "Học viên chọn 1 trong các lựa chọn.",
    studentHint: "Chọn đáp án đúng",
  },
  ARRANGE: {
    label: "Sắp xếp từ",
    description: "Học viên ghép các từ đã trộn thành câu đúng.",
    studentHint: "Bấm các từ theo thứ tự đúng để tạo câu",
  },
  FILL: {
    label: "Nhập câu trả lời",
    description: "Học viên tự nhập đáp án.",
    studentHint: "Nhập câu trả lời",
  },
};

export function isGrammarQuestionType(value: unknown): value is GrammarQuestionType {
  return typeof value === "string" && (GRAMMAR_QUESTION_TYPES as readonly string[]).includes(value);
}

/** Đọc giá trị từ form; không hợp lệ → null để caller báo lỗi. */
export function parseGrammarQuestionType(value: unknown): GrammarQuestionType | null {
  return isGrammarQuestionType(value) ? value : null;
}

/**
 * Trộn các từ cho dạng sắp xếp.
 *
 * Trộn xong mà trùng thứ tự gốc thì học viên bấm "Kiểm tra" ngay là đúng —
 * không còn là bài tập nữa. Nên với từ 2 từ trở lên, lặp lại đến khi khác gốc.
 * Trường hợp mọi từ giống hệt nhau thì mọi hoán vị đều trùng, phải dừng để
 * không lặp vô hạn.
 */
export function shuffledTokens(options: string[]): string[] {
  if (options.length < 2) return [...options];
  const allSame = options.every((o) => o === options[0]);

  let result = [...options];
  for (let attempt = 0; attempt < 20; attempt++) {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    if (allSame || result.join("\u0000") !== options.join("\u0000")) break;
  }
  return result;
}

/** Phần dữ liệu của câu hỏi cần để chấm; nhận cả row từ DB. */
export interface GrammarAnswerable {
  type: GrammarQuestionType;
  options: string[];
  answer: string;
}

/**
 * Chấm câu trả lời của học viên.
 *
 * `response` là chuỗi đã chọn/nhập với SINGLE_CHOICE và FILL, còn ARRANGE là
 * mảng từ theo thứ tự học viên ghép.
 */
export function checkGrammarAnswer(question: GrammarAnswerable, response: string | string[]): boolean {
  if (question.type === "ARRANGE") {
    const picked = Array.isArray(response) ? response : [response];
    if (picked.length !== question.options.length) return false;
    // So chuỗi nối lại chứ không so từng phần tử: nếu hai từ trùng nội dung thì
    // đảo chỗ chúng vẫn ra đúng câu, không nên bắt lỗi.
    return picked.join("") === question.options.join("");
  }

  const text = Array.isArray(response) ? response.join("") : response;
  if (question.type === "SINGLE_CHOICE") {
    // Lựa chọn là chuỗi admin soạn, học viên bấm chọn nên khớp tuyệt đối được
    return text === question.answer;
  }
  // FILL: học viên tự gõ → nới dấu câu và khoảng trắng như phần Nghe câu
  return isAnswerCorrect(text, question.answer, "chinese");
}

/** Đáp án đúng ở dạng chuỗi để hiện khi học viên bấm "Xem đáp án". */
export function grammarAnswerText(question: GrammarAnswerable): string {
  return question.type === "ARRANGE" ? question.options.join("") : question.answer;
}

/** Bốn field nội dung của section, theo thứ tự hiển thị cho học viên. */
export const GRAMMAR_FIELDS = [
  { key: "explanation", label: "Giải thích" },
  { key: "formula", label: "Công thức" },
  { key: "examples", label: "Ví dụ" },
  { key: "note", label: "Lưu ý" },
] as const;

export type GrammarFieldKey = (typeof GRAMMAR_FIELDS)[number]["key"];

/** Section có nội dung để hiện hay không (bỏ qua khoảng trắng). */
export function hasGrammarContent(section: Record<GrammarFieldKey, string | null>): boolean {
  return GRAMMAR_FIELDS.some((f) => (section[f.key] ?? "").trim().length > 0);
}
