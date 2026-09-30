import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import {
  GRAMMAR_QUESTION_META, shuffledTokens,
  type GrammarQuestionType,
} from "~/lib/grammar";
import { cn } from "~/lib/utils";
import {
  CheckCircle2, XCircle, ArrowRight, ArrowLeft, Lightbulb, Eraser,
} from "lucide-react";

export interface GrammarPracticeQuestion {
  id: string;
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  hint: string | null;
}

/** Trạng thái làm bài của một câu; giữ theo id nên quay lại câu cũ vẫn thấy. */
interface QuestionState {
  /** Chuỗi đã chọn/nhập (SINGLE_CHOICE, FILL) */
  text: string;
  /** Các từ đã ghép, theo thứ tự học viên bấm (ARRANGE) */
  picked: string[];
}

const EMPTY: QuestionState = { text: "", picked: [] };

export function GrammarPractice({ questions, sectionId, answerReviewEnabled = false }: { questions: GrammarPracticeQuestion[]; sectionId: string; answerReviewEnabled?: boolean }) {
  const fetcher = useFetcher<{
    intent?: string;
    success?: boolean;
    score?: number;
    correctCount?: number;
    totalCount?: number;
    reviewPending?: boolean;
    grammarError?: string;
  }>();
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, QuestionState>>({});
  const [submitted, setSubmitted] = useState(false);

  const question = questions[index];
  const state = states[question?.id ?? ""] ?? EMPTY;

  // Trộn một lần cho mỗi câu mỗi lượt, không trộn lại sau từng lần render
  const tokens = useMemo(
    () => (question?.type === "ARRANGE" ? shuffledTokens(question.options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question?.id]
  );

  if (!question) {
    return <p className="text-sm text-muted-foreground text-center py-6">Phần này chưa có câu hỏi nào.</p>;
  }

  const update = (patch: Partial<QuestionState>) =>
    setStates((prev) => ({ ...prev, [question.id]: { ...(prev[question.id] ?? EMPTY), ...patch } }));

  const savedResult = submitted && fetcher.data?.intent === "submit-grammar-attempt" && fetcher.data.success
    ? fetcher.data
    : null;
  const locked = Boolean(savedResult) || fetcher.state !== "idle";
  const isLast = index === questions.length - 1;
  const doneCount = questions.filter((item) => {
    const itemState = states[item.id] ?? EMPTY;
    return item.type === "ARRANGE"
      ? itemState.picked.length === item.options.length
      : itemState.text.trim().length > 0;
  }).length;
  const questionType = questions[0]?.type;

  const submitAttempt = () => {
    if (!questionType || doneCount !== questions.length || fetcher.state !== "idle") return;
    setSubmitted(true);
    fetcher.submit({
      intent: "submit-grammar-attempt",
      sectionId,
      questionType,
      answers: JSON.stringify(questions.map((item) => {
        const itemState = states[item.id] ?? EMPTY;
        return {
          questionId: item.id,
          response: item.type === "ARRANGE" ? itemState.picked : itemState.text,
        };
      })),
    }, { method: "post" });
  };

  // Các từ chưa được ghép vào đáp án. Từ trùng nội dung phải trừ theo số lượng,
  // không lọc theo giá trị — nếu không, ghép một "的" sẽ làm biến mất mọi "的".
  const remainingTokens = (() => {
    if (question.type !== "ARRANGE") return [];
    const used = new Map<string, number>();
    for (const t of state.picked) used.set(t, (used.get(t) ?? 0) + 1);
    return tokens.filter((t) => {
      const left = used.get(t) ?? 0;
      if (left > 0) {
        used.set(t, left - 1);
        return false;
      }
      return true;
    });
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={(doneCount / questions.length) * 100} className="h-1.5 flex-1" />
        <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
          Câu {index + 1}/{questions.length}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {GRAMMAR_QUESTION_META[question.type].studentHint}
          </p>
          <p className="text-base font-medium mt-1 whitespace-pre-line">{question.prompt}</p>
        </div>

        {question.type === "SINGLE_CHOICE" && (
          <div className="space-y-2">
            {question.options.map((opt) => {
              const chosen = state.text === opt;
              return (
                <button key={opt} type="button" disabled={locked}
                  onClick={() => {
                    update({ text: opt });
                    if (!isLast) setIndex(index + 1);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    chosen ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    locked && "cursor-not-allowed"
                  )}>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    chosen && "border-primary")}>
                    {chosen && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                  </span>
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
              {state.picked.length === 0 ? (
                <span className="text-sm text-muted-foreground px-1 py-1.5">Bấm các từ bên dưới để ghép câu…</span>
              ) : (
                state.picked.map((t, i) => (
                  <button key={`${t}-${i}`} type="button" disabled={locked}
                    onClick={() => update({ picked: state.picked.filter((_, j) => j !== i) })}
                    className={cn("rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-base font-medium",
                      locked ? "cursor-not-allowed" : "hover:bg-primary/20 transition-colors")}>
                    {t}
                  </button>
                ))
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {remainingTokens.map((t, i) => (
                <button key={`${t}-${i}`} type="button" disabled={locked}
                  onClick={() => update({ picked: [...state.picked, t] })}
                  className={cn("rounded-md border px-3 py-1.5 text-base font-medium",
                    locked ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50 transition-colors")}>
                  {t}
                </button>
              ))}
              {remainingTokens.length === 0 && state.picked.length > 0 && (
                <span className="text-xs text-muted-foreground py-2">Đã dùng hết các từ.</span>
              )}
            </div>

            {state.picked.length > 0 && !locked && (
              <Button type="button" variant="ghost" size="sm" onClick={() => update({ picked: [] })}>
                <Eraser className="h-4 w-4 mr-1.5" />Xóa hết
              </Button>
            )}
          </div>
        )}

        {question.type === "FILL" && (
          <Input
            value={state.text}
            onChange={(e) => update({ text: e.target.value })}
            readOnly={locked}
            placeholder="Nhập câu trả lời…"
            aria-label="Câu trả lời"
            className="h-11 text-base"
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
          Đã trả lời {doneCount}/{questions.length}
        </span>
        {!isLast && (
          <Button type="button" size="sm" onClick={() => setIndex((i) => i + 1)}>
            Câu tiếp theo<ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
        {savedResult ? (
          <div>
            {savedResult.reviewPending ? (
              <p className="text-sm font-medium text-muted-foreground">Đã nộp. Đang chờ giáo viên chấm.</p>
            ) : (
              <>
                <p className="text-sm font-medium text-success">
                  Số câu đúng: {savedResult.correctCount}/{savedResult.totalCount} · {savedResult.score}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {answerReviewEnabled
                    ? "Đáp án chi tiết đã mở ở phần kết quả phía trên."
                    : "Đáp án chi tiết sẽ hiện khi giáo viên mở xem kết quả."}
                </p>
              </>
            )}
          </div>
        ) : fetcher.data?.grammarError && submitted ? (
          <p role="alert" className="text-sm text-destructive">{fetcher.data.grammarError}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Trả lời hết câu hỏi để nộp kết quả.</p>
        )}
        <Button
          type="button"
          size="sm"
          onClick={submitAttempt}
          disabled={doneCount !== questions.length || fetcher.state !== "idle" || Boolean(savedResult)}
        >
          {fetcher.state !== "idle" ? "Đang nộp..." : savedResult ? "Đã nộp kết quả" : submitted && fetcher.data?.grammarError ? "Thử nộp lại" : "Nộp kết quả"}
        </Button>
      </div>

    </div>
  );
}
