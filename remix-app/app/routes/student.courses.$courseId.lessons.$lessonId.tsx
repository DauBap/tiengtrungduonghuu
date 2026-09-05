import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, redirect } from "react-router";
import { requireRole } from "~/lib/session.server";
import {
  getLessonById,
  getLessonProgress,
  upsertLessonProgress,
  computeLessonStatus,
  getBlockProgressMap,
  computeBlockStatuses,
  markBlockCompleted,
  syncLearningCompleted,
} from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { LessonProgress } from "~/components/lessons/lesson-progress";
import { LockedContent } from "~/components/lessons/locked-content";
import { EmptyState } from "~/components/common/empty-state";
import { BlockRenderer, isBlockLearnable, type ResolvedBlock } from "~/components/lessons/blocks/block-renderer";
import { isLearningBlockType } from "~/lib/learning-blocks";
import { WORD_TYPE_META } from "~/lib/word-types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, PlayCircle, ClipboardCheck, BookOpen } from "lucide-react";
import { cn } from "~/lib/utils";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lesson = await getLessonById(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy", { status: 404 });

  // Check unlock: first lesson always unlocked; otherwise check prev lesson
  const allLessons = await prisma.lesson.findMany({
    where: { courseId: lesson.courseId },
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });
  const idx = allLessons.findIndex((l) => l.id === lesson.id);
  let isUnlocked = idx === 0;
  if (!isUnlocked && idx > 0) {
    const prevProgress = await getLessonProgress(user.id, allLessons[idx - 1].id);
    isUnlocked = prevProgress?.testCompleted === true;
  }

  const progress = await getLessonProgress(user.id, lesson.id);
  const lessonStatus = computeLessonStatus(progress);

  // Resolve từ vựng cho từng block ngay ở loader — component không tự query
  const vocabById = new Map(lesson.content.map((v) => [v.id, v]));
  const allBlocks: ResolvedBlock[] = lesson.learningBlocks
    .filter((b) => isLearningBlockType(b.type))
    .map((b) => {
      const config = b.config as { vocabItemIds?: unknown };
      const ids = Array.isArray(config?.vocabItemIds) ? (config.vocabItemIds as string[]) : [];
      return {
        id: b.id,
        type: b.type as ResolvedBlock["type"],
        title: b.title,
        description: b.description,
        required: b.required,
        order: b.order,
        config: b.config,
        vocabItems: ids
          .map((id) => vocabById.get(id))
          .filter((v): v is NonNullable<typeof v> => Boolean(v))
          .map((v) => ({
            id: v.id,
            chinese: v.chinese,
            pinyin: v.pinyin,
            translation: v.translation,
            wordType: v.wordType,
            audioUrl: v.audioUrl,
            note: v.note,
          })),
      };
    });

  // Block rỗng (admin xóa hết từ, hoặc dạng chưa làm) không thể học được nên
  // không được tính vào tiến độ bắt buộc — nếu tính, học viên sẽ bị khóa Bài tập
  // vĩnh viễn. Vẫn hiện block để học viên biết bài đang được soạn.
  const blocks = allBlocks.map((b) => ({ ...b, required: b.required && isBlockLearnable(b) }));

  const blockProgressMap = await getBlockProgressMap(user.id, blocks.map((b) => b.id));
  const blockStatuses = computeBlockStatuses(blocks, blockProgressMap);

  return { user, lesson, isUnlocked, lessonStatus, blocks, blockStatuses };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "complete-learning");

  if (intent === "complete-block") {
    const blockId = String(form.get("blockId"));
    // Chỉ nhận block thuộc đúng bài học này
    const block = await prisma.learningBlock.findFirst({
      where: { id: blockId, lessonId: params.lessonId! },
      select: { id: true },
    });
    if (!block) return { error: "Không tìm thấy phần học" };

    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);
    return { success: true };
  }

  // Bài học chưa có block nào → giữ hành vi cũ
  await upsertLessonProgress(user.id, params.lessonId!, { learningCompleted: true });
  return redirect(`/student/courses/${params.courseId}/lessons/${params.lessonId}/exercise`);
}

export default function LessonDetail() {
  const { user, lesson, isUnlocked, lessonStatus, blocks, blockStatuses } = useLoaderData<typeof loader>();

  if (!isUnlocked) {
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${lesson.courseId}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <LockedContent title="Bài học chưa mở khóa" message="Hãy hoàn thành kiểm tra của bài học trước để mở khóa bài này." />
        </div>
      </AppShell>
    );
  }

  const hasBlocks = blocks.length > 0;
  // Không có gì học được: chưa có từ vựng, và không block nào có nội dung.
  // Gồm cả trường hợp block vẫn còn nhưng admin đã xóa hết từ vựng của nó.
  const isEmptyLesson = lesson.content.length === 0 && !blocks.some(isBlockLearnable);
  const requiredTotal = blocks.filter((b) => b.required).length;
  const requiredDone = blocks.filter((b, i) => b.required && blockStatuses[i] === "COMPLETED").length;
  const allRequiredDone = requiredTotal > 0 && requiredDone === requiredTotal;

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${lesson.courseId}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {lesson.course.hskLevel}</span>
            <span>Bài {lesson.order}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>
          <p className="text-xl text-muted-foreground font-mono mt-1">{lesson.subtitle}</p>
        </div>

        {isEmptyLesson ? (
          <EmptyState
            icon={<BookOpen className="h-12 w-12" />}
            title="Bài học đang trống"
            message="Nội dung bài học này đang được soạn. Bạn hãy quay lại sau nhé."
            action={
              <Button variant="outline" asChild>
                <Link to={`/student/courses/${lesson.courseId}`}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />Về danh sách bài học
                </Link>
              </Button>
            }
          />
        ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1 md:sticky md:top-6 md:self-start">
            <CardHeader><CardTitle className="text-base">Tiến độ bài học</CardTitle></CardHeader>
            <CardContent>
              <LessonProgress steps={[
                { label: "Học lý thuyết", status: lessonStatus.learningStatus },
                { label: "Bài tập", status: lessonStatus.exerciseStatus },
                { label: "Kiểm tra", status: lessonStatus.testStatus },
              ]} />

              {hasBlocks && (
                <div className="mt-4 pt-4 border-t space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Phần lý thuyết ({requiredDone}/{requiredTotal})
                  </p>
                  {blocks.map((block, i) => {
                    const status = blockStatuses[i];
                    return (
                      <a key={block.id} href={`#block-${block.id}`}
                        className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50",
                          status === "COMPLETED" ? "text-success" : status === "LOCKED" ? "text-muted-foreground opacity-60" : "text-foreground"
                        )}>
                        {status === "COMPLETED" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          : status === "LOCKED" ? <Lock className="h-3.5 w-3.5 shrink-0" />
                          : <PlayCircle className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate">{block.title}</span>
                      </a>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 space-y-2">
                {lessonStatus.exerciseStatus !== "LOCKED" && lesson.exercise ? (
                  <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}/exercise`}
                    className="flex items-center gap-2 rounded-lg border p-3 border-primary/30 bg-primary/5 text-primary hover:bg-muted/50 transition-colors">
                    <PlayCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Đến bài tập</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-auto" />
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-muted-foreground opacity-60">
                    <Lock className="h-4 w-4" /><span className="text-sm">Đến bài tập</span>
                  </div>
                )}
                {lessonStatus.testStatus !== "LOCKED" && lesson.test ? (
                  <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}/test`}
                    className="flex items-center gap-2 rounded-lg border p-3 border-primary/30 bg-primary/5 text-primary hover:bg-muted/50 transition-colors">
                    <ClipboardCheck className="h-4 w-4" />
                    <span className="text-sm font-medium">Đến bài kiểm tra</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-auto" />
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-muted-foreground opacity-60">
                    <Lock className="h-4 w-4" /><span className="text-sm">Đến bài kiểm tra</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="md:col-span-2 space-y-4">
            {/* Kho từ vựng của bài */}
            {lesson.content.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Từ vựng bài học</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {lesson.content.map((item) => (
                      <div key={item.id} className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <p className="text-2xl font-medium">{item.chinese}</p>
                            {item.wordType && (
                              <Badge variant="outline" className="text-xs font-normal">
                                {WORD_TYPE_META[item.wordType].label}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-primary font-mono mt-0.5">{item.pinyin}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">{item.translation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Các dạng bài học */}
            {blocks.map((block, i) => (
              <div key={block.id} id={`block-${block.id}`} className="scroll-mt-6">
                <BlockRenderer block={block} status={blockStatuses[i]} />
              </div>
            ))}

            {/* Bài có từ vựng nhưng chưa có block → giữ nút đánh dấu hoàn thành như trước */}
            {!hasBlocks && (
              <Card>
                <CardContent className="pt-6">
                  {lessonStatus.learningStatus === "COMPLETED" ? (
                    <div className="flex items-center gap-2 text-success justify-center">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="text-sm font-medium">Đã đánh dấu hoàn thành</span>
                    </div>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="complete-learning" />
                      <Button type="submit" size="lg" className="w-full">
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />Đánh dấu hoàn thành bài học
                      </Button>
                    </Form>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Đủ block bắt buộc → chuyển sang bài tập */}
            {hasBlocks && allRequiredDone && lesson.exercise && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="pt-6 space-y-3 text-center">
                  <div className="flex items-center gap-2 text-success justify-center">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">Đã hoàn thành phần lý thuyết</span>
                  </div>
                  <Button asChild size="lg" className="w-full">
                    <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}/exercise`}>
                      Đến bài tập<ArrowRight className="h-4 w-4 ml-1.5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        )}
      </div>
    </AppShell>
  );
}
