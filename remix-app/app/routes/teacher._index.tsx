import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getTeacherCourses, getLessonsByCourse } from "~/lib/db.server";
import { formatSchedule, formatNextClass } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { Card, CardContent } from "~/components/ui/card";
import { BookOpen, Users, Layers, Calendar, Clock, TrendingUp, ClipboardList, X } from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
          pendingGrammarAttempts: [],
          studentSummary: cls.enrollments.map((enrollment) => ({
            student: enrollment.user,
            completedTabs: 0,
            totalTabs: 0,
            completionPercent: 0,
          })),
        };
      }

      const [progressRows, grammarAttempts] = await Promise.all([
        prisma.lessonTabProgress.findMany({
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
        }),
        prisma.lessonTabAttempt.findMany({
          where: {
            lessonId: { in: lessonIds },
            userId: { in: cls.enrollments.map((enrollment) => enrollment.userId) },
            tab: "GRAMMAR",
            mode: "FILL",
          },
          select: {
            id: true,
            userId: true,
            lessonId: true,
            completedAt: true,
            details: true,
          },
          orderBy: { completedAt: "desc" },
        }),
      ]);

      const enrollmentsByUserId = new Map(cls.enrollments.map((enrollment) => [enrollment.userId, enrollment]));
      const lessonsById = new Map(courseLessons.map((lesson) => [lesson.id, lesson]));
      const pendingGrammarAttempts = grammarAttempts.flatMap((attempt) => {
        const details = isRecord(attempt.details) ? attempt.details : {};
        if (
          details.questionType !== "FILL"
          || details.reviewPending !== true
          || isRecord(details.teacherGrading)
        ) {
          return [];
        }

        const enrollment = enrollmentsByUserId.get(attempt.userId);
        const lesson = lessonsById.get(attempt.lessonId);
        if (!enrollment || !lesson) return [];

        return [{
          id: attempt.id,
          lessonId: attempt.lessonId,
          userId: attempt.userId,
          studentName: enrollment.user.name ?? enrollment.user.email,
          lessonTitle: lesson.title,
          sectionTitle: typeof details.sectionTitle === "string" ? details.sectionTitle : "Dịch câu",
          completedAt: attempt.completedAt.toISOString(),
        }];
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
        pendingGrammarAttempts,
        studentSummary,
      };
    })
  );

  return { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents };
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents } = useLoaderData<typeof loader>();
  const [openGradingClassId, setOpenGradingClassId] = useState<string | null>(null);

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

                    {cls.pendingGrammarAttempts.length > 0 && (
                      <div className="mb-3">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-expanded={openGradingClassId === cls.id}
                          onClick={() => setOpenGradingClassId(cls.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          Có bài cần chấm ({cls.pendingGrammarAttempts.length})
                        </button>
                        {openGradingClassId === cls.id && (
                          <div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
                            role="presentation"
                            onMouseDown={(event) => {
                              if (event.target === event.currentTarget) setOpenGradingClassId(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setOpenGradingClassId(null);
                            }}
                          >
                            <section
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby={`grading-list-title-${cls.id}`}
                              className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-xl"
                            >
                              <div className="mb-4 flex items-start justify-between gap-3">
                                <div>
                                  <h2 id={`grading-list-title-${cls.id}`} className="text-lg font-semibold">
                                    Bài tập cần chấm
                                  </h2>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {cls.name} · {cls.pendingGrammarAttempts.length} bài chưa chấm
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  aria-label="Đóng danh sách bài cần chấm"
                                  onClick={() => setOpenGradingClassId(null)}
                                  className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <ul className="space-y-2">
                                {cls.pendingGrammarAttempts.map((attempt) => (
                                  <li key={attempt.id}>
                                    <Link
                                      to={`/teacher/courses/${cls.courseId}/lessons/${attempt.lessonId}/students/${attempt.userId}/grammar-history/attempts/${attempt.id}`}
                                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2.5 text-sm hover:bg-amber-100"
                                    >
                                      <span className="min-w-0 font-medium">
                                        {attempt.studentName} · {attempt.lessonTitle} · {attempt.sectionTitle}
                                      </span>
                                      <time className="shrink-0 text-xs text-muted-foreground">
                                        {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(attempt.completedAt))}
                                      </time>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${cls.overallPercent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </AppShell>
  );
}
