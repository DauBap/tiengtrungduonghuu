import { Prisma, PrismaClient } from "@prisma/client";
import type { LessonTabKey, LessonTabProgressState } from "@prisma/client";
import { LESSON_TAB_KEYS, isLessonTabKey, type LessonTab } from "~/lib/lesson-tab-progress";

export type LessonTabState = LessonTabProgressState;
export type { LessonTab };
export { LESSON_TAB_KEYS, isLessonTabKey };

export interface AttemptInput {
  userId: string;
  lessonId: string;
  tab: LessonTab;
  mode?: string;
  score?: number | null;
  correctCount?: number | null;
  totalCount?: number | null;
  passed?: boolean | null;
  details?: Prisma.InputJsonValue;
  startedAt?: Date | null;
  completedAt?: Date;
}

export interface ItemProgressInput {
  tabProgressId: string;
  itemKey: string;
  attemptId?: string | null;
  state?: LessonTabState;
  attempts?: number;
  correct?: boolean | null;
  score?: number | null;
  lastAnswer?: string | null;
  viewedAt?: Date | null;
  completedAt?: Date | null;
}

export interface TabSnapshot {
  percent: number;
  completed: boolean;
  state: LessonTabState;
  currentScore: number | null;
  bestScore: number | null;
};

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeScore(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function computeTabSnapshot(input: {
  opened: boolean;
  completed: boolean;
  percent?: number;
  currentScore?: number | null;
  bestScore?: number | null;
  needsReview?: boolean;
}): TabSnapshot {
  const percent = boundedPercent(input.percent ?? (input.completed ? 100 : 0));
  const completed = input.completed || percent >= 100;
  const state: LessonTabState = input.needsReview
    ? "NEEDS_REVIEW"
    : completed
      ? "COMPLETED"
      : input.opened || percent > 0
        ? "IN_PROGRESS"
        : "NOT_STARTED";

  return {
    percent,
    completed,
    state,
    currentScore: normalizeScore(input.currentScore),
    bestScore: normalizeScore(input.bestScore),
  };
}

export async function openLessonTab(
  prisma: PrismaClient,
  input: { userId: string; lessonId: string; tab: LessonTab }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lessonTabProgress.findUnique({
      where: { userId_lessonId_tab: input },
    });
    const completesOnOpen = input.tab === "VOCABULARY";
    const snapshot = computeTabSnapshot({
      opened: true,
      completed: completesOnOpen || (existing?.completed ?? false),
      percent: completesOnOpen ? 100 : existing?.percent ?? 0,
      currentScore: existing?.currentScore,
      bestScore: existing?.bestScore,
      needsReview: !completesOnOpen && existing?.state === "NEEDS_REVIEW",
    });

    return tx.lessonTabProgress.upsert({
      where: { userId_lessonId_tab: input },
      update: {
        opened: true,
        completed: snapshot.completed,
        percent: snapshot.percent,
        state: snapshot.state,
        completedAt: snapshot.completed ? existing?.completedAt ?? new Date() : existing?.completedAt,
      },
      create: {
        ...input,
        opened: true,
        state: snapshot.state,
        percent: snapshot.percent,
        completed: snapshot.completed,
        currentScore: snapshot.currentScore,
        bestScore: snapshot.bestScore,
        completedAt: snapshot.completed ? new Date() : null,
      },
    });
  });
}

export async function recordLessonTabItem(
  prisma: PrismaClient,
  input: ItemProgressInput
) {
  return prisma.lessonTabItemProgress.upsert({
    where: {
      tabProgressId_itemKey: {
        tabProgressId: input.tabProgressId,
        itemKey: input.itemKey,
      },
    },
    update: {
      attemptId: input.attemptId,
      state: input.state,
      attempts: input.attempts,
      correct: input.correct,
      score: normalizeScore(input.score),
      lastAnswer: input.lastAnswer,
      viewedAt: input.viewedAt,
      completedAt: input.completedAt,
    },
    create: {
      tabProgressId: input.tabProgressId,
      attemptId: input.attemptId,
      itemKey: input.itemKey,
      state: input.state,
      attempts: input.attempts ?? 0,
      correct: input.correct,
      score: normalizeScore(input.score),
      lastAnswer: input.lastAnswer,
      viewedAt: input.viewedAt,
      completedAt: input.completedAt,
    },
  });
}

export async function recordLessonTabAttempt(prisma: PrismaClient, input: AttemptInput) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.lessonTabProgress.findUnique({
      where: {
        userId_lessonId_tab: {
          userId: input.userId,
          lessonId: input.lessonId,
          tab: input.tab,
        },
      },
    });
    const score = normalizeScore(input.score);
    const completedAt = input.completedAt ?? new Date();
    const completed = input.tab === "VOCABULARY_TEST" ? input.passed === true : true;
    const state: LessonTabState = completed ? "COMPLETED" : "IN_PROGRESS";
    const percent = completed ? 100 : 0;
    const bestScore = score == null
      ? previous?.bestScore ?? null
      : Math.max(previous?.bestScore ?? 0, score);
    const progress = await tx.lessonTabProgress.upsert({
      where: {
        userId_lessonId_tab: {
          userId: input.userId,
          lessonId: input.lessonId,
          tab: input.tab,
        },
      },
      update: {
        opened: true,
        completed,
        state,
        percent,
        currentScore: score,
        bestScore,
        lastAttemptAt: completedAt,
        completedAt: completed ? previous?.completedAt ?? completedAt : null,
      },
      create: {
        userId: input.userId,
        lessonId: input.lessonId,
        tab: input.tab,
        opened: true,
        completed,
        state,
        percent,
        currentScore: score,
        bestScore,
        lastAttemptAt: completedAt,
        completedAt: completed ? completedAt : null,
      },
    });

    const attempt = await tx.lessonTabAttempt.create({
      data: {
        userId: input.userId,
        lessonId: input.lessonId,
        tab: input.tab,
        mode: input.mode,
        score,
        correctCount: input.correctCount,
        totalCount: input.totalCount,
        passed: input.passed,
        details: input.details,
        startedAt: input.startedAt,
        completedAt,
      },
    });

    return { progress, attempt };
  });
}

export async function addLessonTabFeedback(
  prisma: PrismaClient,
  input: {
    tabProgressId: string;
    teacherId: string;
    targetType?: string | null;
    targetId?: string | null;
    score?: number | null;
    comment: string;
  }
) {
  const comment = input.comment.trim();
  if (!comment) throw new Error("Feedback comment cannot be empty");

  return prisma.lessonTabFeedback.create({
    data: {
      tabProgressId: input.tabProgressId,
      teacherId: input.teacherId,
      targetType: input.targetType,
      targetId: input.targetId,
      score: normalizeScore(input.score),
      comment,
    },
  });
}

export async function getStudentLessonTabProgress(
  prisma: PrismaClient,
  input: { userId: string; lessonId: string }
) {
  return prisma.lessonTabProgress.findMany({
    where: input,
    orderBy: { tab: "asc" },
    include: {
      attempts: { orderBy: { completedAt: "desc" } },
      feedback: { orderBy: { createdAt: "desc" } },
    },
  });
}
