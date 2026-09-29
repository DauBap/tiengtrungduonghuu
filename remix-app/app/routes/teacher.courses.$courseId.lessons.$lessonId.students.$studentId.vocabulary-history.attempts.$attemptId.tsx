import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, BookOpen, CheckCircle2, ClipboardList, UserRound, XCircle } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type SavedQuestionResult = {
  id: string;
  prompt: string;
  lessonPinyin: string;
  typeLabel: string;
  points: number;
  correct: boolean;
  given: string;
  correctAnswer: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readQuestionResults(details: unknown): SavedQuestionResult[] {
  if (!isRecord(details) || !Array.isArray(details.results)) return [];

  return details.results.flatMap((item): SavedQuestionResult[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.prompt !== "string") return [];
    if (typeof item.correct !== "boolean" || typeof item.given !== "string" || typeof item.correctAnswer !== "string") return [];
    return [{
      id: item.id,
      prompt: item.prompt,
      lessonPinyin: typeof item.lessonPinyin === "string" ? item.lessonPinyin : "",
      typeLabel: typeof item.typeLabel === "string" ? item.typeLabel : "",
      points: typeof item.points === "number" ? item.points : 1,
      correct: item.correct,
      given: item.given,
      correctAnswer: item.correctAnswer,
    }];
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

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
      tab: "VOCABULARY_TEST",
    },
  });
  if (!attempt) throw new Response("Không tìm thấy lần làm bài", { status: 404 });

  const details = isRecord(attempt.details) ? attempt.details : {};
  const earnedPoints = typeof details.earnedPoints === "number" ? details.earnedPoints : attempt.correctCount ?? 0;
  const totalPoints = typeof details.totalPoints === "number" ? details.totalPoints : attempt.totalCount ?? 0;
  const passScore = typeof details.passScore === "number" ? details.passScore : null;
  const blankCount = typeof details.blankCount === "number" ? details.blankCount : 0;

  return {
    user,
    course,
    lesson,
    student: enrollment.user,
    attempt: {
      id: attempt.id,
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalCount: attempt.totalCount,
      passed: attempt.passed,
      completedAt: attempt.completedAt.toISOString(),
      earnedPoints,
      totalPoints,
      passScore,
      blankCount,
      results: readQuestionResults(attempt.details),
    },
  };
}

export default function TeacherVocabularyAttemptDetail() {
  const { user, course, lesson, student, attempt } = useLoaderData<typeof loader>();
  const historyUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/vocabulary-history`;
  const score = Math.round(attempt.score ?? 0);
  const passed = attempt.passed === true;

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={historyUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại lịch sử làm bài</Link>
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{course.title} · {lesson.title}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Chi tiết lần làm bài</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
              </p>
            </div>
          </div>
        </div>

        <Card className={cn(passed ? "border-emerald-300" : "border-rose-300")}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col items-center gap-2 text-center">
              {passed
                ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                : <XCircle className="h-10 w-10 text-rose-600" />}
              <p className={cn("text-lg font-bold", passed ? "text-emerald-700" : "text-rose-700")}>
                {passed ? "Đạt" : "Chưa đạt"}
              </p>
              {attempt.passScore != null && !passed && (
                <p className="text-sm text-muted-foreground">Cần từ {attempt.passScore}% trở lên.</p>
              )}
              <p className="mt-1 text-4xl font-bold tabular-nums">{score}%</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {attempt.earnedPoints}/{attempt.totalPoints} điểm · đúng {attempt.correctCount ?? 0}/{attempt.totalCount ?? 0} câu
                {attempt.blankCount > 0 ? ` · bỏ trống ${attempt.blankCount} câu` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
              </p>
            </div>
            <div className="space-y-1.5">
              <Progress value={score} className="h-2" />
              {attempt.passScore != null && <p className="text-right text-xs text-muted-foreground">Điểm đạt: {attempt.passScore}%</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chi tiết từng câu</CardTitle>
            <CardDescription>Đối chiếu câu trả lời với đáp án đúng của lần làm này.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attempt.results.length === 0 ? (
              <EmptyState
                title="Không có dữ liệu chi tiết từng câu"
                message="Lần làm này được ghi nhận trước khi hệ thống lưu đáp án từng câu. Các lần làm mới sẽ có đầy đủ chi tiết."
              />
            ) : (
              attempt.results.map((question, index) => (
                <div
                  key={`${question.id}-${index}`}
                  className={cn(
                    "space-y-1.5 rounded-lg border p-3",
                    question.correct ? "border-emerald-300 bg-emerald-50/60" : "border-rose-300 bg-rose-50/60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {question.correct
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                        <p className="font-medium">{question.prompt}</p>
                        {question.lessonPinyin && question.typeLabel === "Trung → Việt" && (
                          <p className="w-full pl-5 font-mono text-xs text-muted-foreground">{question.lessonPinyin}</p>
                        )}
                        {question.typeLabel && (
                          <span className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">{question.typeLabel}</span>
                        )}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {question.correct ? question.points : 0}/{question.points} điểm
                        </span>
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Bạn trả lời: </span>
                        {question.given
                          ? <span className={question.correct ? "text-emerald-700" : "text-rose-700"}>{question.given}</span>
                          : <span className="italic text-muted-foreground">bỏ trống</span>}
                      </p>
                      {!question.correct && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Đáp án đúng: </span>
                          <span className="font-medium">{question.correctAnswer}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
