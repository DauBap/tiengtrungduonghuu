import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { getAccuracy } from "~/lib/shenbi";

const attemptSchema = z.object({
  hskLevel: z.number().int().min(1).max(7),
  assignmentId: z.string().min(1).nullable(),
  mode: z.enum(["stage", "challenge"]),
  lessonFrom: z.number().int().min(1).max(100).nullable(),
  lessonTo: z.number().int().min(1).max(100).nullable(),
  stageNumber: z.number().int().min(0).max(100),
  stageCompleted: z.boolean(),
  score: z.number().int().min(0).max(100_000),
  correctCount: z.number().int().min(0).max(1_000),
  missedCount: z.number().int().min(0).max(1_000),
  elapsedSeconds: z.number().int().min(1).max(3_600),
  reviewWords: z.array(z.object({
    chinese: z.string().min(1).max(80),
    pinyin: z.string().max(120),
    translation: z.string().max(500),
    lesson: z.number().int().min(1).max(100),
  })).max(1_000),
}).superRefine((attempt, context) => {
  if ((attempt.lessonFrom === null) !== (attempt.lessonTo === null)) {
    context.addIssue({ code: "custom", message: "Chọn đủ hai đầu mút của phạm vi bài học." });
  }
  if (attempt.lessonFrom !== null && attempt.lessonTo !== null && attempt.lessonFrom > attempt.lessonTo) {
    context.addIssue({ code: "custom", message: "Phạm vi bài học không hợp lệ." });
  }
  if (attempt.mode === "challenge" && attempt.elapsedSeconds > 60) {
    context.addIssue({ code: "custom", message: "Thử thách chỉ kéo dài tối đa 60 giây." });
  }
  if (attempt.mode === "challenge" && attempt.stageNumber !== 0) {
    context.addIssue({ code: "custom", message: "Thử thách không có số chặng." });
  }
  if (attempt.mode === "stage" && attempt.stageNumber < 1) {
    context.addIssue({ code: "custom", message: "Chặng vượt ải không hợp lệ." });
  }
});

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const url = new URL(request.url);
  const hskLevel = Number(url.searchParams.get("hskLevel"));
  const mode = url.searchParams.get("mode");
  const classId = url.searchParams.get("classId");
  if (!Number.isInteger(hskLevel) || hskLevel < 1 || hskLevel > 7 || (mode !== "stage" && mode !== "challenge")) {
    return Response.json({ error: "Cấp HSK hoặc chế độ chơi không hợp lệ." }, { status: 400 });
  }

  let classFilter: { enrollments: { some: { classId: string } } } | undefined;
  if (classId) {
    const membership = await prisma.enrollment.findFirst({
      where: { userId: user.id, classId },
      select: { id: true },
    });
    if (!membership) return Response.json({ error: "Bạn không thuộc lớp này." }, { status: 403 });
    classFilter = { enrollments: { some: { classId } } };
  }

  const scores = await prisma.shenbiAttempt.findMany({
    where: {
      hskLevel,
      mode,
      user: {
        isActive: true,
        deletedAt: null,
        ...(classFilter ?? {}),
      },
    },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    distinct: ["userId"],
    take: 10,
    select: {
      userId: true,
      score: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return Response.json({
    scores: scores.map((score, index) => ({
      rank: index + 1,
      name: score.user.name,
      score: score.score,
      achievedAt: score.createdAt.toISOString(),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Dữ liệu lượt chơi không hợp lệ." }, { status: 400 });
  }

  const parsed = attemptSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Không thể lưu kết quả: dữ liệu lượt chơi không hợp lệ." }, { status: 400 });
  }
  const attempt = parsed.data;
  if (attempt.assignmentId) {
    const assignment = await prisma.shenbiAssignment.findFirst({
      where: {
        id: attempt.assignmentId,
        active: true,
        hskLevel: attempt.hskLevel,
        mode: attempt.mode,
        lessonFrom: attempt.lessonFrom,
        lessonTo: attempt.lessonTo,
        OR: [{ dueAt: null }, { dueAt: { gte: new Date() } }],
        class: { enrollments: { some: { userId: user.id } } },
      },
      select: { id: true },
    });
    if (!assignment) {
      return Response.json({ error: "Bài giao không còn khả dụng hoặc không khớp với lượt chơi." }, { status: 403 });
    }
  }
  const scopeKey = attempt.lessonFrom === null || attempt.lessonTo === null
    ? "all"
    : `${attempt.lessonFrom}-${attempt.lessonTo}`;
  const lessonOrder = attempt.lessonFrom === null || attempt.lessonTo === null
    ? undefined
    : { gte: attempt.lessonFrom, lte: attempt.lessonTo };
  const courseCode = attempt.hskLevel === 7 ? "HSK7-9-3.0" : `HSK${attempt.hskLevel}-3.0`;
  const [courseWords, customWords] = await Promise.all([
    prisma.vocabItem.findMany({
      where: {
        lesson: {
          order: lessonOrder,
          course: { code: courseCode, status: "PUBLISHED" },
        },
      },
      select: { chinese: true, pinyin: true, lesson: { select: { order: true } } },
    }),
    prisma.shenbiVocabulary.findMany({
      where: { hskLevel: attempt.hskLevel, lesson: lessonOrder },
      select: { chinese: true, pinyin: true, lesson: true },
    }),
  ]);
  const availableWords = new Set([
    ...courseWords.map((word) => `${word.lesson.order}:${word.chinese}:${word.pinyin.trim()}`),
    ...customWords.map((word) => `${word.lesson}:${word.chinese}:${word.pinyin.trim()}`),
  ]);
  const roundWordCount = attempt.mode === "stage"
    ? Math.max(0, Math.min(10, availableWords.size - (attempt.stageNumber - 1) * 10))
    : availableWords.size;
  const resolvedCount = attempt.correctCount + attempt.missedCount;
  const maximumScore = attempt.correctCount * 10 + Math.floor(attempt.correctCount / 5) * 20;
  if (
    roundWordCount === 0
    || resolvedCount > roundWordCount
    || attempt.score < attempt.correctCount * 10
    || attempt.score > maximumScore
  ) {
    return Response.json({ error: "Kết quả không khớp với số từ hoặc quy tắc tính điểm của lượt chơi." }, { status: 400 });
  }
  if (attempt.mode === "stage") {
    const completedStages = await prisma.shenbiAttempt.findMany({
      where: { userId: user.id, hskLevel: attempt.hskLevel, mode: "stage", scopeKey, stageCompleted: true },
      select: { stageNumber: true },
    });
    const unlockedStage = Math.max(1, ...completedStages.map((completed) => completed.stageNumber + 1));
    if (attempt.stageNumber > unlockedStage) {
      return Response.json({ error: "Hãy hoàn thành chặng trước để mở khóa chặng này." }, { status: 403 });
    }
    if (
      attempt.stageCompleted
      && (resolvedCount !== roundWordCount || attempt.correctCount < Math.ceil(roundWordCount * 0.8))
    ) {
      return Response.json({ error: "Chặng chưa đáp ứng điều kiện hoàn thành." }, { status: 400 });
    }
  }
  const accuracy = getAccuracy(attempt.correctCount, attempt.missedCount);

  const saved = await prisma.shenbiAttempt.create({
    data: {
      userId: user.id,
      assignmentId: attempt.assignmentId,
      hskLevel: attempt.hskLevel,
      mode: attempt.mode,
      scopeKey,
      lessonFrom: attempt.lessonFrom,
      lessonTo: attempt.lessonTo,
      stageNumber: attempt.stageNumber,
      stageCompleted: attempt.mode === "stage" && attempt.stageCompleted,
      score: attempt.score,
      correctCount: attempt.correctCount,
      missedCount: attempt.missedCount,
      elapsedSeconds: attempt.elapsedSeconds,
      accuracy,
      reviewWords: attempt.reviewWords,
    },
    select: { id: true, createdAt: true },
  });
  const completedAttempts = attempt.mode === "stage" && attempt.stageCompleted
    ? await prisma.shenbiAttempt.findMany({
        where: {
          userId: user.id,
          hskLevel: attempt.hskLevel,
          mode: "stage",
          scopeKey,
          stageCompleted: true,
        },
        select: { stageNumber: true },
      })
    : [];
  const unlockedStage = Math.max(1, ...completedAttempts.map((record) => record.stageNumber + 1));

  return Response.json({
    success: true,
    id: saved.id,
    createdAt: saved.createdAt.toISOString(),
    accuracy,
    unlockedStage,
  });
}
