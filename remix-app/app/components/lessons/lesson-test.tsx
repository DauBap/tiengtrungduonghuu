import { useState } from "react";
import { useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { GRAMMAR_QUESTION_META, type GrammarQuestionType } from "~/lib/grammar";
import { cn } from "~/lib/utils";
import {
  ArrowRight, ArrowLeft, Eraser, Send, AlertTriangle, Loader2, CircleDot, Circle,
} from "lucide-react";

/**
 * Câu hỏi ở dạng học viên được thấy.
 *
 * KHÔNG có `answer` và `hint` — bài kiểm tra tính vào tiến độ nên đáp án không
 * được xuống client trước khi nộp; khác với phần Ngữ pháp là luyện tập nên gửi
 * cả đáp án xuống được. Loader route phải `select` tường minh để giữ điều này.
 */
export interface LessonTestQuestion {
  id: string;
  type: GrammarQuestionType;
  prompt: string;
  /**
   * SINGLE_CHOICE: các lựa chọn; ARRANGE: các từ ĐÃ TRỘN; FILL: rỗng.
   *
   * Dạng ARRANGE trộn ở SERVER, không trộn ở đây: thứ tự gốc chính là đáp án,
   * gửi nguyên xuống rồi mới trộn thì đọc payload loader là biết đáp án.
   */
  options: string[];
  points: number;
}

/** Câu trả lời đang soạn của một câu; giữ theo id nên quay lại câu cũ vẫn thấy. */
interface Answer {
  /** Chuỗi đã chọn/nhập (SINGLE_CHOICE, FILL) */
  text: string;
  /** Các từ đã ghép, theo thứ tự học viên bấm (ARRANGE) */
  picked: string[];
}

const EMPTY: Answer = { text: "", picked: [] };

function hasAnswer(question: LessonTestQuestion, answer: Answer): boolean {
  return question.type === "ARRANGE" ? answer.picked.length > 0 : answer.text.trim().length > 0;
}

export function LessonTest({ questions }: { questions: LessonTestQuestion[] }) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const question = questions[index];
  const answer = answers[question?.id ?? ""] ?? EMPTY;

  if (!question) {
    return <p className="text-sm text-muted-foreground text-center py-6">Bài kiểm tra chưa có câu hỏi nào.</p>;
  }

  const update = (patch: Partial<Answer>) =>
    setAnswers((prev) => ({ ...prev, [question.id]: { ...(prev[question.id] ?? EMPTY), ...patch } }));

  const answeredIds = new Set(
    questions.filter((q) => hasAnswer(q, answers[q.id] ?? EMPTY)).map((q) => q.id)
  );
  const blankCount = questions.length - answeredIds.size;
  const isLast = index === questions.length - 1;

  // Các từ chưa được ghép vào đáp án. `options` đã được server trộn sẵn.
  // Từ trùng nội dung phải trừ theo số lượng, không lọc theo giá trị — nếu
  // không, ghép một "的" sẽ làm biến mất mọi "的".
  const remainingTokens = (() => {
    if (question.type !== "ARRANGE") return [];
    const used = new Map<string, number>();
    for (const t of answer.picked) used.set(t, (used.get(t) ?? 0) + 1);
    return question.options.filter((t) => {      const left = used.get(t) ?? 0;
      if (left > 0) {
        used.set(t, left - 1);
        return false;
      }
      return true;
    });
  })();

  return (
    <div className="space-y-4">
      {/*
        Câu trả lời của MỌI câu nằm ngoài phần đang hiện, để chuyển câu không làm
        mất những gì đã trả lời — chỉ một câu được render mỗi lúc nên không thể
        dựa vào chính các ô nhập để gửi lên.
      */}
      {questions.map((q) => {
        const a = answers[q.id] ?? EMPTY;
        if (!hasAnswer(q, a)) return null;
        return q.type === "ARRANGE" ? (
          // Nhiều input cùng tên theo thứ tự đã ghép; server đọc bằng getAll
          <div key={q.id} className="hidden">
            {a.picked.map((t, i) => (
              <input key={i} type="hidden" name={`response-${q.id}`} value={t} />
            ))}
          </div>
        ) : (
          <input key={q.id} type="hidden" name={`response-${q.id}`} value={a.text} />
        );
      })}

      <div className="flex items-center gap-3">
        <Progress value={(answeredIds.size / questions.length) * 100} className="h-1.5 flex-1" />
        <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
          Câu {index + 1}/{questions.length}
        </span>
      </div>

      {/* Bảng số câu: bấm để nhảy tới, câu đã trả lời được tô đậm */}
      {questions.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <button key={q.id} type="button" onClick={() => setIndex(i)} title={`Câu ${i + 1}`}
              className={cn(
                "h-7 w-7 rounded-md border text-xs font-medium tabular-nums transition-colors",
                i === index && "ring-2 ring-ring ring-offset-1",
                answeredIds.has(q.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50"
              )}>
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {GRAMMAR_QUESTION_META[question.type].studentHint}
            </p>
            <span className="text-xs text-muted-foreground">· {question.points} điểm</span>
          </div>
          <p className="text-base font-medium mt-1 whitespace-pre-line">{question.prompt}</p>
        </div>

        {question.type === "SINGLE_CHOICE" && (
          <div className="space-y-2">
            {question.options.map((opt) => {
              const chosen = answer.text === opt;
              return (
                <button key={opt} type="button" onClick={() => update({ text: opt })}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    chosen ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  )}>
                  {chosen
                    ? <CircleDot className="h-5 w-5 shrink-0 text-primary" />
                    : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
                  <span className="text-base">{opt}</span>
                </button>
              );
            })}
          </div>
        )}

        {question.type === "ARRANGE" && (
          <div className="space-y-3">
            {/* Vùng đáp án: bấm một từ để trả nó về danh sách bên dưới */}
            <div className="min-h-[3.5rem] rounded-lg border-2 border-dashed p-2.5 flex flex-wrap gap-2 items-start">
              {answer.picked.length === 0 ? (
                <span className="text-sm text-muted-foreground px-1 py-1.5">Bấm các từ bên dưới để ghép câu…</span>
              ) : (
                answer.picked.map((t, i) => (
                  <button key={`${t}-${i}`} type="button"
                    onClick={() => update({ picked: answer.picked.filter((_, j) => j !== i) })}
                    className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-base font-medium hover:bg-primary/20 transition-colors">
                    {t}
                  </button>
                ))
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {remainingTokens.map((t, i) => (
                <button key={`${t}-${i}`} type="button"
                  onClick={() => update({ picked: [...answer.picked, t] })}
                  className="rounded-md border px-3 py-1.5 text-base font-medium hover:bg-muted/50 transition-colors">
                  {t}
                </button>
              ))}
              {remainingTokens.length === 0 && answer.picked.length > 0 && (
                <span className="text-xs text-muted-foreground py-2">Đã dùng hết các từ.</span>
              )}
            </div>

            {answer.picked.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => update({ picked: [] })}>
                <Eraser className="h-4 w-4 mr-1.5" />Xóa hết
              </Button>
            )}
          </div>
        )}

        {question.type === "FILL" && (
          <Input
            value={answer.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Nhập câu trả lời…"
            aria-label="Câu trả lời"
            className="text-base h-11"
            // Enter trong ô này sẽ submit cả form → nộp bài sớm ngoài ý muốn
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        )}
      </div>

      {/* Chuyển câu */}
      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />Câu trước
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          Đã trả lời {answeredIds.size}/{questions.length}
        </span>
        <Button type="button" size="sm" disabled={isLast}
          onClick={() => setIndex((i) => i + 1)}>
          Câu tiếp theo<ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </div>

      {/* Nộp bài — vẫn cho nộp khi còn câu trống, chỉ cảnh báo */}
      <div className="space-y-3 border-t pt-4">
        {blankCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-warning">Còn {blankCount} câu chưa trả lời</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Câu bỏ trống được tính 0 điểm. Bạn vẫn nộp được nếu muốn.
              </p>
            </div>
          </div>
        )}
        <Button type="submit" name="intent" value="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting
            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Đang chấm bài…</>
            : <><Send className="h-4 w-4 mr-1.5" />Nộp bài</>}
        </Button>
      </div>
    </div>
  );
}
