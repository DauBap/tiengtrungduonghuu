import type { AssessmentDraftData, AssessmentDraftScope } from "~/lib/assessment-drafts";
import { getAssessmentDraftScopeKey } from "~/lib/assessment-drafts";
import { isEnrolled } from "~/lib/db.server";
import { parseGrammarQuestionType } from "~/lib/grammar";
import { parseListeningConfig, parseWorkbookConfig } from "~/lib/learning-blocks";
import { prisma } from "~/lib/prisma.server";

export async function getAssessmentDraft(userId: string, scope: AssessmentDraftScope) {
  const draft = await prisma.assessmentDraft.findUnique({
    where: {
      userId_scope: {
        userId,
        scope: getAssessmentDraftScopeKey(scope),
      },
    },
    select: { data: true, updatedAt: true },
  });
  return draft ? { data: draft.data, updatedAt: draft.updatedAt.toISOString() } : null;
}

export async function deleteAssessmentDraft(userId: string, scope: AssessmentDraftScope) {
  await prisma.assessmentDraft.deleteMany({
    where: { userId, scope: getAssessmentDraftScopeKey(scope) },
  });
}

export async function validateAssessmentDraftScope(userId: string, scope: unknown) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const value = scope as Record<string, unknown>;

  if (value.kind === "lesson-test" && typeof value.lessonId === "string") {
    const lesson = await prisma.lesson.findUnique({
      where: { id: value.lessonId },
      select: { id: true, courseId: true, test: { select: { timeLimitMinutes: true } } },
    });
    if (!lesson || !(await isEnrolled(userId, lesson.courseId))) return null;
    if (lesson.test?.timeLimitMinutes !== null) return null;
    return {
      scope: { kind: "lesson-test", lessonId: lesson.id } satisfies AssessmentDraftScope,
      lesson,
    };
  }

  if (
    value.kind === "lesson-tab"
    && typeof value.lessonId === "string"
    && typeof value.tab === "string"
    && ["VOCABULARY_TEST", "TRANSLATION", "GRAMMAR", "LISTENING", "PHONETICS", "WORKBOOK"].includes(value.tab)
    && (value.activityId === undefined || typeof value.activityId === "string")
  ) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: value.lessonId },
      select: {
        id: true,
        courseId: true,
        course: { select: { code: true } },
        test: { select: { timeLimitMinutes: true } },
      },
    });
    if (!lesson || !(await isEnrolled(userId, lesson.courseId))) return null;
    const tab = value.tab as Extract<AssessmentDraftScope, { kind: "lesson-tab" }>["tab"];
    const activityId = typeof value.activityId === "string" ? value.activityId : undefined;

    if (tab === "VOCABULARY_TEST") {
      if (activityId !== undefined || lesson.test?.timeLimitMinutes !== null) return null;
    }
    if (tab === "TRANSLATION") {
      if (activityId !== undefined) return null;
      const [questionCount, pendingSubmission] = await Promise.all([
        prisma.translationQuestion.count({ where: { lessonId: lesson.id } }),
        prisma.translationSubmission.findFirst({
          where: { studentId: userId, lessonId: lesson.id, status: "SUBMITTED" },
          select: { id: true },
        }),
      ]);
      if (questionCount === 0 || pendingSubmission) return null;
    }
    if (tab === "GRAMMAR") {
      if (!activityId) return null;
      const separator = activityId.lastIndexOf(":");
      if (separator <= 0) return null;
      const sectionId = activityId.slice(0, separator);
      const questionType = parseGrammarQuestionType(activityId.slice(separator + 1));
      if (!questionType) return null;
      const isFullLessonPractice = sectionId === `full-grammar:${lesson.id}`;
      if (isFullLessonPractice && !["HSK2-2.0", "HSK3-2.0", "HSK4-2.0", "HSK5-2.0"].includes(lesson.course.code)) {
        return null;
      }
      const section = await prisma.grammarSection.findFirst({
        where: isFullLessonPractice
          ? {
              lessonId: lesson.id,
              questions: { some: { type: questionType } },
            }
          : {
              id: sectionId,
              lessonId: lesson.id,
              questions: { some: { type: questionType } },
            },
        select: { id: true },
      });
      if (!section) return null;
    }
    if (tab === "LISTENING") {
      if (!activityId) return null;
      const block = await prisma.learningBlock.findFirst({
        where: { id: activityId, lessonId: lesson.id, type: "LISTENING" },
        select: { config: true },
      });
      if (!block || !parseListeningConfig(block.config).ok) return null;
    }
    if (tab === "PHONETICS") {
      const sectionKey = Number(activityId);
      if (!activityId || !Number.isInteger(sectionKey) || sectionKey <= 0) return null;
      const section = await prisma.phoneticsSection.findFirst({
        where: { lessonId: lesson.id, sectionKey, questions: { some: {} } },
        select: { sectionKey: true },
      });
      if (!section) return null;
    }
    if (tab === "WORKBOOK") {
      if (!activityId) return null;
      const block = await prisma.learningBlock.findFirst({
        where: { id: activityId, lessonId: lesson.id, type: "WORKBOOK" },
        select: { config: true },
      });
      if (!block) return null;
      const parsed = parseWorkbookConfig(block.config);
      if (!parsed.ok || parsed.data.timeLimit !== 0) return null;
    }

    return {
      scope: { kind: "lesson-tab", lessonId: lesson.id, tab, activityId } satisfies AssessmentDraftScope,
      lesson,
    };
  }

  if (value.kind === "course-review" && typeof value.reviewSetId === "string") {
    const reviewSet = await prisma.courseReviewSet.findUnique({
      where: { id: value.reviewSetId },
      select: { id: true, courseId: true },
    });
    if (!reviewSet || !(await isEnrolled(userId, reviewSet.courseId))) return null;
    return {
      scope: { kind: "course-review", reviewSetId: reviewSet.id } satisfies AssessmentDraftScope,
      reviewSet,
    };
  }

  if (
    value.kind === "combined-test"
    && typeof value.courseId === "string"
    && Array.isArray(value.lessonIds)
    && value.lessonIds.length > 0
    && value.lessonIds.length <= 100
    && value.lessonIds.every((id) => typeof id === "string")
  ) {
    if (!(await isEnrolled(userId, value.courseId))) return null;
    const lessonIds = [...new Set(value.lessonIds as string[])].sort();
    const lessons = await prisma.lesson.findMany({
      where: { id: { in: lessonIds }, courseId: value.courseId },
      select: { id: true },
    });
    if (lessons.length !== lessonIds.length) return null;
    return {
      scope: { kind: "combined-test", courseId: value.courseId, lessonIds } satisfies AssessmentDraftScope,
      courseId: value.courseId,
    };
  }

  return null;
}

export async function saveAssessmentDraft(
  userId: string,
  scope: AssessmentDraftScope,
  data: AssessmentDraftData,
) {
  const key = getAssessmentDraftScopeKey(scope);
  return prisma.assessmentDraft.upsert({
    where: { userId_scope: { userId, scope: key } },
    create: { userId, scope: key, data: data as object },
    update: { data: data as object },
    select: { updatedAt: true },
  });
}
