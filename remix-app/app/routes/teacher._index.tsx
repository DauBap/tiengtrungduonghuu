import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getTeacherCourses, getLessonsByCourse } from "~/lib/db.server";
import { formatSchedule, formatNextClass } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { CourseCard } from "~/components/courses/course-card";
import { Card, CardContent } from "~/components/ui/card";
import { BookOpen, Users, Layers, Calendar, Clock, TrendingUp } from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const myCourses = await getTeacherCourses(user.id);
  const myClasses = await prisma.class.findMany({
    where: { teacherId: user.id },
    include: {
      course: { select: { id: true, title: true, code: true, hskLevel: true, description: true, order: true } },
      enrollments: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });

  let totalLessons = 0;
  let totalStudents = 0;

  for (const c of myCourses) {
    const lessons = await getLessonsByCourse(c.id);
    totalLessons += lessons.length;
  }

  for (const cls of myClasses) {
    totalStudents += cls.enrollments.length;
  }

  const classSummaries = await Promise.all(
    myClasses.map(async (cls) => {
      const courseLessons = await getLessonsByCourse(cls.courseId);
      const lessonIds = courseLessons.map((lesson) => lesson.id);
      if (lessonIds.length === 0 || cls.enrollments.length === 0) {
        return {
          ...cls,
          overallPercent: 0,
          studentSummary: cls.enrollments.map((enrollment) => ({
            student: enrollment.user,
            completedTabs: 0,
            totalTabs: 0,
            completionPercent: 0,
          })),
        };
      }

      const progressRows = await prisma.lessonTabProgress.findMany({
        where: {
          lessonId: { in: lessonIds },
          userId: { in: cls.enrollments.map((enrollment) => enrollment.userId) },
        },
        include: {
          attempts: {
            where: { tab: "VOCABULARY_TEST" },
            orderBy: { completedAt: "desc" },
            take: 1,
          },
        },
      });

      const perStudent = new Map<string, Set<string>>();
      for (const row of progressRows) {
        const completed = row.tab === "VOCABULARY_TEST"
          ? row.attempts[0]?.passed === true
          : row.completed;
        if (!completed) continue;
        const current = perStudent.get(row.userId) ?? new Set<string>();
        current.add(`${row.lessonId}:${row.tab}`);
        perStudent.set(row.userId, current);
      }

      const totalTabs = lessonIds.length * LESSON_TAB_KEYS.length;
      const studentSummary = cls.enrollments.map((enrollment) => {
        const completedTabs = perStudent.get(enrollment.userId)?.size ?? 0;
        const completionPercent = Math.round((completedTabs / totalTabs) * 100);
        return {
          student: enrollment.user,
          completedTabs,
          totalTabs,
          completionPercent,
        };
      });

      const completedTabsTotal = studentSummary.reduce((sum, item) => sum + item.completedTabs, 0);
      const overallPercent = Math.round((completedTabsTotal / (studentSummary.length * totalTabs)) * 100);

      return {
        ...cls,
        overallPercent,
        studentSummary,
      };
    })
  );

  return { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents };
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents } = useLoaderData<typeof loader>();
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
                        <span className="text-xs text-muted-foreground">{cls.enrollments.length} học viên</span>
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

        {classSummaries.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Tổng quan theo lớp</h3>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {classSummaries.map((cls) => (
                  <div key={cls.id} className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{cls.name}</p>
                        <p className="text-xs text-muted-foreground">{cls.course.title}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                        {cls.overallPercent}%
                      </span>
                    </div>

                    <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${cls.overallPercent}%` }} />
                    </div>

                    <div className="space-y-2">
                      {cls.studentSummary.slice(0, 3).map((item) => (
                        <div key={item.student.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">{item.student.name ?? "Học viên"}</span>
                          <span className="text-muted-foreground">{item.completionPercent}%</span>
                        </div>
                      ))}
                      {cls.studentSummary.length > 3 && (
                        <p className="text-[10px] text-muted-foreground">
                          +{cls.studentSummary.length - 3} học viên khác
                        </p>
                      )}
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
