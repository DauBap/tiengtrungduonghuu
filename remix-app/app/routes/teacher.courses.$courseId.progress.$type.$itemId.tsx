import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, Eye, FileCheck2, RotateCcw } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, isTeacherOfCourse } from "~/lib/db.server";
import { isReviewAnswerCorrect } from "~/lib/review-answer";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });
  if (params.type !== "reviews" && params.type !== "mock-exams") {
    throw new Response("Không tìm thấy nội dung tiến độ", { status: 404 });
  }

  const classes = await prisma.class.findMany({
    where: { courseId: course.id, teacherId: user.id },
    select: { id: true, name: true, completedAt: true },
    orderBy: [{ completedAt: "asc" }, { name: "asc" }],
  });
  const requestedClassId = new URL(request.url).searchParams.get("classId");
  const selectedClass = requestedClassId
    ? classes.find((item) => item.id === requestedClassId) ?? null
    : classes.find((item) => item.completedAt === null) ?? classes[0] ?? null;
  if (requestedClassId && !selectedClass) {
    throw new Response("Không tìm thấy lớp học", { status: 404 });
  }
  const students = selectedClass
    ? await prisma.enrollment.findMany({
        where: { courseId: course.id, classId: selectedClass.id },
        select: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      })
    : [];
  const studentIds = students.map(({ user: student }) => student.id);
  const courseData = { id: course.id, title: course.title };

  if (params.type === "reviews") {
    const reviewSet = await prisma.courseReviewSet.findFirst({
      where: { id: params.itemId, courseId: course.id },
      select: {
        id: true,
        title: true,
        subtitle: true,
        _count: { select: { questions: true } },
        questions: {
          orderBy: [{ order: "asc" }, { id: "asc" }],
          select: { id: true, prompt: true, answer: true, acceptedAnswers: true },
        },
      },
    });
    if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

    const attempts = studentIds.length === 0
      ? []
      : await prisma.courseReviewAttempt.findMany({
          where: { reviewSetId: reviewSet.id, userId: { in: studentIds } },
          orderBy: { completedAt: "desc" },
          select: {
            id: true,
            userId: true,
            answers: true,
            correctCount: true,
            totalQuestions: true,
            percentage: true,
            completedAt: true,
          },
        });
    const attemptsByStudent = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const previous = attemptsByStudent.get(attempt.userId) ?? [];
      previous.push(attempt);
      attemptsByStudent.set(attempt.userId, previous);
    }

    return {
      user,
      course: courseData,
      classes: classes.map(({ id, name }) => ({ id, name })),
      selectedClass: selectedClass ? { id: selectedClass.id, name: selectedClass.name } : null,
      item: {
        id: reviewSet.id,
        type: "reviews" as const,
        title: reviewSet.title,
        subtitle: reviewSet.subtitle,
        questionCount: reviewSet._count.questions,
      },
      students: students.map(({ user: student }) => {
        const studentAttempts = attemptsByStudent.get(student.id) ?? [];
        const latest = studentAttempts[0];
        return {
          ...student,
          attemptCount: studentAttempts.length,
          reviewAttempts: studentAttempts.map((attempt) => {
            const submittedAnswers = isRecord(attempt.answers) ? attempt.answers : {};
            return {
              id: attempt.id,
              percentage: attempt.percentage,
              correctCount: attempt.correctCount,
              totalQuestions: attempt.totalQuestions,
              date: attempt.completedAt.toISOString(),
              answers: reviewSet.questions.map((question) => {
                const submitted = submittedAnswers[question.id];
                const answer = typeof submitted === "string" ? submitted : "";
                return {
                  prompt: question.prompt,
                  answer,
                  correctAnswer: question.answer,
                  correct: isReviewAnswerCorrect(answer, [question.answer, ...question.acceptedAnswers]),
                };
              }),
            };
          }),
          latest: latest ? {
            status: "Hoàn thành",
            summary: `${latest.correctCount}/${latest.totalQuestions} câu`,
            percentage: latest.percentage,
            date: latest.completedAt.toISOString(),
          } : null,
        };
      }),
    };
  }

  const mockExam = await prisma.mockExam.findFirst({
    where: { id: params.itemId, courseId: course.id },
    select: {
      id: true,
      title: true,
      description: true,
      isPublished: true,
      sections: { select: { _count: { select: { questions: true } } } },
    },
  });
  if (!mockExam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });

  const attempts = studentIds.length === 0
    ? []
    : await prisma.mockExamAttempt.findMany({
        where: { mockExamId: mockExam.id, userId: { in: studentIds } },
        orderBy: { startedAt: "desc" },
        select: {
          userId: true,
          status: true,
          percentage: true,
          passed: true,
          startedAt: true,
          submittedAt: true,
        },
      });
  const attemptsByStudent = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const previous = attemptsByStudent.get(attempt.userId) ?? [];
    previous.push(attempt);
    attemptsByStudent.set(attempt.userId, previous);
  }

  return {
    user,
    course: courseData,
    classes: classes.map(({ id, name }) => ({ id, name })),
    selectedClass: selectedClass ? { id: selectedClass.id, name: selectedClass.name } : null,
    item: {
      id: mockExam.id,
      type: "mock-exams" as const,
      title: mockExam.title,
      subtitle: mockExam.description ?? "",
      questionCount: mockExam.sections.reduce((total, section) => total + section._count.questions, 0),
      isPublished: mockExam.isPublished,
    },
    students: students.map(({ user: student }) => {
      const studentAttempts = attemptsByStudent.get(student.id) ?? [];
      const latest = studentAttempts[0];
      return {
        ...student,
        attemptCount: studentAttempts.length,
        latest: latest ? {
          status: latest.status === "IN_PROGRESS"
            ? "Đang làm"
            : latest.passed === true
              ? "Đạt"
              : latest.passed === false
                ? "Chưa đạt"
                : "Đã nộp",
          summary: null,
          percentage: latest.percentage,
          date: latest.submittedAt?.toISOString() ?? latest.startedAt.toISOString(),
        } : null,
      };
    }),
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function TeacherCourseItemProgress() {
  const { user, course, classes, selectedClass, item, students } = useLoaderData<typeof loader>();
  const isReview = item.type === "reviews";

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/teacher/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại danh sách bài học</Link>
        </Button>

        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {isReview ? <RotateCcw className="h-5 w-5" /> : <FileCheck2 className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {isReview ? "Ôn tập" : "Bài thi thử"}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{item.title}</h1>
            {item.subtitle && <p className="mt-1 text-sm text-muted-foreground">{item.subtitle}</p>}
            <p className="mt-1 text-sm text-muted-foreground">
              {item.questionCount} câu · {selectedClass?.name ?? "Chưa chọn lớp"} · {students.length} học viên
            </p>
            {!isReview && !item.isPublished && (
              <p className="mt-1 text-xs font-medium text-amber-700">Đề chưa phát hành; chưa thể làm trên tài khoản học viên.</p>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <CardTitle className="text-base">Tiến độ học viên</CardTitle>
              {classes.length > 0 && (
                <form method="get" className="flex flex-wrap items-end gap-2">
                  <label htmlFor="progress-class" className="text-sm font-medium">Lớp</label>
                  <select
                    id="progress-class"
                    name="classId"
                    defaultValue={selectedClass?.id ?? ""}
                    className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {classes.map((classOption) => (
                      <option key={classOption.id} value={classOption.id}>{classOption.name}</option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline">Xem lớp</Button>
                </form>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedClass ? (
              <EmptyState title="Chưa có lớp phụ trách" message={`Bạn chưa có lớp nào trong khóa ${course.title}.`} />
            ) : students.length === 0 ? (
              <EmptyState title="Lớp chưa có học viên" message={`Lớp ${selectedClass.name} hiện chưa có học viên.`} />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className={`w-full text-left text-sm ${isReview ? "min-w-[900px]" : ""}`}>
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                      <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                      <th scope="col" className="px-4 py-3 font-medium">Tiến độ mới nhất</th>
                      <th scope="col" className="px-4 py-3 font-medium">Số lần làm</th>
                      <th scope="col" className="px-4 py-3 font-medium">Thời gian</th>
                      {isReview && <th scope="col" className="px-4 py-3 font-medium">Bài làm</th>}
                      {!isReview && <th scope="col" className="px-4 py-3 text-right font-medium">Lịch sử</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {students.map((student, index) => {
                      const latest = student.latest;

                      return (
                        <tr key={student.id}>
                          <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{student.name ?? "Học viên"}</p>
                            <p className="text-xs text-muted-foreground">{student.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium">{latest?.status ?? "Chưa bắt đầu"}</span>
                            {latest?.summary && <span className="ml-2 text-muted-foreground">{latest.summary}</span>}
                            {latest?.percentage != null && (
                              <span className="ml-2 text-muted-foreground tabular-nums">
                                {latest.percentage}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{student.attemptCount}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(latest?.date ?? null)}</td>
                          {isReview && "reviewAttempts" in student && (
                            <td className="px-4 py-3">
                              {student.reviewAttempts.length > 0 ? (
                                <details className="max-w-[34rem]">
                                  <summary className="w-fit cursor-pointer rounded-md px-2 py-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    Xem {student.reviewAttempts.length} lượt làm
                                  </summary>
                                  <ol className="mt-3 space-y-3">
                                    {student.reviewAttempts.map((attempt, attemptIndex) => (
                                      <li key={attempt.id} className="rounded-md border bg-background p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <p className="font-medium">Lượt {student.reviewAttempts.length - attemptIndex}</p>
                                          <span className="text-xs tabular-nums text-muted-foreground">
                                            {attempt.correctCount}/{attempt.totalQuestions} câu · {attempt.percentage}%
                                          </span>
                                        </div>
                                        <time className="mt-1 block text-xs text-muted-foreground" dateTime={attempt.date}>
                                          {formatDate(attempt.date)}
                                        </time>
                                        <ol className="mt-3 space-y-2">
                                          {attempt.answers.map((answer, answerIndex) => (
                                            <li key={`${attempt.id}-${answerIndex}`} className="rounded bg-muted/40 p-2.5">
                                              <p className="text-xs font-medium text-muted-foreground">
                                                Câu {answerIndex + 1}
                                                <span className={`ml-2 ${answer.correct ? "text-emerald-700" : "text-rose-700"}`}>
                                                  {answer.correct ? "Đúng" : "Chưa đúng"}
                                                </span>
                                              </p>
                                              <p className="mt-1 whitespace-pre-wrap break-words font-medium">{answer.prompt}</p>
                                              <p className="mt-1 whitespace-pre-wrap break-words">
                                                <span className="text-muted-foreground">Học viên: </span>
                                                {answer.answer || <span className="italic text-muted-foreground">Bỏ trống</span>}
                                              </p>
                                              {!answer.correct && (
                                                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                                  <span className="font-medium text-foreground">Đáp án: </span>{answer.correctAnswer}
                                                </p>
                                              )}
                                            </li>
                                          ))}
                                        </ol>
                                      </li>
                                    ))}
                                  </ol>
                                </details>
                              ) : (
                                <span className="text-muted-foreground">Chưa nộp bài</span>
                              )}
                            </td>
                          )}
                          {!isReview && (
                            <td className="px-4 py-3 text-right">
                              <Button asChild size="sm" variant="outline">
                                <Link to={`/teacher/courses/${course.id}/progress/mock-exams/${item.id}/students/${student.id}`}>
                                  <Eye className="mr-1.5 h-4 w-4" />Chi tiết
                                </Link>
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
