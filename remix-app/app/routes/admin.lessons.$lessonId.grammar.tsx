import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { GRAMMAR_FIELDS } from "~/lib/grammar";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Overlay } from "~/components/common/overlay";
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Loader2, ChevronUp, ChevronDown,
  GraduationCap, ListChecks,
} from "lucide-react";

type SectionRow = {
  id: string;
  title: string;
  explanation: string | null;
  formula: string | null;
  examples: string | null;
  note: string | null;
  order: number;
  questions: { id: string }[];
};

type ModalMode = "create" | "edit" | "delete" | null;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const lesson = await getLessonForAdmin(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  return { user, lesson };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const lessonId = params.lessonId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "section-create" || intent === "section-edit") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "Vui lòng nhập tiêu đề", field: "title" };

    // Đọc 4 field nội dung, chuỗi rỗng → null để phía học viên ẩn hẳn field đó
    const content = Object.fromEntries(
      GRAMMAR_FIELDS.map((f) => [f.key, String(form.get(f.key) ?? "").trim() || null])
    ) as Record<(typeof GRAMMAR_FIELDS)[number]["key"], string | null>;

    // Section không có field nào thì học viên chỉ thấy một cái tiêu đề trơ trọi
    if (GRAMMAR_FIELDS.every((f) => !content[f.key])) {
      return { error: "Nhập ít nhất một phần nội dung (giải thích, công thức, ví dụ hoặc lưu ý)" };
    }

    if (intent === "section-edit") {
      const sectionId = String(form.get("sectionId"));
      // Chỉ sửa section thuộc đúng bài này — id đến từ client nên phải đối chiếu
      const owned = await prisma.grammarSection.findFirst({
        where: { id: sectionId, lessonId }, select: { id: true },
      });
      if (!owned) return { error: "Không tìm thấy phần ngữ pháp" };
      await prisma.grammarSection.update({ where: { id: sectionId }, data: { title, ...content } });
    } else {
      const last = await prisma.grammarSection.findFirst({
        where: { lessonId }, orderBy: { order: "desc" }, select: { order: true },
      });
      await prisma.grammarSection.create({
        data: { lessonId, title, ...content, order: (last?.order ?? 0) + 1 },
      });
    }
    return { success: true };
  }

  if (intent === "section-delete") {
    const sectionId = String(form.get("sectionId"));
    // Câu hỏi của section tự xóa theo onDelete: Cascade
    const result = await prisma.grammarSection.deleteMany({ where: { id: sectionId, lessonId } });
    if (result.count === 0) return { error: "Không tìm thấy phần ngữ pháp" };
    return { success: true };
  }

  if (intent === "section-move") {
    const sectionId = String(form.get("sectionId"));
    const direction = String(form.get("direction"));
    const current = await prisma.grammarSection.findFirst({
      where: { id: sectionId, lessonId }, select: { id: true, order: true },
    });
    if (!current) return { error: "Không tìm thấy phần ngữ pháp" };
    const neighbour = await prisma.grammarSection.findFirst({
      where: { lessonId, order: direction === "up" ? { lt: current.order } : { gt: current.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };
    // Ba bước qua order tạm -1, giống vocab-move/sentence-move ở trang bài học
    await prisma.$transaction([
      prisma.grammarSection.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.grammarSection.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.grammarSection.update({ where: { id: current.id }, data: { order: neighbour.order } }),
    ]);
    return { success: true };
  }

  return null;
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function SectionModal({
  mode, section, onClose,
}: {
  mode: ModalMode;
  section: SectionRow | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "delete") {
    if (!section) return null;
    const questionCount = section.questions.length;
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa phần ngữ pháp</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>
              Xóa <strong>{section.title}</strong>?
              {questionCount > 0
                ? ` ${questionCount} câu hỏi luyện tập của phần này cũng bị xóa theo.`
                : " Phần này chưa có câu hỏi luyện tập nào."}
            </p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="section-delete" />
            <input type="hidden" name="sectionId" value={section.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa phần này
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";

  return (
    <Overlay onClose={onClose} className="max-w-2xl">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={isEdit ? "section-edit" : "section-create"} />
        {isEdit && section && <input type="hidden" name="sectionId" value={section.id} />}

        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Sửa phần ngữ pháp" : "Thêm phần ngữ pháp"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="title">Tiêu đề <span className="text-destructive">*</span></Label>
          <Input id="title" name="title" defaultValue={section?.title ?? ""}
            placeholder="Ngữ pháp 1" autoFocus
            aria-invalid={fetcher.data?.field === "title" || undefined} />
        </div>

        <p className="text-xs text-muted-foreground">
          Bốn phần dưới đây đều tùy chọn — phần nào để trống thì học viên không thấy.
        </p>

        {GRAMMAR_FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Textarea id={f.key} name={f.key} defaultValue={section?.[f.key] ?? ""}
              rows={f.key === "formula" ? 2 : 3}
              placeholder={PLACEHOLDERS[f.key]} />
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Thêm phần"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

const PLACEHOLDERS: Record<(typeof GRAMMAR_FIELDS)[number]["key"], string> = {
  explanation: "Dùng để giới thiệu bản thân hoặc xác định danh tính...",
  formula: "S + 是 + N",
  examples: "我是学生。\nWǒ shì xuéshēng.\nTôi là học sinh.",
  note: "是 không dùng với tính từ, dùng 很 thay thế.",
};

// ─── Trang ───────────────────────────────────────────────────────────────────

export default function AdminLessonGrammar() {
  const { user, lesson } = useLoaderData<typeof loader>();
  const moveFetcher = useFetcher();
  const [mode, setMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<SectionRow | null>(null);

  const open = (next: ModalMode, section: SectionRow | null = null) => {
    setSelected(section);
    setMode(next);
  };
  const close = useCallback(() => { setMode(null); setSelected(null); }, []);

  const move = (sectionId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "section-move", sectionId, direction }, { method: "post" });

  const sections = lesson.grammarSections;

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6 max-w-4xl">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to={`/admin/lessons/${lesson.id}`}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">Ngữ pháp</h1>
            <p className="text-muted-foreground text-sm mt-1">Bài {lesson.order} - {lesson.title}</p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Các phần ngữ pháp <span className="text-sm font-normal text-muted-foreground">({sections.length})</span>
                  </CardTitle>
                  <CardDescription>Học viên xem lần lượt theo thứ tự bên dưới.</CardDescription>
                </div>
                <Button size="sm" onClick={() => open("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />Thêm phần ngữ pháp
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sections.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có phần ngữ pháp nào</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    Mỗi phần gồm giải thích, công thức, ví dụ và câu hỏi luyện tập.
                  </p>
                  <Button size="sm" onClick={() => open("create")}>
                    <Plus className="h-4 w-4 mr-1.5" />Thêm phần ngữ pháp
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {sections.map((s, i) => {
                    const filled = GRAMMAR_FIELDS.filter((f) => (s[f.key] ?? "").trim());
                    return (
                      <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="flex flex-col">
                          <button onClick={() => move(s.id, "up")} disabled={i === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => move(s.id, "down")} disabled={i === sections.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <GraduationCap className="h-4.5 w-4.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{s.title}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {filled.map((f) => (
                              <Badge key={f.key} variant="outline" className="text-[10px] font-normal text-muted-foreground">
                                {f.label}
                              </Badge>
                            ))}
                            <span className="text-xs text-muted-foreground">
                              · {s.questions.length > 0 ? `${s.questions.length} câu luyện tập` : "chưa có câu luyện tập"}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="sm" asChild title="Câu hỏi luyện tập">
                            <Link to={`/admin/lessons/${lesson.id}/grammar/${s.id}`}>
                              <ListChecks className="h-4 w-4 mr-1.5" />Luyện tập
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" title="Sửa" onClick={() => open("edit", s as SectionRow)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Xóa" onClick={() => open("delete", s as SectionRow)}
                            className="hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
      {/* `key` ép remount mỗi lần mở modal → fetcher mới, không giữ data lần trước */}
      <SectionModal
        key={mode ? `${mode}-${selected?.id ?? "new"}` : "closed"}
        mode={mode}
        section={selected}
        onClose={close}
      />
    </>
  );
}
