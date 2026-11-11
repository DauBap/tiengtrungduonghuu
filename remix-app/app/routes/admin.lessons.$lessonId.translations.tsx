import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ArrowLeft, Languages, Plus, Trash2 } from "lucide-react";
import { parseAnswerVariants } from "~/lib/listening-answer";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const lesson = await prisma.lesson.findUnique({
    where: { id: params.lessonId! },
    include: {
      course: { select: { id: true, title: true } },
      translationQuestions: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  return { user, lesson };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const lessonId = params.lessonId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "create" || intent === "update") {
    const prompt = String(form.get("prompt") ?? "").trim();
    const sampleAnswer = String(form.get("sampleAnswer") ?? "").trim();
    if (!prompt || !sampleAnswer) return { error: "Nhập đề bài và đáp án mẫu." };
    const acceptedAnswers = parseAnswerVariants(
      String(form.get("acceptedAnswers") ?? ""),
      sampleAnswer,
    );
    const maxScore = Math.max(1, Math.min(100, Number(form.get("maxScore") || 10)));
    const data = {
      prompt,
      sampleAnswer,
      acceptedAnswers,
      hint: String(form.get("hint") ?? "").trim(),
      sourceLanguage: String(form.get("sourceLanguage") ?? "VI").trim() || "VI",
      targetLanguage: String(form.get("targetLanguage") ?? "ZH").trim() || "ZH",
      maxScore,
    };
    if (intent === "update") {
      const id = String(form.get("questionId"));
      await prisma.translationQuestion.updateMany({ where: { id, lessonId }, data });
    } else {
      const last = await prisma.translationQuestion.findFirst({
        where: { lessonId }, orderBy: { order: "desc" }, select: { order: true },
      });
      await prisma.translationQuestion.create({ data: { lessonId, order: (last?.order ?? 0) + 1, ...data } });
    }
    return { success: true };
  }

  if (intent === "delete") {
    await prisma.translationQuestion.deleteMany({
      where: { id: String(form.get("questionId")), lessonId },
    });
    return { success: true };
  }

  return { error: "Thao tác không hợp lệ." };
}

export default function TranslationAdmin() {
  const { user, lesson } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();

  return (
    <AppShell user={user}>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/admin/lessons/${lesson.id}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <p className="text-sm text-muted-foreground">{lesson.course.title}</p>
            <h1 className="mt-1 text-2xl font-semibold">Luyện dịch · {lesson.title}</h1>
          </div>
        </div>

        <fetcher.Form method="post" className="grid gap-3 rounded-lg border bg-card p-5 md:grid-cols-12">
          <input type="hidden" name="intent" value="create" />
          <div className="md:col-span-6">
            <label className="mb-1.5 block text-sm font-medium">Đề bài</label>
            <Textarea name="prompt" required placeholder="Ví dụ: Tôi muốn học tiếng Trung." />
          </div>
          <div className="md:col-span-6">
            <label className="mb-1.5 block text-sm font-medium">Đáp án mẫu</label>
            <Textarea name="sampleAnswer" required placeholder="Dịch sang tiếng Trung..." />
          </div>
          <div className="space-y-1.5 md:col-span-12">
            <label className="block text-sm font-medium">
              Đáp án khác được chấp nhận <span className="font-normal text-muted-foreground">(mỗi đáp án một dòng)</span>
            </label>
            <Textarea name="acceptedAnswers" rows={2} placeholder="Nhập đáp án thay thế nếu có..." />
            <p className="text-xs text-muted-foreground">Dùng để giáo viên tham khảo khi chấm và hiển thị khi trả bài.</p>
          </div>
          <Input name="hint" placeholder="Gợi ý (tuỳ chọn)" className="md:col-span-5" />
          <Input name="sourceLanguage" defaultValue="VI" aria-label="Ngôn ngữ đề" className="md:col-span-2" />
          <Input name="targetLanguage" defaultValue="ZH" aria-label="Ngôn ngữ đáp án" className="md:col-span-2" />
          <Input name="maxScore" defaultValue="10" type="number" min="1" max="100" aria-label="Điểm tối đa" className="md:col-span-1" />
          <div className="md:col-span-2 md:flex md:justify-end">
            <Button type="submit"><Plus className="mr-2 h-4 w-4" />Thêm câu</Button>
          </div>
          {fetcher.data?.error && <p className="text-sm text-destructive md:col-span-12">{fetcher.data.error}</p>}
        </fetcher.Form>

        <div className="space-y-3">
          {lesson.translationQuestions.length === 0 && (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              Chưa có câu luyện dịch.
            </div>
          )}
          {lesson.translationQuestions.map((question, index) => (
            <fetcher.Form key={question.id} method="post" className="rounded-lg border bg-card p-4">
              <input type="hidden" name="questionId" value={question.id} />
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Languages className="h-4 w-4 text-primary" />Câu {index + 1}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Textarea name="prompt" defaultValue={question.prompt} required />
                <Textarea name="sampleAnswer" defaultValue={question.sampleAnswer} required />
                <div className="space-y-1.5 md:col-span-2">
                  <label className="block text-sm font-medium">
                    Đáp án khác được chấp nhận <span className="font-normal text-muted-foreground">(mỗi đáp án một dòng)</span>
                  </label>
                  <Textarea
                    name="acceptedAnswers"
                    defaultValue={question.acceptedAnswers.join("\n")}
                    rows={2}
                    placeholder="Nhập đáp án thay thế nếu có..."
                  />
                </div>
                <Input name="hint" defaultValue={question.hint} placeholder="Gợi ý" />
                <div className="grid grid-cols-3 gap-2">
                  <Input name="sourceLanguage" defaultValue={question.sourceLanguage} aria-label="Ngôn ngữ đề" />
                  <Input name="targetLanguage" defaultValue={question.targetLanguage} aria-label="Ngôn ngữ đáp án" />
                  <Input name="maxScore" defaultValue={String(question.maxScore)} type="number" min="1" max="100" aria-label="Điểm tối đa" />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="submit" name="intent" value="update" variant="secondary">Lưu thay đổi</Button>
                <Button type="submit" name="intent" value="delete" variant="ghost" className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Xóa</Button>
              </div>
            </fetcher.Form>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
