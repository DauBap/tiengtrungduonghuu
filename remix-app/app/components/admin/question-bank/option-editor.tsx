import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import { Check, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";

export interface OptionDraft {
  content: string;
  isCorrect: boolean;
}

export const MAX_OPTIONS = 8;

/**
 * Soạn lựa chọn cho câu hỏi.
 *
 * Đáp án đúng gửi lên server bằng input hidden `correct` mang **chỉ số** của
 * dòng, đọc ở `parseQuestionForm` qua `form.getAll("correct")`. Vì thế:
 *
 *  - không dùng radio/checkbox thật (giá trị `on` không mang chỉ số),
 *  - **không được** lọc bỏ dòng trống trước khi gửi — lọc là lệch chỉ số và
 *    chấm sai câu (bug đã gặp ở phần Ngữ pháp). Dòng trống để server báo lỗi.
 */
export function OptionEditor({
  options,
  onChange,
  multiple,
  invalidField,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
  /** true = chọn nhiều đáp án đúng; false = chọn đúng một */
  multiple: boolean;
  invalidField?: string;
}) {
  const setContent = (index: number, content: string) =>
    onChange(options.map((o, i) => (i === index ? { ...o, content } : o)));

  const toggleCorrect = (index: number) =>
    onChange(
      options.map((o, i) =>
        i === index
          ? { ...o, isCorrect: !o.isCorrect }
          : // Dạng một đáp án: đánh dấu dòng mới là bỏ dấu mọi dòng khác
            { ...o, isCorrect: multiple ? o.isCorrect : false }
      )
    );

  const add = () => {
    if (options.length >= MAX_OPTIONS) return;
    onChange([...options, { content: "", isCorrect: false }]);
  };

  const remove = (index: number) => onChange(options.filter((_, i) => i !== index));

  const move = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const correctCount = options.filter((o) => o.isCorrect).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Lựa chọn <span className="text-destructive">*</span>
        </Label>
        <span
          className={cn(
            "text-xs",
            invalidField === "correct" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {multiple
            ? `Bấm dấu ✓ để đánh dấu đáp án đúng (cần ít nhất 2) — đang có ${correctCount}`
            : "Bấm dấu ✓ ở đáp án đúng"}
        </span>
      </div>

      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            {/* Chỉ số dòng, không phải giá trị ô — giữ nguyên cả khi ô trống */}
            {opt.isCorrect && <input type="hidden" name="correct" value={i} />}

            <button
              type="button"
              onClick={() => toggleCorrect(i)}
              title={opt.isCorrect ? "Bỏ đánh dấu đáp án đúng" : "Đánh dấu là đáp án đúng"}
              aria-pressed={opt.isCorrect}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                opt.isCorrect
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Check className="h-4 w-4" />
            </button>

            <Input
              name="option"
              value={opt.content}
              onChange={(e) => setContent(i, e.target.value)}
              placeholder={`Lựa chọn ${i + 1}`}
              aria-label={`Lựa chọn ${i + 1}`}
              aria-invalid={
                (invalidField === "option" && !opt.content.trim()) || undefined
              }
            />

            <div className="flex flex-col shrink-0">
              <button
                type="button"
                onClick={() => move(i, "up")}
                disabled={i === 0}
                title="Lên trên"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, "down")}
                disabled={i === options.length - 1}
                title="Xuống dưới"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => remove(i)}
              disabled={options.length <= 2}
              title={options.length <= 2 ? "Cần ít nhất 2 lựa chọn" : "Xóa lựa chọn"}
              className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={options.length >= MAX_OPTIONS}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Thêm lựa chọn
      </Button>
    </div>
  );
}
