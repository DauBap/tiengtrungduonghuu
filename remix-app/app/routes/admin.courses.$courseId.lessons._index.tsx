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
import { ArrowLeft, Plus, Pencil, Trash2, X, BookOpen, Loader2, Settings2, ClipboardCheck, GripVertical } from "lucide-react";

type LessonRow = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  _count: { content: number; learningBlocks: number };
};
type ReviewRow = {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  _count: { questions: number };
};
type CourseItem =
  | { kind: "lesson"; data: LessonRow }
  | { kind: "review"; data: ReviewRow };
type ModalMode = "create" | "edit" | "delete" | null;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  const lessons = await getLessonsForAdmin(course.id);
  const reviewSets = await prisma.courseReviewSet.findMany({
    where: { courseId: course.id },
    include: { _count: { select: { questions: true } } },
    orderBy: { order: "asc" },
  });
  return { user, course, lessons, reviewSets };
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

  if (intent === "delete-review") {
    const reviewId = String(form.get("reviewId") ?? "");
    const reviewSet = await prisma.courseReviewSet.findFirst({ where: { id: reviewId, courseId }, select: { id: true } });
    if (!reviewSet) return { error: "Không tìm thấy bộ ôn tập" };
    await prisma.courseReviewSet.delete({ where: { id: reviewSet.id } });
    return { success: true };
  }

  if (intent === "move") {
    const itemId = String(form.get("itemId"));
    const itemType = String(form.get("itemType"));
    const direction = String(form.get("direction"));
    const current = itemType === "review"
      ? await prisma.courseReviewSet.findFirst({ where: { id: itemId, courseId }, select: { id: true, order: true } })
      : await prisma.lesson.findFirst({ where: { id: itemId, courseId }, select: { id: true, order: true } });
    if (!current) return { error: "Không tìm thấy bài học" };

    const [lessons, reviewSets] = await Promise.all([
      prisma.lesson.findMany({ where: { courseId }, select: { id: true, order: true } }),
      prisma.courseReviewSet.findMany({ where: { courseId }, select: { id: true, order: true } }),
    ]);
    const items = [
      ...lessons.map((item) => ({ ...item, itemType: "lesson" as const })),
      ...reviewSets.map((item) => ({ ...item, itemType: "review" as const })),
    ].sort((a, b) => a.order - b.order);
    const currentIndex = items.findIndex((item) => item.itemType === itemType && item.id === itemId);
    const neighbour = items[currentIndex + (direction === "up" ? -1 : 1)];
    if (!neighbour) return { success: true };

    // Đánh lại toàn bộ thứ tự sau khi đổi vị trí để lesson và review không trùng số.
    const updateOrder = (type: "lesson" | "review", id: string, order: number) =>
      type === "review"
        ? prisma.courseReviewSet.update({ where: { id }, data: { order } })
        : prisma.lesson.update({ where: { id }, data: { order } });
    const reordered = [...items];
    const neighbourIndex = reordered.findIndex((item) => item.id === neighbour.id && item.itemType === neighbour.itemType);
    [reordered[currentIndex], reordered[neighbourIndex]] = [reordered[neighbourIndex], reordered[currentIndex]];
    await prisma.$transaction(
      reordered.map((item, index) => updateOrder(item.itemType, item.id, index + 1))
    );
    return { success: true };
  }

  if (intent === "reorder") {
    let orderedItems: { id: string; itemType: "lesson" | "review" }[];
    try {
      orderedItems = JSON.parse(String(form.get("items") ?? "[]"));
    } catch {
      return { error: "Thứ tự không hợp lệ" };
    }

    if (!Array.isArray(orderedItems) || orderedItems.some((item) =>
      !item || typeof item.id !== "string" || !["lesson", "review"].includes(item.itemType)
    )) return { error: "Thứ tự không hợp lệ" };

    const existingIds = new Set<string>();
    const [lessons, reviewSets] = await Promise.all([
      prisma.lesson.findMany({ where: { courseId }, select: { id: true } }),
      prisma.courseReviewSet.findMany({ where: { courseId }, select: { id: true } }),
    ]);
    lessons.forEach((item) => existingIds.add(`lesson:${item.id}`));
    reviewSets.forEach((item) => existingIds.add(`review:${item.id}`));

    const submittedKeys = orderedItems.map((item) => `${item.itemType}:${item.id}`);
    if (submittedKeys.length !== existingIds.size || new Set(submittedKeys).size !== submittedKeys.length
      || submittedKeys.some((key) => !existingIds.has(key))) {
      return { error: "Danh sách sắp xếp không hợp lệ" };
    }

    const updateOrder = (type: "lesson" | "review", id: string, order: number) =>
      type === "review"
        ? prisma.courseReviewSet.update({ where: { id }, data: { order } })
        : prisma.lesson.update({ where: { id }, data: { order } });
    await prisma.$transaction(orderedItems.map((item, index) => updateOrder(item.itemType, item.id, index + 1)));
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
  const { user, course, lessons, reviewSets } = useLoaderData<typeof loader>();
  const moveFetcher = useFetcher();
  const reviewDeleteFetcher = useFetcher();
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<LessonRow | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const open = (mode: ModalMode, l: LessonRow | null = null) => { setSelected(l); setModalMode(mode); };
  const close = useCallback(() => { setModalMode(null); setSelected(null); }, []);
  const nextOrder = lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) + 1 : 1;
  const items: CourseItem[] = [
    ...lessons.map((data) => ({ kind: "lesson" as const, data })),
    ...reviewSets.map((data) => ({ kind: "review" as const, data })),
  ].sort((a, b) => a.data.order - b.data.order);
  const lessonNumbers = new Map(lessons.map((lesson, index) => [lesson.id, index + 1]));

  const itemKey = (item: CourseItem) => `${item.kind}:${item.data.id}`;
  const reorder = (targetKey: string) => {
    if (!draggingKey || draggingKey === targetKey) return;
    const fromIndex = items.findIndex((item) => itemKey(item) === draggingKey);
    const toIndex = items.findIndex((item) => itemKey(item) === targetKey);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...items];
    const [dragged] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, dragged);
    moveFetcher.submit({
      intent: "reorder",
      items: JSON.stringify(reordered.map((item) => ({ id: item.data.id, itemType: item.kind }))),
    }, { method: "post" });
    setDraggingKey(null);
  };

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

          {items.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-10 w-10" />} title="Chưa có bài học"
              message="Thêm bài học đầu tiên cho khóa học này."
              action={<Button onClick={() => open("create")}><Plus className="h-4 w-4 mr-1.5" />Thêm bài học</Button>} />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Danh sách bài học <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
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
                    {items.map((item, i) => (
                      <TableRow
                        key={`${item.kind}-${item.data.id}`}
                        draggable
                        onDragStart={() => setDraggingKey(itemKey(item))}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => reorder(itemKey(item))}
                        onDragEnd={() => setDraggingKey(null)}
                        className={draggingKey === itemKey(item) ? "opacity-50" : undefined}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-label="Kéo để sắp xếp" />
                            <span className="font-mono text-sm font-medium tabular-nums w-5">{i + 1}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            {item.kind === "review" && <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                            <div>
                              <p className="font-medium">
                                {item.kind === "review" ? `Ôn tập: ${item.data.title}` : `Bài ${lessonNumbers.get(item.data.id)}: ${item.data.title}`}
                              </p>
                              <p className="text-sm text-muted-foreground font-mono">{item.data.subtitle}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {item.kind === "review" ? `${item.data._count.questions} câu` : `${item.data._count.content} từ`}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {item.kind === "review" ? "Bộ ôn tập" : `${item.data._count.learningBlocks} phần`}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.kind === "lesson" ? (
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="outline" size="sm">
                                <Link to={`/admin/lessons/${item.data.id}`}>
                                  <Settings2 className="h-4 w-4 mr-1.5" />Soạn nội dung
                                </Link>
                              </Button>
                              <Button variant="ghost" size="icon" title="Sửa thông tin" onClick={() => open("edit", item.data)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" title="Xóa" onClick={() => open("delete", item.data)}
                                className="hover:text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="outline" size="sm">
                                <Link to={`/admin/courses/${course.id}/reviews/${item.data.id}`}>
                                  <Settings2 className="mr-1.5 h-4 w-4" />Soạn nội dung
                                </Link>
                              </Button>
                              <Button asChild variant="ghost" size="icon" title="Sửa thông tin">
                                <Link to={`/admin/courses/${course.id}/reviews/${item.data.id}`}><Pencil className="h-4 w-4" /></Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Xóa bộ ôn tập"
                                className="hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => {
                                  if (window.confirm(`Xóa bộ ôn tập "${item.data.title}"?`)) {
                                    reviewDeleteFetcher.submit(
                                      { intent: "delete-review", reviewId: item.data.id },
                                      { method: "post" }
                                    );
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
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
