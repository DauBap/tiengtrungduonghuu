/**
 * Logic chấm bài Ngữ âm — dùng chung cho client (hiện đúng/sai ngay) và server
 * (chấm lại khi nộp, không tin điểm do client gửi lên).
 *
 * Port từ `Ngu_Am/hsk1-3-0.ts`, nguồn nội dung của các block PHONETICS.
 */
import type { PhoneticsItem, PhoneticsSection } from "~/lib/learning-blocks";

export type Tone = 1 | 2 | 3 | 4;
export const TONES: readonly Tone[] = [1, 2, 3, 4];

/**
 * Bỏ dấu thanh khỏi vận mẫu để so sánh.
 *
 * Câu hỏi vận mẫu in sẵn dấu thanh trong đáp án (`iǎn`), nhưng học viên gõ bàn
 * phím thường không có dấu — chấp nhận cả hai bằng cách bỏ dấu hai bên.
 */
export function normalizeFinal(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300\u0301\u0304\u030c]/g, "")
    .normalize("NFC");
}

/** Gắn dấu thanh vào âm tiết không dấu, để hiện đáp án câu thanh điệu. */
export function withTone(syllable: string, tone: Tone): string {
  const index = syllable.includes("a")
    ? syllable.indexOf("a")
    : syllable.includes("e")
      ? syllable.indexOf("e")
      : syllable.includes("ou")
        ? syllable.indexOf("o")
        : Math.max(...[...syllable].map((letter, i) => ("iouü".includes(letter) ? i : -1)));
  const marks: Record<string, string> = {
    a: "āáǎà",
    e: "ēéěè",
    i: "īíǐì",
    o: "ōóǒò",
    u: "ūúǔù",
    ü: "ǖǘǚǜ",
  };
  return index < 0
    ? syllable
    : syllable.slice(0, index) + marks[syllable[index]][tone - 1] + syllable.slice(index + 1);
}

/** Đáp án hiển thị của một câu. */
export function phoneticsAnswerText(item: PhoneticsItem) {
  return item.type === "tone" ? String(item.answerTone) : item.answer;
}

/**
 * Câu trả lời của học viên cho một câu:
 *  - initial/final: chuỗi nhập vào
 *  - tone: số thanh đã chọn (1-4)
 */
export type PhoneticsAnswer = string | number | null | undefined;

export function isPhoneticsAnswerCorrect(item: PhoneticsItem, value: PhoneticsAnswer): boolean {
  if (item.type === "tone") return Number(value) === item.answerTone;
  if (typeof value !== "string") return false;
  return item.type === "final"
    ? normalizeFinal(value) === normalizeFinal(item.answer)
    : value.trim().toLowerCase() === item.answer.trim().toLowerCase();
}

/**
 * Một dòng kết quả, lưu vào `LessonTabAttempt.details.results`.
 *
 * Index signature để type khớp `Prisma.InputJsonValue` — interface thường
 * không thỏa `InputJsonObject`. Giữ cùng hình dạng với results của các tab
 * khác để `makeAnswerReviewGroup` đọc được chung.
 */
export interface PhoneticsItemResult {
  [key: string]: string | boolean | number | null;
  id: string;
  prompt: string;
  given: string;
  correctAnswer: string;
  full: string;
  correct: boolean;
  matchPercent: number;
  hint: null;
  teacherFeedback: null;
}

export interface PhoneticsSectionGrade {
  sectionId: number;
  score: number;
  correctCount: number;
  totalCount: number;
  results: PhoneticsItemResult[];
}

/**
 * Chấm một section. `answers` map theo `item.id`.
 *
 * Câu không trả lời tính là sai — học viên nộp cả section một lần nên bỏ trống
 * là chọn không làm, không phải thiếu dữ liệu.
 */
export function gradePhoneticsSection(
  section: PhoneticsSection,
  answers: Map<number, PhoneticsAnswer>,
): PhoneticsSectionGrade {
  const results = section.items.map((item, index): PhoneticsItemResult => {
    const value = answers.get(item.id);
    const correct = isPhoneticsAnswerCorrect(item, value);
    const given = item.type === "tone"
      ? (value == null || value === "" ? "" : String(value))
      : typeof value === "string"
        ? value.trim()
        : "";
    return {
      id: `${section.id}-${item.id}`,
      prompt: `Câu ${index + 1}`,
      given,
      correctAnswer: phoneticsAnswerText(item),
      full: item.full,
      correct,
      matchPercent: correct ? 100 : 0,
      hint: null,
      teacherFeedback: null,
    };
  });

  const correctCount = results.filter((result) => result.correct).length;
  const totalCount = results.length;
  return {
    sectionId: section.id,
    score: totalCount > 0 ? Math.round((correctCount / totalCount) * 10000) / 100 : 0,
    correctCount,
    totalCount,
    results,
  };
}
