import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData, useNavigation } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const course = await prisma.course.findUnique({ where: { id: params.courseId! } });
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const reviewSet = await prisma.courseReviewSet.findFirst({
    where: { id: params.reviewId!, courseId: course.id },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

  return { user, course, reviewSet };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  const reviewSet = await prisma.courseReviewSet.findFirst({
    where: { id: params.reviewId!, courseId: params.courseId! },
    include: { questions: { select: { id: true } } },
  });
  if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

  const title = String(form.get("title") ?? "").trim();
  const subtitle = String(form.get("subtitle") ?? "").trim();
  if (!title || !subtitle) return { error: "Vui lòng nhập đầy đủ tên và mô tả bộ ôn tập." };

  const questionIds = new Set(reviewSet.questions.map((question) => question.id));
  const updates = reviewSet.questions.map((question) => ({
    id: question.id,
    prompt: String(form.get(`questionPrompt-${question.id}`) ?? "").trim(),
    answer: String(form.get(`questionAnswer-${question.id}`) ?? "").trim(),
    explanation: String(form.get(`questionExplanation-${question.id}`) ?? "").trim() || null,
  }));
  if (updates.some((question) => !question.prompt || !question.answer)
    || updates.some((question) => !questionIds.has(question.id))) {
    return { error: "Vui lòng nhập đầy đủ câu hỏi và đáp án." };
  }

  await prisma.$transaction([
    prisma.courseReviewSet.update({ where: { id: reviewSet.id }, data: { title, subtitle } }),
    ...updates.map((question) => prisma.courseReviewQuestion.update({
      where: { id: question.id },
      data: { prompt: question.prompt, answer: question.answer, explanation: question.explanation },
    })),
  ]);

  return redirect(`/admin/courses/${params.courseId}/lessons`);
}

export default function AdminReviewEdit() {
  const { user, course, reviewSet } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <AppShell user={user}>
      <div className="max-w-4xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/admin/courses/${course.id}/lessons`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại bài học</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Chỉnh sửa bộ ôn tập</h1>
          <p className="mt-1 text-sm text-muted-foreground">{course.code} · Vị trí {reviewSet.order}</p>
        </div>

        <Form method="post" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thông tin bộ ôn tập</CardTitle>
              <CardDescription>Cập nhật tên và mô tả hiển thị cho học viên.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Tên bộ ôn tập</Label>
                <Input id="title" name="title" defaultValue={reviewSet.title} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subtitle">Mô tả</Label>
                <Textarea id="subtitle" name="subtitle" defaultValue={reviewSet.subtitle} rows={2} required />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Danh sách câu hỏi ({reviewSet.questions.length})</CardTitle>
              <CardDescription>Chỉnh sửa câu hỏi, đáp án và phần giải thích.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {reviewSet.questions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bộ ôn tập này chưa có câu hỏi.</p>
              ) : reviewSet.questions.map((question, index) => (
                <div key={question.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">Câu {index + 1}</p>
                    <span className="text-xs text-muted-foreground">
                      {question.direction === "VI2ZH" ? "Việt → Trung" : "Trung → Việt"} · {question.type === "REORDER" ? "Sắp xếp" : "Dịch"}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`questionPrompt-${question.id}`}>Câu hỏi</Label>
                    <Textarea id={`questionPrompt-${question.id}`} name={`questionPrompt-${question.id}`} defaultValue={question.prompt} rows={2} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`questionAnswer-${question.id}`}>Đáp án</Label>
                    <Input id={`questionAnswer-${question.id}`} name={`questionAnswer-${question.id}`} defaultValue={question.answer} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`questionExplanation-${question.id}`}>Giải thích (tùy chọn)</Label>
                    <Textarea id={`questionExplanation-${question.id}`} name={`questionExplanation-${question.id}`} defaultValue={question.explanation ?? ""} rows={2} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button asChild variant="outline"><Link to={`/admin/courses/${course.id}/lessons`}>Hủy</Link></Button>
            <Button type="submit" disabled={isSubmitting}>
              <Save className="mr-1.5 h-4 w-4" />{isSubmitting ? "Đang lưu..." : "Lưu bộ ôn tập"}
            </Button>
          </div>
        </Form>
      </div>
    </AppShell>
  );
}
