import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getAllCourses } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { BookOpen, CheckCircle2, FileEdit, Archive } from "lucide-react";
import { Button } from "~/components/ui/button";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const courses = await getAllCourses();
  return { user, courses };
}

export default function AdminIndex() {
  const { user, courses } = useLoaderData<typeof loader>();
  const total = courses.length;
  const published = courses.filter((c) => c.status === "PUBLISHED").length;
  const draft = courses.filter((c) => c.status === "DRAFT").length;
  const archived = courses.filter((c) => c.status === "ARCHIVED").length;
  const recent = [...courses]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển</h1>
          <p className="text-muted-foreground text-sm mt-1">Tổng quan nền tảng học tiếng Trung.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Tổng khóa học" value={total} icon={BookOpen} accent="primary" />
          <StatCard label="Đã xuất bản" value={published} icon={CheckCircle2} accent="success" />
          <StatCard label="Bản nháp" value={draft} icon={FileEdit} accent="warning" />
          <StatCard label="Đã lưu trữ" value={archived} icon={Archive} accent="accent" />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Khóa học cập nhật gần đây</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link to="/admin/courses">Xem tất cả</Link></Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recent.map((course) => (
                <div key={course.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{course.title}</p>
                      <p className="text-xs text-muted-foreground">HSK {course.hskLevel} - {course.code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <CourseStatusBadge status={course.status} />
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/courses/${course.id}/edit`}>Sửa</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
