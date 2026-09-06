/**
 * Bài kiểm tra cuối bài học. THUẦN — không import prisma, không đọc DB.
 *
 * Đây là hệ RIÊNG, tách hẳn khỏi hệ Bài thi (`~/lib/exams`, `~/lib/exam-grading`):
 * bài kiểm tra thuộc về một bài học, không có version nên không cần snapshot,
 * và không đi qua kho câu hỏi dùng chung.
 *
 * Ba dạng câu và luật so đáp án dùng lại nguyên của phần Ngữ pháp
 * (`~/lib/grammar`) thay vì viết lại — hai bên giống nhau hoàn toàn về cách
 * chấm, nhân đôi logic là mở đường cho chúng trôi lệch nhau.
 *
 * Điểm khác căn bản so với Ngữ pháp: ngữ pháp là luyện tập nên chấm ngay ở
 * client được, còn bài kiểm tra tính vào tiến độ nên CHỈ server được chấm.
 */
import { checkGrammarAnswer, type GrammarQuestionType } from "~/lib/grammar";

/** Số câu tối đa gửi được trong một lần soạn — khớp hằng của phần ngữ pháp. */
export const MAX_TEST_QUESTIONS_PER_SUBMIT = 30;

/** Phần dữ liệu của câu hỏi cần để chấm; nhận cả row từ DB. */
export interface TestAnswerable {
  id: string;
  type: GrammarQuestionType;
  options: string[];
  answer: string;
  points: number;
}

/** Câu trả lời của học viên: chuỗi với SINGLE_CHOICE/FILL, mảng từ với ARRANGE. */
export type TestResponse = string | string[];

export interface TestGrade {
  totalPoints: number;
  earnedPoints: number;
  percentage: number;
  passed: boolean;
  correctCount: number;
  /** Số câu học viên bỏ trống — hiện riêng vì bỏ trống khác với trả lời sai */
  blankCount: number;
  /** Đúng/sai từng câu, khoá theo TestQuestion.id */
  perQuestion: Map<string, boolean>;
}

function isBlank(response: TestResponse | undefined): boolean {
  if (response === undefined) return true;
  if (Array.isArray(response)) return response.length === 0;
  return response.trim().length === 0;
}

/**
 * Chấm cả bài.
 *
 * Câu bỏ trống tính là sai và được 0 điểm, KHÔNG bị trừ điểm — bài kiểm tra
 * cuối bài không có cơ chế trừ điểm như hệ Bài thi.
 */
export function gradeLessonTest(
  questions: TestAnswerable[],
  responses: Map<string, TestResponse>,
  passScore: number
): TestGrade {
  const perQuestion = new Map<string, boolean>();
  let totalPoints = 0;
  let earnedPoints = 0;
  let correctCount = 0;
  let blankCount = 0;

  for (const question of questions) {
    totalPoints += question.points;
    const response = responses.get(question.id);

    if (isBlank(response)) {
      blankCount += 1;
      perQuestion.set(question.id, false);
      continue;
    }

    const correct = checkGrammarAnswer(question, response as TestResponse);
    perQuestion.set(question.id, correct);
    if (correct) {
      correctCount += 1;
      earnedPoints += question.points;
    }
  }

  // Bài chưa có câu nào: 0% và không đạt. Chia cho 0 sẽ ra NaN rồi ghi vào DB.
  const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

  return {
    totalPoints: round2(totalPoints),
    earnedPoints: round2(earnedPoints),
    percentage: round2(percentage),
    passed: totalPoints > 0 && percentage >= passScore,
    correctCount,
    blankCount,
    perQuestion,
  };
}

/**
 * Đọc câu trả lời từ form.
 *
 * Quy ước tên field: `response-<questionId>`. Dạng ARRANGE gửi nhiều input cùng
 * tên theo thứ tự học viên đã ghép nên phải đọc bằng `getAll`; hai dạng còn lại
 * chỉ có một giá trị, lấy phần tử đầu.
 *
 * Chỉ nhận id nằm trong `questionIds` — không thì client thêm field lạ là bơm
 * được câu không thuộc bài này vào map.
 */
export function parseTestResponses(
  form: FormData,
  questionIds: string[]
): Map<string, TestResponse> {
  const responses = new Map<string, TestResponse>();

  for (const id of questionIds) {
    const values = form.getAll(`response-${id}`).map((v) => String(v));
    if (values.length === 0) continue;
    // Một giá trị có thể là ARRANGE chỉ ghép một từ, nhưng chấm ARRANGE luôn so
    // theo số lượng từ nên để dạng chuỗi vẫn ra kết quả đúng.
    responses.set(id, values.length > 1 ? values : values[0]);
  }

  return responses;
}

/** Điểm có trọng số lẻ sinh ra số dài — chốt 2 chữ số cho gọn và ổn định. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
