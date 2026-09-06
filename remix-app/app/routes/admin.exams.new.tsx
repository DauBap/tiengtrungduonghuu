import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, Link, redirect, useNavigation } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { createExam, parseExamForm } from "~/lib/exam.server";
import { AppShell } from "~/components/layout/app-shell";
import { ExamFields } from "~/components/admin/exam/exam-fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const [lessons, courses] = await Promise.all([
    prisma.lesson.findMany({
      orderBy: [{ course: { order: "asc" } }, { order: "asc" }],
      select: { id: true, title: true, order: true, courseId: true, course: { select: { title: true } } },
    }),
    prisma.course.findMany({ orderBy: { order: "asc" }, select: { id: true, title: true } }),
  ]);

  return {
    user,
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      order: l.order,
      courseId: l.courseId,
      courseTitle: l.course.title,
    })),
    courses,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const form = await request.formData();

  const parsed = parseExamForm(form);
  if (!parsed.ok) return { error: parsed.error, field: parsed.field };

  const result = await createExam(parsed.data, user.id);
  if (!result.ok) return { error: result.error, field: result.field };

  // Vào thẳng màn hình soạn đề: tạo xong việc kế tiếp luôn là thêm phần và câu hỏi
  return redirect(`/admin/exams/${result.data.id}`);
}

export default function NewExam() {
  const { user, lessons, courses } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/admin/exams">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Quay lại danh sách bài thi
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Tạo bài thi</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tạo xong sẽ có sẵn phiên bản 1 ở dạng nháp để bạn thêm phần và câu hỏi.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin đề</CardTitle>
            <CardDescription>
              Cấu trúc, câu hỏi và cài đặt sẽ khai báo ở các tab sau khi tạo xong.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              {actionData?.error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {actionData.error}
                </div>
              )}

              <ExamFields lessons={lessons} courses={courses} invalidField={actionData?.field} />

              <div className="flex justify-end gap-2 pt-2">
                <Button asChild variant="outline">
                  <Link to="/admin/exams">Hủy</Link>
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {isSubmitting ? "Đang tạo..." : "Tạo bài thi"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
