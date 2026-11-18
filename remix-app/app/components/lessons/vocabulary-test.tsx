import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { VocabularyTestQuestion } from "~/lib/vocabulary-test";
import { ChevronLeft, ChevronRight, RotateCcw, Send, Timer } from "lucide-react";
import { usePinyinVisibility } from "~/components/lessons/lesson-pinyin-visibility";

export type QuizDirection = "zh2vi" | "vi2zh" | "mixed";
type QuestionDirection = Exclude<QuizDirection, "mixed">;
export type DisplayMode = "paged" | "scroll";

export interface ActiveQuestion extends VocabularyTestQuestion {
  direction: QuestionDirection;
  prompt: string;
  promptDetail: string | null;
  options: string[];
}

export interface VocabularyTestDraft {
  direction: QuizDirection;
  displayMode: DisplayMode;
  started: boolean;
  runQuestions: { id: string; direction: QuestionDirection }[];
  index: number;
  pageIndex: number;
  answers: Record<string, string>;
}

export function parseVocabularyTestDraft(value: unknown): VocabularyTestDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.started !== true
    || !["zh2vi", "vi2zh", "mixed"].includes(String(record.direction))
    || !["paged", "scroll"].includes(String(record.displayMode))
    || !Array.isArray(record.runQuestions)
    || typeof record.answers !== "object"
    || record.answers === null
    || Array.isArray(record.answers)
  ) return null;
  const runQuestions = record.runQuestions.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const question = item as Record<string, unknown>;
    if (typeof question.id !== "string" || (question.direction !== "zh2vi" && question.direction !== "vi2zh")) return [];
    const direction: QuestionDirection = question.direction;
    return [{ id: question.id, direction }];
  });
  const answers = Object.fromEntries(
    Object.entries(record.answers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (runQuestions.length === 0) return null;
  return {
    direction: record.direction as QuizDirection,
    displayMode: record.displayMode as DisplayMode,
    started: true,
    runQuestions,
    index: Number.isInteger(record.index) ? Number(record.index) : 0,
    pageIndex: Number.isInteger(record.pageIndex) ? Number(record.pageIndex) : 0,
    answers,
  };
}

const DIRECTIONS: Array<{ id: QuizDirection; label: string }> = [
  { id: "zh2vi", label: "Trung → Việt" },
  { id: "vi2zh", label: "Việt → Trung" },
  { id: "mixed", label: "Hỗn hợp" },
];

const DISPLAY_MODES: Array<{ id: DisplayMode; label: string }> = [
  { id: "paged", label: "Phân trang" },
  { id: "scroll", label: "Cuộn xuống" },
];

export function VocabularyTest({
  questionSets,
  timeLimitMinutes,
  isSubmitting = false,
  previewOnly = false,
  fixedDirection,
  pageSize,
  initialDraft,
  onDraftChange,
  onClearDraft,
  draftSaving = false,
}: {
  questionSets: { sameWordType: VocabularyTestQuestion[]; random: VocabularyTestQuestion[] };
  timeLimitMinutes: number | null;
  isSubmitting?: boolean;
  previewOnly?: boolean;
  fixedDirection?: QuestionDirection;
  pageSize?: number;
  initialDraft?: VocabularyTestDraft | null;
  onDraftChange?: (draft: VocabularyTestDraft) => void;
  onClearDraft?: () => void;
  draftSaving?: boolean;
}) {
  const showPinyin = usePinyinVisibility();
  const questions = questionSets.sameWordType;
  const [direction, setDirection] = useState<QuizDirection>(initialDraft?.direction ?? fixedDirection ?? "mixed");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(initialDraft?.displayMode ?? "paged");
  const [startedAt, setStartedAt] = useState<number | null>(() =>
    initialDraft?.started && timeLimitMinutes === null ? Date.now() : null
  );
  const [runQuestions, setRunQuestions] = useState<ActiveQuestion[]>(() => {
    if (!initialDraft?.started || timeLimitMinutes !== null) return [];
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    return initialDraft.runQuestions.flatMap(({ id, direction: questionDirection }) => {
      const question = questionsById.get(id);
      if (!question) return [];
      return [{
        ...question,
        direction: questionDirection,
        prompt: questionDirection === "zh2vi" ? question.chinese : question.translation,
        promptDetail: questionDirection === "zh2vi" ? question.pinyin : null,
        options: questionDirection === "zh2vi" ? question.translationOptions : question.chineseOptions,
      }];
    });
  });
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialDraft?.index ?? 0, Math.max(questions.length - 1, 0)))
  );
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, initialDraft?.pageIndex ?? 0));
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    if (!initialDraft?.answers || timeLimitMinutes !== null) return {};
    const validQuestionIds = new Set(questions.map((question) => question.id));
    return Object.fromEntries(
      Object.entries(initialDraft.answers).filter(([questionId, answer]) =>
        validQuestionIds.has(questionId) && typeof answer === "string"
      ),
    );
  });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const didMount = useRef(false);
  const started = startedAt !== null && runQuestions.length > 0;
  const effectiveDirection = fixedDirection ?? direction;
  const answeredCount = runQuestions.filter((item) => Boolean(answers[item.id])).length;

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (startedAt === null || timeLimitMinutes !== null || runQuestions.length === 0) return;
    onDraftChange?.({
      direction,
      displayMode,
      started: true,
      runQuestions: runQuestions.map(({ id, direction: questionDirection }) => ({ id, direction: questionDirection })),
      index,
      pageIndex,
      answers,
    });
  }, [answers, direction, displayMode, index, onDraftChange, pageIndex, runQuestions, startedAt, timeLimitMinutes]);

  useEffect(() => {
    if (startedAt === null || timeLimitMinutes === null) return;

    const deadline = startedAt + timeLimitMinutes * 60_000;
    const updateTime = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, timeLimitMinutes]);

  useEffect(() => {
    if (startedAt !== null && timeLimitMinutes !== null && secondsLeft === 0) {
      submitRef.current?.click();
    }
  }, [secondsLeft, startedAt, timeLimitMinutes]);

  const startTest = () => {
    const nextQuestions = questions.map((question): ActiveQuestion => {
      const questionDirection: QuestionDirection = effectiveDirection === "mixed"
        ? (Math.random() < 0.5 ? "zh2vi" : "vi2zh")
        : effectiveDirection;

      return {
        ...question,
        direction: questionDirection,
        prompt: questionDirection === "zh2vi" ? question.chinese : question.translation,
        promptDetail: questionDirection === "zh2vi" ? question.pinyin : null,
        options: questionDirection === "zh2vi" ? question.translationOptions : question.chineseOptions,
      };
    });

    setRunQuestions(nextQuestions);
    setAnswers({});
    setIndex(0);
    setPageIndex(0);
    setSecondsLeft(timeLimitMinutes === null ? null : timeLimitMinutes * 60);
    setStartedAt(Date.now());
  };

  const restart = () => {
    onClearDraft?.();
    setRunQuestions([]);
    setAnswers({});
    setIndex(0);
    setPageIndex(0);
    setSecondsLeft(null);
    setStartedAt(null);
  };

  const formatTime = (value: number) =>
    `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;

  if (questions.length === 0) return null;

  if (previewOnly) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Bản xem trước · câu hỏi và lựa chọn được khóa, không thể nộp bài.
        </p>
        {questions.map((question, index) => (
          <section key={question.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{index + 1}.</span>
              <span>Trung → Việt</span>
            </div>
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border bg-card px-5 py-6 text-center">
              <p className="content-text hanzi-display text-5xl font-semibold">{question.chinese}</p>
              {showPinyin && <p className="content-text pinyin-text text-sm text-muted-foreground">{question.pinyin}</p>}
              {question.wordTypeLabels.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {question.wordTypeLabels.map((label) => <span key={label} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{label}</span>)}
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {question.translationOptions.map((option) => (
                <button key={option} type="button" disabled className="min-h-14 rounded-md border px-4 py-3 text-center text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70">{option}</button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (!started) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border px-2.5 py-1">{questions.length} câu hỏi</span>
          <span className="flex items-center gap-1 rounded-full border px-2.5 py-1">
            <Timer className="h-3.5 w-3.5" />
            {timeLimitMinutes === null ? "Không giới hạn thời gian" : `${timeLimitMinutes} phút`}
          </span>
        </div>

        {!fixedDirection && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Chế độ thi</legend>
            <div className="flex flex-wrap gap-2">
              {DIRECTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={direction === option.id}
                  onClick={() => setDirection(option.id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm transition-colors",
                    direction === option.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {!pageSize && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Chế độ hiển thị</legend>
            <div className="flex flex-wrap gap-2">
              {DISPLAY_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={displayMode === option.id}
                  onClick={() => setDisplayMode(option.id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm transition-colors",
                    displayMode === option.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <Button type="button" className="w-full" onClick={startTest}>
          Bắt đầu thi
        </Button>
      </div>
    );
  }

  const renderQuestion = (question: ActiveQuestion, questionIndex: number) => (
    <section key={question.id} className="space-y-3 border-b pb-5 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{questionIndex + 1}.</span>
        <span>{question.direction === "zh2vi" ? "Trung → Việt" : "Việt → Trung"}</span>
      </div>
      <div className="flex w-full min-h-36 max-w-full flex-col items-center justify-center gap-2 rounded-lg border bg-card px-5 py-6 text-center">
        <p className={cn("content-text w-full max-w-full break-words font-semibold leading-tight", question.direction === "zh2vi" ? "hanzi-display text-5xl" : "text-2xl") }>
          {question.prompt}
        </p>
        {showPinyin && question.promptDetail && <p className="content-text w-full max-w-full break-words pinyin-text text-sm text-muted-foreground">{question.promptDetail}</p>}
        {question.wordTypeLabels.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {question.wordTypeLabels.map((label) => (
              <span key={label} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {question.options.map((option) => {
          const selected = answers[question.id] === option;
          return (
            <button
              key={option}
              type="button"
              disabled={isSubmitting}
              aria-pressed={selected}
              onClick={() => {
                setAnswers((previous) => ({ ...previous, [question.id]: option }));
                if (!pageSize && displayMode === "paged" && questionIndex === index && index < runQuestions.length - 1) {
                  setIndex(index + 1);
                }
              }}
              className={cn(
                "content-text min-h-14 w-full max-w-full break-words rounded-md border px-4 py-3 text-center !text-[26px] transition-colors",
                question.direction === "vi2zh" && "hanzi-display",
                selected ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50 hover:bg-muted/40"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );

  const currentQuestion = runQuestions[index];
  const pageCount = pageSize ? Math.ceil(runQuestions.length / pageSize) : 0;
  const pageStart = pageIndex * (pageSize ?? 0);
  const pageQuestions = pageSize ? runQuestions.slice(pageStart, pageStart + pageSize) : [];

  return (
    <div className="space-y-4">
      <input type="hidden" name="quizMode" value={effectiveDirection} />
      {runQuestions.map((question) => (
        <span key={question.id} className="hidden">
          <input type="hidden" name={`response-${question.id}`} value={answers[question.id] ?? ""} />
          <input type="hidden" name={`direction-${question.id}`} value={question.direction} />
        </span>
      ))}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-md border px-3 py-2 text-sm">
        <span className="text-muted-foreground">{answeredCount} / {runQuestions.length} câu</span>
        <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
          {timeLimitMinutes === null ? "Không giới hạn" : <><Timer className="h-4 w-4" />{formatTime(secondsLeft ?? timeLimitMinutes * 60)}</>}
        </span>
        <span className="text-right text-muted-foreground">
          {pageSize
            ? `Câu ${pageStart + 1}–${Math.min(pageStart + pageSize, runQuestions.length)} / ${runQuestions.length}`
            : displayMode === "paged" ? `${index + 1} / ${runQuestions.length}` : "Cuộn xuống"}
        </span>
      </div>

      {pageSize ? (
        <>
          <div className="space-y-5">{pageQuestions.map((question, offset) => renderQuestion(question, pageStart + offset))}</div>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
              aria-label="10 câu trước"
              disabled={pageIndex === 0 || isSubmitting}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">10 câu trước</span>
              <span className="sm:hidden">Trước</span>
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">Trang {pageIndex + 1} / {pageCount}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}
              aria-label="10 câu tiếp theo"
              disabled={pageIndex >= pageCount - 1 || isSubmitting}
            >
              <span className="hidden sm:inline">10 câu tiếp theo</span>
              <span className="sm:hidden">Tiếp</span>
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </>
      ) : displayMode === "paged" ? (
        <>
          <div className="flex flex-wrap gap-1.5" aria-label="Chọn câu hỏi">
            {runQuestions.map((question, questionIndex) => (
              <button
                key={question.id}
                type="button"
                aria-label={`Câu ${questionIndex + 1}`}
                aria-current={index === questionIndex ? "step" : undefined}
                onClick={() => setIndex(questionIndex)}
                className={cn(
                  "h-8 w-8 rounded-md border text-xs font-medium tabular-nums transition-colors",
                  index === questionIndex && "border-primary bg-primary text-primary-foreground",
                  index !== questionIndex && answers[question.id] && "border-primary/40 bg-primary/5 text-primary",
                  index !== questionIndex && !answers[question.id] && "hover:bg-muted/50"
                )}
              >
                {questionIndex + 1}
              </button>
            ))}
          </div>
          {currentQuestion && renderQuestion(currentQuestion, index)}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>
              <ChevronLeft className="mr-1 h-4 w-4" />Trước
            </Button>
            <Button type="button" size="sm" onClick={() => setIndex((value) => Math.min(runQuestions.length - 1, value + 1))} disabled={index === runQuestions.length - 1}>
              Sau<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-5">{runQuestions.map(renderQuestion)}</div>
      )}

      <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
        <Button type="button" variant="outline" size="sm" onClick={restart} disabled={isSubmitting || draftSaving}>
          <RotateCcw className="mr-1.5 h-4 w-4" />Cài đặt lại
        </Button>
        <Button
          ref={submitRef}
          type="submit"
          name="intent"
          value="submit-test"
          size="sm"
          disabled={isSubmitting || draftSaving}
        >
          <Send className="mr-1.5 h-4 w-4" />Nộp bài
        </Button>
      </div>
    </div>
  );
}