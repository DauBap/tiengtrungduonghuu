import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { AppShell } from "~/components/layout/app-shell";
import { BlockShell } from "~/components/lessons/blocks/block-shell";
import { FlashcardBlock, type FlashcardVocab } from "~/components/lessons/blocks/flashcard-block";
import { Button } from "~/components/ui/button";
import { getCourseById, isEnrolled } from "~/lib/db.server";
import type { FlashcardConfig } from "~/lib/learning-blocks";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { ArrowLeft } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  const [course, enrolled] = await Promise.all([
    getCourseById(courseId),
    isEnrolled(user.id, courseId),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!enrolled) throw new Response("Không có quyền truy cập", { status: 403 });

  const requestedIds = new URL(request.url).searchParams.getAll("lessonId").filter(Boolean);
  const lessonIds = [...new Set(requestedIds)];
  if (lessonIds.length === 0) throw redirect(`/student/courses/${courseId}`);

  const lessons = await prisma.lesson.findMany({
    where: { courseId, id: { in: lessonIds } },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      content: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          chinese: true,
          pinyin: true,
          translation: true,
          wordTypes: true,
          audioUrl: true,
          note: true,
        },
      },
    },
  });
  if (lessons.length !== lessonIds.length) throw new Response("Bài học không thuộc khóa học này", { status: 404 });

  const items: FlashcardVocab[] = lessons.flatMap((lesson) => lesson.content.map((item) => ({
    id: item.id,
    chinese: item.chinese,
    pinyin: item.pinyin,
    translation: item.translation,
    wordTypes: item.wordTypes ?? [],
    audioUrl: item.audioUrl,
    note: item.note,
  })));

  return {
    user,
    courseId,
    courseTitle: course.title,
    lessons: lessons.map(({ id, order, title }) => ({ id, order, title })),
    items,
    selectionKey: [...lessonIds].sort().join("."),
  };
}

export default function CombinedFlashcards() {
  const { user, courseId, courseTitle, lessons, items, selectionKey } = useLoaderData<typeof loader>();
  const config: FlashcardConfig = {
    vocabItemIds: items.map((item) => item.id),
    frontSide: "chinese",
    showPinyinOnFront: false,
    shuffle: false,
    autoSpeak: false,
  };
  const storageKey = `flashcard-progress:${courseId}:combined:${selectionKey}`;
  const lessonSummary = lessons.map((lesson) => `Bài ${lesson.order}: ${lesson.title}`).join(" · ");

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${courseId}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Flashcard tổng hợp</h1>
          <p className="mt-1 text-sm text-muted-foreground">{courseTitle} · {lessons.length} bài · {items.length} từ vựng</p>
        </div>

        {items.length > 0 ? (
          <BlockShell type="FLASHCARD" title="Học tổng hợp" description={lessonSummary} status="AVAILABLE" required={false} showSettings>
            <FlashcardBlock
              config={config}
              items={items}
              courseId={courseId}
              lessonId={`combined:${selectionKey}`}
              progressStorageKey={storageKey}
              isCompleted
              onComplete={() => undefined}
            />
          </BlockShell>
        ) : (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Các bài đã chọn chưa có từ vựng.</p>
        )}
      </div>
    </AppShell>
  );
}