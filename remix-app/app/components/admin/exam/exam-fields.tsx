import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

export interface LessonOption {
  id: string;
  title: string;
  order: number;
  courseId: string;
  courseTitle: string;
}

export interface ExamFormValues {
  code: string;
  title: string;
  description: string | null;
  lessonId: string | null;
  courseId: string | null;
}

/**
 * Các field mô tả đề. Dùng chung cho trang tạo mới và tab Tổng quan.
 *
 * Component chỉ render field, không tự bọc `<Form>` — trang gọi quyết định
 * dùng `Form` hay `fetcher.Form` và đặt nút bấm ở đâu.
 *
 * Gắn bài học và gắn khóa học loại trừ nhau: chọn bài học là đã ngụ ý khóa của
 * bài đó, để cả hai thì không rõ đề thuộc về đâu.
 */
export function ExamFields({
  values,
  lessons,
  courses,
  invalidField,
}: {
  values?: ExamFormValues;
  lessons: LessonOption[];
  courses: { id: string; title: string }[];
  invalidField?: string;
}) {
  const [attachType, setAttachType] = useState<"none" | "lesson" | "course">(() => {
    if (values?.lessonId) return "lesson";
    if (values?.courseId) return "course";
    return "none";
  });

  const selectClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="code">
            Mã đề <span className="text-destructive">*</span>
          </Label>
          <Input
            id="code"
            name="code"
            defaultValue={values?.code ?? ""}
            placeholder="HSK1-GK"
            aria-invalid={invalidField === "code" || undefined}
          />
          <p className="text-xs text-muted-foreground">
            Chữ không dấu, số, gạch ngang. Không trùng với đề khác.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">
            Tên đề <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            name="title"
            defaultValue={values?.title ?? ""}
            placeholder="HSK 1 - Kiểm tra giữa kỳ"
            aria-invalid={invalidField === "title" || undefined}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Mô tả</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={values?.description ?? ""}
          placeholder="Mô tả ngắn cho admin. Lời dặn hiện cho học viên trước khi thi đặt ở tab Cài đặt."
        />
      </div>

      <div className="space-y-2">
        <Label>Gắn đề vào đâu</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "none", label: "Độc lập", hint: "Học viên vào từ mục Bài thi" },
            { value: "lesson", label: "Một bài học", hint: "Chạy ở tab Kiểm tra của bài đó" },
            { value: "course", label: "Một khóa học", hint: "Đề chung của khóa" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAttachType(opt.value as typeof attachType)}
              aria-pressed={attachType === opt.value}
              className={
                attachType === opt.value
                  ? "rounded-lg border border-primary bg-primary/5 p-3 text-left"
                  : "rounded-lg border p-3 text-left hover:bg-muted/50"
              }
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chỉ gửi id của kiểu đang chọn; kiểu kia gửi rỗng để server xóa liên kết cũ */}
      {attachType === "lesson" ? (
        <div className="space-y-2">
          <input type="hidden" name="courseId" value="" />
          <Label htmlFor="lessonId">Bài học</Label>
          <select
            id="lessonId"
            name="lessonId"
            defaultValue={values?.lessonId ?? ""}
            className={selectClass}
          >
            <option value="">— Chọn bài học —</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.courseTitle} · Bài {l.order} - {l.title}
              </option>
            ))}
          </select>
        </div>
      ) : attachType === "course" ? (
        <div className="space-y-2">
          <input type="hidden" name="lessonId" value="" />
          <Label htmlFor="courseId">Khóa học</Label>
          <select
            id="courseId"
            name="courseId"
            defaultValue={values?.courseId ?? ""}
            className={selectClass}
          >
            <option value="">— Chọn khóa học —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <input type="hidden" name="lessonId" value="" />
          <input type="hidden" name="courseId" value="" />
        </>
      )}
    </div>
  );
}

/** Nút lưu dùng chung, nhãn đổi theo trạng thái gửi form. */
export function ExamSubmitButton({
  isSubmitting,
  label,
  pendingLabel,
}: {
  isSubmitting: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" disabled={isSubmitting}>
      {isSubmitting ? pendingLabel : label}
    </Button>
  );
}
