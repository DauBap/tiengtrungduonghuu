import { useState, useMemo } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, useNavigation } from "react-router";
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
import { Search, Plus, Pencil, BookOpen, ListOrdered } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const courses = await getAllCourses();
  return { user, courses };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  return null;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("vi-VN", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminCourses() {
  const { user, courses } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [hskFilter, setHskFilter] = useState("ALL");

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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
