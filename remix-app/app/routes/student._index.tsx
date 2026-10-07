import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCoursesWithClass, getStudentDashboardStats } from "~/lib/db.server";
import { formatSchedule, formatNextClass } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { ArrowRight, BookOpen, TrendingUp, CheckCircle2, PlayCircle, Clock, Calendar, Trophy } from "lucide-react";
import { prisma } from "~/lib/prisma.server";

function formatStudyTime(totalSeconds: number) {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} phút`;
  return `${hours} giờ ${minutes} phút`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const enrollments = await getEnrolledCoursesWithClass(user.id);
  const myCourses = enrollments.map((e) => e.course);

  const { totalCompleted, currentLesson, courseProgress, overallProgress } =
    await getStudentDashboardStats(user.id, myCourses.map((c) => c.id));

  const courseIds = myCourses.map((course) => course.id);
  const [courseEnrollments, studySessions] = courseIds.length > 0
    ? await Promise.all([
        prisma.enrollment.findMany({
          where: {
            courseId: { in: courseIds },
            user: { role: "student", isActive: true, deletedAt: null },
          },
          select: {
            userId: true,
            courseId: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
          },
        }),
        prisma.courseStudySession.groupBy({
          by: ["courseId", "userId"],
          where: { courseId: { in: courseIds } },
          _sum: { totalSeconds: true },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const studyByEnrollment = new Map<string, { totalSeconds: number; visitCount: number }>();
  for (const session of studySessions) {
    studyByEnrollment.set(`${session.courseId}:${session.userId}`, {
      totalSeconds: session._sum.totalSeconds ?? 0,
      visitCount: session._count._all,
    });
  }

  const courseLeaderboards = myCourses.map((course) => ({
    id: course.id,
    title: course.title,
    code: course.code,
    students: courseEnrollments
      .filter((enrollment) => enrollment.courseId === course.id)
      .map((enrollment) => ({
        userId: enrollment.userId,
        name: enrollment.user.name || "Học viên",
        className: enrollment.class?.name ?? "Chưa có lớp",
        ...(studyByEnrollment.get(`${course.id}:${enrollment.userId}`) ?? { totalSeconds: 0, visitCount: 0 }),
      }))
      .sort((left, right) =>
        right.totalSeconds - left.totalSeconds
        || right.visitCount - left.visitCount
        || left.name.localeCompare(right.name, "vi")
      ),
  }));

  return { user, myCourses, enrollments, overallProgress, totalCompleted, currentLesson, courseProgress, courseLeaderboards };
}

export default function StudentIndex() {
  const { user, myCourses, enrollments, overallProgress, totalCompleted, currentLesson, courseProgress, courseLeaderboards } =
    useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển học viên</h1>
          <p className="text-muted-foreground text-sm mt-1">Tiếp tục hành trình học tiếng Trung của bạn.</p>
        </div>
        <div className="grid grid-cols-2 divide-x rounded-lg border bg-card sm:grid-cols-4">
          {[
            { label: "Khóa học", value: myCourses.length, icon: BookOpen, tone: "text-primary bg-primary/10" },
            { label: "Tiến độ", value: `${overallProgress}%`, icon: TrendingUp, tone: "text-success bg-success/10" },
            { label: "Bài hoàn thành", value: totalCompleted, icon: CheckCircle2, tone: "text-accent bg-accent/10" },
            { label: "Bài hiện tại", value: currentLesson ? `Bài ${currentLesson.order}` : "Hoàn thành", icon: PlayCircle, tone: "text-warning bg-warning/10" },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="flex min-w-0 items-center gap-2.5 px-3 py-3 sm:px-4">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">{label}</p>
                <p className="truncate text-lg font-semibold leading-tight">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {currentLesson && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[11px] font-semibold text-primary">TIẾP TỤC HỌC</p>
                <h3 className="mt-0.5 font-semibold">{currentLesson.title}</h3>
                <p className="text-xs text-muted-foreground font-mono">{currentLesson.subtitle}</p>
              </div>
              <Button asChild size="sm">
                <Link to={`/student/courses/${currentLesson.courseId}/lessons/${currentLesson.id}`}>Tiếp tục</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Class Schedule Info */}
        {enrollments.length > 0 && enrollments.some(e => e.class) && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Lịch học</h3>
              </div>
              <div className="divide-y">
                {enrollments.filter(e => e.class).map((enrollment) => (
                  <div key={enrollment.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate text-sm font-medium">{enrollment.class?.name}</span>
                      <span className="text-xs text-muted-foreground">{enrollment.course.code}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatSchedule(enrollment.class?.schedule)} <span className="mx-1">·</span>
                      {formatNextClass(enrollment.class?.schedule)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {courseLeaderboards.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-semibold">Bảng vàng</h2>
            </div>
            {courseLeaderboards.map((course) => {
              const maxStudySeconds = course.students[0]?.totalSeconds ?? 0;
              return (
                <Card key={course.id}>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{course.title}</h3>
                        <p className="text-xs text-muted-foreground">{course.code} · Gộp tất cả lớp</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        {course.students.length} học viên
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px] text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th scope="col" className="px-2 py-2 font-medium">#</th>
                            <th scope="col" className="px-2 py-2 font-medium">Học viên</th>
                            <th scope="col" className="px-2 py-2 font-medium">Lớp</th>
                            <th scope="col" className="w-[35%] px-2 py-2 font-medium">Thời gian học</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">Lượt vào</th>
                          </tr>
                        </thead>
                        <tbody>
                          {course.students.map((student, index) => {
                            const studyPercent = maxStudySeconds > 0
                              ? Math.round((student.totalSeconds / maxStudySeconds) * 100)
                              : 0;
                            const rankTone = index === 0
                              ? "bg-amber-100 text-amber-800"
                              : index === 1
                                ? "bg-slate-100 text-slate-700"
                                : index === 2
                                  ? "bg-orange-100 text-orange-800"
                                  : "text-muted-foreground";
                            return (
                              <tr key={student.userId} className="border-b last:border-0">
                                <td className="px-2 py-2">
                                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${rankTone}`}>
                                    {index + 1}
                                  </span>
                                </td>
                                <td className="px-2 py-2 font-medium">{student.name}</td>
                                <td className="px-2 py-2 text-muted-foreground">{student.className}</td>
                                <td className="px-2 py-2">
                                  <span className="whitespace-nowrap tabular-nums">{formatStudyTime(student.totalSeconds)}</span>
                                  <div
                                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                                    role="progressbar"
                                    aria-label={`Thời gian học của ${student.name} so với người học nhiều nhất`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={studyPercent}
                                  >
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${studyPercent}%` }} />
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums">{student.visitCount}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-base font-semibold">Khóa học</h2>
            <Link to="/student/courses" className="text-xs text-primary hover:underline">Xem tất cả</Link>
          </div>
          <div className="space-y-2">
            {myCourses.map((course) => (
              <Link
                key={course.id}
                to={`/student/courses/${course.id}`}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.02]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <BookOpen className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate text-sm font-medium">{course.title}</span>
                    <span className="text-[11px] text-muted-foreground">{course.code}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${courseProgress[course.id] ?? 0}%` }} />
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{courseProgress[course.id] ?? 0}%</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
