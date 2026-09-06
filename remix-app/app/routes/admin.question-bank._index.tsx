import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { requireRole } from "~/lib/session.server";
import {
  listQuestions,
  listQuestionTags,
  parseQuestionForm,
  createQuestion,
  updateQuestion,
  duplicateQuestion,
  deleteQuestion,
} from "~/lib/question-bank.server";
import { QUESTION_TYPE_META, parseQuestionType } from "~/lib/exams";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Overlay } from "~/components/common/overlay";
import { QuestionForm, type QuestionRow } from "~/components/admin/question-bank/question-form";
import { QuestionFilters } from "~/components/admin/question-bank/question-filters";
import {
  Plus, Pencil, Trash2, Copy, X, Loader2, ListChecks, Check,
} from "lucide-react";

type ModalMode = "create" | "edit" | "delete" | null;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);

  const difficultyRaw = Number(url.searchParams.get("difficulty"));
  const filter = {
    // Giá trị lạ trong URL bị bỏ qua thay vì làm vỡ query
    type: parseQuestionType(url.searchParams.get("type")) ?? undefined,
    tag: url.searchParams.get("tag") || undefined,
    difficulty: Number.isInteger(difficultyRaw) && difficultyRaw > 0 ? difficultyRaw : undefined,
    keyword: url.searchParams.get("q")?.trim() || undefined,
  };

  const [result, tags] = await Promise.all([
    listQuestions({ ...filter, page: Number(url.searchParams.get("page")) || 1 }),
    listQuestionTags(),
  ]);

  // `total` là số câu SAU khi lọc, nên không dùng nó để kết luận kho rỗng —
  // lọc không ra gì sẽ hiện nhầm "kho còn trống" và mời admin thêm câu mới.
  const filtered = Object.values(filter).some((v) => v !== undefined);

  return { user, ...result, tags, filtered };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "question-create" || intent === "question-edit") {
    const parsed = parseQuestionForm(form);
    if (!parsed.ok) return { error: parsed.error, field: parsed.field };

    const result =
      intent === "question-edit"
        ? await updateQuestion(String(form.get("questionId")), parsed.data)
        : await createQuestion(parsed.data, user.id);

    if (!result.ok) return { error: result.error, field: result.field };
    return { success: true };
  }

  if (intent === "question-duplicate") {
    const result = await duplicateQuestion(String(form.get("questionId")), user.id);
    if (!result.ok) return { error: result.error };
    return { success: true };
  }

  if (intent === "question-delete") {
    const result = await deleteQuestion(String(form.get("questionId")));
    if (!result.ok) return { error: result.error };
    return { success: true, softDeleted: result.data.softDeleted };
  }

  return null;
}

// ─── Modal xóa ───────────────────────────────────────────────────────────────

function DeleteModal({
  question,
  onClose,
}: {
  question: QuestionRow;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const usages = question._count.usages;

  return (
    <Overlay onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">Xóa câu hỏi</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="line-clamp-3">Xóa câu hỏi “{question.prompt}”?</p>
          {usages > 0 && (
            <p className="mt-2">
              Câu này đang nằm trong <strong>{usages} đề</strong>. Câu sẽ bị ẩn khỏi kho nhưng các đề
              đã có vẫn giữ nguyên nội dung và điểm — lịch sử thi không đổi.
            </p>
          )}
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="question-delete" />
          <input type="hidden" name="questionId" value={question.id} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Hủy
            </Button>
            <Button type="submit" variant="destructive" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {usages > 0 ? "Ẩn khỏi kho" : "Xóa câu hỏi"}
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Overlay>
  );
}

// ─── Trang ───────────────────────────────────────────────────────────────────

export default function AdminQuestionBank() {
  // Chỉ đọc giá trị từ loader — component chạy cả ở client nên không được import
  // bất cứ gì từ module `.server` (React Router chỉ bóc loader/action ra khỏi
  // bundle client, hằng số thì kéo cả module server theo và làm vỡ trang).
  const { user, items, total, page, perPage, pageCount, tags, filtered } =
    useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const rowFetcher = useFetcher();
  const [mode, setMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<QuestionRow | null>(null);

  const open = (next: ModalMode, question: QuestionRow | null = null) => {
    setSelected(question);
    setMode(next);
  };
  const close = useCallback(() => {
    setMode(null);
    setSelected(null);
  }, []);

  const duplicate = (questionId: string) =>
    rowFetcher.submit({ intent: "question-duplicate", questionId }, { method: "post" });

  /** Link phân trang giữ nguyên bộ lọc đang áp. */
  const pageLink = (target: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    return `?${next.toString()}`;
  };

  const questions = items as unknown as QuestionRow[];

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kho câu hỏi</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Câu hỏi ở đây dùng lại được cho nhiều đề thi. Sửa câu không ảnh hưởng các đề đã phát
              hành.
            </p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Danh sách câu hỏi</CardTitle>
                  <CardDescription>
                    Trang {page}/{pageCount} · {perPage} câu mỗi trang
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => open("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Thêm câu hỏi
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuestionFilters tags={tags} total={total} />

              {questions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <ListChecks className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">
                    {filtered ? "Không có câu nào khớp bộ lọc" : "Kho câu hỏi còn trống"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    {filtered
                      ? "Thử bỏ một vài điều kiện lọc."
                      : "Thêm câu hỏi vào kho rồi gắn vào đề thi ở mục Bài thi."}
                  </p>
                  {!filtered && (
                    <Button size="sm" onClick={() => open("create")}>
                      <Plus className="h-4 w-4 mr-1.5" />
                      Thêm câu hỏi
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {questions.map((q) => {
                    const meta = QUESTION_TYPE_META[q.type];
                    const Icon = meta.icon;
                    return (
                      <div key={q.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                          title={meta.label}
                        >
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium line-clamp-2">{q.prompt}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {meta.label}
                            </Badge>
                            {q.difficulty !== null && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                Độ khó {q.difficulty}
                              </Badge>
                            )}
                            {q.tags.map((t) => (
                              <Badge
                                key={t}
                                variant="secondary"
                                className="text-[10px] font-normal"
                              >
                                {t}
                              </Badge>
                            ))}
                            <span className="text-xs text-muted-foreground">
                              ·{" "}
                              {q._count.usages > 0
                                ? `dùng ở ${q._count.usages} đề`
                                : "chưa dùng ở đề nào"}
                            </span>
                          </div>
                          {/* Đáp án đúng chỉ hiện ở trang admin, không bao giờ ở phía học viên */}
                          {q.options.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                              {q.options.map((o) => (
                                <span
                                  key={o.id}
                                  className={
                                    o.isCorrect
                                      ? "inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                                      : "inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                                  }
                                >
                                  {o.isCorrect && <Check className="h-3 w-3" />}
                                  {o.content}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Nhân bản"
                            onClick={() => duplicate(q.id)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Sửa"
                            onClick={() => open("edit", q)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Xóa"
                            onClick={() => open("delete", q)}
                            className="hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" asChild disabled={page <= 1}>
                    <Link to={pageLink(page - 1)} aria-disabled={page <= 1}>
                      Trang trước
                    </Link>
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {pageCount}
                  </span>
                  <Button variant="outline" size="sm" asChild disabled={page >= pageCount}>
                    <Link to={pageLink(page + 1)} aria-disabled={page >= pageCount}>
                      Trang sau
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>

      {/* `key` ép remount mỗi lần mở modal → fetcher mới, không giữ data lần trước */}
      {mode === "delete" && selected && (
        <DeleteModal key={`delete-${selected.id}`} question={selected} onClose={close} />
      )}
      {(mode === "create" || mode === "edit") && (
        <QuestionForm
          key={`${mode}-${selected?.id ?? "new"}`}
          question={mode === "edit" ? selected : null}
          onClose={close}
        />
      )}
    </>
  );
}
