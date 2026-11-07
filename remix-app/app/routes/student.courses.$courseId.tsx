import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link, useNavigate } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonSummariesByCourse, getCourseReviewSetSummaries, computeTrackedCourseProgress, isEnrolled } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { LessonCard } from "~/components/lessons/lesson-card";
import { ProgressBar } from "~/components/progress/progress-bar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { useModalScrollLock } from "~/components/common/use-modal-scroll-lock";
import { ArrowLeft, ArrowUpRight, BookOpen, Layers, FileCheck2, ListChecks, Search, X, ClipboardCheck, Award, CheckCircle2, Video } from "lucide-react";
import type { ProgressStatus } from "~/types/progress";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import {
  areAllAvailableActivitiesGreen,
  getGrammarActivityProgress,
  type GrammarAttemptProgress,
  type GrammarQuestionGroup,
  type LessonActivityProgress,
} from "~/lib/lesson-progress-summary";
import { parseGrammarQuestionType } from "~/lib/grammar";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  // Hai query độc lập nhau (cả hai chỉ cần courseId từ params) — chạy song song
  // để tiết kiệm một round-trip tới DB trước khi vào nhóm query bên dưới.
  const [course, enrolled] = await Promise.all([
    getCourseById(params.courseId!),
    isEnrolled(user.id, params.courseId!),
  ]);
  if (!course) throw new Response("Không tìm thấy", { status: 404 });
  if (!enrolled) throw new Response("Không có quyền truy cập", { status: 403 });

  const [lessons, reviewSets, tabProgressRows, grammarAttempts, grammarQuestionRows, enrollment] = await Promise.all([
    getLessonSummariesByCourse(course.id),
    getCourseReviewSetSummaries(course.id),
    prisma.lessonTabProgress.findMany({
      where: { userId: user.id, lesson: { courseId: course.id } },
      include: {
        attempts: {
          where: { tab: "VOCABULARY_TEST" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { passed: true },
        },
      },
    }),
    prisma.lessonTabAttempt.findMany({
      where: {
        userId: user.id,
        lesson: { courseId: course.id },
        tab: "GRAMMAR",
      },
      select: { lessonId: true, mode: true, details: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    prisma.grammarQuestion.findMany({
      where: { section: { lesson: { courseId: course.id } } },
      select: { type: true, sectionId: true, section: { select: { lessonId: true } } },
    }),
    prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: {
        class: {
          select: {
            id: true,
            name: true,
            completedAt: true,
            finalResults: {
              where: { studentId: user.id },
              select: {
                score: true,
                comment: true,
                attendedSessions: true,
                totalSessions: true,
                decision: true,
              },
            },
            attendanceSessions: {
              orderBy: [{ date: "desc" }, { createdAt: "desc" }],
              select: {
                id: true,
                title: true,
                lesson: true,
                date: true,
                recordingUrl: true,
                courseLesson: { select: { order: true, title: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  const classFinalResult = enrollment?.class?.finalResults[0] ?? null;
  const isClassCompleted = Boolean(enrollment?.class?.completedAt);
  const attendanceSessions = (enrollment?.class?.attendanceSessions ?? []).map((session) => {
    let recordingUrl: string | null = null;
    if (session.recordingUrl) {
      try {
        const url = new URL(session.recordingUrl);
        if (url.protocol === "https:" || url.protocol === "http:") recordingUrl = url.toString();
      } catch {
        recordingUrl = null;
      }
    }
    return { ...session, recordingUrl };
  });
  const mockExams = await prisma.mockExam.findMany({
    where: { courseId: course.id, isPublished: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sections: {
        select: {
          questions: { select: { type: true } },
        },
      },
    },
  });
  const mockExamsWithLabels = mockExams.map((exam) => {
    const questionTypes = exam.sections.flatMap((section) => section.questions.map((question) => question.type));
    const labels = [
      ...(questionTypes.includes("LISTENING") ? ["Nghe"] : []),
      ...(questionTypes.some((type) => type !== "LISTENING") ? ["Đọc"] : []),
    ];
    return {
      id: exam.id,
      questionCount: questionTypes.length,
      labels,
    };
  });
  const courseProgress = computeTrackedCourseProgress(lessons.map((lesson) => lesson.id), tabProgressRows);
  const tabProgressByLesson = new Map<string, typeof tabProgressRows>();
  for (const row of tabProgressRows) {
    const rows = tabProgressByLesson.get(row.lessonId) ?? [];
    rows.push(row);
    tabProgressByLesson.set(row.lessonId, rows);
  }
  const grammarGroupsByLesson = new Map<string, GrammarQuestionGroup[]>();
  for (const question of grammarQuestionRows) {
    const groups = grammarGroupsByLesson.get(question.section.lessonId) ?? [];
    groups.push({ sectionId: question.sectionId, questionType: question.type });
    grammarGroupsByLesson.set(question.section.lessonId, groups);
  }
  const grammarAttemptsByLesson = new Map<string, GrammarAttemptProgress[]>();
  for (const attempt of grammarAttempts) {
    const details = typeof attempt.details === "object" && attempt.details !== null && !Array.isArray(attempt.details)
      ? attempt.details
      : {};
    const questionType = parseGrammarQuestionType(details.questionType ?? attempt.mode);
    if (typeof details.sectionId !== "string" || !questionType) continue;

    const attempts = grammarAttemptsByLesson.get(attempt.lessonId) ?? [];
    const teacherGrading = details.teacherGrading;
    attempts.push({
      sectionId: details.sectionId,
      questionType,
      completedAt: attempt.completedAt,
      reviewPending: details.reviewPending === true
        && (typeof teacherGrading !== "object" || teacherGrading === null || Array.isArray(teacherGrading)),
    });
    grammarAttemptsByLesson.set(attempt.lessonId, attempts);
  }

  // Match a lesson's tick to every available activity being green in the teacher table.
  const lessonsWithStatus = lessons.map((lesson) => {
    const tabRows = tabProgressByLesson.get(lesson.id) ?? [];
    const progressByTab = new Map(tabRows.map((row) => [row.tab, row]));
    const grammarProgress = getGrammarActivityProgress(
      grammarGroupsByLesson.get(lesson.id) ?? [],
      grammarAttemptsByLesson.get(lesson.id) ?? [],
    );
    const availableActivities: Record<(typeof LESSON_TAB_KEYS)[number], boolean> = {
      FLASHCARD: lesson.learningBlocks.some((block) => block.type === "FLASHCARD"),
      VOCABULARY_TEST: lesson._count.content > 0,
      LISTENING: lesson.learningBlocks.some((block) => block.type === "LISTENING"),
      VOCABULARY: false,
      LESSON: lesson._count.audioScripts > 0,
      PHONETICS: lesson.phoneticsSections.length > 0,
      GRAMMAR: lesson._count.grammarSections > 0,
      WORKBOOK: lesson.learningBlocks.some((block) => block.type === "WORKBOOK"),
      TRANSLATION: false,
    };
    const activities: LessonActivityProgress[] = LESSON_TAB_KEYS.map((tab) => {
      const progress = progressByTab.get(tab);
      const latestAttempt = progress?.attempts[0];
      const completed = tab === "VOCABULARY_TEST"
        ? latestAttempt?.passed === true
        : tab === "GRAMMAR"
          ? grammarProgress.completed
          : progress?.completed === true;
      const waiting = tab === "GRAMMAR" && grammarProgress.waiting;
      const hasStarted = Boolean(
        latestAttempt
        || (tab === "GRAMMAR" && grammarProgress.hasStarted)
        || progress?.opened
        || progress?.state === "IN_PROGRESS"
        || (progress?.percent ?? 0) > 0,
      );

      return {
        status: !availableActivities[tab]
          ? "unavailable"
          : waiting
            ? "waiting"
            : completed
              ? "completed"
              : hasStarted
                ? "partial"
                : "missing",
        percent: tab === "GRAMMAR"
          ? grammarProgress.percent
          : Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
      };
    });
    const status: ProgressStatus = areAllAvailableActivitiesGreen(activities)
      ? "COMPLETED"
      : activities.some((activity) => activity.status !== "unavailable" && activity.status !== "missing")
        ? "IN_PROGRESS"
        : "AVAILABLE";

    return { ...lesson, status };
  });

  return {
    user,
    course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
    lessonsWithStatus,
    reviewSets,
    courseProgress,
    mockExams: mockExamsWithLabels,
    isClassCompleted,
    classId: enrollment?.class?.id ?? null,
    className: enrollment?.class?.name ?? null,
    attendanceSessions,
    classFinalResult,
  };
}

export default function StudentCourseDetail() {
  const {
    user,
    course,
    lessonsWithStatus,
    reviewSets,
    courseProgress,
    mockExams,
    isClassCompleted,
    classId,
    className,
    attendanceSessions,
    classFinalResult,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [isFinalResultOpen, setIsFinalResultOpen] = useState(false);
  const finalResultDialogRef = useRef<HTMLElement>(null);
  const finalResultCloseRef = useRef<HTMLButtonElement>(null);
  const recordingsDialogRef = useRef<HTMLDialogElement>(null);
  const recordingsCloseRef = useRef<HTMLButtonElement>(null);
  const [isRecordingsOpen, setIsRecordingsOpen] = useState(false);
  const [combinedMode, setCombinedMode] = useState<"study" | "test" | null>(null);
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
  const [lessonSearchQuery, setLessonSearchQuery] = useState("");
  useModalScrollLock(combinedMode !== null || isFinalResultOpen || isRecordingsOpen);
  useEffect(() => {
    const dialog = recordingsDialogRef.current;
    if (!dialog) return;
    if (isRecordingsOpen && !dialog.open) {
      dialog.showModal();
      recordingsCloseRef.current?.focus();
    }
    if (!isRecordingsOpen && dialog.open) dialog.close();
  }, [isRecordingsOpen]);
  useEffect(() => {
    if (!isFinalResultOpen) return;

    const dialog = finalResultDialogRef.current;
    if (!dialog) return;

    const previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    finalResultCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsFinalResultOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusableElements = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, [isFinalResultOpen]);
  const allLessonsSelected = lessonsWithStatus.length > 0
    && lessonsWithStatus.every((lesson) => selectedLessonIds.includes(lesson.id));

  const orderedCourseItems = [
    ...lessonsWithStatus.map((lesson) => ({
      kind: "lesson" as const,
      order: lesson.order,
      item: lesson,
    })),
    ...reviewSets.map((set) => ({
      kind: "review" as const,
      order: set.order,
      item: set,
    })),
  ].sort((a, b) => a.order - b.order);
  const lessonNumbers = new Map(lessonsWithStatus.map((lesson, index) => [lesson.id, index + 1]));
  const filteredLessons = useMemo(() => {
    const query = lessonSearchQuery
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/đ/g, "d");
    if (!query) return lessonsWithStatus;

    return lessonsWithStatus.filter((lesson, index) => {
      const searchableText = [
        `bai ${index + 1}`,
        lesson.title,
        lesson.subtitle,
      ]
        .join(" ")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/đ/g, "d");
      return searchableText.includes(query);
    });
  }, [lessonSearchQuery, lessonsWithStatus]);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/student/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {course.hskLevel}</span>
                <span className="text-xs font-mono text-muted-foreground">{course.code}</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">{course.title}</h1>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{course.description}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Tiến độ khóa học</CardTitle>
            {isClassCompleted && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-700/20 bg-emerald-700/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-300">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                Khóa học đã kết thúc
              </span>
            )}
          </CardHeader>
          <CardContent><ProgressBar value={courseProgress} /></CardContent>
        </Card>

        {isClassCompleted && (
          <section className="space-y-3">
            <Button
              type="button"
              variant="default"
              onClick={() => setIsFinalResultOpen(true)}
              className="w-full justify-start gap-2 sm:w-auto"
            >
              <Award aria-hidden="true" className="h-4 w-4" />
              Xem kết quả cuối khóa
            </Button>
            {isFinalResultOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsFinalResultOpen(false);
                }}
              >
                <section
                  ref={finalResultDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="student-final-result-heading"
                  tabIndex={-1}
                  className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border bg-background shadow-xl"
                >
                  <header className="flex items-start justify-between gap-4 border-b bg-muted/30 px-4 py-4 sm:px-6">
                    <div>
                      <h2 id="student-final-result-heading" className="font-semibold">Kết quả cuối khóa</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {className ? `Lớp ${className}` : "Lớp học"} · Đã kết thúc
                      </p>
                    </div>
                    <Button
                      ref={finalResultCloseRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Đóng kết quả cuối khóa"
                      onClick={() => setIsFinalResultOpen(false)}
                      className="h-8 w-8 shrink-0"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </header>
                  {classFinalResult ? (
                    <div className="space-y-4 p-4 sm:p-6">
                      <dl className="grid gap-4 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                        <div className="pt-3 first:pt-0 sm:px-4 sm:pt-0 sm:first:pl-0">
                          <dt className="text-xs font-medium text-muted-foreground">Điểm cuối khóa</dt>
                          <dd className="mt-1 text-2xl font-semibold tabular-nums">
                            {classFinalResult.score}<span className="text-sm font-normal text-muted-foreground"> / 10</span>
                          </dd>
                        </div>
                        <div className="pt-3 sm:px-4 sm:pt-0">
                          <dt className="text-xs font-medium text-muted-foreground">Chuyên cần</dt>
                          <dd className="mt-1 text-2xl font-semibold tabular-nums">
                            {classFinalResult.totalSessions > 0
                              ? Math.round((classFinalResult.attendedSessions / classFinalResult.totalSessions) * 100)
                              : 0}
                            <span className="text-sm font-normal text-muted-foreground">%</span>
                          </dd>
                          <p className="text-xs text-muted-foreground">
                            {classFinalResult.attendedSessions}/{classFinalResult.totalSessions} buổi có mặt
                          </p>
                        </div>
                        <div className="pt-3 sm:px-4 sm:pt-0 sm:last:pr-0">
                          <dt className="text-xs font-medium text-muted-foreground">Kết quả</dt>
                          <dd className="mt-1 text-base font-semibold">
                            {classFinalResult.decision === "PROMOTE" ? "Lên lớp" : "Ở lại"}
                          </dd>
                        </div>
                      </dl>
                      <div className="border-t pt-4">
                        <h3 className="text-sm font-semibold">Nhận xét của giáo viên</h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{classFinalResult.comment}</p>
                      </div>
                    </div>
                  ) : (
                    <p role="status" className="p-4 text-sm text-muted-foreground sm:p-6">
                      Giáo viên chưa cập nhật kết quả cuối khóa. Kết quả sẽ hiển thị tại đây sau khi được hoàn tất.
                    </p>
                  )}
                </section>
              </div>
            )}
          </section>
        )}

        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Bài học</h2>
            {(lessonsWithStatus.length > 0 || classId) && (
              <div className="flex flex-wrap gap-2">
                {classId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsRecordingsOpen(true)}
                    className="hover:border-primary hover:bg-primary hover:text-primary-foreground"
                  >
                    <Video aria-hidden="true" className="mr-1.5 h-4 w-4" />Bản ghi buổi học
                  </Button>
                )}
                {lessonsWithStatus.length > 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCombinedMode("study")}
                      className="hover:border-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      <Layers className="mr-1.5 h-4 w-4" />Học tổng hợp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCombinedMode("test")}
                      className="hover:border-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      <ClipboardCheck className="mr-1.5 h-4 w-4" />Thi tổng hợp
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          {orderedCourseItems.length === 0
            ? <EmptyState title="Chưa có bài học" message="Khóa học này chưa có bài học nào." />
            : <div className="space-y-3">
                {orderedCourseItems.map((entry) => {
                  if (entry.kind === "lesson") {
                    const lesson = entry.item as (typeof lessonsWithStatus)[number];
                    return (
                      <LessonCard
                        key={lesson.id}
                        lesson={{ ...lesson, content: [] }}
                        status={lesson.status}
                        index={(lessonNumbers.get(lesson.id) ?? 1) - 1}
                        href={`/student/courses/${course.id}/lessons/${lesson.id}`}
                      />
                    );
                  }

                  const review = entry.item as (typeof reviewSets)[number];
                  return (
                    <LessonCard
                      key={review.id}
                      lesson={{ id: review.id, courseId: course.id, order: review.order, title: review.title, subtitle: review.subtitle, content: [] }}
                      status="AVAILABLE"
                      index={review.order}
                      badgeText="Ôn tập"
                      variant="review"
                      href={`/student/courses/${course.id}/reviews/${review.id}`}
                    />
                  );
                })}
              </div>}
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">BÀI THI THỬ</h2>
              <p className="text-sm text-muted-foreground">
                {mockExams.length} đề thi thử · Làm bài độc lập với các bài học
              </p>
            </div>
          </div>
          {mockExams.length === 0
            ? <EmptyState title="Chưa có bài thi thử" message="Khóa học này hiện chưa có bài thi thử được phát hành." />
            : <div className="space-y-3">
                {mockExams.map((exam, index) => (
                  <Card key={exam.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                      <div>
                        <h3 className="font-semibold">Đề số {index + 1}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {exam.questionCount} câu{exam.labels.length > 0 && ` · ${exam.labels.join(" + ")}`}
                        </p>
                      </div>
                      <Button asChild variant="outline">
                        <Link to={`/student/courses/${course.id}/mock-exams/${exam.id}`}>Xem bài thi thử</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>}
        </section>

        {classId && (
          <dialog
            ref={recordingsDialogRef}
            aria-labelledby="student-recordings-heading"
            onClose={() => setIsRecordingsOpen(false)}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsRecordingsOpen(false);
            }}
            className="fixed left-1/2 top-1/2 m-0 max-h-[85vh] w-[calc(100%-1rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
          >
            <section className="flex max-h-[85vh] flex-col">
              <header className="flex items-start justify-between gap-4 border-b bg-muted/30 px-4 py-4 sm:px-6">
                <div>
                  <h2 id="student-recordings-heading" className="font-semibold">Bản ghi buổi học</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {className ?? course.title} · {attendanceSessions.length} buổi
                  </p>
                </div>
                <Button
                  ref={recordingsCloseRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng danh sách bản ghi"
                  onClick={() => setIsRecordingsOpen(false)}
                  className="h-8 w-8 shrink-0"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
              {attendanceSessions.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Video aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">Chưa có buổi học hoặc bản ghi</p>
                  <p className="mt-1 text-sm text-muted-foreground">Khi giáo viên đăng link, buổi học sẽ xuất hiện tại đây.</p>
                </div>
              ) : (
                <ol className="divide-y overflow-y-auto">
                  {attendanceSessions.map((session) => (
                    <li key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="font-medium">{session.title}</h3>
                        {(session.courseLesson || session.lesson) && (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {session.courseLesson
                              ? `Bài ${session.courseLesson.order} · ${session.courseLesson.title}`
                              : session.lesson}
                          </p>
                        )}
                        <time className="mt-1 block text-sm text-muted-foreground">
                          {session.date.toLocaleDateString("vi-VN")}
                        </time>
                      </div>
                      {session.recordingUrl ? (
                        <a
                          href={session.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Xem bản ghi<ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">Chưa có bản ghi</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </dialog>
        )}

        {combinedMode !== null && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="presentation"
          >
            <section role="dialog" aria-modal="true" aria-labelledby="combined-action-title"
              className="w-full max-w-lg rounded-lg border bg-background shadow-xl">
              <div className="border-b p-5">
                <h2 id="combined-action-title" className="text-lg font-semibold">
                  {combinedMode === "study" ? "Học tổng hợp" : "Thi tổng hợp"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Chọn các bài học trong khóa {course.title}.</p>
              </div>
              <div className="space-y-3 border-b p-4">
                <Label htmlFor="combined-study-lesson-search">Tìm kiếm bài học</Label>
                <div className="relative">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="combined-study-lesson-search"
                    type="text"
                    value={lessonSearchQuery}
                    onChange={(event) => setLessonSearchQuery(event.target.value)}
                    placeholder="Tên bài, nội dung hoặc số bài..."
                    className="h-11 pl-9 pr-12"
                  />
                  {lessonSearchQuery && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2"
                      onClick={() => setLessonSearchQuery("")}
                      aria-label="Xóa nội dung tìm kiếm bài học"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {lessonSearchQuery.trim()
                      ? `Tìm thấy ${filteredLessons.length}/${lessonsWithStatus.length} bài học`
                      : `${lessonsWithStatus.length} bài học trong khóa`}
                  </p>
                  {lessonsWithStatus.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={allLessonsSelected}
                      onClick={() => setSelectedLessonIds(allLessonsSelected
                        ? []
                        : lessonsWithStatus.map((lesson) => lesson.id))}
                      className="h-9 gap-1.5 border-primary/30 bg-primary/5 px-3 font-medium text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
                    >
                      <ListChecks aria-hidden="true" className="h-4 w-4" />
                      {allLessonsSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </Button>
                  )}
                </div>
              </div>
              <div className="max-h-[45vh] space-y-1 overflow-y-auto p-3">
                {filteredLessons.length === 0 ? (
                  <div role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Không tìm thấy bài học phù hợp.
                  </div>
                ) : filteredLessons.map((lesson) => (
                  <label key={lesson.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={selectedLessonIds.includes(lesson.id)}
                      onChange={(event) => setSelectedLessonIds((previous) => event.target.checked
                        ? [...previous, lesson.id]
                        : previous.filter((id) => id !== lesson.id))}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="mr-2 text-xs font-medium text-muted-foreground">Bài {lessonNumbers.get(lesson.id) ?? 1}</span>
                      <span className="text-sm font-medium">{lesson.title}</span>
                      {lesson.subtitle && <span className="mt-0.5 block text-xs text-muted-foreground">{lesson.subtitle}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 border-t p-4">
                <span className="text-xs text-muted-foreground">Đã chọn {selectedLessonIds.length} bài</span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setCombinedMode(null)}>Hủy</Button>
                  <Button disabled={selectedLessonIds.length === 0} onClick={() => {
                    const search = new URLSearchParams();
                    selectedLessonIds.forEach((id) => search.append("lessonId", id));
                    const destination = combinedMode === "study" ? "flashcards" : "combined-test";
                    navigate(`/student/courses/${course.id}/${destination}?${search.toString()}`);
                  }}>
                    {combinedMode === "study" ? (
                      <><BookOpen className="mr-1.5 h-4 w-4" />Học bài</>
                    ) : (
                      <><ClipboardCheck className="mr-1.5 h-4 w-4" />Bắt đầu thi</>
                    )}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
