import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, BookOpen, CheckCircle2, ClipboardList, UserRound, XCircle } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { GRAMMAR_QUESTION_META, isGrammarQuestionType, type GrammarQuestionType } from "~/lib/grammar";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type GrammarQuestionResult = {
  id: string;
  prompt: string;
  type: GrammarQuestionType;
  given: string;
  givenTokens: string[] | null;
  correctAnswer: string;
  correct: boolean;
  points: number;
  hint: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGrammarResults(details: unknown): GrammarQuestionResult[] {
  if (!isRecord(details) || !Array.isArray(details.results)) return [];
  return details.results.flatMap((item): GrammarQuestionResult[] => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.prompt !== "string") return [];
    if (!isGrammarQuestionType(item.type) || typeof item.given !== "string") return [];
    if (typeof item.correctAnswer !== "string" || typeof item.correct !== "boolean") return [];
    return [{
      id: item.id,
      prompt: item.prompt,
      type: item.type,
      given: item.given,
      givenTokens: Array.isArray(item.givenTokens) && item.givenTokens.every((token) => typeof token === "string")
        ? item.givenTokens
        : null,
      correctAnswer: item.correctAnswer,
      correct: item.correct,
      points: typeof item.points === "number" ? item.points : 1,
      hint: typeof item.hint === "string" ? item.hint : null,
    }];
  });
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
      tab: "GRAMMAR",
    },
  });
  if (!attempt) throw new Response("Không tìm thấy lượt luyện tập Ngữ pháp", { status: 404 });

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
      sectionTitle: typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ pháp",
      questionType: isGrammarQuestionType(details.questionType) ? details.questionType : null,
      results: readGrammarResults(attempt.details),
    },
  };
}

export default function TeacherGrammarAttemptDetail() {
  const { user, course, lesson, student, attempt } = useLoaderData<typeof loader>();
  const historyUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/grammar-history`;
  const score = attempt.score ?? 0;

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={historyUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại lịch sử Ngữ pháp</Link>
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Chi tiết lượt luyện tập</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {attempt.sectionTitle}{attempt.questionType ? ` · ${GRAMMAR_QUESTION_META[attempt.questionType].label}` : ""}
            </p>
          </div>
        </div>

        <Card className={cn(attempt.passed ? "border-emerald-300" : "border-rose-300")}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col items-center gap-2 text-center">
              {attempt.passed
                ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                : <XCircle className="h-10 w-10 text-rose-600" />}
              <p className={cn("text-lg font-bold", attempt.passed ? "text-emerald-700" : "text-rose-700")}>
                {attempt.passed ? "Đạt" : "Chưa đạt"}
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{score}%</p>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
              </p>
            </div>
            <Progress value={score} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chi tiết từng câu</CardTitle>
            <CardDescription>Đáp án học viên đã nộp, đáp án chuẩn và kết quả chấm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attempt.results.length === 0 ? (
              <EmptyState title="Không có chi tiết câu trả lời" message="Lượt làm này chưa lưu đáp án từng câu." />
            ) : (
              attempt.results.map((result, index) => (
                <div
                  key={`${result.id}-${index}`}
                  className={cn(
                    "space-y-1.5 rounded-lg border p-3",
                    result.correct ? "border-emerald-300 bg-emerald-50/60" : "border-rose-300 bg-rose-50/60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {result.correct
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                        <p className="font-medium">{result.prompt}</p>
                        <span className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {GRAMMAR_QUESTION_META[result.type].label}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {result.correct ? result.points : 0}/{result.points} điểm
                        </span>
                      </div>
                      {result.type === "ARRANGE" && result.givenTokens && (
                        <p className="pl-5 text-xs text-muted-foreground">Từ đã chọn: {result.givenTokens.join(" / ")}</p>
                      )}
                      <p className="text-sm">
                        <span className="text-muted-foreground">Học viên trả lời: </span>
                        {result.given || <span className="italic text-muted-foreground">bỏ trống</span>}
                      </p>
                      {!result.correct && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Đáp án đúng: </span>
                          <span className="font-medium">{result.correctAnswer}</span>
                        </p>
                      )}
                      {result.hint && <p className="whitespace-pre-line text-xs text-muted-foreground">{result.hint}</p>}
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
