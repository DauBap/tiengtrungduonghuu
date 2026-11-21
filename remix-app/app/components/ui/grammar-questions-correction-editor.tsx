import { useState } from "react";
import { GRAMMAR_QUESTION_META, GRAMMAR_QUESTION_TYPES, isGrammarQuestionType, type GrammarQuestionType } from "~/lib/grammar";
import { isRecord } from "~/lib/content-corrections";

interface GrammarQuestionDraft {
  id: string;
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  acceptedAnswers: string[];
  hint: string | null;
}

function getQuestions(value: unknown): GrammarQuestionDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question) => {
    if (!isRecord(question) || typeof question.id !== "string" || !isGrammarQuestionType(question.type)) return [];
    return [{
      id: question.id,
      type: question.type,
      prompt: typeof question.prompt === "string" ? question.prompt : "",
      options: Array.isArray(question.options) ? question.options.filter((item): item is string => typeof item === "string") : [],
      answer: typeof question.answer === "string" ? question.answer : "",
      acceptedAnswers: Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.filter((item): item is string => typeof item === "string") : [],
      hint: typeof question.hint === "string" ? question.hint : null,
    }];
  });
}

const fieldClassName = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function GrammarQuestionsCorrectionEditor({ name, value }: { name: string; value: unknown }) {
  const [originalQuestions] = useState(() => getQuestions(value));
  const [questions, setQuestions] = useState(originalQuestions);
  const [activeQuestionId, setActiveQuestionId] = useState(originalQuestions[0]?.id ?? "");
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) ?? questions[0];
  const activeQuestionIndex = activeQuestion ? questions.indexOf(activeQuestion) : -1;
  const originalQuestion = originalQuestions.find((question) => question.id === activeQuestion?.id);

  function updateQuestion(index: number, patch: Partial<GrammarQuestionDraft>) {
    setQuestions((current) => current.map((question, questionIndex) =>
      questionIndex === index ? { ...question, ...patch } : question,
    ));
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Phần ngữ pháp này chưa có câu hỏi luyện tập.</p>
      ) : activeQuestion ? (
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">
            Câu luyện tập
            <select
              value={activeQuestion.id}
              onChange={(event) => setActiveQuestionId(event.currentTarget.value)}
              className={fieldClassName}
            >
              {originalQuestions.map((question, index) => (
                <option key={question.id} value={question.id}>
                  Câu {index + 1} · {question.prompt.slice(0, 72)}
                </option>
              ))}
            </select>
          </label>

          <section aria-label={`Nội dung hiện tại câu ${activeQuestionIndex + 1}`} className="space-y-2 rounded-md bg-muted/40 p-3">
            <h3 className="text-sm font-semibold">Hiện tại</h3>
            <p className="text-xs text-muted-foreground">{originalQuestion ? GRAMMAR_QUESTION_META[originalQuestion.type].label : ""}</p>
            <p className="whitespace-pre-wrap text-sm">{originalQuestion?.prompt}</p>
            {originalQuestion && originalQuestion.options.length > 0 && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {originalQuestion.type === "ARRANGE" ? "Các từ" : "Lựa chọn"}: {originalQuestion.options.join(" · ")}
              </p>
            )}
            <p className="text-sm"><span className="font-medium">Đáp án:</span> {originalQuestion?.answer || "—"}</p>
            {originalQuestion && originalQuestion.acceptedAnswers.length > 0 && (
              <p className="whitespace-pre-wrap text-sm"><span className="font-medium">Đáp án khác:</span> {originalQuestion.acceptedAnswers.join(" · ")}</p>
            )}
            {originalQuestion?.hint && <p className="whitespace-pre-wrap text-sm text-muted-foreground"><span className="font-medium">Giải thích:</span> {originalQuestion.hint}</p>}
          </section>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">Góp ý chỉnh sửa</legend>
          <label className="block space-y-1.5 text-xs font-medium">
            Dạng câu hỏi
            <select
              value={activeQuestion.type}
              onChange={(event) => {
                if (isGrammarQuestionType(event.currentTarget.value)) updateQuestion(activeQuestionIndex, { type: event.currentTarget.value });
              }}
              className={fieldClassName}
            >
              {GRAMMAR_QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>{GRAMMAR_QUESTION_META[type].label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 text-xs font-medium">
            Nội dung câu hỏi
            <textarea
              value={activeQuestion.prompt}
              rows={2}
              onChange={(event) => updateQuestion(activeQuestionIndex, { prompt: event.currentTarget.value })}
              className={fieldClassName}
            />
          </label>
          {activeQuestion.type !== "FILL" && (
            <label className="block space-y-1.5 text-xs font-medium">
              {activeQuestion.type === "ARRANGE" ? "Các từ theo thứ tự đúng (mỗi dòng một từ)" : "Lựa chọn (mỗi dòng một đáp án)"}
              <textarea
                value={activeQuestion.options.join("\n")}
                rows={Math.min(5, Math.max(2, activeQuestion.options.length + 1))}
                onChange={(event) => updateQuestion(activeQuestionIndex, {
                  options: event.currentTarget.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                })}
                className={fieldClassName}
              />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs font-medium">
              Đáp án đúng
              <input value={activeQuestion.answer} onChange={(event) => updateQuestion(activeQuestionIndex, { answer: event.currentTarget.value })} className={fieldClassName} />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              Đáp án khác được chấp nhận (mỗi dòng một đáp án)
              <textarea
                value={activeQuestion.acceptedAnswers.join("\n")}
                rows={2}
                onChange={(event) => updateQuestion(activeQuestionIndex, {
                  acceptedAnswers: event.currentTarget.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                })}
                className={fieldClassName}
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-xs font-medium">
            Giải thích khi xem đáp án
            <textarea
              value={activeQuestion.hint ?? ""}
              rows={2}
              onChange={(event) => updateQuestion(activeQuestionIndex, { hint: event.currentTarget.value || null })}
              className={fieldClassName}
            />
          </label>
          </fieldset>
        </div>
      ) : null}
      <input type="hidden" name={name} value={JSON.stringify(questions)} />
    </div>
  );
}
