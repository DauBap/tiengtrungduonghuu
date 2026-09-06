import { Form, useSearchParams } from "react-router";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { QUESTION_TYPES, QUESTION_TYPE_META } from "~/lib/exams";
import { Search, X } from "lucide-react";

/**
 * Bộ lọc kho câu hỏi.
 *
 * Trạng thái lọc nằm trong URL (không phải React state) để chia sẻ link được và
 * F5 không mất bộ lọc. Dùng `<Form method="get">` nên loader tự chạy lại; đổi
 * select là submit ngay, còn ô tìm kiếm chờ Enter cho khỏi gọi loader mỗi ký tự.
 */
export function QuestionFilters({ tags, total }: { tags: string[]; total: number }) {
  const [params] = useSearchParams();
  const hasFilter = ["type", "tag", "difficulty", "q"].some((k) => params.get(k));

  const selectClass =
    "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Form method="get" className="flex flex-wrap items-center gap-2">
      {/* Lọc lại luôn về trang 1: giữ page cũ dễ ra trang trắng */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder="Tìm trong nội dung câu hỏi..."
          className="h-9 pl-9"
        />
      </div>

      <select
        name="type"
        defaultValue={params.get("type") ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Dạng câu hỏi"
        className={selectClass}
      >
        <option value="">Mọi dạng</option>
        {QUESTION_TYPES.map((t) => (
          <option key={t} value={t}>
            {QUESTION_TYPE_META[t].label}
          </option>
        ))}
      </select>

      <select
        name="difficulty"
        defaultValue={params.get("difficulty") ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Độ khó"
        className={selectClass}
      >
        <option value="">Mọi độ khó</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            Độ khó {n}
          </option>
        ))}
      </select>

      {tags.length > 0 && (
        <select
          name="tag"
          defaultValue={params.get("tag") ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label="Nhãn"
          className={selectClass}
        >
          <option value="">Mọi nhãn</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      <Button type="submit" variant="secondary" size="sm">
        Lọc
      </Button>

      {hasFilter && (
        <Button type="button" variant="ghost" size="sm" asChild>
          <a href="/admin/question-bank">
            <X className="h-4 w-4 mr-1.5" />
            Bỏ lọc
          </a>
        </Button>
      )}

      <span className="text-sm text-muted-foreground ml-auto">{total} câu</span>
    </Form>
  );
}
