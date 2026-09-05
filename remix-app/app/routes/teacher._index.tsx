import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses, getLessonsByCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { CourseCard } from "~/components/courses/course-card";
import { BookOpen, Users, Layers } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const myCourses = await getEnrolledCourses(user.id);
  let totalLessons = 0;
  for (const c of myCourses) {
    const lessons = await getLessonsByCourse(c.id);
    totalLessons += lessons.length;
  }
  return { user, myCourses, totalLessons };
}

export default function TeacherIndex() {
  const { user, myCourses, totalLessons } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển giáo viên</h1>
          <p className="text-muted-foreground text-sm mt-1">Chào mừng trở lại! Đây là tổng quan hoạt động giảng dạy của bạn.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Khóa học của tôi" value={myCourses.length} icon={BookOpen} accent="primary" />
          <StatCard label="Tổng học viên" value={0} icon={Users} accent="success" />
          <StatCard label="Tổng bài học" value={totalLessons} icon={Layers} accent="accent" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Khóa học của tôi</h2>
            <Link to="/teacher/courses" className="text-sm text-primary hover:underline">Xem tất cả</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.map((c) => (
              <CourseCard key={c.id} course={{ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }}
                href={`/teacher/courses/${c.id}`} ctaLabel="Xem khóa học" />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
