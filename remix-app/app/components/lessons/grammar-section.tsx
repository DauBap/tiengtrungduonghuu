import { useState } from "react";
import { Button } from "~/components/ui/button";
import { GrammarPractice, type GrammarPracticeQuestion } from "./grammar-practice";
import { GRAMMAR_FIELDS, type GrammarFieldKey } from "~/lib/grammar";
import { cn } from "~/lib/utils";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";

export interface GrammarSectionData extends Record<GrammarFieldKey, string | null> {
  id: string;
  title: string;
  questions: GrammarPracticeQuestion[];
}

/**
 * Một điểm ngữ pháp cho học viên.
 *
 * Bốn field nội dung đều tùy chọn — field trống thì ẩn cả nhãn, không hiện
 * "Giải thích:" rồi để trắng. Công thức được làm nổi bật bằng nền vàng pastel
 * vì đó là phần học viên cần nhớ.
 */
export function GrammarSection({ section }: { section: GrammarSectionData }) {
  const [practicing, setPracticing] = useState(false);
  const hasQuestions = section.questions.length > 0;

  return (
    <div className="rounded-xl border bg-card">
      <div className="p-5 sm:p-6 space-y-4">
        <h3 className="text-lg font-bold tracking-tight">{section.title}</h3>

        {GRAMMAR_FIELDS.map((field) => {
          const value = (section[field.key] ?? "").trim();
          if (!value) return null;

          const isFormula = field.key === "formula";
          return (
            <div
              key={field.key}
              className={cn(
                "space-y-1",
                // Công thức: nền vàng pastel qua biến theme --warning nên tự
                // hợp cả dark mode
                isFormula && "rounded-lg border border-warning/30 bg-warning/10 p-4"
              )}
            >
              <p className={cn("text-xs font-medium uppercase tracking-wide",
                isFormula ? "text-warning" : "text-muted-foreground")}>
                {field.label}
              </p>
              <p className={cn("whitespace-pre-line",
                isFormula ? "text-lg font-semibold" : "text-sm")}>
                {value}
              </p>
            </div>
          );
        })}

        {hasQuestions && (
          <Button variant="outline" onClick={() => setPracticing((p) => !p)} className="w-full sm:w-auto">
            <ListChecks className="h-4 w-4 mr-1.5" />
            Luyện tập
            <span className="text-muted-foreground ml-1.5 tabular-nums">({section.questions.length})</span>
            {practicing ? <ChevronUp className="h-4 w-4 ml-1.5" /> : <ChevronDown className="h-4 w-4 ml-1.5" />}
          </Button>
        )}
      </div>

      {/* Mở ngay dưới nội dung để học viên vẫn đối chiếu được công thức */}
      {practicing && hasQuestions && (
        <div className="border-t bg-muted/20 p-5 sm:p-6">
          <GrammarPractice questions={section.questions} />
        </div>
      )}
    </div>
  );
}
