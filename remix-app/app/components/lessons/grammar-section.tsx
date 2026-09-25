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

/**
 * Một điểm ngữ pháp cho học viên.
 *
 * Bốn field nội dung đều tùy chọn — field trống thì ẩn cả nhãn. Ví dụ được
 * tách theo từng đoạn để học viên dễ đối chiếu câu tiếng Trung và nghĩa.
 */
export function GrammarSection({ section, number }: { section: GrammarSectionData; number: number }) {
  const [practicing, setPracticing] = useState(false);
  const [activeType, setActiveType] = useState<GrammarQuestionType>("SINGLE_CHOICE");
  const hasQuestions = section.questions.length > 0;
  const questionsByType: Record<GrammarQuestionType, GrammarPracticeQuestion[]> = {
    SINGLE_CHOICE: section.questions.filter((question) => question.type === "SINGLE_CHOICE"),
    ARRANGE: section.questions.filter((question) => question.type === "ARRANGE"),
    FILL: section.questions.filter((question) => question.type === "FILL"),
  };

  const openPractice = () => {
    const firstAvailable = PRACTICE_TABS.find((tab) => questionsByType[tab.type].length > 0);
    if (firstAvailable) setActiveType(firstAvailable.type);
    setPracticing(true);
  };

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

      {hasQuestions && (
        <div className="border-t bg-muted/20 px-5 py-3 sm:px-6">
          <Button onClick={openPractice} className="w-full justify-between sm:w-auto sm:justify-start">
            <span className="flex items-center">
              <ListChecks className="mr-1.5 h-4 w-4" />
              Luyện tập
              <span className="ml-1.5 tabular-nums text-muted-foreground">({section.questions.length})</span>
            </span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
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
              <div role="tablist" aria-label="Dạng bài tập" className="grid grid-cols-3">
                {PRACTICE_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeType === tab.type;
                  const tabId = `grammar-practice-tab-${section.id}-${tab.type}`;
                  return (
                    <button
                      key={tab.type}
                      id={tabId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`${tabId}-panel`}
                      onClick={() => setActiveType(tab.type)}
                      className={cn(
                        "flex min-h-[4.5rem] flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-center text-xs font-medium leading-tight transition-colors sm:flex-row sm:gap-2 sm:text-sm",
                        selected ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
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
              {PRACTICE_TABS.map((tab) => {
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
                    {questions.length > 0 ? (
                      <GrammarPractice questions={questions} />
                    ) : (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Chưa có câu hỏi dạng này trong phần ngữ pháp.
                      </p>
                    )}
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
