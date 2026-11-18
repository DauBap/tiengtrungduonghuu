import { useState, useMemo, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, useNavigation, useFetcher, redirect } from "react-router";
import { toast } from "sonner";
import { requireRole } from "~/lib/session.server";
import { getAllCourses } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { removeCourseDocumentAsset } from "~/lib/storage.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { EmptyState } from "~/components/common/empty-state";
import { Overlay } from "~/components/common/overlay";
import { Search, Plus, Pencil, BookOpen, ListOrdered, Trash2, X, Loader2 } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const courses = await getAllCourses();
  return { user, courses };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete-course") {
    const courseId = String(form.get("courseId") ?? "");
    if (!courseId) return { error: "Thiếu khóa học cần xóa." };

    const documents = await prisma.courseDocument.findMany({
      where: { courseId },
      select: { fileUrl: true },
    });
    await prisma.course.delete({ where: { id: courseId } });
    await Promise.all(documents.map(({ fileUrl }) => removeCourseDocumentAsset(fileUrl)));
    return redirect("/admin/courses");
  }

  if (intent === "update-course") {
    const courseId = String(form.get("courseId") ?? "");
    const code = String(form.get("code") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const hskLevel = Number(form.get("hskLevel"));
    const status = String(form.get("status") ?? "");
    const order = Number(form.get("order"));

    if (!courseId || !code || !title) {
      return { error: "Vui lòng nhập mã và tên khóa học." };
    }
    if (!Number.isInteger(hskLevel) || hskLevel < 1 || hskLevel > 6) {
      return { error: "Cấp độ HSK không hợp lệ." };
    }
    if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
      return { error: "Trạng thái khóa học không hợp lệ." };
    }
    if (!Number.isInteger(order) || order < 0) {
      return { error: "Thứ tự phải là số nguyên không âm." };
    }

    const [course, duplicate] = await Promise.all([
      prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }),
      prisma.course.findFirst({ where: { code, id: { not: courseId } }, select: { id: true } }),
    ]);
    if (!course) return { error: "Không tìm thấy khóa học. Hãy tải lại trang." };
    if (duplicate) return { error: "Mã khóa học đã được sử dụng." };

    await prisma.course.update({
      where: { id: courseId },
      data: {
        code,
        title,
        description: String(form.get("description") ?? "").trim() || null,
        hskLevel,
        status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
        order,
        thumbnail: String(form.get("thumbnail") ?? "").trim() || null,
      },
    });

    return { success: true };
  }

  return null;
}

type CourseRow = Awaited<ReturnType<typeof getAllCourses>>[number];
type CourseVersion = "2.0" | "3.0";
type ModalMode = "delete" | null;

const COURSE_VERSIONS: CourseVersion[] = ["2.0", "3.0"];

function getCourseVersion(course: Pick<CourseRow, "code">): CourseVersion | null {
  const suffix = course.code.match(/-(2\.0|3\.0)$/)?.[1];
  return suffix === "2.0" || suffix === "3.0" ? suffix : null;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("vi-VN", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminCourses() {
  const { user, courses } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [versionFilter, setVersionFilter] = useState<CourseVersion>("3.0");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [hskFilter, setHskFilter] = useState("ALL");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [courseToDelete, setCourseToDelete] = useState<CourseRow | null>(null);
  const [courseToEdit, setCourseToEdit] = useState<CourseRow | null>(null);
  const [editStatus, setEditStatus] = useState<CourseRow["status"]>("DRAFT");
  const [editHskLevel, setEditHskLevel] = useState("1");
  const editFetcher = useFetcher<typeof action>();

  const versionCounts = useMemo(() => {
    const counts: Record<CourseVersion, number> = { "2.0": 0, "3.0": 0 };
    for (const course of courses) {
      const version = getCourseVersion(course);
      if (version) counts[version] += 1;
    }
    return counts;
  }, [courses]);

  const isDeleting = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "delete-course";

  const openDelete = (course: CourseRow) => {
    setCourseToDelete(course);
    setModalMode("delete");
  };

  const closeDelete = () => {
    setCourseToDelete(null);
    setModalMode(null);
  };

  const openEdit = (course: CourseRow) => {
    editFetcher.reset();
    setCourseToEdit(course);
    setEditStatus(course.status);
    setEditHskLevel(String(course.hskLevel));
  };

  const closeEdit = () => {
    if (editFetcher.state !== "idle") return;
    setCourseToEdit(null);
    editFetcher.reset();
  };

  useEffect(() => {
    if (editFetcher.state !== "idle" || !editFetcher.data || !("success" in editFetcher.data)) return;
    if (!editFetcher.data.success) return;
    toast.success("Đã cập nhật khóa học.");
    setCourseToEdit(null);
    editFetcher.reset();
  }, [editFetcher.state, editFetcher.data]);

  const filtered = useMemo(() =>
    courses.filter((c) => {
      if (getCourseVersion(c) !== versionFilter) return false;
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (hskFilter !== "ALL" && c.hskLevel !== Number(hskFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      }
      return true;
    }),
    [courses, search, versionFilter, statusFilter, hskFilter]
  );

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Khóa học</h1>
            <p className="text-muted-foreground text-sm mt-1">Quản lý tất cả khóa học HSK.</p>
          </div>
          <Button asChild>
            <Link to="/admin/courses/new"><Plus className="h-4 w-4 mr-1.5" />Tạo khóa học</Link>
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">Phiên bản chương trình</p>
          <div className="inline-flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-1" role="group" aria-label="Chọn phiên bản khóa học">
            {COURSE_VERSIONS.map((version) => {
              const isSelected = versionFilter === version;
              return (
                <Button
                  key={version}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "ghost"}
                  aria-pressed={isSelected}
                  onClick={() => setVersionFilter(version)}
                  className="gap-2"
                >
                  <span>HSK {version}</span>
                  <span className={isSelected ? "rounded-full bg-primary-foreground/15 px-1.5 py-0.5 text-xs" : "rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground"}>
                    {versionCounts[version]}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Tìm theo tên, mã..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
              <SelectItem value="DRAFT">Nháp</SelectItem>
              <SelectItem value="PUBLISHED">Đã xuất bản</SelectItem>
              <SelectItem value="ARCHIVED">Đã lưu trữ</SelectItem>
            </SelectContent>
          </Select>
          <Select value={hskFilter} onValueChange={setHskFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả cấp độ</SelectItem>
              {[1,2,3,4,5,6].map((n) => <SelectItem key={n} value={String(n)}>HSK {n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<BookOpen className="h-10 w-10" />} title="Không tìm thấy khóa học" message="Thử điều chỉnh bộ lọc."
            action={<Button asChild><Link to="/admin/courses/new"><Plus className="h-4 w-4 mr-1.5" />Tạo khóa học</Link></Button>} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead>HSK</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Cập nhật</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className="font-mono text-xs font-medium">{course.code}</TableCell>
                    <TableCell className="font-medium">{course.title}</TableCell>
                    <TableCell>
                      <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">HSK {course.hskLevel}</span>
                    </TableCell>
                    <TableCell><CourseStatusBadge status={course.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(course.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/admin/courses/${course.id}/lessons`}>
                            <ListOrdered className="h-4 w-4 mr-1.5" />Bài học
                          </Link>
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Sửa khóa học" aria-label={`Sửa khóa học ${course.title}`} onClick={() => openEdit(course)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Xóa khóa học"
                          className="hover:text-destructive hover:bg-destructive/10 transition-transform duration-200 hover:scale-110"
                          onClick={() => openDelete(course)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {modalMode === "delete" && courseToDelete && (
        <Overlay onClose={closeDelete} className="max-w-lg">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">Xóa khóa học</h2>
                <p className="text-sm text-muted-foreground mt-1">Hành động này sẽ xóa khóa học và dữ liệu liên quan.</p>
              </div>
              <button type="button" onClick={closeDelete} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive animate-pulse">
              <p>
                Xóa khóa học <strong>{courseToDelete.title}</strong> (<span className="font-mono">{courseToDelete.code}</span>)?
                Tất cả bài học, từ vựng, block, tiến độ và dữ liệu liên quan của khóa học này sẽ bị xóa vĩnh viễn.
              </p>
            </div>

            <Form method="post" onSubmit={(event) => {
              closeDelete();
              toast.success("Đã xóa khóa học thành công");
            }}>
              <input type="hidden" name="intent" value="delete-course" />
              <input type="hidden" name="courseId" value={courseToDelete.id} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDelete} disabled={isDeleting}>Hủy</Button>
                <Button type="submit" variant="destructive" disabled={isDeleting} className="transition-all duration-300">
                  {isDeleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5 animate-bounce" />}
                  {isDeleting ? "Đang xóa..." : "Xóa khóa học"}
                </Button>
              </div>
            </Form>
          </div>
        </Overlay>
      )}

      {courseToEdit && (
        <Overlay onClose={closeEdit} closeOnEscape closeOnBackdrop className="max-w-2xl">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-course-title" className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 id="edit-course-title" className="text-xl font-semibold tracking-tight">Sửa khóa học</h2>
                <p className="text-sm text-muted-foreground">{courseToEdit.code} · HSK {courseToEdit.hskLevel}</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                disabled={editFetcher.state !== "idle"}
                aria-label="Đóng"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editFetcher.data && "error" in editFetcher.data && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {editFetcher.data.error}
              </p>
            )}

            <editFetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="update-course" />
              <input type="hidden" name="courseId" value={courseToEdit.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-course-code">Mã khóa học</Label>
                  <Input id="edit-course-code" name="code" defaultValue={courseToEdit.code} autoFocus required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-title-input">Tên khóa học</Label>
                  <Input id="edit-course-title-input" name="title" defaultValue={courseToEdit.title} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-course-description">Mô tả</Label>
                <Textarea id="edit-course-description" name="description" defaultValue={courseToEdit.description ?? ""} rows={3} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-course-hsk">Cấp độ HSK</Label>
                  <Select value={editHskLevel} onValueChange={setEditHskLevel} name="hskLevel">
                    <SelectTrigger id="edit-course-hsk"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4, 5, 6].map((level) => <SelectItem key={level} value={String(level)}>HSK {level}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-status">Trạng thái</Label>
                  <Select value={editStatus} onValueChange={(value) => setEditStatus(value as CourseRow["status"])} name="status">
                    <SelectTrigger id="edit-course-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Nháp</SelectItem>
                      <SelectItem value="PUBLISHED">Đã xuất bản</SelectItem>
                      <SelectItem value="ARCHIVED">Đã lưu trữ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-order">Thứ tự</Label>
                  <Input id="edit-course-order" name="order" type="number" min={0} defaultValue={courseToEdit.order} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-course-thumbnail">URL ảnh đại diện (tùy chọn)</Label>
                <Input id="edit-course-thumbnail" name="thumbnail" defaultValue={courseToEdit.thumbnail ?? ""} />
              </div>
              <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row">
                <Button type="button" variant="outline" onClick={closeEdit} disabled={editFetcher.state !== "idle"}>Hủy</Button>
                <Button type="submit" disabled={editFetcher.state !== "idle"}>
                  {editFetcher.state !== "idle" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pencil className="mr-1.5 h-4 w-4" />}
                  {editFetcher.state !== "idle" ? "Đang lưu..." : "Lưu thay đổi"}
                </Button>
              </div>
            </editFetcher.Form>
          </div>
        </Overlay>
      )}
    </AppShell>
  );
}
