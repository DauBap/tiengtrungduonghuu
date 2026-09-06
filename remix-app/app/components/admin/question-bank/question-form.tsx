import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Overlay } from "~/components/common/overlay";
import { OptionEditor, type OptionDraft } from "./option-editor";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_META,
  TRUE_FALSE_OPTIONS,
  type QuestionType,
} from "~/lib/exams";
import { cn } from "~/lib/utils";
import { X, Loader2, Check } from "lucide-react";

/** Hình dạng câu hỏi mà route truyền vào — khớp `questionInclude` ở server. */
export interface QuestionRow {
  id: string;
  type: QuestionType;
  prompt: string;
  payload: unknown;
  explanation: string | null;
  difficulty: number | null;
  tags: string[];
  options: { id: string; content: string; isCorrect: boolean; order: number }[];
  _count: { usages: number };
}

const EMPTY_OPTIONS: OptionDraft[] = [
  { content: "", isCorrect: false },
  { content: "", isCorrect: false },
];

/** Payload đọc từ DB có thể là bất cứ gì; lấy field theo kiểu chịu lỗi. */
function payloadField(payload: unknown, key: string): string {
  if (payload && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  return "";
}

/**
 * Form soạn câu hỏi cho kho.
 *
 * Field hiện ra theo `QUESTION_TYPE_META[type].optionMode` chứ không theo tên
 * dạng — thêm dạng mới chỉ cần thêm entry trong registry.
 *
 * Đổi dạng câu hỏi **không xóa** lựa chọn đã nhập (state giữ nguyên, chỉ ẩn đi),
 * để admin thử qua lại mà không mất công gõ lại.
 */
export function QuestionForm({
  question,
  onClose,
}: {
  question: QuestionRow | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";
  const isEdit = question !== null;

  const [type, setType] = useState<QuestionType>(question?.type ?? "SINGLE_CHOICE");
  const [options, setOptions] = useState<OptionDraft[]>(() => {
    if (!question || question.options.length < 2) return EMPTY_OPTIONS;
    // Đúng/Sai dựng lựa chọn ở server, không đổ vào editor
    if (QUESTION_TYPE_META[question.type].optionMode === "fixed-boolean") return EMPTY_OPTIONS;
    return question.options.map((o) => ({ content: o.content, isCorrect: o.isCorrect }));
  });
  const [answerIsTrue, setAnswerIsTrue] = useState(() => {
    if (!question) return true;
    // Lựa chọn đầu luôn là "Đúng" (buildTrueFalseOptions dựng theo TRUE_FALSE_OPTIONS)
    return question.options[0]?.isCorrect ?? true;
  });

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const meta = QUESTION_TYPE_META[type];
  const invalidField = fetcher.data?.field;

  return (
    <Overlay onClose={onClose} className="max-w-2xl">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={isEdit ? "question-edit" : "question-create"} />
        {isEdit && <input type="hidden" name="questionId" value={question.id} />}
        <input type="hidden" name="type" value={type} />

        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Sửa câu hỏi" : "Thêm câu hỏi"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <div className="space-y-2">
          <Label>Dạng câu hỏi</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {QUESTION_TYPES.map((t) => {
              const m = QUESTION_TYPE_META[t];
              const Icon = m.icon;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!m.implemented}
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                    type === t ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    !m.implemented && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {m.label}
                      {!m.implemented && " (sắp có)"}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="prompt">
            Nội dung câu hỏi <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="prompt"
            name="prompt"
            rows={2}
            defaultValue={question?.prompt ?? ""}
            placeholder="他是谁？"
            autoFocus
            aria-invalid={invalidField === "prompt" || undefined}
          />
        </div>

        {type === "LISTENING" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="audioUrl">
                Link audio <span className="text-destructive">*</span>
              </Label>
              <Input
                id="audioUrl"
                name="audioUrl"
                defaultValue={payloadField(question?.payload, "audioUrl")}
                placeholder="https://... hoặc /audio/hsk1-01.mp3"
                aria-invalid={invalidField === "audioUrl" || undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transcript">Lời thoại</Label>
              <Textarea
                id="transcript"
                name="transcript"
                rows={2}
                defaultValue={payloadField(question?.payload, "transcript")}
                placeholder="Nội dung đoạn nghe — chỉ hiện cho học viên sau khi được xem kết quả."
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="imageUrl">Link ảnh minh họa</Label>
          <Input
            id="imageUrl"
            name="imageUrl"
            defaultValue={payloadField(question?.payload, "imageUrl")}
            placeholder="Tùy chọn"
          />
        </div>

        {meta.optionMode === "fixed-boolean" ? (
          <div className="space-y-2">
            <input type="hidden" name="answerIsTrue" value={String(answerIsTrue)} />
            <Label>
              Đáp án đúng <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {TRUE_FALSE_OPTIONS.map((label, i) => {
                const active = answerIsTrue === (i === 0);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAnswerIsTrue(i === 0)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors",
                      active ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50"
                    )}
                  >
                    {active && <Check className="h-4 w-4" />}
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Hai lựa chọn Đúng / Sai do hệ thống tạo, nhãn giống nhau ở mọi câu.
            </p>
          </div>
        ) : meta.optionMode === "none" ? null : (
          <OptionEditor
            options={options}
            onChange={setOptions}
            multiple={meta.optionMode === "multi"}
            invalidField={invalidField}
          />
        )}

        <div className="space-y-2">
          <Label htmlFor="explanation">Giải thích đáp án</Label>
          <Textarea
            id="explanation"
            name="explanation"
            rows={2}
            defaultValue={question?.explanation ?? ""}
            placeholder="Chỉ hiện cho học viên khi cấu hình đề cho phép xem giải thích."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="difficulty">Độ khó</Label>
            <select
              id="difficulty"
              name="difficulty"
              defaultValue={question?.difficulty?.toString() ?? ""}
              aria-invalid={invalidField === "difficulty" || undefined}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Không đặt</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Nhãn</Label>
            <Input
              id="tags"
              name="tags"
              defaultValue={question?.tags.join(", ") ?? ""}
              placeholder="HSK1, nghe, chào hỏi"
            />
            <p className="text-xs text-muted-foreground">Cách nhau bằng dấu phẩy.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
            Hủy
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Thêm câu hỏi"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}
