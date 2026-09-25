/**
 * So đáp án phần Nghe câu.
 *
 * Học viên nhập trên bàn phím thường nên không thể đòi khớp tuyệt đối:
 *  - Chữ Hán: dấu câu tiếng Trung (，。？！) và khoảng trắng nên bỏ qua.
 *  - Pinyin: gõ được "ni hao" thay vì "nǐ hǎo" — bỏ dấu thanh trước khi so.
 * Vẫn phân biệt phụ âm/nguyên âm, chỉ nới phần người học không kiểm soát được.
 */

/** Dấu câu tiếng Trung và tiếng Việt, cùng khoảng trắng mọi loại. */
const PUNCTUATION = /[\s，。、；：？！""''（）《》〈〉—…,.;:?!"'()<>[\]{}]/g;

/**
 * Bốn dấu thanh pinyin ở dạng tổ hợp NFD: macron (ā), acute (á), caron (ǎ),
 * grave (à). Cố tình KHÔNG gồm trema U+0308 của ü — bỏ nó đi thì "nü" thành
 * "nu", trộn lẫn hai âm khác nhau.
 */
const TONE_MARKS = /[̄́̌̀]/g;

/** Bỏ dấu thanh khỏi pinyin: "nǐ hǎo" → "ni hao", "nǚ" → "nü". */
function stripTone(input: string): string {
  return input.normalize("NFD").replace(TONE_MARKS, "").normalize("NFC");
}

export type AnswerMode = "chinese" | "pinyin";

/** Chuẩn hoá một chuỗi để so sánh, theo chế độ trả lời. */
export function normalizeAnswer(input: string, mode: AnswerMode): string {
  const base = input.trim().replace(PUNCTUATION, "");
  if (mode !== "pinyin") return base;
  // Bỏ thanh trước, rồi mới quy ü→v: "nǚ" phải về "nü" mới khớp được "nv".
  return stripTone(base.toLowerCase()).replace(/ü/g, "v");
}

/** Câu trả lời có khớp đáp án hay không. */
export function isAnswerCorrect(input: string, expected: string, mode: AnswerMode): boolean {
  const a = normalizeAnswer(input, mode);
  if (!a) return false;
  return a === normalizeAnswer(expected, mode);
}

export type ComparisonPartStatus = "match" | "mismatch" | "neutral";

export interface ComparisonPart {
  text: string;
  status: ComparisonPartStatus;
}

/** So sánh từng ký tự / token để highlight đúng/sai theo chuỗi đang nhập. */
export function compareAnswerHighlights(input: string, expected: string, mode: AnswerMode): ComparisonPart[] {
  const normalizedInput = normalizeAnswer(input, mode);
  const normalizedExpected = normalizeAnswer(expected, mode);

  if (!normalizedInput && !normalizedExpected) {
    return [{ text: "", status: "neutral" }];
  }

  if (!normalizedInput || !normalizedExpected) {
    return [{ text: normalizedInput || normalizedExpected || "", status: "neutral" }];
  }

  const maxLength = Math.max(normalizedInput.length, normalizedExpected.length);
  const parts: ComparisonPart[] = [];

  for (let i = 0; i < maxLength; i++) {
    const left = normalizedInput[i] ?? "";
    const right = normalizedExpected[i] ?? "";

    if (left === right) {
      parts.push({ text: left || right, status: "match" });
      continue;
    }

    if (left && right) {
      parts.push({ text: left || right, status: "mismatch" });
      continue;
    }

    if (left) {
      parts.push({ text: left, status: "mismatch" });
    } else {
      parts.push({ text: right, status: "neutral" });
    }
  }

  return parts.length > 0 ? parts : [{ text: "", status: "neutral" }];
}
