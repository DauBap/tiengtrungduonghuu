import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getTeacherCourses, getTeacherClasses, getLessonsByCourse } from "~/lib/db.server";
import { formatSchedule, formatNextClass } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { CourseCard } from "~/components/courses/course-card";
import { Card, CardContent } from "~/components/ui/card";
import { BookOpen, Users, Layers, Calendar, Clock } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const myCourses = await getTeacherCourses(user.id);
  const myClasses = await getTeacherClasses(user.id);

  let totalLessons = 0;
  let totalStudents = 0;

  for (const c of myCourses) {
    const lessons = await getLessonsByCourse(c.id);
    totalLessons += lessons.length;
  }

  for (const cls of myClasses) {
    totalStudents += cls._count.enrollments;
  }

  return { user, myCourses, myClasses, totalLessons, totalStudents };
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, totalLessons, totalStudents } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển giáo viên</h1>
          <p className="text-muted-foreground text-sm mt-1">Chào mừng trở lại! Đây là tổng quan hoạt động giảng dạy của bạn.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Khóa học của tôi" value={myCourses.length} icon={BookOpen} accent="primary" />
          <StatCard label="Tổng học viên" value={totalStudents} icon={Users} accent="success" />
          <StatCard label="Tổng bài học" value={totalLessons} icon={Layers} accent="accent" />
        </div>

        {/* Class Schedule Info */}
        {myClasses.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Lịch giảng dạy</h3>
              </div>
              <div className="space-y-3">
                {myClasses.map((cls) => (
                  <div key={cls.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-medium text-sm">{cls.name}</p>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs font-mono text-primary">HSK{cls.course.hskLevel}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{cls._count.enrollments} học viên</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatSchedule(cls.schedule)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Buổi học tiếp theo: {formatNextClass(cls.schedule)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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
