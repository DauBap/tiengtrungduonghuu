import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { VocabularyTestQuestion } from "~/lib/vocabulary-test";
import { ChevronLeft, ChevronRight, RotateCcw, Send, Timer } from "lucide-react";

type QuizDirection = "zh2vi" | "vi2zh" | "mixed";
type QuestionDirection = Exclude<QuizDirection, "mixed">;
type DisplayMode = "paged" | "scroll";

interface ActiveQuestion extends VocabularyTestQuestion {
  direction: QuestionDirection;
  prompt: string;
  promptDetail: string | null;
  options: string[];
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
  questions,
  timeLimitMinutes,
  isSubmitting = false,
}: {
  questions: VocabularyTestQuestion[];
  timeLimitMinutes: number | null;
  isSubmitting?: boolean;
}) {
  const [direction, setDirection] = useState<QuizDirection>("mixed");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("paged");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [runQuestions, setRunQuestions] = useState<ActiveQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const started = startedAt !== null;
  const answeredCount = runQuestions.filter((item) => Boolean(answers[item.id])).length;

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
      const questionDirection: QuestionDirection = direction === "mixed"
        ? (Math.random() < 0.5 ? "zh2vi" : "vi2zh")
        : direction;

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
    setSecondsLeft(timeLimitMinutes === null ? null : timeLimitMinutes * 60);
    setStartedAt(Date.now());
  };

  const restart = () => {
    setRunQuestions([]);
    setAnswers({});
    setIndex(0);
    setSecondsLeft(null);
    setStartedAt(null);
  };

  const formatTime = (value: number) =>
    `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;

  if (questions.length === 0) return null;

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
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border bg-card px-5 py-6 text-center">
        <p className={cn("font-semibold leading-tight", question.direction === "zh2vi" ? "text-5xl" : "text-2xl")}>
          {question.prompt}
        </p>
        {question.promptDetail && <p className="font-mono text-sm text-muted-foreground">{question.promptDetail}</p>}
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
                if (displayMode === "paged" && questionIndex === index && index < runQuestions.length - 1) {
                  setIndex(index + 1);
                }
              }}
              className={cn(
                "min-h-14 rounded-md border px-4 py-3 text-center text-sm transition-colors",
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

  return (
    <div className="space-y-4">
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
        <span className="text-right text-muted-foreground">{displayMode === "paged" ? `${index + 1} / ${runQuestions.length}` : "Cuộn xuống"}</span>
      </div>

      {displayMode === "paged" ? (
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
        <Button type="button" variant="outline" size="sm" onClick={restart} disabled={isSubmitting}>
          <RotateCcw className="mr-1.5 h-4 w-4" />Cài đặt lại
        </Button>
        <Button ref={submitRef} type="submit" name="intent" value="submit-test" size="sm" disabled={isSubmitting}>
          <Send className="mr-1.5 h-4 w-4" />Nộp bài
        </Button>
      </div>
    </div>
  );
}