import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ShenbiGame } from "~/components/games/shenbi-game";
import stylesheet from "~/styles/shenbi.css?url";

export function links() {
  return [{ rel: "stylesheet", href: stylesheet }];
}

const COURSE_CODES = ["HSK1-3.0", "HSK2-3.0", "HSK3-3.0", "HSK4-3.0", "HSK5-3.0", "HSK6-3.0"];

export function meta() {
  return [
    { title: "Thần Bút – TIẾNG TRUNG DƯƠNG HỮU" },
    { name: "description", content: "Luyện viết từ vựng HSK bằng nhận diện nét chữ Hán." },
  ];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const [courses, customWords, completedStages, memberships, recentAttempts, assignments] = await Promise.all([
    prisma.course.findMany({
      where: { code: { in: COURSE_CODES }, status: "PUBLISHED" },
      orderBy: { hskLevel: "asc" },
      select: {
        code: true,
        title: true,
        hskLevel: true,
        lessons: {
          orderBy: { order: "asc" },
          select: {
            order: true,
            title: true,
            content: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                chinese: true,
                chineseAlternatives: true,
                pinyin: true,
                pinyinAlternatives: true,
                translation: true,
                translationAlternatives: true,
                audioUrl: true,
              },
            },
          },
        },
      },
    }),
    prisma.shenbiVocabulary.findMany({
      where: { hskLevel: { gte: 1, lte: 7 } },
      orderBy: [{ hskLevel: "asc" }, { lesson: "asc" }, { chinese: "asc" }],
      select: {
        id: true,
        hskLevel: true,
        lesson: true,
        chinese: true,
        chineseAlternatives: true,
        pinyin: true,
        pinyinAlternatives: true,
        translation: true,
        translationAlternatives: true,
        audioUrl: true,
      },
    }),
    prisma.shenbiAttempt.findMany({
      where: { userId: user.id, mode: "stage", stageCompleted: true },
      select: { hskLevel: true, scopeKey: true, stageNumber: true },
    }),
    prisma.enrollment.findMany({
      where: { userId: user.id, classId: { not: null } },
      select: { classId: true, class: { select: { name: true } } },
    }),
    prisma.shenbiAttempt.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        hskLevel: true,
        mode: true,
        score: true,
        correctCount: true,
        missedCount: true,
        accuracy: true,
        elapsedSeconds: true,
        createdAt: true,
      },
    }),
    prisma.shenbiAssignment.findMany({
      where: {
        active: true,
        class: { enrollments: { some: { userId: user.id } } },
        OR: [{ dueAt: null }, { dueAt: { gte: new Date() } }],
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        classId: true,
        title: true,
        hskLevel: true,
        lessonFrom: true,
        lessonTo: true,
        mode: true,
        dueAt: true,
        class: { select: { name: true } },
      },
    }),
  ]);

  const levels = Array.from({ length: 7 }, (_, index) => {
    const level = index + 1;
    const course = courses.find((candidate) => candidate.hskLevel === level);
    const courseWords = course?.lessons.flatMap((lesson) => lesson.content.map((word) => ({
      ...word,
      lesson: lesson.order,
    }))) ?? [];
    const customLevelWords = customWords
      .filter((word) => word.hskLevel === level)
      .map(({ hskLevel: _hskLevel, ...word }) => word);
    const wordsBySourceKey = new Map(
      courseWords.map((word) => [
        `${word.lesson}:${word.chinese}:${word.pinyin.trim()}`,
        word,
      ]),
    );
    for (const word of customLevelWords) {
      wordsBySourceKey.set(`${word.lesson}:${word.chinese}:${word.pinyin.trim()}`, word);
    }
    const words = [...wordsBySourceKey.values()];
    const lessonByOrder = new Map((course?.lessons ?? []).map(({ order, title }) => [order, title]));
    for (const word of customLevelWords) {
      if (!lessonByOrder.has(word.lesson)) lessonByOrder.set(word.lesson, `Bài ${word.lesson}`);
    }
    return {
      level,
      courseCode: course?.code ?? (level === 7 ? "HSK7-9-3.0" : `HSK${level}-3.0`),
      title: course?.title ?? `HSK ${level === 7 ? "7–9" : level} (3.0)`,
      lessons: [...lessonByOrder].map(([order, title]) => ({
        order,
        title,
        wordCount: words.filter((word) => word.lesson === order).length,
      })),
      words,
    };
  });

  const stageProgress = completedStages.reduce<Record<string, number>>((progress, attempt) => {
    const key = `${attempt.hskLevel}:${attempt.scopeKey}`;
    progress[key] = Math.max(progress[key] ?? 1, attempt.stageNumber + 1);
    return progress;
  }, {});

  return {
    user: { id: user.id, name: user.name },
    levels,
    stageProgress,
    recentAttempts: recentAttempts.map((attempt) => ({
      ...attempt,
      createdAt: attempt.createdAt.toISOString(),
    })),
    assignments: assignments.map((assignment) => ({
      ...assignment,
      dueAt: assignment.dueAt?.toISOString() ?? null,
    })),
    classes: memberships.flatMap((membership) => membership.classId && membership.class
      ? [{ id: membership.classId, name: membership.class.name }]
      : []),
  };
}

export default function ShenbiRoute() {
  const data = useLoaderData<typeof loader>();
  return <ShenbiGame {...data} />;
}
