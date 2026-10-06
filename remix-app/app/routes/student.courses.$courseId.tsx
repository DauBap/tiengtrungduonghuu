import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link, useNavigate } from "react-router";
import { useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonSummariesByCourse, getCourseReviewSetSummaries, getAllProgressForCourse, computeLessonStatus, computeTrackedCourseProgress, isEnrolled } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { LessonCard } from "~/components/lessons/lesson-card";
import { ProgressBar } from "~/components/progress/progress-bar";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, BookOpen, Layers, FileCheck2 } from "lucide-react";
import type { ProgressStatus } from "~/types/progress";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
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

  const [lessons, reviewSets, progressList, tabProgressRows] = await Promise.all([
    getLessonSummariesByCourse(course.id),
    getCourseReviewSetSummaries(course.id),
    getAllProgressForCourse(user.id, course.id),
    prisma.lessonTabProgress.findMany({
      where: { userId: user.id, lesson: { courseId: course.id } },
      include: {
        attempts: {
          where: { tab: "VOCABULARY_TEST" },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);
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
  const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));
  const courseProgress = computeTrackedCourseProgress(lessons.map((lesson) => lesson.id), tabProgressRows);
  const tabProgressByLesson = new Map<string, typeof tabProgressRows>();
  for (const row of tabProgressRows) {
    const rows = tabProgressByLesson.get(row.lessonId) ?? [];
    rows.push(row);
    tabProgressByLesson.set(row.lessonId, rows);
  }

  // Mọi bài học đều mở — không còn khóa theo tiến độ bài trước.
  // Status chỉ còn phản ánh học viên đã học tới đâu, không dùng để chặn truy cập.
  const lessonsWithStatus = lessons.map((lesson) => {
    const p = progressMap.get(lesson.id) ?? null;
    const s = computeLessonStatus(p);
    const tabRows = tabProgressByLesson.get(lesson.id) ?? [];
    const completedTabCount = tabRows.filter((row) => row.tab === "VOCABULARY_TEST"
      ? row.attempts[0]?.passed === true
      : row.completed).length;
    const hasStartedTab = tabRows.some((row) => row.opened || row.completed);

    let status: ProgressStatus;
    if (completedTabCount === LESSON_TAB_KEYS.length) status = "COMPLETED";
    else if (hasStartedTab) status = "IN_PROGRESS";
    else if (s.learningStatus === "COMPLETED" || s.exerciseStatus !== "LOCKED") status = "IN_PROGRESS";
    else status = "AVAILABLE";

    return { ...lesson, status };
  });

  return {
    user,
    course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
    lessonsWithStatus,
    reviewSets,
    courseProgress,
    mockExams: mockExamsWithLabels,
  };
}

export default function StudentCourseDetail() {
  const { user, course, lessonsWithStatus, reviewSets, courseProgress, mockExams } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [showCombinedStudy, setShowCombinedStudy] = useState(false);
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);

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
          <CardHeader><CardTitle className="text-base">Tiến độ khóa học</CardTitle></CardHeader>
          <CardContent><ProgressBar value={courseProgress} /></CardContent>
        </Card>

        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Bài học</h2>
            {lessonsWithStatus.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowCombinedStudy(true)}>
                <Layers className="mr-1.5 h-4 w-4" />Học tổng hợp
              </Button>
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

        {showCombinedStudy && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowCombinedStudy(false);
            }}
          >
            <section role="dialog" aria-modal="true" aria-labelledby="combined-study-title"
              className="w-full max-w-lg rounded-lg border bg-background shadow-xl">
              <div className="border-b p-5">
                <h2 id="combined-study-title" className="text-lg font-semibold">Học tổng hợp</h2>
                <p className="mt-1 text-sm text-muted-foreground">Chọn các bài học trong khóa {course.title}.</p>
              </div>
              <div className="max-h-[55vh] space-y-1 overflow-y-auto p-3">
                {lessonsWithStatus.map((lesson) => (
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
                  <Button variant="ghost" onClick={() => setShowCombinedStudy(false)}>Hủy</Button>
                  <Button disabled={selectedLessonIds.length === 0} onClick={() => {
                    const search = new URLSearchParams();
                    selectedLessonIds.forEach((id) => search.append("lessonId", id));
                    navigate(`/student/courses/${course.id}/flashcards?${search.toString()}`);
                  }}>
                    <BookOpen className="mr-1.5 h-4 w-4" />Học bài
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
