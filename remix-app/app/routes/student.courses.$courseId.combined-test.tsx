import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { AppShell } from "~/components/layout/app-shell";
import { VocabularyTest } from "~/components/lessons/vocabulary-test";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, isEnrolled, upsertLessonProgress } from "~/lib/db.server";
import { gradeVocabularyTest, createVocabularyTest, type VocabularyTestWord } from "~/lib/vocabulary-test";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { recordLessonTabAttempt } from "~/lib/lesson-tab-progress.server";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

type CourseLesson = {
  id: string;
  order: number;
  title: string;
  test: { passScore: number } | null;
  content: VocabularyTestWord[];
};

function getSelectedLessonIds(request: Request) {
  return [...new Set(new URL(request.url).searchParams.getAll("lessonId").filter(Boolean))];
}

async function getCourseLessons(courseId: string): Promise<CourseLesson[]> {
  return prisma.lesson.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      test: { select: { passScore: true } },
      content: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          chinese: true,
          chineseAlternatives: true,
          pinyin: true,
          translation: true,
          translationAlternatives: true,
          wordTypes: true,
        },
      },
    },
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  const [course, enrolled] = await Promise.all([
    getCourseById(courseId),
    isEnrolled(user.id, courseId),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!enrolled) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessonIds = getSelectedLessonIds(request);
  if (lessonIds.length === 0) throw redirect(`/student/courses/${courseId}`);

  const courseLessons = await getCourseLessons(courseId);
  const lessons = courseLessons.filter((lesson) => lessonIds.includes(lesson.id));
  if (lessons.length !== lessonIds.length) throw new Response("Bài học không thuộc khóa học này", { status: 404 });

  const selectedWords = lessons.flatMap((lesson) => lesson.content);
  const questionSets = {
    sameWordType: createVocabularyTest(selectedWords, courseLessons.flatMap((lesson) => lesson.content), true),
    random: [],
  };

  return {
    user,
    courseId,
    courseTitle: course.title,
    lessons: lessons.map(({ id, order, title }) => ({ id, order, title })),
    questionSets,
    questionCount: questionSets.sameWordType.length,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  const enrolled = await isEnrolled(user.id, courseId);
  if (!enrolled) throw new Response("Không có quyền truy cập", { status: 403 });

  const formData = await request.formData();
  if (formData.get("intent") !== "submit-combined-test") {
    throw new Response("Thao tác không hợp lệ", { status: 400 });
  }

  const lessonIds = getSelectedLessonIds(request);
  if (lessonIds.length === 0) throw new Response("Chưa chọn bài học", { status: 400 });
  const courseLessons = await getCourseLessons(courseId);
  const lessons = courseLessons.filter((lesson) => lessonIds.includes(lesson.id));
  if (lessons.length !== lessonIds.length) throw new Response("Bài học không thuộc khóa học này", { status: 404 });

  const lessonsWithVocabulary = lessons.filter((lesson) => lesson.content.length > 0);
  const totalCount = lessonsWithVocabulary.reduce((count, lesson) => count + lesson.content.length, 0);
  if (totalCount === 0) return { error: "Các bài đã chọn chưa có từ vựng để kiểm tra." as const };

  const lessonResults = lessonsWithVocabulary.map((lesson) => {
    const answers = new FormData();
    for (const word of lesson.content) {
      const response = formData.get(`response-${word.id}`);
      answers.set(`response-${word.id}`, typeof response === "string" ? response : "");
      answers.set(`direction-${word.id}`, "vi2zh");
    }

    return {
      lesson,
      result: gradeVocabularyTest(lesson.content, answers, lesson.test?.passScore ?? 50),
    };
  });

  const completedAt = new Date();
  await Promise.all(lessonResults.map(async ({ lesson, result }) => {
    if (result.passed) await upsertLessonProgress(user.id, lesson.id, { testCompleted: true });

    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: lesson.id,
      tab: "VOCABULARY_TEST",
      mode: "vi2zh",
      score: result.percentage,
      correctCount: result.correctCount,
      totalCount: result.questionCount,
      passed: result.passed,
      startedAt: completedAt,
      completedAt,
      details: {
        combined: true,
        earnedPoints: result.earnedPoints,
        totalPoints: result.totalPoints,
        blankCount: result.blankCount,
        passScore: result.passScore,
        results: result.results,
      },
    });
  }));

  const correctCount = lessonResults.reduce((count, item) => count + item.result.correctCount, 0);
  return {
    score: Math.round((correctCount / totalCount) * 10000) / 100,
    correctCount,
    totalCount,
    passedLessons: lessonResults.filter((item) => item.result.passed).length,
    lessonCount: lessonResults.length,
    lessonResults: lessonResults.map(({ lesson, result }) => ({
      id: lesson.id,
      title: lesson.title,
      score: result.percentage,
      passed: result.passed,
    })),
  };
}

export default function CombinedVocabularyTest() {
  const { user, courseId, courseTitle, lessons, questionSets, questionCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data && "lessonResults" in fetcher.data && Array.isArray(fetcher.data.lessonResults)
    ? fetcher.data
    : null;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const lessonResults = result?.lessonResults ?? [];
  const lessonSummary = lessons.map((lesson) => `Bài ${lesson.order}: ${lesson.title}`).join(" · ");

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${courseId}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Thi tổng hợp từ vựng</h1>
          <p className="mt-1 text-sm text-muted-foreground">{courseTitle} · {lessons.length} bài · {questionCount} câu</p>
        </div>

        {result && (
          <section aria-live="polite" className="space-y-3 rounded-lg border bg-card p-4">
            <div>
              <h2 className="font-semibold">Đã ghi nhận kết quả</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Đúng {result.correctCount}/{result.totalCount} câu · {result.score}% · Đạt {result.passedLessons}/{result.lessonCount} bài
              </p>
            </div>
            <ul className="divide-y rounded-md border">
              {lessonResults.map((lesson) => (
                <li key={lesson.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>{lesson.title}</span>
                  <span className={lesson.passed ? "font-medium text-success" : "text-muted-foreground"}>
                    {lesson.score}% · {lesson.passed ? "Đạt" : "Chưa đạt"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {questionCount > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4" />Việt → Trung
              </CardTitle>
              <CardDescription>
                Đọc nghĩa tiếng Việt rồi chọn từ tiếng Trung. Kết quả được lưu riêng cho từng bài.
              </CardDescription>
              <p className="text-xs text-muted-foreground">{lessonSummary}</p>
            </CardHeader>
            <CardContent>
              {error && (
                <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="submit-combined-test" />
                <VocabularyTest
                  questionSets={questionSets}
                  timeLimitMinutes={null}
                  fixedDirection="vi2zh"
                  pageSize={10}
                  isSubmitting={fetcher.state !== "idle"}
                />
              </fetcher.Form>
            </CardContent>
          </Card>
        ) : (
          <p role="status" className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Các bài đã chọn chưa có từ vựng để kiểm tra.
          </p>
        )}
      </div>
    </AppShell>
  );
}
