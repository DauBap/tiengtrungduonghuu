import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getTeacherCourses } from "~/lib/db.server";
import { formatSchedule, formatNextClass, getNextClassTime } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { Card, CardContent } from "~/components/ui/card";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  MessageCircle,
  TrendingUp,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import { GRAMMAR_QUESTION_META, type GrammarQuestionType, type TeacherGrammarGrade } from "~/lib/grammar";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

const DASHBOARD_ACTIVITIES = [
  { tab: "FLASHCARD", label: "Flashcard" },
  { tab: "LESSON", label: "Bài khóa" },
  { tab: "PHONETICS", label: "Ngữ âm" },
  { tab: "VOCABULARY_TEST", label: "Ôn từ vựng" },
  { tab: "LISTENING", label: "Nghe câu" },
  { tab: "GRAMMAR", label: "Ngữ pháp" },
  { tab: "WORKBOOK", label: "Sách bài tập" },
] as const;

type DashboardActivityTab = (typeof DASHBOARD_ACTIVITIES)[number]["tab"];

interface GrammarAttemptData {
  course: { id: string; title: string };
  lesson: { id: string; title: string };
  student: { id: string; name: string | null; email: string };
  attempt: {
    id: string;
    sectionTitle: string;
    questionType: GrammarQuestionType | null;
    results: {
      id: string;
      prompt: string;
      type: GrammarQuestionType;
      given: string;
      givenTokens: string[] | null;
      correctAnswer: string;
      correct: boolean;
      autoCorrect: boolean;
      teacherFeedback: string;
      points: number;
      hint: string | null;
    }[];
  };
}

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
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });

  const courseIds = [...new Set(myClasses.map((cls) => cls.courseId))];
  const [lessonCounts, lessonsByCourse] = await Promise.all([
    Promise.all(courseIds.map(async (courseId) => [courseId, await prisma.lesson.count({ where: { courseId } })] as const)),
    Promise.all(courseIds.map(async (courseId) => {
      const lessons = await prisma.lesson.findMany({
        where: { courseId },
        select: {
          id: true,
          order: true,
          title: true,
          _count: { select: { content: true, grammarSections: true, phoneticsSections: true, audioScripts: true } },
          learningBlocks: { select: { type: true, required: true } },
        },
        orderBy: { order: "asc" },
      });
      return [courseId, lessons] as const;
    })),
  ]);
  const lessonCountByCourse = new Map(lessonCounts);
  const lessonMapByCourse = new Map(lessonsByCourse);
  const totalLessons = myCourses.reduce((sum, course) => sum + (lessonCountByCourse.get(course.id) ?? 0), 0);
  const totalStudents = myClasses.reduce((sum, cls) => sum + cls.enrollments.length, 0);

  const classSummaries = await Promise.all(myClasses.map(async (cls) => {
    const courseLessons = lessonMapByCourse.get(cls.courseId) ?? [];
    const lessonIds = courseLessons.map((lesson) => lesson.id);
    const userIds = cls.enrollments.map((enrollment) => enrollment.userId);
    const [progressRows, grammarAttempts] = lessonIds.length > 0 && userIds.length > 0
      ? await Promise.all([
          prisma.lessonTabProgress.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
            },
            select: {
              userId: true,
              lessonId: true,
              tab: true,
              state: true,
              completed: true,
              opened: true,
              percent: true,
              currentScore: true,
              bestScore: true,
              lastAttemptAt: true,
              updatedAt: true,
              attempts: {
                where: { tab: { in: DASHBOARD_ACTIVITIES.map((activity) => activity.tab) } },
                orderBy: { completedAt: "desc" },
                take: 1,
                select: { score: true, passed: true, completedAt: true, correctCount: true, totalCount: true },
              },
            },
          }),
          prisma.lessonTabAttempt.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
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
        ])
      : [[], []];

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

    const progressByKey = new Map(progressRows.map((row) => [`${row.userId}:${row.lessonId}:${row.tab}`, row]));
    const pendingGrammarKeys = new Set(pendingGrammarAttempts.map((attempt) => `${attempt.userId}:${attempt.lessonId}`));
    const lessons = courseLessons.map((lesson) => ({
      id: lesson.id,
      order: lesson.order,
      title: lesson.title,
      availableActivities: {
        FLASHCARD: lesson.learningBlocks.some((block) => block.type === "FLASHCARD" && block.required),
        LESSON: lesson._count.audioScripts > 0,
        PHONETICS: lesson._count.phoneticsSections > 0,
        VOCABULARY_TEST: lesson._count.content > 0,
        LISTENING: lesson.learningBlocks.some((block) => block.type === "LISTENING" && block.required),
        GRAMMAR: lesson._count.grammarSections > 0,
        WORKBOOK: lesson.learningBlocks.some((block) => block.type === "WORKBOOK" && block.required),
      },
    }));
    const activityData = cls.enrollments.map((enrollment) => {
      const lastActivityAt = progressRows
        .filter((row) => row.userId === enrollment.userId)
        .reduce<Date | null>((latest, row) => {
          const activityAt = row.lastAttemptAt ?? row.attempts[0]?.completedAt ?? row.updatedAt;
          return !latest || activityAt > latest ? activityAt : latest;
        }, null);
      const studentLessons = lessons.map((lesson) => ({
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        activities: DASHBOARD_ACTIVITIES.map(({ tab }) => {
          const progress = progressByKey.get(`${enrollment.userId}:${lesson.id}:${tab}`);
          const attempt = progress?.attempts[0];
          const available = lesson.availableActivities[tab];
          const completed = tab === "VOCABULARY_TEST"
            ? attempt?.passed === true
            : progress?.completed === true;
          const hasStarted = Boolean(
            attempt
            || progress?.opened
            || progress?.state === "IN_PROGRESS"
            || (progress?.percent ?? 0) > 0,
          );
          const status = !available
            ? "unavailable"
            : tab === "GRAMMAR" && pendingGrammarKeys.has(`${enrollment.userId}:${lesson.id}`)
              ? "waiting"
              : completed
                ? "completed"
                : hasStarted
                  ? "partial"
                  : "missing";
          return {
            tab,
            status,
            score: Math.round(attempt?.score ?? progress?.currentScore ?? progress?.bestScore ?? progress?.percent ?? 0),
            percent: Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
            correctCount: attempt?.correctCount,
            totalCount: attempt?.totalCount,
          };
        }),
      }));

      return {
        student: {
          ...enrollment.user,
          zaloUrl: enrollment.user.phone ? `https://zalo.me/${enrollment.user.phone.replace(/\D/g, "")}` : null,
        },
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        lessons: studentLessons,
      };
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
      const completionPercent = totalTabs > 0 ? Math.round((completedTabs / totalTabs) * 100) : 0;
      return {
        student: enrollment.user,
        completedTabs,
        totalTabs,
        completionPercent,
      };
    });
    const completedTabsTotal = studentSummary.reduce((sum, item) => sum + item.completedTabs, 0);
    const overallPercent = studentSummary.length > 0 && totalTabs > 0
      ? Math.round((completedTabsTotal / (studentSummary.length * totalTabs)) * 100)
      : 0;
    const latestProgress = progressRows
      .filter((row) => row.lastAttemptAt || row.updatedAt)
      .sort((a, b) => (b.lastAttemptAt ?? b.updatedAt).getTime() - (a.lastAttemptAt ?? a.updatedAt).getTime())[0];

    return {
      ...cls,
      lessons,
      suggestedLessonId: latestProgress?.lessonId ?? lessons[0]?.id ?? null,
      overallPercent,
      pendingGrammarAttempts,
      studentSummary,
      activityData,
    };
  }));

  return { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents };
}

function getLessonProgress(activities: { status: string; percent: number }[]) {
  const available = activities.filter((activity) => activity.status !== "unavailable");
  if (available.length === 0) return { percent: 0, completed: 0, total: 0 };
  const completed = available.filter((activity) => activity.status === "completed" || activity.status === "waiting").length;
  const percent = Math.round(available.reduce((sum, activity) => {
    if (activity.status === "completed" || activity.status === "waiting") return sum + 100;
    return sum + (activity.status === "partial" ? activity.percent : 0);
  }, 0) / available.length);
  return { percent, completed, total: available.length };
}

function activityTone(status: string, isPastLesson: boolean) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (status === "waiting") return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300";
  if (status === "partial") return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  if (status === "unavailable") return "bg-muted/40 text-muted-foreground";
  if (isPastLesson) return "border border-dashed border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
  return "bg-muted text-muted-foreground";
}

function lessonProgressTone(percent: number) {
  if (percent === 0) return "bg-muted text-muted-foreground";
  if (percent <= 80) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents } = useLoaderData<typeof loader>();
  const location = useLocation();
  const gradingFetcher = useFetcher<GrammarAttemptData & { success?: boolean }>();
  const gradeSubmitFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [selectedClassId, setSelectedClassId] = useState(classSummaries[0]?.id ?? "");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [progressView, setProgressView] = useState<"overview" | "lesson">("overview");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [gradingAttemptId, setGradingAttemptId] = useState<string | null>(null);
  const [grades, setGrades] = useState<TeacherGrammarGrade[]>([]);
  const [initializedGradeAttemptId, setInitializedGradeAttemptId] = useState<string | null>(null);
  const selectedClass = classSummaries.find((cls) => cls.id === selectedClassId) ?? classSummaries[0];
  const selectedLesson = selectedClass?.lessons.find((lesson) => lesson.id === selectedLessonId)
    ?? selectedClass?.lessons.find((lesson) => lesson.id === selectedClass.suggestedLessonId)
    ?? selectedClass?.lessons[0];
  const sortedActivityData = selectedClass
    ? selectedClass.activityData
        .map((student) => {
          const lessons = progressView === "lesson"
            ? student.lessons.filter((lesson) => lesson.id === selectedLesson?.id)
            : student.lessons;
          const completedCount = lessons.reduce(
            (sum, lesson) => sum + getLessonProgress(lesson.activities).completed,
            0,
          );
          return { student, completedCount };
        })
        .sort((a, b) => (
          b.completedCount - a.completedCount
          || (a.student.student.name ?? a.student.student.email)
            .localeCompare(b.student.student.name ?? b.student.student.email, "vi")
        ))
        .map(({ student }) => student)
    : [];
  const selectedLessonActivities = selectedLesson
    ? DASHBOARD_ACTIVITIES.filter(({ tab }) => selectedLesson.availableActivities[tab])
    : [];
  const selectedStudent = selectedClass?.activityData.find((item) => item.student.id === selectedStudentId);
  const upcomingClasses = myClasses
    .flatMap((cls) => {
      const nextClassTime = getNextClassTime(cls.schedule);
      return nextClassTime ? [{ cls, nextClassTime }] : [];
    })
    .sort((a, b) => a.nextClassTime.getTime() - b.nextClassTime.getTime())
    .slice(0, 1);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.key]);

  useEffect(() => {
    if (!selectedStudentId && !gradingAttemptId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedStudentId(null);
        setGradingAttemptId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedStudentId, gradingAttemptId]);

  const gradingData = gradingFetcher.data?.attempt ? gradingFetcher.data : null;
  useEffect(() => {
    if (!gradingData || gradingData.attempt.id !== gradingAttemptId || initializedGradeAttemptId === gradingAttemptId) return;
    setGrades(gradingData.attempt.results.map((result) => ({
      questionId: result.id,
      correct: result.autoCorrect,
      teacherFeedback: result.teacherFeedback,
    })));
    setInitializedGradeAttemptId(gradingAttemptId);
  }, [gradingData, gradingAttemptId, initializedGradeAttemptId]);

  useEffect(() => {
    if (gradeSubmitFetcher.state !== "idle" || !gradeSubmitFetcher.data?.success) return;
    setGradingAttemptId(null);
    setInitializedGradeAttemptId(null);
    revalidator.revalidate();
  }, [gradeSubmitFetcher.state, gradeSubmitFetcher.data, revalidator]);

  const reminderRows = selectedClass && selectedLesson
    ? selectedClass.activityData.flatMap((student) => {
        const missing = student.lessons
          .filter((lesson) => lesson.order <= selectedLesson.order)
          .flatMap((lesson) => lesson.activities
            .filter((activity) => activity.status === "missing" || activity.status === "partial")
            .map((activity) => ({
              lessonTitle: lesson.title,
              lessonOrder: lesson.order,
              activity: DASHBOARD_ACTIVITIES.find((item) => item.tab === activity.tab)?.label ?? activity.tab,
              percent: activity.percent,
              isPast: lesson.order < selectedLesson.order,
            })));
        return missing.length ? [{ student, missing }] : [];
      })
    : [];
  const updateGrade = (questionId: string, patch: Partial<TeacherGrammarGrade>) => {
    setGrades((current) => current.map((grade) => grade.questionId === questionId ? { ...grade, ...patch } : grade));
  };
  const openGradingAttempt = (courseId: string, lessonId: string, studentId: string, attemptId: string) => {
    setGradingAttemptId(attemptId);
    setInitializedGradeAttemptId(null);
    setGrades([]);
    gradingFetcher.load(`/teacher/courses/${courseId}/lessons/${lessonId}/students/${studentId}/grammar-history/attempts/${attemptId}`);
  };

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển giáo viên</h1>
          <p className="mt-1 text-sm text-muted-foreground">Theo dõi tiến độ lớp học và những việc cần xử lý.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Khóa học của tôi" value={myCourses.length} icon={BookOpen} accent="primary" />
          <StatCard label="Lớp đang phụ trách" value={myClasses.length} icon={Layers} accent="accent" />
          <StatCard label="Tổng học viên" value={totalStudents} icon={Users} accent="success" />
          <StatCard label="Tổng bài học" value={totalLessons} icon={TrendingUp} accent="warning" />
        </div>

        {upcomingClasses.length > 0 && (
          <Card>
            <CardContent className="pt-6 sm:pt-6">
              <div className="mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Lịch giảng dạy sắp tới</h2>
              </div>
              <div className="space-y-3">
                {upcomingClasses.map(({ cls }) => (
                  <div key={cls.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{cls.name}</p>
                        <span className="text-xs text-muted-foreground">· HSK{cls.course.hskLevel} · {cls.enrollments.length} học viên</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{formatSchedule(cls.schedule)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Buổi học tiếp theo: {formatNextClass(cls.schedule)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {classSummaries.length > 0 ? (
          <>
            <section className="space-y-3" aria-labelledby="classes-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="classes-heading" className="text-lg font-semibold">Lớp học của tôi</h2>
                  <p className="text-sm text-muted-foreground">Chọn lớp để xem hoạt động và tiến độ từng học viên.</p>
                </div>
                <Link to="/teacher/courses" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Khóa học của tôi <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {classSummaries.map((cls) => {
                  const selected = cls.id === selectedClass?.id;
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedClassId(cls.id);
                        setSelectedLessonId(null);
                        setSelectedStudentId(null);
                      }}
                      className={`rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{cls.name}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{cls.course.title} · HSK {cls.course.hskLevel}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{cls.overallPercent}%</span>
                      </div>
                      <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${cls.overallPercent}%` }} />
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{cls.enrollments.length} học viên · {cls.lessons.length} bài học</span>
                        {cls.pendingGrammarAttempts.length > 0 && (
                          <span className="font-medium text-amber-700 dark:text-amber-300">Cần chấm {cls.pendingGrammarAttempts.length} bài</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedClass && (
              <>
                {selectedClass.pendingGrammarAttempts.length > 0 && (
                  <Card>
                    <CardContent className="pt-5 sm:pt-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ClipboardList className="h-4 w-4 text-amber-600" />
                          <h2 className="font-semibold">Bài ngữ pháp chờ chấm</h2>
                        </div>
                        <span className="text-sm text-muted-foreground">{selectedClass.pendingGrammarAttempts.length} bài · {selectedClass.name}</span>
                      </div>
                      <ul className="divide-y rounded-lg border">
                        {selectedClass.pendingGrammarAttempts.slice(0, 5).map((attempt) => (
                          <li key={attempt.id}>
                            <button
                              type="button"
                              onClick={() => openGradingAttempt(selectedClass.courseId, attempt.lessonId, attempt.userId, attempt.id)}
                              className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                            >
                              <span className="min-w-0 font-medium">{attempt.studentName} · {attempt.lessonTitle} · {attempt.sectionTitle}</span>
                              <span className="shrink-0 text-xs text-primary">Chấm bài <ArrowUpRight className="inline h-3.5 w-3.5" /></span>
                            </button>
                          </li>
                        ))}
                        {selectedClass.pendingGrammarAttempts.length > 5 && (
                          <li className="px-3 py-2 text-xs text-muted-foreground">Còn {selectedClass.pendingGrammarAttempts.length - 5} bài khác đang chờ chấm.</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="pt-5 sm:pt-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">Tiến độ học tập · {selectedClass.name}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{selectedClass.course.title} · {selectedClass.activityData.length} học viên</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Xếp theo số hoạt động hoàn thành giảm dần{progressView === "lesson" && selectedLesson ? ` trong Bài ${selectedLesson.order}` : ""}
                        </p>
                      </div>
                      <div className="flex rounded-lg bg-muted p-1" role="tablist" aria-label="Cách xem tiến độ lớp">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={progressView === "overview"}
                          onClick={() => setProgressView("overview")}
                          className={`rounded-md px-3 py-1.5 text-sm ${progressView === "overview" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Tổng quan {selectedClass.lessons.length} bài
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={progressView === "lesson"}
                          onClick={() => setProgressView("lesson")}
                          className={`rounded-md px-3 py-1.5 text-sm ${progressView === "lesson" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Chi tiết từng bài
                        </button>
                      </div>
                    </div>

                    {selectedClass.lessons.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Khóa học này chưa có bài học để theo dõi.</p>
                    ) : selectedClass.activityData.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Lớp này chưa có học viên.</p>
                    ) : progressView === "overview" ? (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                          <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              <th scope="col" className="sticky left-0 z-10 min-w-44 bg-muted/95 px-3 py-3 font-medium">Học viên</th>
                              {selectedClass.lessons.map((lesson) => (
                                <th scope="col" key={lesson.id} className="min-w-16 px-1 py-2 text-center font-medium">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedLessonId(lesson.id);
                                      setProgressView("lesson");
                                    }}
                                    className="rounded px-1.5 py-1 hover:bg-background hover:text-primary"
                                    title={`Xem chi tiết ${lesson.title}`}
                                  >
                                    B{lesson.order}
                                  </button>
                                </th>
                              ))}
                              <th scope="col" className="min-w-20 px-3 py-3 text-right font-medium">Trung bình</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedActivityData.map((student) => {
                              const lessonScores = student.lessons.map((lesson) => getLessonProgress(lesson.activities));
                              const total = lessonScores.reduce((sum, item) => sum + (item.total ? item.percent : 0), 0);
                              const totalAvailable = lessonScores.filter((item) => item.total > 0).length;
                              const average = totalAvailable ? Math.round(total / totalAvailable) : 0;
                              return (
                                <tr key={student.student.id} className="border-t">
                                  <th scope="row" className="sticky left-0 z-10 border-t bg-background px-3 py-2 text-left">
                                    <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="font-medium hover:text-primary hover:underline">
                                      {student.student.name ?? student.student.email}
                                    </button>
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      {student.lastActivityAt
                                        ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                        : "Chưa có hoạt động"}
                                    </span>
                                  </th>
                                  {student.lessons.map((lesson, index) => {
                                    const progress = lessonScores[index];
                                    const hasPendingGrade = lesson.activities.some((activity) => activity.status === "waiting");
                                    return (
                                      <td key={lesson.id} className="border-t px-1 py-2 text-center">
                                        {progress.total === 0 ? (
                                          <span className="text-muted-foreground">—</span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedLessonId(lesson.id);
                                              setProgressView("lesson");
                                            }}
                                            title={`${lesson.title}: ${progress.percent}%${hasPendingGrade ? " · Có bài chờ chấm" : ""}`}
                                            className={`relative min-w-12 rounded-md px-1.5 py-2 text-xs font-semibold ${lessonProgressTone(progress.percent)}`}
                                          >
                                            {progress.percent}%
                                            {hasPendingGrade && <span className="ml-0.5 text-[10px] text-blue-700 dark:text-blue-300">✎</span>}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="border-t px-3 py-2 text-right font-semibold tabular-nums">{average}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-muted/30 text-xs text-muted-foreground">
                            <tr>
                              <th scope="row" className="sticky left-0 bg-muted/95 px-3 py-2 text-left font-medium">Trung bình lớp</th>
                              {selectedClass.lessons.map((lesson) => {
                                const scores = selectedClass.activityData
                                  .map((student) => getLessonProgress(student.lessons.find((item) => item.id === lesson.id)?.activities ?? []))
                                  .filter((item) => item.total > 0);
                                const average = scores.length ? Math.round(scores.reduce((sum, item) => sum + item.percent, 0) / scores.length) : null;
                                return <td key={lesson.id} className="px-1 py-2 text-center">{average === null ? "—" : `${average}%`}</td>;
                              })}
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <>
                        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2" aria-label="Chọn bài học">
                          {selectedClass.lessons.map((lesson) => {
                            const hasGaps = selectedClass.activityData.some((student) =>
                              student.lessons.find((item) => item.id === lesson.id)?.activities.some((activity) => activity.status === "missing" || activity.status === "partial"),
                            );
                            return (
                              <button
                                key={lesson.id}
                                type="button"
                                aria-pressed={selectedLesson?.id === lesson.id}
                                onClick={() => setSelectedLessonId(lesson.id)}
                                className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${selectedLesson?.id === lesson.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"} ${hasGaps && selectedLesson?.id !== lesson.id ? "border-rose-300" : ""}`}
                              >
                                Bài {lesson.order}
                                {lesson.id === selectedClass.suggestedLessonId && <span className="ml-1.5 text-emerald-500" aria-label="Bài đang học">●</span>}
                              </button>
                            );
                          })}
                        </div>
                        {selectedLesson && (
                          <>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                              <div>
                                <h3 className="font-medium">{selectedLesson.title}</h3>
                                <p className="text-xs text-muted-foreground">Bài được gợi ý dựa trên hoạt động gần nhất của lớp.</p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {selectedClass.activityData.length} học viên · {selectedLesson.availableActivities && Object.values(selectedLesson.availableActivities).filter(Boolean).length} phần theo dõi
                              </span>
                            </div>
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full min-w-[650px] text-left text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                  <tr>
                                    <th scope="col" className="min-w-44 px-3 py-3 font-medium">Học viên</th>
                                    {selectedLessonActivities.map((activity) => (
                                      <th scope="col" key={activity.tab} className="min-w-28 px-2 py-3 text-center font-medium">{activity.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {sortedActivityData.map((student) => {
                                    const lesson = student.lessons.find((item) => item.id === selectedLesson.id);
                                    return (
                                      <tr key={student.student.id}>
                                        <th scope="row" className="px-3 py-2 text-left">
                                          <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="font-medium hover:text-primary hover:underline">
                                            {student.student.name ?? student.student.email}
                                          </button>
                                          <span className="block text-xs font-normal text-muted-foreground">
                                            {student.lastActivityAt
                                              ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                              : "Chưa có hoạt động"}
                                          </span>
                                        </th>
                                        {selectedLessonActivities.map((activity) => {
                                          const result = lesson?.activities.find((item) => item.tab === activity.tab);
                                          const pending = activity.tab === "GRAMMAR" && result?.status === "waiting"
                                            ? selectedClass.pendingGrammarAttempts.find((attempt) => attempt.userId === student.student.id && attempt.lessonId === selectedLesson.id)
                                            : undefined;
                                          return (
                                            <td key={activity.tab} className="px-2 py-2 text-center">
                                              {!result || result.status === "unavailable" ? (
                                                <span className="text-xs text-muted-foreground">Không áp dụng</span>
                                              ) : result.status === "waiting" && pending ? (
                                                <button
                                                  type="button"
                                                  onClick={() => openGradingAttempt(selectedClass.courseId, selectedLesson.id, student.student.id, pending.id)}
                                                  className="inline-flex rounded-md bg-blue-100 px-2.5 py-2 text-xs font-medium text-blue-800 hover:bg-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950"
                                                >
                                                  Chờ chấm <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                                                </button>
                                              ) : (
                                                <span className={`inline-flex min-w-20 flex-col items-center rounded-md px-2 py-1.5 ${activityTone(result.status, selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0))}`}>
                                                  <span className="font-semibold">
                                                    {result.status === "completed" ? `${result.score}%` : result.status === "partial" ? `${result.percent}%` : selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0) ? "Bỏ sót" : "Chưa làm"}
                                                  </span>
                                                  {result.correctCount != null && result.totalCount != null && result.totalCount > 0 && (
                                                    <span className="text-[10px]">{result.correctCount}/{result.totalCount}</span>
                                                  )}
                                                  <span className="text-[10px]">
                                                    {result.status === "completed" ? "Đã xong" : result.status === "partial" ? "Đang làm" : selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0) ? "Cần hoàn thành" : "Chưa bắt đầu"}
                                                  </span>
                                                </span>
                                              )}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Đã hoàn thành</span>
                              <span className="inline-flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-amber-600" />Đang làm</span>
                              <span className="inline-flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-blue-600" />Chờ chấm</span>
                              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-rose-400" />Bỏ sót</span>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5 sm:pt-5">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-rose-600" />
                        <h2 className="font-semibold">Cần nhắc</h2>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {selectedLesson ? `${reminderRows.length}/${selectedClass.activityData.length} học viên còn phần chưa xong đến Bài ${selectedLesson.order}` : "Chưa có bài học"}
                      </span>
                    </div>
                    {reminderRows.length === 0 ? (
                      <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {selectedClass.activityData.length === 0 ? "Lớp chưa có học viên." : "Không có phần học nào cần nhắc đến bài đang chọn."}
                      </p>
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {reminderRows.map(({ student, missing }) => {
                          const missingByActivity = new Map<string, typeof missing>();
                          for (const item of missing) {
                            const activityItems = missingByActivity.get(item.activity) ?? [];
                            activityItems.push(item);
                            missingByActivity.set(item.activity, activityItems);
                          }

                          return (
                            <li key={student.student.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                              <div className="min-w-48 flex-1">
                                <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="text-left text-sm font-medium hover:text-primary hover:underline">
                                  {student.student.name ?? student.student.email}
                                </button>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {[...missingByActivity].map(([activity, items]) => {
                                    const tooltipId = `reminder-${student.student.id}-${activity.replace(/\W/g, "-")}`;
                                    return (
                                      <span
                                        key={activity}
                                        tabIndex={0}
                                        aria-describedby={tooltipId}
                                        className="group relative inline-flex cursor-help rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 outline-none hover:border-rose-300 hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-ring dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                                      >
                                        {activity}
                                        <span className="ml-1 rounded-full bg-background/80 px-1.5 tabular-nums">{items.length}</span>
                                        <span
                                          id={tooltipId}
                                          role="tooltip"
                                          className="invisible absolute bottom-full left-0 z-30 max-h-56 min-w-56 max-w-80 overflow-y-auto whitespace-normal rounded-md border bg-popover p-2.5 text-left text-xs font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity after:absolute after:left-0 after:top-full after:h-2 after:w-full after:content-[''] group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
                                        >
                                          <span className="mb-1 block font-semibold">{activity} · {items.length} bài cần hoàn thành</span>
                                          {items.map((item) => (
                                            <span key={`${item.lessonOrder}-${item.lessonTitle}`} className="block">
                                              {item.isPast ? "Bỏ sót" : item.percent > 0 ? "Đang làm dở" : "Chưa hoàn thành"} · Bài {item.lessonOrder}: {item.lessonTitle}
                                            </span>
                                          ))}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                {student.student.zaloUrl ? (
                                  <a
                                    href={student.student.zaloUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    aria-label={`Nhắn Zalo cho ${student.student.name ?? student.student.email}`}
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />Nhắn Zalo
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    title="Thêm số điện thoại Zalo trong Quản lý tài khoản để nhắn học viên"
                                    className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />Nhắn Zalo
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-medium">Bạn chưa được phân công lớp học</p>
              <p className="mt-1 text-sm text-muted-foreground">Khi có lớp mới, thông tin tiến độ sẽ hiển thị tại đây.</p>
            </CardContent>
          </Card>
        )}

        {selectedStudent && selectedClass && (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/45"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedStudentId(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-progress-title"
              className="h-full w-full max-w-xl overflow-y-auto border-l bg-background p-5 shadow-xl sm:p-6"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 id="student-progress-title" className="text-lg font-semibold">{selectedStudent.student.name ?? selectedStudent.student.email}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedClass.name} · {selectedClass.course.title}</p>
                </div>
                <button type="button" aria-label="Đóng tiến độ học viên" onClick={() => setSelectedStudentId(null)} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Bài học</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Hoàn thành</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedStudent.lessons.map((lesson) => {
                      const progress = getLessonProgress(lesson.activities);
                      return (
                        <tr key={lesson.id}>
                          <th scope="row" className="px-3 py-2 font-medium">{lesson.title}</th>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {progress.total > 0 ? `${progress.percent}% · ${progress.completed}/${progress.total}` : "Không áp dụng"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Link
                to={`/teacher/courses/${selectedClass.courseId}/students/${selectedStudent.student.id}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Mở hồ sơ tiến độ đầy đủ <ArrowUpRight className="h-4 w-4" />
              </Link>
            </section>
          </div>
        )}

        {gradingAttemptId && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setGradingAttemptId(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="grammar-grading-title"
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <h2 id="grammar-grading-title" className="text-lg font-semibold">Chấm bài ngữ pháp</h2>
                  {gradingData && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {gradingData.student.name ?? gradingData.student.email} · {gradingData.lesson.title} · {gradingData.attempt.sectionTitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Đóng cửa sổ chấm bài"
                  onClick={() => setGradingAttemptId(null)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {gradingFetcher.state === "loading" ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Đang tải bài làm...</div>
              ) : !gradingData ? (
                <div role="alert" className="p-8 text-center text-sm text-destructive">
                  Không tải được bài làm. Hãy đóng cửa sổ và thử lại.
                </div>
              ) : (
                <gradeSubmitFetcher.Form
                  method="post"
                  action={`/teacher/courses/${gradingData.course.id}/lessons/${gradingData.lesson.id}/students/${gradingData.student.id}/grammar-history/attempts/${gradingAttemptId}`}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <input type="hidden" name="intent" value="grade-grammar-fill-dashboard" />
                  <input type="hidden" name="grades" value={JSON.stringify(grades)} />
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
                    {gradeSubmitFetcher.data?.error && (
                      <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {gradeSubmitFetcher.data.error}
                      </p>
                    )}
                    {gradingData.attempt.results.map((result, index) => {
                      const grade = grades.find((item) => item.questionId === result.id);
                      if (!grade) return null;
                      return (
                        <article key={`${result.id}-${index}`} className="space-y-3 rounded-lg border p-3 sm:p-4">
                          <div className="flex flex-wrap items-start gap-2">
                            <span className="mt-0.5 font-mono text-xs text-muted-foreground">{index + 1}.</span>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="content-text hanzi-display font-medium">{result.prompt}</p>
                                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{GRAMMAR_QUESTION_META[result.type].label}</span>
                              </div>
                              {result.type === "ARRANGE" && result.givenTokens && (
                                <p className="text-xs text-muted-foreground">Từ đã chọn: {result.givenTokens.join(" / ")}</p>
                              )}
                              <p className="text-sm"><span className="text-muted-foreground">Học viên trả lời: </span>{result.given || <em className="text-muted-foreground">bỏ trống</em>}</p>
                              <p className="text-sm"><span className="text-muted-foreground">Đáp án chuẩn: </span><span className="font-medium">{result.correctAnswer}</span></p>
                              {result.hint && <p className="whitespace-pre-line text-xs text-muted-foreground">{result.hint}</p>}
                            </div>
                          </div>
                          <div className="space-y-2 border-t pt-3">
                            <div className="flex gap-2" role="group" aria-label={`Chấm câu ${index + 1}`}>
                              <Button type="button" size="sm" variant={grade.correct ? "default" : "outline"} onClick={() => updateGrade(result.id, { correct: true })}>
                                <CheckCircle2 className="mr-1.5 h-4 w-4" />Đúng
                              </Button>
                              <Button type="button" size="sm" variant={!grade.correct ? "destructive" : "outline"} onClick={() => updateGrade(result.id, { correct: false })}>
                                <XCircle className="mr-1.5 h-4 w-4" />Sai
                              </Button>
                              <span className="self-center text-xs text-muted-foreground">Tự chấm: {result.autoCorrect ? "Đúng" : "Sai"}</span>
                            </div>
                            <label htmlFor={`dashboard-teacher-feedback-${result.id}`} className="text-xs font-medium">
                              Đáp án/Nhận xét <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
                            </label>
                            <Textarea
                              id={`dashboard-teacher-feedback-${result.id}`}
                              value={grade.teacherFeedback}
                              rows={2}
                              onChange={(event) => updateGrade(result.id, { teacherFeedback: event.target.value })}
                              placeholder="Nhập nhận xét hoặc đáp án thay thế"
                            />
                          </div>
                        </article>
                      );
                    })}
                    {gradingData.attempt.results.length === 0 && (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Bài làm không có dữ liệu câu trả lời để chấm.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 sm:px-5">
                    <p className="text-sm text-muted-foreground">
                      Điểm dự kiến: {grades.length ? `${Math.round((grades.filter((grade) => grade.correct).length / grades.length) * 100)}%` : "—"}
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setGradingAttemptId(null)}>Hủy</Button>
                      <Button type="submit" disabled={gradeSubmitFetcher.state === "submitting" || grades.length !== gradingData.attempt.results.length || grades.length === 0}>
                        {gradeSubmitFetcher.state === "submitting" ? "Đang lưu..." : "Lưu điểm"}
                      </Button>
                    </div>
                  </div>
                </gradeSubmitFetcher.Form>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
