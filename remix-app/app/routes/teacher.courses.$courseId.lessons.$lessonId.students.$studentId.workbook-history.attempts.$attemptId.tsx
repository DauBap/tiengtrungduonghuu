import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { ArrowLeft, BookOpen, CheckCircle2, ClipboardList, UserRound, XCircle } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse, markBlockCompleted, syncLearningCompleted } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type WorkbookQuestionResult = {
  id: string;
  number: number;
  sectionId: string;
  sectionTitle: string;
  prompt: string;
  passage: string;
  translation: string;
  kind: "choice" | "input";
  gradable: boolean;
  given: string;
  givenLabel: string;
  correctAnswer: string;
  correct: boolean | null;
  teacherReviewPending: boolean;
  points: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkbookResults(details: unknown): WorkbookQuestionResult[] {
  if (!isRecord(details) || !Array.isArray(details.results)) return [];
  return details.results.flatMap((item): WorkbookQuestionResult[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.number !== "number") return [];
    if (item.kind !== "choice" && item.kind !== "input") return [];
    if (typeof item.gradable !== "boolean" || typeof item.given !== "string" || typeof item.correctAnswer !== "string") return [];
    return [{
      id: item.id,
      number: item.number,
      sectionId: typeof item.sectionId === "string" ? item.sectionId : "unknown",
      sectionTitle: typeof item.sectionTitle === "string" ? item.sectionTitle : "Phần bài tập",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
      passage: typeof item.passage === "string" ? item.passage : "",
      translation: typeof item.translation === "string" ? item.translation : "",
      kind: item.kind,
      gradable: item.gradable,
      given: item.given,
      givenLabel: typeof item.givenLabel === "string" ? item.givenLabel : item.given,
      correctAnswer: item.correctAnswer,
      correct: item.correct === true ? true : item.correct === false ? false : null,
      teacherReviewPending: item.teacherReviewPending === true,
      points: typeof item.points === "number" ? item.points : 0,
    }];
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, course.id))) throw new Response("Không có quyền truy cập", { status: 403 });

  const lesson = (await getLessonsByCourse(course.id)).find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
    select: { userId: true },
  });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });
  const attempt = await prisma.lessonTabAttempt.findFirst({
    where: { id: params.attemptId, userId: enrollment.userId, lessonId: lesson.id, tab: "WORKBOOK" },
  });
  if (!attempt) throw new Response("Không tìm thấy lượt Sách bài tập", { status: 404 });

  const details = isRecord(attempt.details) ? attempt.details : null;
  if (!details || details.reviewPending !== true || !Array.isArray(details.results)) {
    return { error: "Lượt làm này không còn câu nào chờ chấm." };
  }
  const pendingIds = details.results.flatMap((item) =>
    isRecord(item) && item.teacherReviewPending === true && typeof item.id === "string" ? [item.id] : []
  );
  if (pendingIds.length === 0) return { error: "Không tìm thấy câu cần chấm." };

  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "grade-workbook" && intent !== "grade-workbook-dashboard") return null;
  const grades = new Map<string, boolean>();
  for (const questionId of pendingIds) {
    const value = form.get(`grade-${questionId}`);
    if (value !== "correct" && value !== "incorrect") {
      return { error: "Vui lòng chọn kết quả cho tất cả câu đang chờ chấm." };
    }
    grades.set(questionId, value === "correct");
  }

  const results = details.results.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !grades.has(item.id)) return item;
    return { ...item, correct: grades.get(item.id), teacherReviewPending: false };
  });
  const gradableResults = results.filter((item) => isRecord(item) && item.gradable === true);
  const correctCount = gradableResults.filter((item) => isRecord(item) && item.correct === true).length;
  const totalCount = gradableResults.length;
  if (totalCount === 0) return { error: "Lượt làm không có câu được chấm điểm." };
  const score = Math.round((correctCount / totalCount) * 10000) / 100;
  const gradedAt = new Date();
  const updatedDetails = {
    ...details,
    reviewPending: false,
    teacherGrading: { teacherId: user.id, gradedAt: gradedAt.toISOString() },
    results,
  };

  await prisma.$transaction(async (tx) => {
    const otherAttempts = await tx.lessonTabAttempt.findMany({
      where: { userId: enrollment.userId, lessonId: lesson.id, tab: "WORKBOOK", id: { not: attempt.id } },
      select: { details: true },
    });
    const stillPending = otherAttempts.some((other) => {
      const otherDetails = isRecord(other.details) ? other.details : {};
      return otherDetails.reviewPending === true;
    });
    const progress = await tx.lessonTabProgress.findUnique({
      where: { userId_lessonId_tab: { userId: enrollment.userId, lessonId: lesson.id, tab: "WORKBOOK" } },
    });
    const bestScore = Math.max(progress?.bestScore ?? 0, score);
    await tx.lessonTabAttempt.update({
      where: { id: attempt.id },
      data: { score, correctCount, totalCount, passed: correctCount === totalCount, details: updatedDetails },
    });
    await tx.lessonTabProgress.upsert({
      where: { userId_lessonId_tab: { userId: enrollment.userId, lessonId: lesson.id, tab: "WORKBOOK" } },
      update: {
        opened: true,
        state: stillPending ? "NEEDS_REVIEW" : "COMPLETED",
        completed: !stillPending,
        percent: stillPending ? 0 : 100,
        currentScore: stillPending ? null : score,
        bestScore,
        lastAttemptAt: attempt.completedAt,
        completedAt: stillPending ? null : progress?.completedAt ?? gradedAt,
      },
      create: {
        userId: enrollment.userId,
        lessonId: lesson.id,
        tab: "WORKBOOK",
        opened: true,
        state: stillPending ? "NEEDS_REVIEW" : "COMPLETED",
        completed: !stillPending,
        percent: stillPending ? 0 : 100,
        currentScore: stillPending ? null : score,
        bestScore,
        lastAttemptAt: attempt.completedAt,
        completedAt: stillPending ? null : gradedAt,
      },
    });
    await tx.userNotification.create({
      data: {
        recipientId: enrollment.userId,
        actorId: user.id,
        kind: "WORKBOOK_GRADED",
        entityId: attempt.id,
        title: "Bài làm đã được chấm",
        message: `Phần “${typeof details.blockTitle === "string" ? details.blockTitle : "Sách bài tập"}” của “${lesson.title}” đã được chấm. Bạn hãy kiểm tra nhé.`,
        targetUrl: `/student/courses/${encodeURIComponent(course.id)}/lessons/${encodeURIComponent(lesson.id)}?reviewAttemptId=${encodeURIComponent(attempt.id)}`,
      },
    });
  });

  if (typeof details.blockId === "string") {
    const block = await prisma.learningBlock.findFirst({
      where: { id: details.blockId, lessonId: lesson.id, type: "WORKBOOK" },
      select: { id: true },
    });
    const attemptsForBlock = block
      ? await prisma.lessonTabAttempt.findMany({
          where: { userId: enrollment.userId, lessonId: lesson.id, tab: "WORKBOOK" },
          select: { details: true },
        })
      : [];
    const blockStillPending = attemptsForBlock.some((other) => {
      const otherDetails = isRecord(other.details) ? other.details : {};
      return otherDetails.blockId === details.blockId && otherDetails.reviewPending === true;
    });
    if (block && !blockStillPending) {
      await markBlockCompleted(enrollment.userId, block.id);
      await syncLearningCompleted(enrollment.userId, lesson.id);
    }
  }

  if (intent === "grade-workbook-dashboard") return { success: true, attemptId: attempt.id };
  return redirect(new URL(request.url).pathname);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, course.id))) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  const attempt = await prisma.lessonTabAttempt.findFirst({
    where: {
      id: params.attemptId,
      userId: enrollment.userId,
      lessonId: lesson.id,
      tab: "WORKBOOK",
    },
  });
  if (!attempt) throw new Response("Không tìm thấy lượt Sách bài tập", { status: 404 });

  const details = isRecord(attempt.details) ? attempt.details : {};
  return {
    user,
    course,
    lesson,
    student: enrollment.user,
    attempt: {
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalCount: attempt.totalCount,
      passed: attempt.passed,
      completedAt: attempt.completedAt.toISOString(),
      blockTitle: typeof details.blockTitle === "string" ? details.blockTitle : "Sách bài tập",
      ungradableCount: typeof details.ungradableCount === "number" ? details.ungradableCount : 0,
      results: readWorkbookResults(attempt.details),
    },
  };
}

export default function TeacherWorkbookAttemptDetail() {
  const { user, course, lesson, student, attempt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const historyUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/workbook-history`;
  const groupedResults = attempt.results.reduce<Array<{ id: string; title: string; results: WorkbookQuestionResult[] }>>((groups, result) => {
    let group = groups.find((item) => item.id === result.sectionId);
    if (!group) {
      group = { id: result.sectionId, title: result.sectionTitle, results: [] };
      groups.push(group);
    }
    group.results.push(result);
    return groups;
  }, []);
  const score = attempt.score ?? 0;
  const pendingReview = attempt.results.some((result) => result.teacherReviewPending);

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={historyUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại lịch sử Workbook</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{course.title} · {lesson.title}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Chi tiết lượt Sách bài tập</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{attempt.blockTitle}</p>
          </div>
        </div>

        <Card className={cn(attempt.passed ? "border-emerald-300" : "border-amber-300")}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col items-center gap-2 text-center">
              {pendingReview
                ? <ClipboardList className="h-10 w-10 text-amber-600" />
                : attempt.passed
                ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                : <XCircle className="h-10 w-10 text-amber-600" />}
              <p className={cn("text-lg font-bold", attempt.passed ? "text-emerald-700" : "text-amber-700")}>
                {pendingReview ? "Chờ chấm" : attempt.passed ? "Đạt" : "Chưa đạt"}
              </p>
              {!pendingReview && <p className="mt-1 text-4xl font-bold tabular-nums">{score}%</p>}
              <p className="text-sm text-muted-foreground tabular-nums">
                {pendingReview
                  ? `${attempt.results.filter((result) => result.teacherReviewPending).length} câu đang cần chấm`
                  : `Đúng ${attempt.correctCount ?? 0}/${attempt.totalCount ?? 0} câu có đáp án`}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
              </p>
            </div>
            {!pendingReview && <Progress value={score} className="h-2" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chấm điểm chi tiết</CardTitle>
            <CardDescription>
              Đáp án học viên đã chọn và answer key của từng câu.
              {attempt.ungradableCount > 0 ? ` ${attempt.ungradableCount} câu chưa có đáp án nên không tính điểm.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {pendingReview && (
              <Form method="post" className="space-y-4 rounded-lg border border-amber-300 bg-amber-50/50 p-4">
                <input type="hidden" name="intent" value="grade-workbook" />
                <p className="text-sm font-medium">Chấm các câu đang chờ. Hãy đối chiếu đáp án học viên với đáp án chuẩn.</p>
                {actionData?.error && <p role="alert" className="text-sm text-destructive">{actionData.error}</p>}
                <div className="space-y-3">
                  {attempt.results.filter((result) => result.teacherReviewPending).map((result) => (
                    <label key={result.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm">
                      <span>
                        <strong>Câu {result.number}:</strong> Học viên trả lời {result.givenLabel || "bỏ trống"} · Đáp án chuẩn: {result.correctAnswer || "chưa cấu hình"}
                      </span>
                      <select name={`grade-${result.id}`} required defaultValue="" className="rounded-md border bg-background px-2 py-1.5">
                        <option value="" disabled>Chọn kết quả</option>
                        <option value="correct">Đúng</option>
                        <option value="incorrect">Sai</option>
                      </select>
                    </label>
                  ))}
                </div>
                <Button type="submit">Lưu điểm</Button>
              </Form>
            )}
            {groupedResults.length === 0 ? (
              <EmptyState title="Không có chi tiết câu trả lời" message="Lượt này chưa lưu kết quả từng câu." />
            ) : groupedResults.map((group) => (
              <section key={group.id} className="space-y-3">
                <h2 className="border-b pb-2 font-semibold">{group.title}</h2>
                {group.results.map((result) => (
                  <div
                    key={result.id}
                    className={cn(
                      "space-y-1.5 rounded-lg border p-3",
                      result.correct === true
                        ? "border-emerald-300 bg-emerald-50/60"
                        : result.correct === false
                          ? "border-rose-300 bg-rose-50/60"
                          : "border-border bg-muted/30",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {result.correct === true
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        : result.correct === false
                          ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                          : <span className="mt-0.5 h-4 w-4 shrink-0 text-center text-xs text-muted-foreground">—</span>}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">Câu {result.number}</span>
                          <p className="content-text hanzi-display font-medium">{result.prompt || result.passage || "Câu hỏi"}</p>
                          <span className="text-xs text-muted-foreground">
                            {result.teacherReviewPending
                              ? "Chờ giáo viên chấm"
                              : result.correct === null
                                ? "Không tính điểm"
                                : result.correct ? "Đúng · 1 điểm" : "Sai · 0 điểm"}
                          </span>
                        </div>
                        {result.passage && result.prompt && <p className="content-text hanzi-display whitespace-pre-line text-sm">{result.passage}</p>}
                        <p className="content-text text-sm">
                          <span className="text-muted-foreground">Học viên chọn: </span>
                          {result.givenLabel || <span className="italic text-muted-foreground">bỏ trống</span>}
                        </p>
                        {result.gradable && result.correct !== true && (
                          <p className="content-text text-sm">
                            <span className="text-muted-foreground">Đáp án đúng: </span>
                            <span className="font-medium">{result.correctAnswer}</span>
                          </p>
                        )}
                        {result.translation && <p className="content-text text-xs text-muted-foreground">{result.translation}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
