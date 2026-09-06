import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, redirect } from "react-router";
import { useState } from "react";
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
import { LockedContent } from "~/components/lessons/locked-content";
import { EmptyState } from "~/components/common/empty-state";
import { BlockRenderer, isBlockLearnable, type ResolvedBlock } from "~/components/lessons/blocks/block-renderer";
import { isLearningBlockType, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";
import { LessonTabs } from "~/components/lessons/lesson-tabs";
import { VocabularyTable } from "~/components/lessons/vocabulary-table";
import { Button } from "~/components/ui/button";
import { ArrowLeft, BookOpen, Construction } from "lucide-react";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lesson = await getLessonById(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy", { status: 404 });

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

  // Resolve nội dung cho từng block ngay ở loader — component không tự query.
  // Nghe câu có thể lấy nguồn từ kho câu nên phải kèm cả sentences.
  const vocabById = new Map(lesson.content.map((v) => [v.id, v]));
  const sentenceById = new Map(lesson.sentences.map((s) => [s.id, s]));
  const allBlocks: ResolvedBlock[] = lesson.learningBlocks
    .filter((b) => isLearningBlockType(b.type))
    .map((b) => {
      const config = b.config as { vocabItemIds?: unknown; sentenceItemIds?: unknown };
      const vocabIds = Array.isArray(config?.vocabItemIds) ? (config.vocabItemIds as string[]) : [];
      const sentenceIds = Array.isArray(config?.sentenceItemIds) ? (config.sentenceItemIds as string[]) : [];
      return {
        id: b.id,
        type: b.type as ResolvedBlock["type"],
        title: b.title,
        description: b.description,
        required: b.required,
        order: b.order,
        config: b.config,
        vocabItems: vocabIds
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
        sentenceItems: sentenceIds
          .map((id) => sentenceById.get(id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({
            id: s.id,
            chinese: s.chinese,
            pinyin: s.pinyin,
            translation: s.translation,
            audioUrl: s.audioUrl,
          })),
      };
    });

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
    const block = await prisma.learningBlock.findFirst({
      where: { id: blockId, lessonId: params.lessonId! },
      select: { id: true },
    });
    if (!block) return { error: "Không tìm thấy phần học" };

    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);
    return { success: true };
  }

  await upsertLessonProgress(user.id, params.lessonId!, { learningCompleted: true });
  return redirect(`/student/courses/${params.courseId}/lessons/${params.lessonId}/exercise`);
}

/** Bài học chưa có block dạng này. Dạng đã làm nhưng bài chưa soạn thì nói
 *  "chưa có", còn dạng chưa hỗ trợ thì nói "đang phát triển". */
function BlockPlaceholder({ type }: { type: LearningBlockType }) {
  const meta = BLOCK_META[type];
  return (
    <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/5 p-8 text-center">
      <div className="flex justify-center mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Construction className="h-6 w-6" />
        </div>
      </div>
      <p className="text-sm font-medium">
        {meta.implemented
          ? `Bài này chưa có phần ${meta.label}`
          : `Dạng "${meta.label}" đang được phát triển`}
      </p>
      <p className="text-sm text-muted-foreground mt-1">Nội dung sẽ được bổ sung trong thời gian tới.</p>
    </div>
  );
}

export default function LessonDetail() {
  const { user, lesson, isUnlocked, blocks, blockStatuses } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<LearningBlockType>("FLASHCARD");

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

  // Dạng bài có mặt trong bài này. Dùng để làm mờ tab của dạng bài chưa soạn —
  // block đã tạo nhưng chưa chọn nội dung vẫn tính là có, để học viên bấm vào
  // và thấy lời nhắn cụ thể thay vì tưởng dạng đó không tồn tại.
  const availableTypes = new Set(blocks.map((b) => b.type));
  // Tab Từ vựng dựa vào kho từ của bài chứ không cần admin tạo block riêng.
  if (lesson.content.length > 0) availableTypes.add("VOCABULARY");

  const isEmptyLesson = lesson.content.length === 0 && !blocks.some(isBlockLearnable);

  const renderTabContent = () => {
    // Từ vựng đọc trực tiếp kho từ của bài, không qua block.
    if (activeTab === "VOCABULARY") {
      return <VocabularyTable items={lesson.content} />;
    }

    const blockIndex = blocks.findIndex((b) => b.type === activeTab);
    // Bài chưa có block dạng này — khác với block đã có nhưng chưa chọn nội
    // dung, trường hợp đó BlockRenderer hiện "chưa có nội dung" của riêng nó.
    if (blockIndex === -1) return <BlockPlaceholder type={activeTab} />;

    return <BlockRenderer block={blocks[blockIndex]} status={blockStatuses[blockIndex]} />;
  };

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${lesson.courseId}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {lesson.course.hskLevel}</span>
            <span>Bài {lesson.order}</span>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">{lesson.title}</h1>
            <p className="text-xl text-muted-foreground font-mono mt-2">{lesson.subtitle}</p>
          </div>
        </div>

        {isEmptyLesson ? (
          <EmptyState
            icon={<BookOpen className="h-12 w-12" />}
            title="Bài học đang trống"
            message="Nội dung bài học này đang được soạn. Bạn hãy quay lại sau nhé."
          />
        ) : (
          <>
            <LessonTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              availableTypes={availableTypes}
              lessonId={lesson.id}
              courseId={lesson.courseId}
            />

            <div className="max-w-6xl mx-auto px-4">
              {renderTabContent()}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

