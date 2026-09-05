import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Link, redirect } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { parseBlockForm } from "~/lib/block-form.server";
import { BLOCK_META, parseFlashcardConfig, isLearningBlockType, type LearningBlockType } from "~/lib/learning-blocks";
import { AppShell } from "~/components/layout/app-shell";
import { FlashcardForm } from "~/components/admin/flashcard-form";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const lesson = await getLessonForAdmin(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const block = lesson.learningBlocks.find((b) => b.id === params.blockId);
  if (!block) throw new Response("Không tìm thấy dạng bài học", { status: 404 });

  return { user, lesson, block };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const lessonId = params.lessonId!;
  const blockId = params.blockId!;
  const form = await request.formData();

  const existing = await prisma.learningBlock.findFirst({
    where: { id: blockId, lessonId }, select: { id: true },
  });
  if (!existing) throw new Response("Không tìm thấy dạng bài học", { status: 404 });

  const parsed = parseBlockForm(form);
  if (!parsed.ok) return { error: parsed.error, field: parsed.field };

  const config = parsed.data.config as { vocabItemIds?: string[] };
  if (config.vocabItemIds) {
    const valid = await prisma.vocabItem.findMany({
      where: { lessonId, id: { in: config.vocabItemIds } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((v) => v.id));
    const filtered = config.vocabItemIds.filter((id) => validIds.has(id));
    if (filtered.length === 0) return { error: "Chọn ít nhất 1 từ vựng cho thẻ" };
    config.vocabItemIds = filtered;
  }

  await prisma.learningBlock.update({
    where: { id: blockId },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      required: parsed.data.required,
      config: parsed.data.config as object,
    },
  });

  return redirect(`/admin/lessons/${lessonId}`);
}

export default function EditLearningBlock() {
  const { user, lesson, block } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const backTo = `/admin/lessons/${lesson.id}`;

  const type = isLearningBlockType(block.type) ? (block.type as LearningBlockType) : null;
  const vocabOptions = lesson.content.map((v) => ({
    id: v.id, chinese: v.chinese, pinyin: v.pinyin, translation: v.translation, wordType: v.wordType, audioUrl: v.audioUrl,
  }));

  const header = (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link to={backTo}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học</Link>
      </Button>
      <h1 className="text-2xl font-bold tracking-tight">Chỉnh sửa dạng bài học</h1>
      <p className="text-muted-foreground text-sm mt-1">
        {type ? BLOCK_META[type].label : block.type} - Bài {lesson.order} - {lesson.title}
      </p>
    </div>
  );

  if (type === "FLASHCARD") {
    const parsedConfig = parseFlashcardConfig(block.config);
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          {header}
          {parsedConfig.ok ? (
            <FlashcardForm
              vocabOptions={vocabOptions}
              initial={{
                title: block.title,
                description: block.description,
                required: block.required,
                config: parsedConfig.data,
              }}
              error={actionData?.error}
              field={actionData?.field}
              cancelTo={backTo}
            />
          ) : (
            // Config trong DB bị lỗi → cho soạn lại từ đầu thay vì chặn admin
            <>
              <ConfigWarning message={parsedConfig.error} />
              <FlashcardForm vocabOptions={vocabOptions} error={actionData?.error} field={actionData?.field} cancelTo={backTo} />
            </>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-3xl">
        {header}
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm font-medium">Dạng này chưa có trình chỉnh sửa</p>
            <p className="text-sm text-muted-foreground">
              Dạng &quot;{type ? BLOCK_META[type].label : block.type}&quot; đang được phát triển.
            </p>
            <Button asChild variant="outline" className="mt-4"><Link to={backTo}>Quay lại</Link></Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function ConfigWarning({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>Cấu hình cũ không hợp lệ ({message}). Vui lòng chọn lại từ vựng và lưu.</span>
    </div>
  );
}
