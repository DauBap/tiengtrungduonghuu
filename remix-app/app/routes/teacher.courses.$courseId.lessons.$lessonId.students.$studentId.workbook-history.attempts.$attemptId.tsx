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
      points: typeof item.points === "number" ? item.points : 0,
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
              {attempt.passed
                ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                : <XCircle className="h-10 w-10 text-amber-600" />}
              <p className={cn("text-lg font-bold", attempt.passed ? "text-emerald-700" : "text-amber-700")}>
                {attempt.passed ? "Đạt" : "Chưa đạt"}
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{score}%</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                Đúng {attempt.correctCount ?? 0}/{attempt.totalCount ?? 0} câu có đáp án
              </p>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
              </p>
            </div>
            <Progress value={score} className="h-2" />
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
                          <p className="font-medium">{result.prompt || result.passage || "Câu hỏi"}</p>
                          <span className="text-xs text-muted-foreground">
                            {result.correct === null ? "Không tính điểm" : result.correct ? "Đúng · 1 điểm" : "Sai · 0 điểm"}
                          </span>
                        </div>
                        {result.passage && result.prompt && <p className="whitespace-pre-line text-sm">{result.passage}</p>}
                        <p className="text-sm">
                          <span className="text-muted-foreground">Học viên chọn: </span>
                          {result.givenLabel || <span className="italic text-muted-foreground">bỏ trống</span>}
                        </p>
                        {result.gradable && result.correct !== true && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">Đáp án đúng: </span>
                            <span className="font-medium">{result.correctAnswer}</span>
                          </p>
                        )}
                        {result.translation && <p className="text-xs text-muted-foreground">{result.translation}</p>}
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
