import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { ArrowLeft, Clock3, FileCheck2, ListChecks } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import type { Prisma } from "@prisma/client";

function shuffle<T>(values: T[]) {
  const items = [...values];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const [course, enrolled] = await Promise.all([
    getCourseById(params.courseId!),
    isEnrolled(user.id, params.courseId!),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!enrolled) throw new Response("Bạn không thuộc khóa học này", { status: 403 });
  const exam = await prisma.mockExam.findFirst({
    where: { id: params.mockExamId!, courseId: course.id, isPublished: true },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: { _count: { select: { questions: true } } },
      },
      attempts: {
        where: { userId: user.id },
        orderBy: { attemptNumber: "desc" },
        select: { id: true, attemptNumber: true, status: true, percentage: true, passed: true, submittedAt: true },
      },
    },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });
  const activeAttempt = exam.attempts.find((attempt) => attempt.status === "IN_PROGRESS") ?? null;
  return {
    user,
    course: { id: course.id, title: course.title },
    exam: {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      passScore: exam.passScore,
      maxAttempts: exam.maxAttempts,
      questionCount: exam.sections.reduce((count, section) => count + section._count.questions, 0),
      sectionCount: exam.sections.length,
      submittedAttempts: exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
      activeAttempt,
      latestAttempt: exam.attempts.find((attempt) => attempt.status === "SUBMITTED") ?? null,
    },
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  const mockExamId = params.mockExamId!;
  if (!(await isEnrolled(user.id, courseId))) throw new Response("Bạn không thuộc khóa học này", { status: 403 });

  const exam = await prisma.mockExam.findFirst({
    where: { id: mockExamId, courseId, isPublished: true },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
      },
      attempts: {
        where: { userId: user.id },
        orderBy: { attemptNumber: "desc" },
        select: { id: true, attemptNumber: true, status: true },
      },
    },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });
  const inProgress = exam.attempts.find((attempt) => attempt.status === "IN_PROGRESS");
  if (inProgress) return redirect(`/student/courses/${courseId}/mock-exams/${mockExamId}/attempts/${inProgress.id}`);
  const submittedCount = exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length;
  if (exam.maxAttempts > 0 && submittedCount >= exam.maxAttempts) {
    return { error: "Bạn đã sử dụng hết số lượt làm bài cho đề này." };
  }

  const orderedSections = exam.sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    questions: (exam.shuffleQuestions ? shuffle(section.questions) : section.questions).map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      imageUrl: question.imageUrl,
      audioUrl: question.audioUrl,
      points: question.points,
      options: question.options.map((option) => ({
        id: option.id,
        content: option.content,
        imageUrl: option.imageUrl,
        isCorrect: option.isCorrect,
      })),
    })),
  }));
  const questionCount = orderedSections.reduce((count, section) => count + section.questions.length, 0);
  if (!questionCount) return { error: "Đề thi chưa có câu hỏi, vui lòng báo giáo viên." };
  const attemptNumber = (exam.attempts[0]?.attemptNumber ?? 0) + 1;
  const expiresAt = exam.durationMinutes > 0
    ? new Date(Date.now() + exam.durationMinutes * 60_000)
    : null;
  const attempt = await prisma.mockExamAttempt.create({
    data: {
      mockExamId,
      userId: user.id,
      attemptNumber,
      expiresAt,
      questionSnapshot: orderedSections as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return redirect(`/student/courses/${courseId}/mock-exams/${mockExamId}/attempts/${attempt.id}`);
}

export default function StudentMockExamOverview() {
  const { user, course, exam } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const canStart = !exam.maxAttempts || exam.submittedAttempts < exam.maxAttempts;
  const attemptHref = exam.activeAttempt
    ? `/student/courses/${course.id}/mock-exams/${exam.id}/attempts/${exam.activeAttempt.id}`
    : null;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/student/courses/${course.id}/mock-exams`}><ArrowLeft className="mr-1.5 h-4 w-4" />Danh sách bài thi thử</Link>
        </Button>
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground sm:p-8">
            <p className="text-sm font-medium opacity-90">BÀI THI THỬ</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{exam.title}</h1>
            <p className="mt-2 max-w-2xl text-sm opacity-90">{exam.description || "Hoàn thành các phần thi và kiểm tra kết quả của bạn."}</p>
          </div>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <ListChecks className="h-5 w-5 text-primary" />
              <div><p className="text-lg font-bold">{exam.questionCount}</p><p className="text-xs text-muted-foreground">Câu hỏi · {exam.sectionCount} phần</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Clock3 className="h-5 w-5 text-primary" />
              <div><p className="text-lg font-bold">{exam.durationMinutes || "∞"}</p><p className="text-xs text-muted-foreground">{exam.durationMinutes ? "Phút làm bài" : "Không giới hạn thời gian"}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <FileCheck2 className="h-5 w-5 text-primary" />
              <div><p className="text-lg font-bold">{exam.submittedAttempts}{exam.maxAttempts ? ` / ${exam.maxAttempts}` : ""}</p><p className="text-xs text-muted-foreground">Lượt đã nộp</p></div>
            </div>
          </CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-5">
            <div>
              <p className="text-sm font-medium">Điểm đạt: {exam.passScore}%</p>
              {exam.latestAttempt && <p className="text-sm text-muted-foreground">Lần gần nhất: {exam.latestAttempt.percentage}% · {exam.latestAttempt.passed ? "Đạt" : "Chưa đạt"}</p>}
            </div>
            {actionData?.error && <p role="alert" className="w-full text-sm text-destructive">{actionData.error}</p>}
            {exam.activeAttempt && attemptHref ? (
              <Button asChild><Link to={attemptHref}>Tiếp tục làm bài</Link></Button>
            ) : (
              <Form method="post">
                <Button type="submit" disabled={!canStart}>Bắt đầu làm bài</Button>
              </Form>
            )}
          </div>
          {!canStart && <CardDescription className="px-6 pb-5 text-destructive">Bạn đã sử dụng hết số lượt làm bài.</CardDescription>}
        </Card>
      </div>
    </AppShell>
  );
}
