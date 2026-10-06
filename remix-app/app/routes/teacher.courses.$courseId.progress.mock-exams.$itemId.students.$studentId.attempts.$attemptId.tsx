import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { getCourseById, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";

interface SnapshotOption {
  id: string;
  content: string;
  imageUrl: string | null;
  isCorrect: boolean;
}

interface SnapshotQuestion {
  id: string;
  prompt: string;
  imageUrl: string | null;
  points: number;
  options: SnapshotOption[];
}

interface SnapshotSection {
  title: string;
  questions: SnapshotQuestion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSnapshot(raw: Prisma.JsonValue): SnapshotSection[] {
  if (!Array.isArray(raw)) throw new Response("Dữ liệu đề thi không hợp lệ", { status: 500 });
  return raw.map((rawSection) => {
    if (!isRecord(rawSection) || !Array.isArray(rawSection.questions)) {
      throw new Response("Dữ liệu phần thi không hợp lệ", { status: 500 });
    }
    return {
      title: typeof rawSection.title === "string" ? rawSection.title : "",
      questions: rawSection.questions.map((rawQuestion): SnapshotQuestion => {
        if (!isRecord(rawQuestion) || !Array.isArray(rawQuestion.options)) {
          throw new Response("Dữ liệu câu hỏi không hợp lệ", { status: 500 });
        }
        return {
          id: typeof rawQuestion.id === "string" ? rawQuestion.id : "",
          prompt: typeof rawQuestion.prompt === "string" ? rawQuestion.prompt : "",
          imageUrl: typeof rawQuestion.imageUrl === "string" ? rawQuestion.imageUrl : null,
          points: typeof rawQuestion.points === "number" ? rawQuestion.points : 0,
          options: rawQuestion.options.map((rawOption): SnapshotOption => {
            if (!isRecord(rawOption)) throw new Response("Dữ liệu đáp án không hợp lệ", { status: 500 });
            return {
              id: typeof rawOption.id === "string" ? rawOption.id : "",
              content: typeof rawOption.content === "string" ? rawOption.content : "",
              imageUrl: typeof rawOption.imageUrl === "string" ? rawOption.imageUrl : null,
              isCorrect: rawOption.isCorrect === true,
            };
          }),
        };
      }),
    };
  });
}

function readAnswers(raw: Prisma.JsonValue): Record<string, string[]> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([questionId, value]) =>
    Array.isArray(value)
      ? [[questionId, value.filter((optionId): optionId is string => typeof optionId === "string")]]
      : [],
  ));
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!await isTeacherOfCourse(user.id, course.id)) throw new Response("Không có quyền truy cập", { status: 403 });

  const [mockExam, enrollment] = await Promise.all([
    prisma.mockExam.findFirst({
      where: { id: params.itemId, courseId: course.id },
      select: { id: true, title: true },
    }),
    prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  if (!mockExam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  const attempt = await prisma.mockExamAttempt.findFirst({
    where: {
      id: params.attemptId,
      mockExamId: mockExam.id,
      userId: enrollment.user.id,
    },
  });
  if (!attempt) throw new Response("Không tìm thấy lượt làm bài", { status: 404 });

  const sections = readSnapshot(attempt.questionSnapshot);
  const answers = readAnswers(attempt.answers);
  const submitted = attempt.status === "SUBMITTED";
  const questions = sections.flatMap((section) => section.questions);
  const answeredCount = questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length;

  return {
    user,
    course: { id: course.id, title: course.title },
    mockExam,
    student: enrollment.user,
    attempt: {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      percentage: attempt.percentage,
      earnedPoints: attempt.earnedPoints,
      totalPoints: attempt.totalPoints,
      passed: attempt.passed,
      answeredCount,
      questionCount: questions.length,
      sections: sections.map((section) => ({
        title: section.title,
        questions: section.questions.map((question) => {
          const selectedIds = new Set(answers[question.id] ?? []);
          const correctIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);
          const correct = submitted && correctIds.length > 0
            && selectedIds.size === correctIds.length
            && [...selectedIds].every((id) => correctIds.includes(id));
          return {
            id: question.id,
            prompt: question.prompt,
            imageUrl: question.imageUrl,
            points: question.points,
            selectedCount: selectedIds.size,
            correct,
            options: question.options.map((option) => ({
              ...option,
              selected: selectedIds.has(option.id),
              showCorrect: submitted && option.isCorrect,
            })),
          };
        }),
      })),
    },
  };
}

function formatDate(value: string | null) {
  if (!value) return "Chưa nộp";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TeacherMockExamAttemptDetail() {
  const { user, course, mockExam, student, attempt } = useLoaderData<typeof loader>();
  const historyUrl = `/teacher/courses/${course.id}/progress/mock-exams/${mockExam.id}/students/${student.id}`;
  const submitted = attempt.status === "SUBMITTED";
  const passed = attempt.passed === true;
  let questionNumber = 0;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to={historyUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại lịch sử làm bài</Link>
        </Button>

        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{course.title} · {mockExam.title}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Chi tiết lần làm bài {attempt.attemptNumber}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{student.name ?? "Học viên"} · {student.email}</p>
          </div>
        </div>

        <Card className={cn(submitted && (passed ? "border-emerald-300" : "border-rose-300"))}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-col items-center gap-2 text-center">
              {submitted && (passed
                ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                : <XCircle className="h-10 w-10 text-rose-600" />)}
              <p className="text-lg font-bold">
                {submitted ? passed ? "Đạt" : "Chưa đạt" : "Đang làm"}
              </p>
              {attempt.percentage != null && <p className="text-4xl font-bold tabular-nums">{attempt.percentage}%</p>}
              {attempt.earnedPoints != null && attempt.totalPoints != null && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {attempt.earnedPoints}/{attempt.totalPoints} điểm
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {attempt.answeredCount}/{attempt.questionCount} câu đã trả lời · Bắt đầu {formatDate(attempt.startedAt)}
              </p>
              {attempt.submittedAt && <p className="text-sm text-muted-foreground">Nộp bài {formatDate(attempt.submittedAt)}</p>}
            </div>
            {attempt.percentage != null && <Progress value={attempt.percentage} className="h-2" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chi tiết câu trả lời</CardTitle>
            <CardDescription>
              {submitted
                ? "Đáp án học sinh được đối chiếu với đáp án đúng đã lưu của lượt làm."
                : "Đáp án đúng được ẩn cho tới khi học sinh nộp bài."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {attempt.questionCount === 0 ? (
              <EmptyState title="Không có câu hỏi" message="Lượt làm này không lưu dữ liệu câu hỏi." />
            ) : attempt.sections.map((section, sectionIndex) => (
              <section key={`${section.title}-${sectionIndex}`} className="space-y-4 border-t pt-5 first:border-0 first:pt-0">
                <h2 className="font-semibold">{section.title}</h2>
                {section.questions.map((question) => {
                  questionNumber += 1;
                  return (
                    <article key={question.id} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Câu {questionNumber}</h3>
                          {question.prompt && <p className="mt-1 whitespace-pre-wrap text-sm">{question.prompt}</p>}
                        </div>
                        {submitted && (
                          <span className={cn(
                            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                            question.correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
                          )}>
                            {question.correct ? "Đúng" : "Sai"}
                          </span>
                        )}
                      </div>
                      {question.imageUrl && (
                        <img src={question.imageUrl} alt={`Hình câu ${questionNumber}`} className="max-h-72 max-w-full rounded-md border object-contain" />
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {question.options.map((option, optionIndex) => (
                          <div
                            key={option.id}
                            className={cn(
                              "flex items-start gap-2 rounded-md border p-3 text-sm",
                              option.selected && "border-primary bg-primary/5",
                              option.showCorrect && "border-emerald-400 bg-emerald-50",
                            )}
                          >
                            <span className="font-semibold text-muted-foreground">{String.fromCharCode(65 + optionIndex)}.</span>
                            <div className="min-w-0 flex-1">
                              {option.content && <p className="whitespace-pre-wrap">{option.content}</p>}
                              {option.imageUrl && <img src={option.imageUrl} alt={`Lựa chọn ${String.fromCharCode(65 + optionIndex)}`} className="mt-2 max-h-48 max-w-full object-contain" />}
                              {option.selected && <p className="mt-1 text-xs font-medium text-primary">Học sinh chọn</p>}
                              {option.showCorrect && <p className="mt-1 text-xs font-medium text-emerald-700">Đáp án đúng</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {!question.options.some((option) => option.selected) && (
                        <p className="text-xs text-muted-foreground">Học sinh chưa chọn đáp án.</p>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
