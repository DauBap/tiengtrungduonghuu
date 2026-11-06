import { useFetcher } from "react-router";
import { CheckCircle2, Clock3, Languages, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Badge } from "~/components/ui/badge";

export interface TranslationQuestion {
  id: string;
  prompt: string;
  sourceLanguage: string;
  targetLanguage: string;
  sampleAnswer: string;
  hint: string;
  maxScore: number;
  order: number;
}

export interface TranslationSubmission {
  id: string;
  answers: unknown;
  status: "SUBMITTED" | "GRADED";
  score: number | null;
  maxScore: number;
  teacherComment: string;
  submittedAt: string;
  gradedAt: string | null;
  teacher: { name: string | null } | null;
}

export function TranslationPractice({
  questions,
  submission,
  error,
  isSaving,
}: {
  questions: TranslationQuestion[];
  submission: TranslationSubmission | null;
  error?: string | null;
  isSaving: boolean;
}) {
  const fetcher = useFetcher();
  const [missingQuestionIds, setMissingQuestionIds] = useState<string[]>([]);
  const [validationMessage, setValidationMessage] = useState("");
  const answers = Array.isArray(submission?.answers)
    ? (submission.answers as { questionId: string; answer: string; teacherComment?: string }[])
    : [];
  const answersByQuestion = new Map(answers.map((item) => [item.questionId, item.answer]));
  const commentsByQuestion = new Map<string, string>();
  answers.forEach((item) => commentsByQuestion.set(item.questionId, item.teacherComment ?? ""));

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        Giáo viên chưa soạn câu luyện dịch cho bài này.
      </div>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const missing = questions.filter((question) => {
      const field = form.elements.namedItem(`translation-${question.id}`) as HTMLTextAreaElement | null;
      return !field?.value.trim();
    });

    if (missing.length > 0) {
      event.preventDefault();
      setMissingQuestionIds(missing.map((question) => question.id));
      setValidationMessage(
        missing.length === 1
          ? `Bạn chưa viết đáp án cho câu số ${questions.findIndex((question) => question.id === missing[0].id) + 1}.`
          : `Bạn còn ${missing.length} câu chưa viết đáp án. Hãy kiểm tra các ô được đánh dấu nhé.`,
      );
      const firstMissing = form.elements.namedItem(`translation-${missing[0].id}`) as HTMLTextAreaElement | null;
      window.requestAnimationFrame(() => firstMissing?.focus());
      return;
    }

    setMissingQuestionIds([]);
    setValidationMessage("");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {submission?.status === "GRADED" && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-emerald-900">Giáo viên đã trả bài</p>
              <p className="mt-1 text-sm text-emerald-800">
                Điểm: <strong>{submission.score ?? 0}/{submission.maxScore}</strong>
                {submission.teacher?.name ? ` · ${submission.teacher.name}` : ""}
              </p>
            </div>
            <Badge className="bg-emerald-600 text-white">Đã chấm</Badge>
          </div>
          {submission.teacherComment && (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-white/70 p-3 text-sm text-emerald-950">
              {submission.teacherComment}
            </p>
          )}
        </section>
      )}

      <fetcher.Form method="post" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <input type="hidden" name="intent" value="submit-translation" />
        {validationMessage && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
          >
            {validationMessage}
          </div>
        )}
        {questions.map((question, index) => (
          <section key={question.id} className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Câu {index + 1} · {question.sourceLanguage} → {question.targetLanguage}
                </p>
                <p className="mt-2 text-base font-semibold leading-7">{question.prompt}</p>
                {question.hint && (
                  <p className="mt-1 text-sm text-muted-foreground">Gợi ý: {question.hint}</p>
                )}
              </div>
              <Badge variant="secondary">Bài tự luận</Badge>
            </div>
            <Textarea
              name={`translation-${question.id}`}
              defaultValue={submission ? answersByQuestion.get(question.id) ?? "" : ""}
              readOnly={submission?.status === "SUBMITTED" || submission?.status === "GRADED"}
              onChange={(event) => {
                if (event.currentTarget.value.trim()) {
                  const remainingIds = missingQuestionIds.filter((id) => id !== question.id);
                  setMissingQuestionIds(remainingIds);
                  if (remainingIds.length === 0) {
                    setValidationMessage("");
                  } else if (remainingIds.length === 1) {
                    const remainingIndex = questions.findIndex((item) => item.id === remainingIds[0]);
                    setValidationMessage(`Bạn chưa viết đáp án cho câu số ${remainingIndex + 1}.`);
                  } else {
                    setValidationMessage(`Bạn còn ${remainingIds.length} câu chưa viết đáp án. Hãy kiểm tra các ô được đánh dấu nhé.`);
                  }
                }
              }}
              className={`mt-4 min-h-24 resize-y ${
                missingQuestionIds.includes(question.id)
                  ? "border-amber-400 bg-amber-50/40 focus-visible:ring-amber-400"
                  : ""
              }`}
              placeholder="Nhập câu dịch của bạn..."
              aria-invalid={missingQuestionIds.includes(question.id)}
            />
            {submission?.status === "GRADED" && commentsByQuestion.get(question.id) && (
              <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                <span className="font-medium">Nhận xét câu {index + 1}:</span>{" "}
                {commentsByQuestion.get(question.id)}
              </div>
            )}
          </section>
        ))}

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}

        {!submission || submission.status === "GRADED" ? (
          <Button type="submit" disabled={isSaving || fetcher.state !== "idle"} className="w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            {isSaving || fetcher.state !== "idle" ? "Đang nộp..." : "Nộp bài luyện dịch"}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
            <Clock3 className="h-4 w-4" />
            Đã nộp bài, bài làm đang chờ giáo viên chấm.
          </div>
        )}
      </fetcher.Form>

      {submission?.status === "GRADED" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" />
          Bài nộp lúc {new Date(submission.submittedAt).toLocaleString("vi-VN")}
        </div>
      )}
    </div>
  );
}
