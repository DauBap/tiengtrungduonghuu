import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { Overlay } from "~/components/common/overlay";
import { ArrowLeft, Plus, Pencil, Trash2, X, BookOpen, Loader2, ChevronUp, ChevronDown, Settings2 } from "lucide-react";

type LessonRow = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  _count: { content: number; learningBlocks: number };
};
type ModalMode = "create" | "edit" | "delete" | null;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  const lessons = await getLessonsForAdmin(course.id);
  return { user, course, lessons };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "create" || intent === "edit") {
    const title = String(form.get("title") ?? "").trim();
    const subtitle = String(form.get("subtitle") ?? "").trim();
    const orderRaw = String(form.get("order") ?? "").trim();

    if (!title) return { error: "Vui lòng nhập tên bài học", field: "title" };
    if (!subtitle) return { error: "Vui lòng nhập phụ đề (câu tiếng Trung tiêu biểu)", field: "subtitle" };
    const order = Number(orderRaw);
    if (!Number.isInteger(order) || order < 1) return { error: "Thứ tự phải là số nguyên từ 1 trở lên", field: "order" };

    const lessonId = intent === "edit" ? String(form.get("lessonId")) : null;
    const clash = await prisma.lesson.findFirst({
      where: { courseId, order, ...(lessonId ? { id: { not: lessonId } } : {}) },
      select: { id: true },
    });
    if (clash) return { error: `Đã có bài học ở thứ tự ${order}`, field: "order" };

    if (lessonId) {
      await prisma.lesson.update({ where: { id: lessonId }, data: { title, subtitle, order } });
    } else {
      await prisma.lesson.create({ data: { courseId, title, subtitle, order } });
    }
    return { success: true };
  }

  if (intent === "delete") {
    // Cascade xóa luôn vocab, block, tiến độ của bài này
    await prisma.lesson.delete({ where: { id: String(form.get("lessonId")) } });
    return { success: true };
  }

  if (intent === "move") {
    const lessonId = String(form.get("lessonId"));
    const direction = String(form.get("direction"));
    const current = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true, order: true } });
    if (!current) return { error: "Không tìm thấy bài học" };

    const neighbour = await prisma.lesson.findFirst({
      where: {
        courseId,
        order: direction === "up" ? { lt: current.order } : { gt: current.order },
      },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };

    // Đổi chỗ qua giá trị tạm để không vướng thứ tự trùng
    await prisma.$transaction([
      prisma.lesson.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.lesson.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.lesson.update({ where: { id: current.id }, data: { order: neighbour.order } }),
    ]);
    return { success: true };
  }

  return null;
}

function LessonModal({
  mode, lesson, nextOrder, onClose,
}: { mode: ModalMode; lesson: LessonRow | null; nextOrder: number; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "delete") {
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa bài học</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>Xóa bài <strong>{lesson?.title}</strong>? Toàn bộ từ vựng, dạng bài học và tiến độ của học viên trong bài này sẽ bị xóa vĩnh viễn.</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="lessonId" value={lesson?.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa bài học
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";
  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" noValidate className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Chỉnh sửa bài học" : "Thêm bài học"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}
        <input type="hidden" name="intent" value={isEdit ? "edit" : "create"} />
        {isEdit && <input type="hidden" name="lessonId" value={lesson?.id} />}
        <div className="space-y-2">
          <Label htmlFor="title">Tên bài học <span className="text-destructive">*</span></Label>
          <Input id="title" name="title" defaultValue={lesson?.title} placeholder="Chào hỏi & Giới thiệu"
            aria-invalid={fetcher.data?.field === "title" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subtitle">Phụ đề <span className="text-destructive">*</span></Label>
          <Input id="subtitle" name="subtitle" defaultValue={lesson?.subtitle} placeholder="你好，你叫什么名字？"
            aria-invalid={fetcher.data?.field === "subtitle" || undefined} />
          <p className="text-xs text-muted-foreground">Câu tiếng Trung tiêu biểu, hiện dưới tên bài học.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="order">Thứ tự <span className="text-destructive">*</span></Label>
          <Input id="order" name="order" type="number" min={1} defaultValue={lesson?.order ?? nextOrder}
            aria-invalid={fetcher.data?.field === "order" || undefined} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Thêm bài học"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

export default function AdminCourseLessons() {
  const { user, course, lessons } = useLoaderData<typeof loader>();
  const moveFetcher = useFetcher();
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<LessonRow | null>(null);

  const open = (mode: ModalMode, l: LessonRow | null = null) => { setSelected(l); setModalMode(mode); };
  const close = useCallback(() => { setModalMode(null); setSelected(null); }, []);
  const nextOrder = lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) + 1 : 1;

  const move = (lessonId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "move", lessonId, direction }, { method: "post" });

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to="/admin/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
            </Button>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Bài học</h1>
                <p className="text-muted-foreground text-sm mt-1">{course.code} - {course.title}</p>
              </div>
              <Button onClick={() => open("create")}><Plus className="h-4 w-4 mr-1.5" />Thêm bài học</Button>
            </div>
          </div>

          {lessons.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-10 w-10" />} title="Chưa có bài học"
              message="Thêm bài học đầu tiên cho khóa học này."
              action={<Button onClick={() => open("create")}><Plus className="h-4 w-4 mr-1.5" />Thêm bài học</Button>} />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Danh sách bài học <span className="text-sm font-normal text-muted-foreground">({lessons.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Thứ tự</TableHead>
                      <TableHead>Tên bài học</TableHead>
                      <TableHead>Từ vựng</TableHead>
                      <TableHead>Dạng bài học</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lessons.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm font-medium tabular-nums w-5">{l.order}</span>
                            <div className="flex flex-col">
                              <button onClick={() => move(l.id, "up")} disabled={i === 0}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                                title="Lên trên">
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => move(l.id, "down")} disabled={i === lessons.length - 1}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                                title="Xuống dưới">
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{l.title}</p>
                          <p className="text-sm text-muted-foreground font-mono">{l.subtitle}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">{l._count.content} từ</TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">{l._count.learningBlocks} phần</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button asChild variant="outline" size="sm">
                              <Link to={`/admin/lessons/${l.id}`}>
                                <Settings2 className="h-4 w-4 mr-1.5" />Soạn nội dung
                              </Link>
                            </Button>
                            <Button variant="ghost" size="icon" title="Sửa thông tin" onClick={() => open("edit", l as LessonRow)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Xóa" onClick={() => open("delete", l as LessonRow)}
                              className="hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </AppShell>
      <LessonModal
        key={modalMode ? `${modalMode}-${selected?.id ?? "new"}` : "closed"}
        mode={modalMode}
        lesson={selected}
        nextOrder={nextOrder}
        onClose={close}
      />
    </>
  );
}
