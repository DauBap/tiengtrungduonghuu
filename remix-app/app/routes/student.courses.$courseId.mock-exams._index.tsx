import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, Clock3, FileCheck2, History } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const [course, enrolled] = await Promise.all([
    getCourseById(params.courseId!),
    isEnrolled(user.id, params.courseId!),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!enrolled) throw new Response("Bạn không thuộc khóa học này", { status: 403 });

  const exams = await prisma.mockExam.findMany({
    where: { courseId: course.id, isPublished: true },
    orderBy: { createdAt: "asc" },
    include: {
      sections: { include: { _count: { select: { questions: true } } } },
      attempts: {
        where: { userId: user.id, status: "SUBMITTED" },
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: { percentage: true, passed: true, submittedAt: true },
      },
    },
  });
  return {
    user,
    course: { id: course.id, title: course.title, code: course.code, hskLevel: course.hskLevel },
    exams: exams.map((exam) => ({
      ...exam,
      questionCount: exam.sections.reduce((total, section) => total + section._count.questions, 0),
      lastAttempt: exam.attempts[0] ? {
        percentage: exam.attempts[0].percentage,
        passed: exam.attempts[0].passed,
        submittedAt: exam.attempts[0].submittedAt?.toISOString() ?? null,
      } : null,
      sections: undefined,
      attempts: undefined,
    })),
  };
}

export default function StudentMockExamList() {
  const { user, course, exams } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">HSK {course.hskLevel} · {course.code}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Bài thi thử</h1>
          <p className="mt-1 text-sm text-muted-foreground">{course.title} · Khu vực thi riêng, không ảnh hưởng tiến độ bài học.</p>
        </div>

        {exams.length === 0 ? (
          <EmptyState icon={<FileCheck2 className="h-10 w-10" />} title="Chưa có bài thi thử"
            message="Khóa học này hiện chưa có bài thi thử được phát hành." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {exams.map((exam, index) => (
              <Card key={exam.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Đề số {index + 1}</span>
                    {exam.lastAttempt && <span className="text-sm font-semibold">{exam.lastAttempt.percentage}%</span>}
                  </div>
                  <CardTitle className="pt-2">{exam.title}</CardTitle>
                  <CardDescription>{exam.description || "Bài thi thử tổng hợp"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><FileCheck2 className="h-4 w-4" />{exam.questionCount} câu hỏi</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" />{exam.durationMinutes ? `${exam.durationMinutes} phút` : "Không giới hạn"}</span>
                  </div>
                  {exam.lastAttempt && (
                    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <History className="h-3.5 w-3.5" />Lần gần nhất: {exam.lastAttempt.passed ? "Đạt" : "Chưa đạt"}
                    </p>
                  )}
                  <Button asChild className="w-full">
                    <Link to={`/student/courses/${course.id}/mock-exams/${exam.id}`}>Xem đề và bắt đầu</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
