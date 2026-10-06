import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, ClipboardList, UserRound } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

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

  const attempts = await prisma.mockExamAttempt.findMany({
    where: { mockExamId: mockExam.id, userId: enrollment.user.id },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      percentage: true,
      passed: true,
      earnedPoints: true,
      totalPoints: true,
    },
  });

  return {
    user,
    course: { id: course.id, title: course.title },
    mockExam,
    student: enrollment.user,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
    })),
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TeacherMockExamStudentHistory() {
  const { user, course, mockExam, student, attempts } = useLoaderData<typeof loader>();
  const progressUrl = `/teacher/courses/${course.id}/progress/mock-exams/${mockExam.id}`;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to={progressUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại tiến độ bài thi thử</Link>
        </Button>

        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{course.title} · {mockExam.title}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Lịch sử làm bài</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Các lần làm bài ({attempts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {attempts.length === 0 ? (
              <EmptyState title="Chưa có lịch sử làm bài" message="Học viên chưa bắt đầu bài thi thử này." />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-16 px-4 py-3 font-medium">Lần</th>
                      <th scope="col" className="px-4 py-3 font-medium">Bắt đầu</th>
                      <th scope="col" className="px-4 py-3 font-medium">Nộp bài</th>
                      <th scope="col" className="px-4 py-3 font-medium">Kết quả</th>
                      <th scope="col" className="px-4 py-3 font-medium">Điểm</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {attempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td className="px-4 py-3 font-medium tabular-nums">{attempt.attemptNumber}</td>
                        <td className="px-4 py-3">{formatDate(attempt.startedAt)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {attempt.submittedAt ? formatDate(attempt.submittedAt) : "Chưa nộp"}
                        </td>
                        <td className="px-4 py-3">
                          {attempt.status === "IN_PROGRESS"
                            ? "Đang làm"
                            : attempt.passed === true
                              ? "Đạt"
                              : attempt.passed === false
                                ? "Chưa đạt"
                                : "Đã nộp"}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {attempt.percentage == null ? "—" : `${attempt.percentage}%`}
                          {attempt.earnedPoints != null && attempt.totalPoints != null
                            ? <span className="ml-1 text-muted-foreground">({attempt.earnedPoints}/{attempt.totalPoints})</span>
                            : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link to={`${progressUrl}/students/${student.id}/attempts/${attempt.id}`}>Xem chi tiết</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
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
