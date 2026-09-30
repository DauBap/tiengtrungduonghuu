import { useState } from "react";
import { Button } from "~/components/ui/button";
import { GrammarPractice, type GrammarPracticeQuestion } from "./grammar-practice";
import { GRAMMAR_FIELDS, type GrammarFieldKey, type GrammarQuestionType } from "~/lib/grammar";
import { cn } from "~/lib/utils";
import { BookOpen, CheckCircle2, ChevronDown, Languages, ListChecks, ListOrdered, X } from "lucide-react";
import { Overlay } from "~/components/common/overlay";

const PRACTICE_TABS: Array<{
  type: GrammarQuestionType;
  label: string;
  icon: typeof CheckCircle2;
}> = [
  { type: "SINGLE_CHOICE", label: "Chọn đáp án đúng", icon: CheckCircle2 },
  { type: "ARRANGE", label: "Sắp xếp từ thành câu", icon: ListOrdered },
  { type: "FILL", label: "Dịch câu", icon: Languages },
];

export interface GrammarSectionData extends Record<GrammarFieldKey, string | null> {
  id: string;
  title: string;
  questions: GrammarPracticeQuestion[];
}

export interface GrammarPracticeSummary {
  score: number | null;
  correctCount: number | null;
  totalCount: number | null;
  passed: boolean | null;
  pendingReview?: boolean;
}

export interface GrammarAnswerReviewGroup {
  targetKey: string;
  score: number | null;
  correctCount: number | null;
  totalCount: number | null;
  results: Array<{
    id: string;
    prompt: string;
    given: string;
    correctAnswer: string;
    correct: boolean | null;
    matchPercent: number | null;
    hint: string | null;
    teacherFeedback: string | null;
  }>;
}

/**
 * Một điểm ngữ pháp cho học viên.
 *
 * Bốn field nội dung đều tùy chọn — field trống thì ẩn cả nhãn. Ví dụ được
 * tách theo từng đoạn để học viên dễ đối chiếu câu tiếng Trung và nghĩa.
 */
export function GrammarSection({
  section,
  number,
  latestAttempts,
  lockedPracticeTypes = [],
  answerReviewEnabled = false,
  answerReviewGroups = [],
}: {
  section: GrammarSectionData;
  number: number;
  latestAttempts: Partial<Record<GrammarQuestionType, GrammarPracticeSummary>>;
  lockedPracticeTypes?: GrammarQuestionType[];
  answerReviewEnabled?: boolean;
  answerReviewGroups?: GrammarAnswerReviewGroup[];
}) {
  const [practicing, setPracticing] = useState(false);
  const [activeType, setActiveType] = useState<GrammarQuestionType>("SINGLE_CHOICE");
  const [showAnswersFor, setShowAnswersFor] = useState<GrammarQuestionType | null>(null);
  const hasQuestions = section.questions.length > 0;
  const questionsByType: Record<GrammarQuestionType, GrammarPracticeQuestion[]> = {
    SINGLE_CHOICE: section.questions.filter((question) => question.type === "SINGLE_CHOICE"),
    ARRANGE: section.questions.filter((question) => question.type === "ARRANGE"),
    FILL: section.questions.filter((question) => question.type === "FILL"),
  };
  const availablePracticeTabs = PRACTICE_TABS.filter((tab) => questionsByType[tab.type].length > 0);
  const latestPracticeTabs = availablePracticeTabs.filter((tab) => latestAttempts[tab.type]);
  const unattemptedPracticeTabs = availablePracticeTabs.filter((tab) => !latestAttempts[tab.type]);
  const isPracticeLocked = (type: GrammarQuestionType) =>
    lockedPracticeTypes.includes(type) || Boolean(latestAttempts[type]?.pendingReview);

  const openPractice = (type?: GrammarQuestionType) => {
    const selected = type
      ? availablePracticeTabs.find((tab) => tab.type === type && !isPracticeLocked(tab.type))
      : availablePracticeTabs.find((tab) => !isPracticeLocked(tab.type));
    if (selected) setActiveType(selected.type);
    setPracticing(true);
  };
  const activeReviewGroup = showAnswersFor
    ? answerReviewGroups.find((group) => group.targetKey === `${section.id}:${showAnswersFor}`)
    : null;
  const activeReviewLabel = PRACTICE_TABS.find((tab) => tab.type === showAnswersFor)?.label;

  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-start gap-3 border-b bg-muted/20 px-5 py-4 sm:px-6">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <BookOpen className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Ngữ pháp {number}</p>
          <h3 className="mt-1 text-lg font-bold leading-snug">{section.title}</h3>
        </div>
      </header>

      <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">

        {GRAMMAR_FIELDS.map((field) => {
          const value = (section[field.key] ?? "").trim();
          if (!value) return null;

          const isFormula = field.key === "formula";
          const isNote = field.key === "note";
          const exampleGroups = field.key === "examples"
            ? value.split(/\n\s*\n/).map((example) => example.trim()).filter(Boolean)
            : [];

          return (
            <div
              key={field.key}
              className={cn(
                "min-w-0",
                isFormula && "rounded-lg border border-warning/30 bg-warning/10 p-4",
                isNote && "rounded-lg border-l-2 border-accent/60 bg-muted/30 px-4 py-3"
              )}
            >
              <p className={cn(
                "mb-2 text-[11px] font-bold uppercase",
                isFormula ? "text-warning" : isNote ? "text-accent" : "text-muted-foreground"
              )}>
                {field.label}
              </p>

              {isFormula ? (
                <div className="space-y-1.5">
                  {value.split("\n").map((line, index) => line.trim() && (
                    <p key={index} className="whitespace-pre-line text-base font-semibold leading-6">
                      {line.trim()}
                    </p>
                  ))}
                </div>
              ) : field.key === "examples" ? (
                <div className="space-y-3">
                  {exampleGroups.map((example, index) => {
                    const [chinese, ...translations] = example.split("\n").map((line) => line.trim()).filter(Boolean);
                    return (
                      <div key={index} className={cn(index > 0 && "border-t pt-3")}>
                        <p className="whitespace-pre-line text-[15px] font-medium leading-6">{chinese}</p>
                        {translations.length > 0 && (
                          <p className="mt-0.5 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                            {translations.join("\n")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="whitespace-pre-line text-sm leading-6">{value}</p>
              )}
            </div>
          );
        })}
      </div>

      {!practicing && availablePracticeTabs.length > 0 && (
        <div className="space-y-2 border-t px-5 py-4 sm:px-6">
          <p className="text-xs font-bold uppercase text-muted-foreground">Luyện tập theo dạng</p>
          {latestPracticeTabs.map((tab) => {
            const result = latestAttempts[tab.type];
            const locked = isPracticeLocked(tab.type);
            const reviewGroup = answerReviewGroups.find((group) => group.targetKey === `${section.id}:${tab.type}`);
            const answersVisible = showAnswersFor === tab.type;
            return (
              <div key={tab.type} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{tab.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {result?.pendingReview ? "Chờ giáo viên chấm" : result ? (
                        <>
                          {result.passed === true ? "Đạt" : "Chưa đạt"}
                          {result.correctCount != null && result.totalCount != null
                            ? ` · Đúng ${result.correctCount}/${result.totalCount} câu`
                            : ""}
                          {result.score != null ? ` · ${result.score}%` : ""}
                        </>
                      ) : "Chưa làm"}
                    </p>
                  </div>
                  {result?.pendingReview ? (
                    <Button type="button" size="sm" variant="outline" disabled>Chờ chấm</Button>
                  ) : locked ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={answersVisible ? "default" : "outline"}
                      disabled={!reviewGroup}
                      onClick={() => setShowAnswersFor(answersVisible ? null : tab.type)}
                    >
                      {answersVisible ? "Ẩn đáp án" : "Hiển thị đáp án kèm kết quả của học sinh"}
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => openPractice(tab.type)}>
                      {result ? "Làm lại" : "Luyện tập"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {unattemptedPracticeTabs.length > 0 && lockedPracticeTypes.length === 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => openPractice(unattemptedPracticeTabs[0].type)}>
              <ListChecks className="mr-1.5 h-4 w-4" />
              {latestPracticeTabs.length > 0 ? "Luyện dạng khác" : "Bắt đầu luyện tập"}
            </Button>
          )}
        </div>
      )}

      {activeReviewGroup && showAnswersFor && (
        <Overlay onClose={() => setShowAnswersFor(null)} className="max-w-3xl !p-0">
          <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-xl">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-base font-bold">Đáp án và kết quả của học sinh</h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {section.title} · {activeReviewLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Đóng đáp án"
                onClick={() => setShowAnswersFor(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <p className="text-sm font-semibold">Kết quả lượt làm tốt nhất</p>
                {activeReviewGroup.score != null && (
                  <p className="text-sm font-medium tabular-nums text-muted-foreground">
                    {activeReviewGroup.score}%{activeReviewGroup.correctCount != null && activeReviewGroup.totalCount != null
                      ? ` · ${activeReviewGroup.correctCount}/${activeReviewGroup.totalCount} câu đúng`
                      : ""}
                  </p>
                )}
              </div>
              {activeReviewGroup.results.map((answer, index) => {
                const correct = answer.correct === true || answer.matchPercent === 100;
                const incorrect = answer.correct === false || answer.matchPercent === 0;
                return (
                  <section key={answer.id} className="space-y-1.5 rounded-md border p-3 text-sm">
                    <p className="font-medium">{index + 1}. {answer.prompt}</p>
                    <p><span className="text-muted-foreground">Câu trả lời của bạn: </span>{answer.given || "Bỏ trống"}</p>
                    <p className={correct ? "text-success" : incorrect ? "text-destructive" : "text-muted-foreground"}>
                      Kết quả: {correct ? "Đúng" : incorrect ? "Sai" : "Chưa xác định"}
                    </p>
                    {answer.teacherFeedback && <p className="whitespace-pre-wrap text-muted-foreground">Giáo viên nhận xét: {answer.teacherFeedback}</p>}
                  </section>
                );
              })}
            </div>
          </div>
        </Overlay>
      )}

      {practicing && hasQuestions && (
        <Overlay onClose={() => setPracticing(false)} className="max-w-3xl !p-0">
          <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-xl">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-base font-bold">Luyện tập</h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{section.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setPracticing(false)}
                aria-label="Đóng luyện tập"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="shrink-0 border-b px-3 sm:px-5">
              <div
                role="tablist"
                aria-label="Dạng bài tập"
                className="grid"
                style={{ gridTemplateColumns: `repeat(${availablePracticeTabs.length}, minmax(0, 1fr))` }}
              >
                {availablePracticeTabs.map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeType === tab.type;
                  const locked = isPracticeLocked(tab.type);
                  const tabId = `grammar-practice-tab-${section.id}-${tab.type}`;
                  return (
                    <button
                      key={tab.type}
                      id={tabId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`${tabId}-panel`}
                      disabled={locked}
                      onClick={() => !locked && setActiveType(tab.type)}
                      className={cn(
                        "flex min-h-[4.5rem] flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-center text-xs font-medium leading-tight transition-colors sm:flex-row sm:gap-2 sm:text-sm",
                        selected ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                        locked && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{tab.label}</span>
                      <span className="tabular-nums text-muted-foreground">({questionsByType[tab.type].length})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {availablePracticeTabs.map((tab) => {
                const tabId = `grammar-practice-tab-${section.id}-${tab.type}`;
                const questions = questionsByType[tab.type];
                return (
                  <section
                    key={tab.type}
                    id={`${tabId}-panel`}
                    role="tabpanel"
                    aria-labelledby={tabId}
                    hidden={activeType !== tab.type}
                  >
                      <GrammarPractice questions={questions} sectionId={section.id} answerReviewEnabled={answerReviewEnabled} />
                  </section>
                );
              })}
            </div>
          </div>
        </Overlay>
      )}
    </article>
  );
}
