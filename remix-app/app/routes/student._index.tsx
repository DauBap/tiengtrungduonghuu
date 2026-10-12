import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCoursesWithClass, getStudentDashboardStats } from "~/lib/db.server";
import { formatSchedule, formatNextClass, getNextClassTime } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { ArrowRight, BookOpen, TrendingUp, CheckCircle2, PlayCircle, Clock, Calendar, Trophy, X } from "lucide-react";
import { prisma } from "~/lib/prisma.server";

function formatStudyTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} giây`);
  return parts.join(" ");
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
            class: { select: { id: true, name: true } },
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

  const classLeaderboards = myCourses.flatMap((course) => {
    const enrollmentsByClass = new Map<string, typeof courseEnrollments>();
    for (const enrollment of courseEnrollments) {
      if (enrollment.courseId !== course.id || !enrollment.class) continue;
      const classEnrollments = enrollmentsByClass.get(enrollment.class.id) ?? [];
      classEnrollments.push(enrollment);
      enrollmentsByClass.set(enrollment.class.id, classEnrollments);
    }

    return Array.from(enrollmentsByClass, ([classId, classEnrollments]) => ({
      id: classId,
      className: classEnrollments[0].class!.name,
      title: course.title,
      code: course.code,
      students: classEnrollments
        .map((enrollment) => ({
          userId: enrollment.userId,
          name: enrollment.user.name || "Học viên",
          ...(studyByEnrollment.get(`${course.id}:${enrollment.userId}`) ?? { totalSeconds: 0, visitCount: 0 }),
        }))
        .sort((left, right) =>
          right.totalSeconds - left.totalSeconds
          || right.visitCount - left.visitCount
          || left.name.localeCompare(right.name, "vi")
        ),
    }));
  });

  return { user, myCourses, enrollments, overallProgress, totalCompleted, currentLesson, courseProgress, classLeaderboards };
}

export default function StudentIndex() {
  const { user, myCourses, enrollments, overallProgress, totalCompleted, currentLesson, courseProgress, classLeaderboards } =
    useLoaderData<typeof loader>();
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [selectedLeaderboardClassId, setSelectedLeaderboardClassId] = useState<string | null>(null);
  const selectedLeaderboard = classLeaderboards.find((item) => item.id === selectedLeaderboardClassId)
    ?? classLeaderboards[0];
  const nextScheduledEnrollment = enrollments
    .flatMap((enrollment) => {
      if (!enrollment.class) return [];
      const nextClassTime = getNextClassTime(enrollment.class.schedule);
      return nextClassTime ? [{ enrollment, nextClassTime }] : [];
    })
    .sort((a, b) => a.nextClassTime.getTime() - b.nextClassTime.getTime())[0];

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
            <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-4">
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
        {nextScheduledEnrollment && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Lịch học</h3>
              </div>
              <div className="divide-y">
                {[nextScheduledEnrollment.enrollment].map((enrollment) => (
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

        {classLeaderboards.length > 0 && (
          <>
            <Button
              type="button"
              size="icon"
              className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg"
              aria-label="Mở bảng vàng"
              title="Bảng vàng"
              onClick={() => setIsLeaderboardOpen(true)}
            >
              <Trophy className="h-5 w-5" />
            </Button>

            {isLeaderboardOpen && (
              <div
                className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-3 sm:p-6"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsLeaderboardOpen(false);
                }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="student-leaderboard-title"
                  className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
                >
                  <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-amber-500" />
                      <h2 id="student-leaderboard-title" className="font-semibold">Bảng vàng</h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Đóng bảng vàng"
                      onClick={() => setIsLeaderboardOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </header>
                  <div className="space-y-3 overflow-y-auto p-3 sm:p-4">
                    <div role="tablist" aria-label="Chọn lớp trong bảng vàng" className="flex gap-2 overflow-x-auto border-b pb-2">
                      {classLeaderboards.map((classLeaderboard) => (
                        <button
                          key={classLeaderboard.id}
                          type="button"
                          role="tab"
                          id={`leaderboard-tab-${classLeaderboard.id}`}
                          aria-selected={selectedLeaderboard?.id === classLeaderboard.id}
                          aria-controls="leaderboard-panel"
                          onClick={() => setSelectedLeaderboardClassId(classLeaderboard.id)}
                          className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                            selectedLeaderboard?.id === classLeaderboard.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          }`}
                        >
                          {classLeaderboard.className}
                        </button>
                      ))}
                    </div>
                    {selectedLeaderboard && (
                      <Card
                        role="tabpanel"
                        id="leaderboard-panel"
                        aria-labelledby={`leaderboard-tab-${selectedLeaderboard.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold">{selectedLeaderboard.className}</h3>
                              <p className="text-xs text-muted-foreground">{selectedLeaderboard.title} · {selectedLeaderboard.code}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              {selectedLeaderboard.students.length} học viên
                            </span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[480px] text-xs">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th scope="col" className="px-2 py-2 font-medium">#</th>
                                  <th scope="col" className="px-2 py-2 font-medium">Học viên</th>
                                  <th scope="col" className="w-[40%] px-2 py-2 font-medium">Thời gian học</th>
                                  <th scope="col" className="px-2 py-2 text-right font-medium">Lượt vào</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedLeaderboard.students.map((student, index) => {
                                  const maxStudySeconds = selectedLeaderboard.students[0]?.totalSeconds ?? 0;
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
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
