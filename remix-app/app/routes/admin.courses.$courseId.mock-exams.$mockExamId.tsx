import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { ArrowLeft, FileCheck2, Plus, Trash2 } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const MOCK_QUESTION_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "LISTENING"] as const;
type MockQuestionType = (typeof MOCK_QUESTION_TYPES)[number];

function isMockQuestionType(value: string): value is MockQuestionType {
  return (MOCK_QUESTION_TYPES as readonly string[]).includes(value);
}

function parseOptions(form: FormData) {
  const contents = form.getAll("optionContent").map((value) => String(value).trim());
  const images = form.getAll("optionImageUrl").map((value) => String(value).trim());
  const correctIndexes = new Set(form.getAll("optionCorrect").map((value) => Number(value)));
  const options = contents
    .map((content, index) => ({ content, imageUrl: images[index] || null, index }))
    .filter((option) => option.content || option.imageUrl)
    .map((option, order) => ({
      content: option.content,
      imageUrl: option.imageUrl,
      isCorrect: correctIndexes.has(option.index),
      order,
    }));
  return options;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const [course, mockExam] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { id: true, code: true, title: true } }),
    prisma.mockExam.findFirst({
      where: { id: params.mockExamId!, courseId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
        },
        _count: { select: { attempts: true } },
      },
    }),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!mockExam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });
  return { user, course, mockExam };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const mockExamId = params.mockExamId!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ownedExam = await prisma.mockExam.findFirst({
    where: { id: mockExamId, courseId },
    select: { id: true },
  });
  if (!ownedExam) throw new Response("Không tìm thấy bài thi thử", { status: 404 });

  if (intent === "exam-update") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "Vui lòng nhập tên bài thi thử" };
    const durationMinutes = Number(form.get("durationMinutes"));
    const passScore = Number(form.get("passScore"));
    const maxAttempts = Number(form.get("maxAttempts"));
    if (!Number.isInteger(durationMinutes) || durationMinutes < 0) return { error: "Thời gian phải là số phút không âm" };
    if (!Number.isInteger(passScore) || passScore < 0 || passScore > 100) return { error: "Điểm đạt phải từ 0 đến 100" };
    if (!Number.isInteger(maxAttempts) || maxAttempts < 0) return { error: "Số lượt thi phải là số nguyên không âm" };
    await prisma.mockExam.update({
      where: { id: mockExamId },
      data: {
        title,
        description: String(form.get("description") ?? "").trim() || null,
        durationMinutes,
        passScore,
        maxAttempts,
        shuffleQuestions: form.get("shuffleQuestions") === "on",
        showAnswers: form.get("showAnswers") === "on",
      },
    });
    return { success: "Đã lưu cài đặt bài thi thử." };
  }

  if (intent === "exam-publish") {
    const publish = form.get("published") === "true";
    if (publish) {
      const sections = await prisma.mockExamSection.findMany({
        where: { mockExamId },
        include: { questions: { include: { options: true } } },
      });
      const questions = sections.flatMap((section) => section.questions);
      if (!questions.length) return { error: "Thêm ít nhất một câu hỏi trước khi phát hành." };
      const invalid = questions.some((question) => {
        const correct = question.options.filter((option) => option.isCorrect).length;
        return question.options.length < 2 || correct === 0 ||
          (question.type !== "MULTIPLE_CHOICE" && correct !== 1);
      });
      if (invalid) return { error: "Mỗi câu cần ít nhất 2 lựa chọn và đáp án đúng hợp lệ." };
    }
    await prisma.mockExam.update({ where: { id: mockExamId }, data: { isPublished: publish } });
    return { success: publish ? "Đã phát hành bài thi thử." : "Đã ẩn bài thi thử khỏi học viên." };
  }

  if (intent === "section-create") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "Vui lòng nhập tên phần thi." };
    const last = await prisma.mockExamSection.findFirst({
      where: { mockExamId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    await prisma.mockExamSection.create({
      data: {
        mockExamId,
        title,
        description: String(form.get("description") ?? "").trim() || null,
        order: (last?.order ?? 0) + 1,
      },
    });
    return { success: "Đã thêm phần thi." };
  }

  if (intent === "section-delete") {
    const sectionId = String(form.get("sectionId") ?? "");
    await prisma.mockExamSection.deleteMany({ where: { id: sectionId, mockExamId } });
    return { success: "Đã xóa phần thi và các câu hỏi trong phần." };
  }

  if (intent === "question-create" || intent === "question-edit") {
    const sectionId = String(form.get("sectionId") ?? "");
    const section = await prisma.mockExamSection.findFirst({
      where: { id: sectionId, mockExamId },
      select: { id: true },
    });
    if (!section) return { error: "Không tìm thấy phần thi." };
    const prompt = String(form.get("prompt") ?? "").trim();
    const typeValue = String(form.get("type") ?? "SINGLE_CHOICE");
    const points = Number(form.get("points"));
    const audioUrl = String(form.get("audioUrl") ?? "").trim();
    const imageUrl = String(form.get("imageUrl") ?? "").trim();
    if (!prompt) return { error: "Vui lòng nhập nội dung câu hỏi." };
    if (!isMockQuestionType(typeValue)) return { error: "Dạng câu hỏi không hợp lệ." };
    const type = typeValue;
    if (!Number.isFinite(points) || points <= 0) return { error: "Điểm câu hỏi phải lớn hơn 0." };
    if (type === "LISTENING" && !audioUrl) return { error: "Câu nghe cần có đường dẫn âm thanh." };
    const options = parseOptions(form);
    const correctCount = options.filter((option) => option.isCorrect).length;
    if (options.length < 2 || !correctCount || (type !== "MULTIPLE_CHOICE" && correctCount !== 1)) {
      return { error: "Cần ít nhất 2 lựa chọn và chọn đáp án đúng phù hợp với dạng câu hỏi." };
    }

    const questionId = String(form.get("questionId") ?? "");
    if (intent === "question-edit") {
      const ownedQuestion = await prisma.mockExamQuestion.findFirst({
        where: { id: questionId, section: { mockExamId } },
        select: { id: true },
      });
      if (!ownedQuestion) return { error: "Không tìm thấy câu hỏi." };
      await prisma.$transaction([
        prisma.mockExamQuestion.update({
          where: { id: questionId },
          data: {
            sectionId,
            prompt,
            type,
            points,
            audioUrl: audioUrl || null,
            imageUrl: imageUrl || null,
          },
        }),
        prisma.mockExamOption.deleteMany({ where: { questionId } }),
        prisma.mockExamOption.createMany({ data: options.map((option) => ({ ...option, questionId })) }),
      ]);
      return { success: "Đã cập nhật câu hỏi." };
    }

    const last = await prisma.mockExamQuestion.findFirst({
      where: { sectionId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    await prisma.mockExamQuestion.create({
      data: {
        sectionId,
        prompt,
        type,
        points,
        audioUrl: audioUrl || null,
        imageUrl: imageUrl || null,
        order: (last?.order ?? 0) + 1,
        options: { create: options },
      },
    });
    return { success: "Đã thêm câu hỏi." };
  }

  if (intent === "question-delete") {
    const questionId = String(form.get("questionId") ?? "");
    await prisma.mockExamQuestion.deleteMany({ where: { id: questionId, section: { mockExamId } } });
    return { success: "Đã xóa câu hỏi." };
  }

  return { error: "Thao tác không hợp lệ." };
}

function QuestionEditor({
  sectionId,
  question,
}: {
  sectionId: string;
  question?: {
    id: string;
    type: string;
    prompt: string;
    points: number;
    imageUrl: string | null;
    audioUrl: string | null;
    options: { content: string; imageUrl: string | null; isCorrect: boolean }[];
  };
}) {
  const options = question?.options ?? [];
  return (
    <Form method="post" className="space-y-4 rounded-lg border p-4">
      <input type="hidden" name="intent" value={question ? "question-edit" : "question-create"} />
      <input type="hidden" name="sectionId" value={sectionId} />
      {question && <input type="hidden" name="questionId" value={question.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Dạng câu hỏi</Label>
          <select name="type" defaultValue={question?.type ?? "SINGLE_CHOICE"} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="SINGLE_CHOICE">Chọn một đáp án</option>
            <option value="MULTIPLE_CHOICE">Chọn nhiều đáp án</option>
            <option value="LISTENING">Nghe rồi chọn</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Điểm</Label>
          <Input name="points" type="number" min="0.1" step="0.1" defaultValue={question?.points ?? 1} required />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Nội dung câu hỏi</Label>
        <Textarea name="prompt" rows={2} defaultValue={question?.prompt ?? ""} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>URL ảnh câu hỏi (nếu có)</Label>
          <Input name="imageUrl" type="url" defaultValue={question?.imageUrl ?? ""} />
        </div>
        <div className="space-y-2">
          <Label>URL âm thanh (dạng Nghe)</Label>
          <Input name="audioUrl" type="url" defaultValue={question?.audioUrl ?? ""} />
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Lựa chọn · đánh dấu đáp án đúng</legend>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="grid items-center gap-2 sm:grid-cols-[auto_1fr_1fr]">
            <input
              aria-label={`Lựa chọn ${index + 1} là đáp án đúng`}
              name="optionCorrect"
              type="checkbox"
              value={index}
              defaultChecked={options[index]?.isCorrect ?? false}
            />
            <Input name="optionContent" placeholder={`Nội dung lựa chọn ${index + 1}`} defaultValue={options[index]?.content ?? ""} />
            <Input name="optionImageUrl" type="url" placeholder="URL ảnh lựa chọn (nếu có)" defaultValue={options[index]?.imageUrl ?? ""} />
          </div>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" size="sm"><Plus className="mr-1.5 h-4 w-4" />{question ? "Lưu câu hỏi" : "Thêm câu hỏi"}</Button>
      </div>
    </Form>
  );
}

export default function AdminCourseMockExamEditor() {
  const { user, course, mockExam } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/admin/courses/${course.id}/lessons`}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại bài học
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{mockExam.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{course.code} · {course.title} · {mockExam._count.attempts} lượt làm</p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="exam-publish" />
              <input type="hidden" name="published" value={String(!mockExam.isPublished)} />
              <Button type="submit" variant={mockExam.isPublished ? "outline" : "default"} disabled={navigation.state === "submitting"}>
                <FileCheck2 className="mr-1.5 h-4 w-4" />
                {mockExam.isPublished ? "Ẩn với học viên" : "Phát hành"}
              </Button>
            </Form>
          </div>
        </div>

        {actionData?.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{actionData.error}</p>}
        {actionData?.success && <p role="status" className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm">{actionData.success}</p>}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cài đặt bài thi thử</CardTitle>
            <CardDescription>Đây là cài đặt riêng, không ảnh hưởng module Bài thi hiện có.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="exam-update" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label>Tên bài thi</Label><Input name="title" defaultValue={mockExam.title} required /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Mô tả</Label><Textarea name="description" defaultValue={mockExam.description ?? ""} rows={2} /></div>
                <div className="space-y-2"><Label>Thời gian (phút, 0 = không giới hạn)</Label><Input name="durationMinutes" type="number" min="0" step="1" defaultValue={mockExam.durationMinutes} required /></div>
                <div className="space-y-2"><Label>Điểm đạt (%)</Label><Input name="passScore" type="number" min="0" max="100" step="1" defaultValue={mockExam.passScore} required /></div>
                <div className="space-y-2"><Label>Số lượt tối đa (0 = không giới hạn)</Label><Input name="maxAttempts" type="number" min="0" step="1" defaultValue={mockExam.maxAttempts} required /></div>
                <label className="flex items-center gap-2 text-sm"><input name="shuffleQuestions" type="checkbox" defaultChecked={mockExam.shuffleQuestions} />Trộn thứ tự câu hỏi khi bắt đầu</label>
                <label className="flex items-center gap-2 text-sm"><input name="showAnswers" type="checkbox" defaultChecked={mockExam.showAnswers} />Cho xem đáp án sau khi nộp</label>
              </div>
              <div className="flex justify-end"><Button type="submit">Lưu cài đặt</Button></div>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Các phần thi</CardTitle><CardDescription>Tạo phần Nghe, Đọc hoặc tên phần tùy ý.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <Form method="post" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="intent" value="section-create" />
              <Input name="title" placeholder="Tên phần thi" required />
              <Input name="description" placeholder="Mô tả (không bắt buộc)" />
              <Button type="submit"><Plus className="mr-1.5 h-4 w-4" />Thêm phần</Button>
            </Form>
            {mockExam.sections.length === 0 && <p className="text-sm text-muted-foreground">Chưa có phần thi nào.</p>}
            {mockExam.sections.map((section, sectionIndex) => (
              <section key={section.id} className="space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">{sectionIndex + 1}. {section.title}</h2>{section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}</div>
                  <Form method="post" onSubmit={(event) => { if (!window.confirm(`Xóa phần "${section.title}" và toàn bộ câu hỏi?`)) event.preventDefault(); }}>
                    <input type="hidden" name="intent" value="section-delete" /><input type="hidden" name="sectionId" value={section.id} />
                    <Button type="submit" variant="ghost" size="sm" className="text-destructive"><Trash2 className="mr-1.5 h-4 w-4" />Xóa phần</Button>
                  </Form>
                </div>
                <div className="space-y-3">
                  {section.questions.map((question, questionIndex) => (
                    <details key={question.id} className="rounded-lg border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Câu {questionIndex + 1}: {question.prompt} <span className="text-muted-foreground">({question.points} điểm)</span>
                      </summary>
                      <div className="mt-3 space-y-3">
                        <QuestionEditor sectionId={section.id} question={question} />
                        <Form method="post" onSubmit={(event) => { if (!window.confirm("Xóa câu hỏi này?")) event.preventDefault(); }}>
                          <input type="hidden" name="intent" value="question-delete" /><input type="hidden" name="questionId" value={question.id} />
                          <Button type="submit" variant="ghost" size="sm" className="text-destructive"><Trash2 className="mr-1.5 h-4 w-4" />Xóa câu hỏi</Button>
                        </Form>
                      </div>
                    </details>
                  ))}
                </div>
                <details className="rounded-lg border border-dashed p-3">
                  <summary className="cursor-pointer text-sm font-medium">Thêm câu hỏi</summary>
                  <div className="mt-3"><QuestionEditor sectionId={section.id} /></div>
                </details>
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
