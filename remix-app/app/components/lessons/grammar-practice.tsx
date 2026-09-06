import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import {
  GRAMMAR_QUESTION_META, checkGrammarAnswer, grammarAnswerText, shuffledTokens,
  type GrammarQuestionType,
} from "~/lib/grammar";
import { cn } from "~/lib/utils";
import {
  CheckCircle2, XCircle, ArrowRight, ArrowLeft, RefreshCw, Eye, Lightbulb, Eraser,
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
  verdict: "correct" | "wrong" | null;
  /** Đã bấm "Xem đáp án" — không tính là tự làm được nữa */
  revealed: boolean;
}

const EMPTY: QuestionState = { text: "", picked: [], verdict: null, revealed: false };

export function GrammarPractice({ questions }: { questions: GrammarPracticeQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [states, setStates] = useState<Record<string, QuestionState>>({});

  const question = questions[index];
  const state = states[question?.id ?? ""] ?? EMPTY;

  // Trộn một lần cho mỗi câu mỗi lượt, không trộn lại sau từng lần render
  const tokens = useMemo(
    () => (question?.type === "ARRANGE" ? shuffledTokens(question.options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question?.id, round]
  );

  if (!question) {
    return <p className="text-sm text-muted-foreground text-center py-6">Phần này chưa có câu hỏi nào.</p>;
  }

  const update = (patch: Partial<QuestionState>) =>
    setStates((prev) => ({ ...prev, [question.id]: { ...(prev[question.id] ?? EMPTY), ...patch } }));

  const answered = state.verdict !== null || state.revealed;
  // Đã chấm hoặc đã xem đáp án thì khoá lại, tránh sửa rồi chấm lại cùng một câu
  const locked = answered;
  const hasResponse = question.type === "ARRANGE" ? state.picked.length > 0 : state.text.trim().length > 0;

  const isLast = index === questions.length - 1;
  const correctCount = questions.filter((q) => states[q.id]?.verdict === "correct").length;
  const doneCount = questions.filter((q) => {
    const s = states[q.id];
    return s && (s.verdict !== null || s.revealed);
  }).length;

  const check = () => {
    if (locked || !hasResponse) return;
    const response = question.type === "ARRANGE" ? state.picked : state.text;
    update({ verdict: checkGrammarAnswer(question, response) ? "correct" : "wrong" });
  };

  const reveal = () => update({ revealed: true });

  /** Làm lại câu hiện tại — xoá câu trả lời và kết quả của riêng câu này */
  const retry = () => update({ ...EMPTY });

  const restartAll = () => {
    setStates({});
    setIndex(0);
    setRound((r) => r + 1);
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
                  onClick={() => update({ text: opt })}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    chosen ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    locked && "cursor-not-allowed",
                    locked && chosen && state.verdict === "correct" && "border-success bg-success/5",
                    locked && chosen && state.verdict === "wrong" && "border-destructive bg-destructive/5"
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
          <form onSubmit={(e) => { e.preventDefault(); check(); }}>
            <Input
              value={state.text}
              onChange={(e) => update({ text: e.target.value })}
              readOnly={locked}
              placeholder="Nhập câu trả lời…"
              aria-label="Câu trả lời"
              aria-invalid={state.verdict === "wrong" || undefined}
              className={cn("text-base h-11",
                state.verdict === "correct" && "border-success bg-success/5",
                state.verdict === "wrong" && "border-destructive bg-destructive/5")}
            />
          </form>
        )}
      </div>

      {/* Kết quả */}
      {state.verdict !== null && (
        <div className={cn("rounded-lg border p-4",
          state.verdict === "correct" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
          <div className={cn("flex items-center gap-2 text-sm font-medium",
            state.verdict === "correct" ? "text-success" : "text-destructive")}>
            {state.verdict === "correct" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {state.verdict === "correct" ? "Chính xác!" : "Chưa đúng"}
          </div>
          {state.verdict === "wrong" && !state.revealed && (
            <p className="text-xs text-muted-foreground mt-2">
              Bấm &quot;Xem đáp án&quot; để đối chiếu, hoặc &quot;Làm lại&quot; để thử lần nữa.
            </p>
          )}
        </div>
      )}

      {state.revealed && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <Lightbulb className="h-4 w-4" />Đáp án đúng
          </div>
          <p className="text-lg font-medium">{grammarAnswerText(question)}</p>
          {question.hint && <p className="text-sm text-muted-foreground whitespace-pre-line">{question.hint}</p>}
        </div>
      )}

      {/* Ba nút của phần luyện tập */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={check} disabled={locked || !hasResponse}>
          <CheckCircle2 className="h-4 w-4 mr-1.5" />Kiểm tra đáp án
        </Button>
        <Button type="button" variant="outline" onClick={reveal} disabled={state.revealed}>
          <Eye className="h-4 w-4 mr-1.5" />Xem đáp án
        </Button>
        <Button type="button" variant="ghost" onClick={retry} disabled={!hasResponse && !answered}>
          <RefreshCw className="h-4 w-4 mr-1.5" />Làm lại
        </Button>
      </div>

      {/* Chuyển câu */}
      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />Câu trước
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          Đúng {correctCount}/{questions.length}
        </span>
        {isLast ? (
          <Button type="button" variant="ghost" size="sm" onClick={restartAll}>
            <RefreshCw className="h-4 w-4 mr-1.5" />Làm lại từ đầu
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => setIndex((i) => i + 1)}>
            Câu tiếp theo<ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
