import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { getCourseById, getCourseReviewSetById, isEnrolled } from "~/lib/db.server";
import { requireRole } from "~/lib/session.server";
import { isReviewAnswerCorrect } from "~/lib/review-answer";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const [course, enrolled] = await Promise.all([
    getCourseById(params.courseId!),
    isEnrolled(user.id, params.courseId!),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!enrolled) throw new Response("Bạn không thuộc khóa học này", { status: 403 });

  const reviewSet = await getCourseReviewSetById(course.id, params.reviewId!);
  if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

  const attempt = await prisma.courseReviewAttempt.findFirst({
    where: { reviewSetId: reviewSet.id, userId: user.id },
    orderBy: { completedAt: "desc" },
    select: {
      status: true,
      answers: true,
      grades: true,
      correctCount: true,
      totalQuestions: true,
      percentage: true,
      completedAt: true,
      returnedAt: true,
    },
  });
  const submittedAnswers = isRecord(attempt?.answers) ? attempt.answers : {};
  const gradesByQuestion = new Map<string, Record<string, unknown>>();
  if (Array.isArray(attempt?.grades)) {
    for (const grade of attempt.grades) {
      if (isRecord(grade) && typeof grade.questionId === "string") {
        gradesByQuestion.set(grade.questionId, grade);
      }
    }
  }
  const returnedResults = attempt?.status === "RETURNED"
    ? reviewSet.questions.map((question) => {
        const submitted = submittedAnswers[question.id];
        const answer = typeof submitted === "string" ? submitted : "";
        const grade = gradesByQuestion.get(question.id);
        const correct = typeof grade?.correct === "boolean"
          ? grade.correct
          : isQuestionCorrect(question, answer);
        return {
          prompt: question.prompt,
          answer,
          correctAnswer: question.answer,
          correct,
          teacherFeedback: typeof grade?.feedback === "string" ? grade.feedback : "",
        };
      })
    : null;

  return {
    user,
    course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
    latestAttempt: attempt ? {
      status: attempt.status,
      completedAt: attempt.completedAt.toISOString(),
      returnedAt: attempt.returnedAt?.toISOString() ?? null,
      correctCount: attempt.correctCount,
      totalQuestions: attempt.totalQuestions,
      percentage: attempt.percentage,
      results: returnedResults,
    } : null,
    reviewSet: {
      id: reviewSet.id,
      title: reviewSet.title,
      subtitle: reviewSet.subtitle,
      questions: reviewSet.questions.map((question) => ({
        id: question.id,
        direction: question.direction,
        type: question.type,
        prompt: question.prompt,
        tokens: question.tokens,
        order: question.order,
      })),
    },
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((answer) => typeof answer === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!await isEnrolled(user.id, course.id)) throw new Response("Bạn không thuộc khóa học này", { status: 403 });

  const reviewSet = await getCourseReviewSetById(course.id, params.reviewId!);
  if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

  const formData = await request.formData();
  if (formData.get("intent") !== "submit-review") throw new Response("Yêu cầu không hợp lệ", { status: 400 });

  const rawAnswers = formData.get("answers");
  if (typeof rawAnswers !== "string") throw new Response("Thiếu câu trả lời", { status: 400 });

  let parsedAnswers: unknown;
  try {
    parsedAnswers = JSON.parse(rawAnswers);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Response("Dữ liệu câu trả lời không hợp lệ", { status: 400 });
    throw error;
  }
  if (!isStringRecord(parsedAnswers)) {
    throw new Response("Dữ liệu câu trả lời không hợp lệ", { status: 400 });
  }

  const answers = Object.fromEntries(reviewSet.questions.map((question) => [
    question.id,
    parsedAnswers[question.id] ?? "",
  ]));
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
    select: { classId: true, class: { select: { teacherId: true } } },
  });
  if (!enrollment?.classId || !enrollment.class?.teacherId) {
    return { ok: false as const, error: "Lớp học chưa có giáo viên phụ trách để nhận bài ôn tập." };
  }
  const classId = enrollment.classId;
  const teacherId = enrollment.class.teacherId;
  const pendingAttempt = await prisma.courseReviewAttempt.findFirst({
    where: { reviewSetId: reviewSet.id, userId: user.id, status: { in: ["SUBMITTED", "GRADED"] } },
    select: { id: true },
  });
  if (pendingAttempt) {
    return { ok: false as const, error: "Bạn đã nộp một lượt và đang chờ giáo viên trả kết quả." };
  }

  await prisma.$transaction(async (transaction) => {
    const attempt = await transaction.courseReviewAttempt.create({
      data: {
        reviewSetId: reviewSet.id,
        userId: user.id,
        answers,
        totalQuestions: reviewSet.questions.length,
        correctCount: 0,
        percentage: 0,
        status: "SUBMITTED",
      },
      select: { id: true },
    });
    await transaction.userNotification.create({
      data: {
        recipientId: teacherId,
        actorId: user.id,
        kind: "REVIEW_GRADING_REQUEST",
        entityId: attempt.id,
        title: "Bài ôn tập cần chấm",
        message: `${user.name ?? "Học viên"} đã nộp bộ ôn tập “${reviewSet.title}”. Bạn hãy chấm bài nhé.`,
        targetUrl: `/teacher/courses/${course.id}/progress/reviews/${reviewSet.id}?classId=${encodeURIComponent(classId)}&attemptId=${encodeURIComponent(attempt.id)}`,
      },
    });
  });

  return { ok: true };
}

function isQuestionCorrect(question: { answer: string; acceptedAnswers?: string[] }, provided: string) {
  return isReviewAnswerCorrect(provided, [question.answer, ...(question.acceptedAnswers ?? [])]);
}

export default function StudentCourseReviewPage() {
  const { user, course, reviewSet, latestAttempt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const orderedQuestions = useMemo(
    () => [...reviewSet.questions].sort((a, b) => a.order - b.order),
    [reviewSet.questions]
  );

  useEffect(() => {
    if (fetcher.data?.ok === false) setSubmitted(false);
  }, [fetcher.data]);

  const currentQuestion = orderedQuestions[index];
  const hasPendingAttempt = latestAttempt?.status === "SUBMITTED" || latestAttempt?.status === "GRADED";
  const waitingForTeacher = submitted || hasPendingAttempt;
  const awaitingReturn = latestAttempt?.status === "GRADED";
  const canStartAttempt = !waitingForTeacher;

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  };

  if (orderedQuestions.length === 0) {
    return (
      <AppShell user={user}>
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <EmptyState title="Chưa có câu hỏi ôn tập" message="Bộ này hiện chưa có dữ liệu để luyện tập." />
        </div>
      </AppShell>
    );
  }

  const next = () => {
    if (index < orderedQuestions.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    fetcher.submit(
      { intent: "submit-review", answers: JSON.stringify(answers) },
      { method: "post" },
    );
    setSubmitted(true);
  };

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">Ôn tập</span>
                <span className="text-xs font-mono text-muted-foreground">{course.code}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{reviewSet.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{reviewSet.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Số câu</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-5 w-5 text-primary" />{orderedQuestions.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Dạng câu</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {new Set(orderedQuestions.map((q) => q.type === "REORDER" ? "Sắp xếp" : "Dịch")).size} loại
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Thời gian</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />Tự luyện, không giới hạn</CardContent>
          </Card>
        </div>

        {fetcher.data?.ok === false && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}

        {canStartAttempt && !started && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bắt đầu luyện tập</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Bộ ôn tập gồm các câu dịch và sắp xếp câu. Sau khi nộp, giáo viên sẽ chấm từng câu và trả kết quả cho bạn.
              </p>
              <Button type="button" className="w-full" onClick={() => setStarted(true)}>Bắt đầu ôn tập</Button>
            </CardContent>
          </Card>
        )}

        {started && !waitingForTeacher && currentQuestion && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">Câu {index + 1} / {orderedQuestions.length}</CardTitle>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {currentQuestion.direction === "VI2ZH" ? "Việt → Trung" : "Trung → Việt"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Câu hỏi</p>
                {currentQuestion.type === "REORDER" ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(currentQuestion.tokens ?? []).map((token, tokenIndex) => (
                        <span key={`${currentQuestion.id}-${tokenIndex}`} className="rounded-full border bg-background px-2.5 py-1 text-sm">{token}</span>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">Sắp xếp các từ thành câu đúng:</p>
                  </div>
                ) : (
                  <p className="content-text hanzi-display mt-3 text-xl font-semibold leading-relaxed">{currentQuestion.prompt}</p>
                )}
              </div>

              <label className="block text-sm font-medium">
                {currentQuestion.type === "REORDER" ? "Đáp án của bạn" : "Nhập đáp án"}
                <textarea
                  value={answers[currentQuestion.id] ?? ""}
                  onChange={(event) => setAnswer(currentQuestion.id, event.target.value)}
                  rows={currentQuestion.type === "REORDER" ? 2 : 4}
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-0 focus:border-primary"
                  placeholder={currentQuestion.type === "REORDER" ? "Viết câu hoàn chỉnh theo đúng thứ tự" : "Nhập đáp án của bạn..."}
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="outline" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                  Câu trước
                </Button>
                <Button type="button" onClick={next}>
                  {index === orderedQuestions.length - 1 ? "Nộp bài" : "Câu tiếp theo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {waitingForTeacher && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Đã nộp bài ôn tập</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-4">
                <Clock3 aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">
                    {fetcher.state !== "idle"
                      ? "Đang gửi bài..."
                      : awaitingReturn
                        ? "Giáo viên đã chấm, đang chờ trả kết quả"
                        : "Đang chờ giáo viên chấm"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Kết quả và nhận xét sẽ hiển thị sau khi giáo viên trả bài.
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {latestAttempt?.completedAt
                  ? `Đã nộp lúc ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(latestAttempt.completedAt))}`
                  : "Bài làm sẽ được gửi thông báo tới giáo viên."}
              </p>
            </CardContent>
          </Card>
        )}

        {!started && !submitted && latestAttempt?.status === "RETURNED" && latestAttempt.results && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Kết quả ôn tập</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-4">
                <CheckCircle2 aria-hidden="true" className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-lg font-semibold">{latestAttempt.correctCount}/{latestAttempt.totalQuestions} câu đúng</p>
                  <p className="text-sm text-muted-foreground">Điểm số: {latestAttempt.percentage}%</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground" role="status">
                Giáo viên đã trả kết quả
                {latestAttempt.returnedAt
                  ? ` lúc ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(latestAttempt.returnedAt))}`
                  : "."}
              </p>

              <div className="space-y-3">
                {latestAttempt.results.map((result, questionIndex) => (
                  <div key={`${questionIndex}-${result.prompt}`} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">Câu {questionIndex + 1}</p>
                      <span className={result.correct ? "text-green-600" : "text-red-600"}>
                        {result.correct ? "Đúng" : "Chưa đúng"}
                      </span>
                    </div>
                    <p className="content-text hanzi-display mt-2 text-sm text-muted-foreground">{result.prompt}</p>
                    <p className="content-text mt-2 whitespace-pre-wrap text-sm">
                      <span className="font-medium">Câu trả lời của bạn: </span>{result.answer || "(chưa trả lời)"}
                    </p>
                    <p className="content-text mt-1 whitespace-pre-wrap text-sm">
                      <span className="font-medium">Đáp án tham khảo: </span>{result.correctAnswer}
                    </p>
                    {result.teacherFeedback && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Nhận xét giáo viên: </span>{result.teacherFeedback}
                      </p>
                    )}
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
