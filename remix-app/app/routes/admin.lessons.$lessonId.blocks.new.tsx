import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Link, redirect } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { parseBlockForm } from "~/lib/block-form.server";
import { BLOCK_META, BLOCK_TYPES, type LearningBlockType } from "~/lib/learning-blocks";
import { AppShell } from "~/components/layout/app-shell";
import { FlashcardForm } from "~/components/admin/flashcard-form";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { cn } from "~/lib/utils";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const lesson = await getLessonForAdmin(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  if (lesson.content.length === 0) {
    // Không cho tạo block khi kho từ vựng trống
    throw redirect(`/admin/lessons/${lesson.id}`);
  }
  return { user, lesson };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const lessonId = params.lessonId!;
  const form = await request.formData();

  const parsed = parseBlockForm(form);
  if (!parsed.ok) return { error: parsed.error, field: parsed.field };

  // Chỉ nhận từ vựng thuộc đúng bài học này
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

  const last = await prisma.learningBlock.findFirst({
    where: { lessonId }, orderBy: { order: "desc" }, select: { order: true },
  });

  await prisma.learningBlock.create({
    data: {
      lessonId,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      required: parsed.data.required,
      order: (last?.order ?? 0) + 1,
      config: parsed.data.config as object,
    },
  });

  return redirect(`/admin/lessons/${lessonId}`);
}

export default function NewLearningBlock() {
  const { user, lesson } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [type, setType] = useState<LearningBlockType | null>(null);
  const backTo = `/admin/lessons/${lesson.id}`;

  const vocabOptions = lesson.content.map((v) => ({
    id: v.id, chinese: v.chinese, pinyin: v.pinyin, translation: v.translation, wordType: v.wordType, audioUrl: v.audioUrl,
  }));

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={backTo}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Thêm dạng bài học</h1>
          <p className="text-muted-foreground text-sm mt-1">Bài {lesson.order} - {lesson.title}</p>
        </div>

        {type === null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chọn dạng bài học</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {BLOCK_TYPES.map((t) => {
                const meta = BLOCK_META[t];
                const Icon = meta.icon;
                return (
                  <button key={t} type="button" disabled={!meta.implemented}
                    onClick={() => meta.implemented && setType(t)}
                    className={cn("flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
                      meta.implemented ? "hover:border-primary/50 hover:bg-primary/5" : "opacity-60 cursor-not-allowed")}>
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <span className="font-medium">{meta.label}</span>
                      {!meta.implemented && (
                        <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">Sắp có</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Dạng:</span>
                <span className="font-medium">{BLOCK_META[type].label}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setType(null)}>Đổi dạng khác</Button>
            </div>
            {type === "FLASHCARD" && (
              <FlashcardForm vocabOptions={vocabOptions} error={actionData?.error} field={actionData?.field} cancelTo={backTo} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
