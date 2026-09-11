import { useState, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, useNavigation, redirect } from "react-router";
import { toast } from "sonner";
import { requireRole } from "~/lib/session.server";
import { getAllCourses } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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

    await prisma.course.delete({ where: { id: courseId } });
    return redirect("/admin/courses");
  }

  return null;
}

type CourseRow = Awaited<ReturnType<typeof getAllCourses>>[number];
type ModalMode = "delete" | null;

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("vi-VN", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminCourses() {
  const { user, courses } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [hskFilter, setHskFilter] = useState("ALL");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [courseToDelete, setCourseToDelete] = useState<CourseRow | null>(null);

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

  const filtered = useMemo(() =>
    courses.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (hskFilter !== "ALL" && c.hskLevel !== Number(hskFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      }
      return true;
    }),
    [courses, search, statusFilter, hskFilter]
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
                        <Button asChild variant="ghost" size="icon" title="Sửa khóa học">
                          <Link to={`/admin/courses/${course.id}/edit`}><Pencil className="h-4 w-4" /></Link>
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
    </AppShell>
  );
}
