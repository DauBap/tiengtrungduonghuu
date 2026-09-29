import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, BookOpen, ClipboardList, UserRound } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";

const ANSWER_MODE_LABELS: Record<string, string> = {
  chinese: "Chữ Hán",
  pinyin: "Pinyin",
};

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

  const attempts = await prisma.lessonTabAttempt.findMany({
    where: { userId: enrollment.userId, lessonId: lesson.id, tab: "LISTENING" },
    orderBy: { completedAt: "desc" },
  });

  return { user, course, lesson, student: enrollment.user, attempts };
}

export default function TeacherListeningHistory() {
  const { user, course, lesson, student, attempts } = useLoaderData<typeof loader>();
  const progressUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}?tab=LISTENING`;

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={progressUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại tiến độ Nghe câu</Link>
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Lịch sử Nghe câu</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />Các lượt làm ({attempts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attempts.length === 0 ? (
              <EmptyState title="Chưa có lịch sử Nghe câu" message="Học viên chưa hoàn thành lượt Nghe câu nào trong bài này." />
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-16 px-4 py-3 font-medium">Lần</th>
                      <th scope="col" className="px-4 py-3 font-medium">Thời gian</th>
                      <th scope="col" className="px-4 py-3 font-medium">Chế độ trả lời</th>
                      <th scope="col" className="px-4 py-3 font-medium">Số câu đúng / tổng</th>
                      <th scope="col" className="px-4 py-3 font-medium">Điểm</th>
                      <th scope="col" className="px-4 py-3 font-medium">Kết quả</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {attempts.map((attempt, index) => (
                      <tr key={attempt.id}>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{attempts.length - index}</td>
                        <td className="px-4 py-3">
                          {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(attempt.completedAt)}
                        </td>
                        <td className="px-4 py-3">
                          {attempt.mode ? ANSWER_MODE_LABELS[attempt.mode] ?? "Không lưu" : "Không lưu"}
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">
                          {attempt.correctCount != null && attempt.totalCount != null ? `${attempt.correctCount}/${attempt.totalCount}` : "-"}
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">
                          {attempt.score != null ? `${Math.round(attempt.score)}%` : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                            attempt.passed == null
                              ? "bg-slate-100 text-slate-600"
                              : attempt.passed
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700",
                          )}>
                            {attempt.passed == null ? "Chưa xác định" : attempt.passed ? "Đạt" : "Chưa đạt"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/listening-history/attempts/${attempt.id}`}>
                              Chi tiết
                            </Link>
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
