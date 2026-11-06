import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getTeacherCourses } from "~/lib/db.server";
import { formatSchedule, formatNextClass, getNextClassTime } from "~/lib/schedule-utils";
import { AppShell } from "~/components/layout/app-shell";
import { useModalScrollLock } from "~/components/common/use-modal-scroll-lock";
import { StatCard } from "~/components/common/stat-card";
import { Card, CardContent } from "~/components/ui/card";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  Loader2,
  MessageCircle,
  TrendingUp,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import {
  getGrammarActivityProgress,
  getLessonProgress,
  getLessonScriptProgress,
  isLessonProgressGreen,
  type GrammarAttemptProgress,
  type GrammarQuestionGroup,
} from "~/lib/lesson-progress-summary";
import {
  GRAMMAR_QUESTION_META,
  parseGrammarQuestionType,
  type GrammarQuestionType,
  type TeacherGrammarGrade,
} from "~/lib/grammar";
import { aggregatePhoneticsSections, getBestPhoneticsSectionAttempts, type PhoneticsReviewResult } from "~/lib/phonetics";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import type { loader as courseItemProgressLoader } from "./teacher.courses.$courseId.progress.$type.$itemId";
import type { loader as mockExamAttemptLoader } from "./teacher.courses.$courseId.progress.mock-exams.$itemId.students.$studentId.attempts.$attemptId";

const DASHBOARD_ACTIVITIES = [
  { tab: "FLASHCARD", label: "Flashcard" },
  { tab: "LESSON", label: "Bài khóa" },
  { tab: "PHONETICS", label: "Ngữ âm" },
  { tab: "VOCABULARY_TEST", label: "Ôn từ vựng" },
  { tab: "LISTENING", label: "Nghe câu" },
  { tab: "GRAMMAR", label: "Ngữ pháp" },
  { tab: "WORKBOOK", label: "Sách bài tập" },
  { tab: "TRANSLATION", label: "Luyện dịch" },
] as const;

type DashboardActivityTab = (typeof DASHBOARD_ACTIVITIES)[number]["tab"];

type PendingGrammarAttempt = Awaited<ReturnType<typeof loader>>["classSummaries"][number]["pendingGrammarAttempts"][number];
type DashboardReviewItem = Extract<
  Awaited<ReturnType<typeof loader>>["classSummaries"][number]["courseItems"][number],
  { kind: "review" }
>;
type DashboardMockExamItem = Extract<
  Awaited<ReturnType<typeof loader>>["classSummaries"][number]["courseItems"][number],
  { kind: "mockExam" }
>;

interface GrammarAttemptData {
  course: { id: string; title: string };
  lesson: { id: string; title: string };
  student: { id: string; name: string | null; email: string };
  attempt: {
    id: string;
    sectionTitle: string;
    questionType: GrammarQuestionType | null;
    results: {
      id: string;
      prompt: string;
      type: GrammarQuestionType;
      given: string;
      givenTokens: string[] | null;
      correctAnswer: string;
      correct: boolean;
      autoCorrect: boolean;
      teacherFeedback: string;
      points: number;
      hint: string | null;
    }[];
  };
}

interface MockExamProgressDialogState {
  classId: string;
  mockExamId: string;
  mockExamTitle: string;
  studentId: string;
  studentName: string;
  attemptId: string;
}

interface DashboardWrongAnswer {
  prompt: string;
  full: string;
  given: string;
  correctAnswer: string;
  answerMode: "chinese" | "pinyin" | "plain";
  translation: string;
  groupLabel: string;
}

interface ActivityReviewDialogState {
  activityLabel: string;
  studentName: string;
  lessonTitle: string;
  correctCount: number;
  totalCount: number;
  wrongAnswers: DashboardWrongAnswer[];
}

interface ReviewProgressDialogState {
  classId: string;
  reviewId: string;
  reviewTitle: string;
  studentId: string;
  studentName: string;
}

interface LessonReviewDialogState {
  studentName: string;
  lessonTitle: string;
  scripts: {
    id: string;
    title: string;
    attempts: {
      id: string;
      scriptText: string;
      transcript: string;
      evaluation: string | null;
      score: number | null;
      completedAt: string;
    }[];
  }[];
}

interface WorkbookGradingData {
  course: { id: string; title: string };
  lesson: { id: string; title: string };
  student: { id: string; name: string | null; email: string };
  attempt: {
    blockTitle: string;
    results: {
      id: string;
      number: number;
      sectionTitle: string;
      prompt: string;
      passage: string;
      givenLabel: string;
      correctAnswer: string;
      teacherReviewPending: boolean;
    }[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const searchParams = new URL(request.url).searchParams;
  const initialGradeAttemptId = searchParams.get("gradeAttemptId");
  const initialWorkbookAttemptId = searchParams.get("gradeWorkbookAttemptId");
  const initialTranslationSubmissionId = searchParams.get("gradeTranslationId");
  const myCourses = await getTeacherCourses(user.id);
  const myClasses = await prisma.class.findMany({
    where: { teacherId: user.id, completedAt: null },
    include: {
      course: { select: { id: true, title: true, code: true, hskLevel: true, description: true, order: true } },
      enrollments: {
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });

  const assignedCourseIds = [...new Set(myClasses.map((cls) => cls.courseId))];
  const assignedStudentIds = [...new Set(myClasses.flatMap((cls) => cls.enrollments.map((item) => item.userId)))];
  const [translationSubmissions, initialTranslationSubmission] = await Promise.all([
    prisma.translationSubmission.findMany({
      where: {
        lesson: { courseId: { in: assignedCourseIds } },
        studentId: { in: assignedStudentIds },
      },
      orderBy: { submittedAt: "desc" },
      include: {
        student: { select: { id: true, name: true, email: true } },
        lesson: { select: { id: true, title: true, courseId: true, course: { select: { title: true } } } },
        teacher: { select: { name: true } },
      },
    }),
    initialTranslationSubmissionId
      ? prisma.translationSubmission.findFirst({
          where: {
            id: initialTranslationSubmissionId,
            lesson: { courseId: { in: assignedCourseIds } },
            studentId: { in: assignedStudentIds },
          },
          include: {
            student: { select: { id: true, name: true, email: true } },
            lesson: { select: { id: true, title: true, courseId: true } },
            teacher: { select: { name: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  let initialWorkbookTargetUrl: string | null = null;
  if (initialWorkbookAttemptId) {
    const candidate = await prisma.lessonTabAttempt.findFirst({
      where: { id: initialWorkbookAttemptId, tab: "WORKBOOK" },
      select: {
        id: true,
        userId: true,
        details: true,
        lesson: { select: { id: true, courseId: true } },
      },
    });
    const isAssignedStudent = candidate && myClasses.some((cls) =>
      cls.courseId === candidate.lesson.courseId
      && cls.enrollments.some((enrollment) => enrollment.userId === candidate.userId)
    );
    const details = isRecord(candidate?.details) ? candidate.details : {};
    const hasPendingQuestions = Array.isArray(details.results)
      && details.results.some((item) => isRecord(item) && item.teacherReviewPending === true);
    if (candidate && isAssignedStudent && details.reviewPending === true && hasPendingQuestions) {
      initialWorkbookTargetUrl = `/teacher/courses/${encodeURIComponent(candidate.lesson.courseId)}/lessons/${encodeURIComponent(candidate.lesson.id)}/students/${encodeURIComponent(candidate.userId)}/workbook-history/attempts/${encodeURIComponent(candidate.id)}`;
    }
  }

  const courseIds = [...new Set(myClasses.map((cls) => cls.courseId))];
  const [lessonCounts, lessonsByCourse, reviewSetsByCourse, mockExamsByCourse] = await Promise.all([
    Promise.all(courseIds.map(async (courseId) => [courseId, await prisma.lesson.count({ where: { courseId } })] as const)),
    Promise.all(courseIds.map(async (courseId) => {
      const lessons = await prisma.lesson.findMany({
        where: { courseId },
        select: {
          id: true,
          order: true,
          title: true,
          _count: { select: { content: true, grammarSections: true, phoneticsSections: true, audioScripts: true } },
          learningBlocks: { select: { type: true, required: true } },
        },
        orderBy: { order: "asc" },
      });
      return [courseId, lessons] as const;
    })),
    Promise.all(courseIds.map(async (courseId) => {
      const reviewSets = await prisma.courseReviewSet.findMany({
        where: { courseId },
        select: {
          id: true,
          order: true,
          title: true,
          subtitle: true,
          _count: { select: { questions: true } },
        },
        orderBy: { order: "asc" },
      });
      return [courseId, reviewSets] as const;
    })),
    Promise.all(courseIds.map(async (courseId) => {
      const mockExams = await prisma.mockExam.findMany({
        where: { courseId },
        select: {
          id: true,
          title: true,
          sections: { select: { _count: { select: { questions: true } } } },
        },
        orderBy: { createdAt: "asc" },
      });
      return [courseId, mockExams] as const;
    })),
  ]);
  const lessonCountByCourse = new Map(lessonCounts);
  const lessonMapByCourse = new Map(lessonsByCourse);
  const reviewSetMapByCourse = new Map(reviewSetsByCourse);
  const mockExamMapByCourse = new Map(mockExamsByCourse);
  const totalLessons = myCourses.reduce((sum, course) => sum + (lessonCountByCourse.get(course.id) ?? 0), 0);
  const totalStudents = myClasses.reduce((sum, cls) => sum + cls.enrollments.length, 0);

  const classSummaries = await Promise.all(myClasses.map(async (cls) => {
    const courseLessons = lessonMapByCourse.get(cls.courseId) ?? [];
    const courseReviewSets = reviewSetMapByCourse.get(cls.courseId) ?? [];
    const courseMockExams = mockExamMapByCourse.get(cls.courseId) ?? [];
    const lessonIds = courseLessons.map((lesson) => lesson.id);
    const reviewSetIds = courseReviewSets.map((reviewSet) => reviewSet.id);
    const mockExamIds = courseMockExams.map((mockExam) => mockExam.id);
    const userIds = cls.enrollments.map((enrollment) => enrollment.userId);
    const [progressRows, lessonAudioScripts, pronunciationAssessments, lessonAttempts, phoneticsSections, phoneticsAttempts, grammarAttempts, grammarAutoAttempts, grammarQuestionRows, reviewAttempts, mockExamAttempts] = (lessonIds.length > 0 || reviewSetIds.length > 0 || mockExamIds.length > 0) && userIds.length > 0
      ? await Promise.all([
          lessonIds.length > 0 ? prisma.lessonTabProgress.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
            },
            select: {
              userId: true,
              lessonId: true,
              tab: true,
              state: true,
              completed: true,
              opened: true,
              percent: true,
              currentScore: true,
              bestScore: true,
              lastAttemptAt: true,
              updatedAt: true,
              attempts: {
                where: { tab: { in: DASHBOARD_ACTIVITIES.map((activity) => activity.tab) } },
                orderBy: { completedAt: "desc" },
                take: 1,
                select: {
                  score: true,
                  passed: true,
                  completedAt: true,
                  correctCount: true,
                  totalCount: true,
                  details: true,
                },
              },
            },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.lessonAudioScript.findMany({
            where: { lessonId: { in: lessonIds } },
            select: { id: true, lessonId: true },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.pronunciationAssessment.findMany({
            where: {
              userId: { in: userIds },
              lessonAudioScript: { lessonId: { in: lessonIds } },
            },
            select: {
              userId: true,
              lessonAudioScriptId: true,
              score: true,
            },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.lessonTabAttempt.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
              tab: "LESSON",
            },
            select: {
              id: true,
              userId: true,
              lessonId: true,
              score: true,
              completedAt: true,
              details: true,
            },
            orderBy: { completedAt: "desc" },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.phoneticsSection.findMany({
            where: { lessonId: { in: lessonIds }, questions: { some: {} } },
            select: {
              lessonId: true,
              sectionKey: true,
              title: true,
              _count: { select: { questions: true } },
            },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.lessonTabAttempt.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
              tab: "PHONETICS",
              score: { not: null },
            },
            select: {
              userId: true,
              lessonId: true,
              mode: true,
              score: true,
              correctCount: true,
              completedAt: true,
              details: true,
            },
            orderBy: { completedAt: "desc" },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.lessonTabAttempt.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
              tab: "GRAMMAR",
              mode: "FILL",
            },
            select: {
              id: true,
              userId: true,
              lessonId: true,
              completedAt: true,
              details: true,
            },
            orderBy: { completedAt: "desc" },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.lessonTabAttempt.findMany({
            where: {
              lessonId: { in: lessonIds },
              userId: { in: userIds },
              tab: "GRAMMAR",
              mode: { in: ["SINGLE_CHOICE", "ARRANGE"] },
            },
            select: {
              userId: true,
              lessonId: true,
              mode: true,
              correctCount: true,
              totalCount: true,
              completedAt: true,
              details: true,
            },
            orderBy: { completedAt: "desc" },
          }) : Promise.resolve([]),
          lessonIds.length > 0 ? prisma.grammarQuestion.findMany({
            where: {
              section: { lessonId: { in: lessonIds } },
            },
            select: {
              sectionId: true,
              type: true,
              section: { select: { lessonId: true } },
            },
          }) : Promise.resolve([]),
          reviewSetIds.length > 0 ? prisma.courseReviewAttempt.findMany({
            where: {
              reviewSetId: { in: reviewSetIds },
              userId: { in: userIds },
            },
            select: {
              userId: true,
              reviewSetId: true,
              percentage: true,
              completedAt: true,
            },
            orderBy: { completedAt: "desc" },
          }) : Promise.resolve([]),
          mockExamIds.length > 0 ? prisma.mockExamAttempt.findMany({
            where: {
              mockExamId: { in: mockExamIds },
              userId: { in: userIds },
            },
            select: {
              id: true,
              userId: true,
              mockExamId: true,
              attemptNumber: true,
              status: true,
              percentage: true,
              passed: true,
              startedAt: true,
              submittedAt: true,
            },
            orderBy: { startedAt: "desc" },
          }) : Promise.resolve([]),
        ])
      : [[], [], [], [], [], [], [], [], [], [], []];

    const enrollmentsByUserId = new Map(cls.enrollments.map((enrollment) => [enrollment.userId, enrollment]));
    const lessonsById = new Map(courseLessons.map((lesson) => [lesson.id, lesson]));
    const audioScriptIdsByLesson = new Map<string, string[]>();
    const audioScriptLessonById = new Map<string, string>();
    for (const script of lessonAudioScripts) {
      const scriptIds = audioScriptIdsByLesson.get(script.lessonId) ?? [];
      scriptIds.push(script.id);
      audioScriptIdsByLesson.set(script.lessonId, scriptIds);
      audioScriptLessonById.set(script.id, script.lessonId);
    }
    const pronunciationScoresByUserLesson = new Map<string, { scriptId: string; score: number }[]>();
    for (const assessment of pronunciationAssessments) {
      const lessonId = audioScriptLessonById.get(assessment.lessonAudioScriptId);
      if (!lessonId) continue;
      const key = `${assessment.userId}:${lessonId}`;
      const attempts = pronunciationScoresByUserLesson.get(key) ?? [];
      attempts.push({ scriptId: assessment.lessonAudioScriptId, score: assessment.score });
      pronunciationScoresByUserLesson.set(key, attempts);
    }
    const phoneticsSectionsByLesson = new Map<string, { sectionId: number; totalCount: number; title: string }[]>();
    for (const section of phoneticsSections) {
      const sections = phoneticsSectionsByLesson.get(section.lessonId) ?? [];
      sections.push({
        sectionId: section.sectionKey,
        totalCount: section._count.questions,
        title: section.title,
      });
      phoneticsSectionsByLesson.set(section.lessonId, sections);
    }
    const grammarQuestionTotalsByLesson = new Map<string, number>();
    const grammarGroupsByLesson = new Map<string, GrammarQuestionGroup[]>();
    for (const question of grammarQuestionRows) {
      const groups = grammarGroupsByLesson.get(question.section.lessonId) ?? [];
      groups.push({ sectionId: question.sectionId, questionType: question.type });
      grammarGroupsByLesson.set(question.section.lessonId, groups);
      if (question.type === "SINGLE_CHOICE" || question.type === "ARRANGE") {
        grammarQuestionTotalsByLesson.set(
          question.section.lessonId,
          (grammarQuestionTotalsByLesson.get(question.section.lessonId) ?? 0) + 1,
        );
      }
    }
    const latestGrammarAttemptsBySectionType = new Map<string, (typeof grammarAutoAttempts)[number]>();
    for (const attempt of grammarAutoAttempts) {
      const details = isRecord(attempt.details) ? attempt.details : {};
      const questionType = details.questionType === "SINGLE_CHOICE" || details.questionType === "ARRANGE"
        ? details.questionType
        : attempt.mode;
      if (questionType !== "SINGLE_CHOICE" && questionType !== "ARRANGE") continue;
      const sectionId = typeof details.sectionId === "string" ? details.sectionId : "unknown-section";
      const key = `${attempt.userId}:${attempt.lessonId}:${sectionId}:${questionType}`;
      if (!latestGrammarAttemptsBySectionType.has(key)) {
        latestGrammarAttemptsBySectionType.set(key, attempt);
      }
    }
    const grammarSummaryByUserLesson = new Map<string, {
      lessonId: string;
      correctCount: number;
      totalCount: number;
    }>();
    for (const attempt of latestGrammarAttemptsBySectionType.values()) {
      const summaryKey = `${attempt.userId}:${attempt.lessonId}`;
      const summary = grammarSummaryByUserLesson.get(summaryKey) ?? {
        lessonId: attempt.lessonId,
        correctCount: 0,
        totalCount: 0,
      };
      summary.correctCount += attempt.correctCount ?? 0;
      summary.totalCount += attempt.totalCount ?? 0;
      grammarSummaryByUserLesson.set(summaryKey, summary);
    }
    for (const summary of grammarSummaryByUserLesson.values()) {
      summary.totalCount = grammarQuestionTotalsByLesson.get(summary.lessonId) ?? summary.totalCount;
      summary.correctCount = Math.min(summary.correctCount, summary.totalCount);
    }
    const grammarAttemptsByUserLesson = new Map<string, GrammarAttemptProgress[]>();
    for (const attempt of [...grammarAttempts, ...grammarAutoAttempts]) {
      const details = isRecord(attempt.details) ? attempt.details : {};
      const questionType = parseGrammarQuestionType(
        details.questionType ?? ("mode" in attempt ? attempt.mode : null),
      );
      if (typeof details.sectionId !== "string" || !questionType) continue;

      const key = `${attempt.userId}:${attempt.lessonId}`;
      const attempts = grammarAttemptsByUserLesson.get(key) ?? [];
      const teacherGrading = details.teacherGrading;
      attempts.push({
        sectionId: details.sectionId,
        questionType,
        completedAt: attempt.completedAt,
        reviewPending: details.reviewPending === true
          && !isRecord(teacherGrading),
      });
      grammarAttemptsByUserLesson.set(key, attempts);
    }
    const phoneticsAttemptsByUserLesson = new Map<string, {
      sectionId: number;
      score: number;
      correctCount: number;
      completedAt: Date;
      results: PhoneticsReviewResult[];
    }[]>();
    for (const attempt of phoneticsAttempts) {
      const details = isRecord(attempt.details) ? attempt.details : {};
      const sectionId = typeof details.sectionId === "number" ? details.sectionId : Number(attempt.mode);
      if (!Number.isInteger(sectionId) || attempt.score == null || attempt.correctCount == null) continue;
      const results = Array.isArray(details.results)
        ? details.results.flatMap((result): PhoneticsReviewResult[] => {
            if (!isRecord(result)) return [];
            return [{
              prompt: typeof result.prompt === "string" ? result.prompt : "Câu hỏi",
              full: typeof result.full === "string" ? result.full : "",
              given: typeof result.given === "string" ? result.given : "",
              correctAnswer: typeof result.correctAnswer === "string" ? result.correctAnswer : "",
              correct: result.correct === true,
            }];
          })
        : [];
      const key = `${attempt.userId}:${attempt.lessonId}`;
      const attempts = phoneticsAttemptsByUserLesson.get(key) ?? [];
      attempts.push({
        sectionId,
        score: attempt.score,
        correctCount: attempt.correctCount,
        completedAt: attempt.completedAt,
        results,
      });
      phoneticsAttemptsByUserLesson.set(key, attempts);
    }
    const pendingGrammarAttempts = grammarAttempts.flatMap((attempt) => {
      const details = isRecord(attempt.details) ? attempt.details : {};
      if (
        details.questionType !== "FILL"
        || details.reviewPending !== true
        || isRecord(details.teacherGrading)
      ) {
        return [];
      }

      const enrollment = enrollmentsByUserId.get(attempt.userId);
      const lesson = lessonsById.get(attempt.lessonId);
      if (!enrollment || !lesson) return [];

      return [{
        id: attempt.id,
        lessonId: attempt.lessonId,
        userId: attempt.userId,
        studentName: enrollment.user.name ?? enrollment.user.email,
        lessonTitle: lesson.title,
        sectionTitle: typeof details.sectionTitle === "string" ? details.sectionTitle : "Dịch câu",
        completedAt: attempt.completedAt.toISOString(),
      }];
    });

    const progressByKey = new Map(progressRows.map((row) => [`${row.userId}:${row.lessonId}:${row.tab}`, row]));
    const reviewProgressByKey = new Map<string, (typeof reviewAttempts)[number]>();
    const reviewAttemptsByKey = new Map<string, typeof reviewAttempts>();
    for (const attempt of reviewAttempts) {
      const key = `${attempt.userId}:${attempt.reviewSetId}`;
      const attemptsForStudent = reviewAttemptsByKey.get(key) ?? [];
      attemptsForStudent.push(attempt);
      reviewAttemptsByKey.set(key, attemptsForStudent);
      if (!reviewProgressByKey.has(key)) reviewProgressByKey.set(key, attempt);
    }
    const mockExamProgressByKey = new Map<string, (typeof mockExamAttempts)[number]>();
    for (const attempt of mockExamAttempts) {
      const key = `${attempt.userId}:${attempt.mockExamId}`;
      if (!mockExamProgressByKey.has(key)) mockExamProgressByKey.set(key, attempt);
    }
    const lessons = courseLessons.map((lesson, index) => ({
      id: lesson.id,
      order: lesson.order,
      displayOrder: index + 1,
      title: lesson.title,
      availableActivities: {
        FLASHCARD: lesson.learningBlocks.some((block) => block.type === "FLASHCARD" && block.required),
        LESSON: lesson._count.audioScripts > 0,
        PHONETICS: (phoneticsSectionsByLesson.get(lesson.id)?.length ?? 0) > 0,
        VOCABULARY_TEST: lesson._count.content > 0,
        LISTENING: lesson.learningBlocks.some((block) => block.type === "LISTENING" && block.required),
        GRAMMAR: lesson._count.grammarSections > 0,
        WORKBOOK: lesson.learningBlocks.some((block) => block.type === "WORKBOOK" && block.required),
        TRANSLATION: false,
      },
    }));
    const reviews = courseReviewSets.map((reviewSet, index) => ({
      id: reviewSet.id,
      order: reviewSet.order,
      label: `Ôn tập ${index + 1}`,
      title: reviewSet.title,
      subtitle: reviewSet.subtitle,
      questionCount: reviewSet._count.questions,
    }));
    const courseItems = [
      ...lessons.map((lesson) => ({ kind: "lesson" as const, ...lesson })),
      ...reviews.map((review) => ({ kind: "review" as const, ...review })),
    ].sort((a, b) => a.order - b.order);
    const progressItems = [
      ...courseItems,
      ...courseMockExams.map((mockExam, index) => ({
        kind: "mockExam" as const,
        id: mockExam.id,
        label: `Thi thử ${index + 1}`,
        title: mockExam.title,
        questionCount: mockExam.sections.reduce((total, section) => total + section._count.questions, 0),
      })),
    ];
    const grammarProgressByUserLesson = new Map<string, ReturnType<typeof getGrammarActivityProgress>>();
    const activityData = cls.enrollments.map((enrollment) => {
      const lastActivityAt = progressRows
        .filter((row) => row.userId === enrollment.userId)
        .reduce<Date | null>((latest, row) => {
          const activityAt = row.lastAttemptAt ?? row.attempts[0]?.completedAt ?? row.updatedAt;
          return !latest || activityAt > latest ? activityAt : latest;
        }, null);
      const lastReviewActivityAt = reviewAttempts
        .filter((attempt) => attempt.userId === enrollment.userId)
        .reduce<Date | null>((latest, attempt) => (
          !latest || attempt.completedAt > latest ? attempt.completedAt : latest
        ), null);
      const lastMockExamActivityAt = mockExamAttempts
        .filter((attempt) => attempt.userId === enrollment.userId)
        .reduce<Date | null>((latest, attempt) => {
          const activityAt = attempt.submittedAt ?? attempt.startedAt;
          return !latest || activityAt > latest ? activityAt : latest;
        }, null);
      const activityDates = [lastActivityAt, lastReviewActivityAt, lastMockExamActivityAt]
        .filter((date): date is Date => date !== null);
      const latestActivityAt = activityDates.length > 0
        ? activityDates.reduce((latest, date) => date > latest ? date : latest)
        : null;
      const studentLessons = lessons.map((lesson) => {
        const lessonKey = `${enrollment.userId}:${lesson.id}`;
        const lessonScriptProgress = getLessonScriptProgress(
          audioScriptIdsByLesson.get(lesson.id) ?? [],
          pronunciationScoresByUserLesson.get(lessonKey) ?? [],
        );
        const grammarProgress = getGrammarActivityProgress(
          grammarGroupsByLesson.get(lesson.id) ?? [],
          grammarAttemptsByUserLesson.get(lessonKey) ?? [],
        );
        grammarProgressByUserLesson.set(lessonKey, grammarProgress);
        const lessonPhoneticsSections = phoneticsSectionsByLesson.get(lesson.id) ?? [];
        const lessonPhoneticsAttempts = phoneticsAttemptsByUserLesson.get(`${enrollment.userId}:${lesson.id}`) ?? [];
        const phoneticsSummary = aggregatePhoneticsSections(
          lessonPhoneticsSections,
          lessonPhoneticsAttempts,
        );
        const sectionTitles = new Map(lessonPhoneticsSections.map((section) => [section.sectionId, section.title]));
        const phoneticsWrongAnswers = getBestPhoneticsSectionAttempts(
          lessonPhoneticsSections,
          lessonPhoneticsAttempts,
        ).flatMap((attempt) => (attempt.results ?? [])
          .filter((result) => !result.correct)
          .map((result) => ({
            prompt: result.prompt,
            full: result.full,
            given: result.given,
            correctAnswer: result.correctAnswer,
            answerMode: "pinyin" as const,
            translation: "",
            groupLabel: sectionTitles.get(attempt.sectionId) ?? "Ngữ âm",
          })));
        return {
          id: lesson.id,
          order: lesson.order,
          displayOrder: lesson.displayOrder,
          title: lesson.title,
          lessonAttempts: lessonAttempts
            .filter((attempt) => attempt.userId === enrollment.userId && attempt.lessonId === lesson.id)
            .map((attempt) => {
              const details = isRecord(attempt.details) ? attempt.details : {};
              return {
                id: attempt.id,
                scriptId: typeof details.lessonAudioScriptId === "string"
                  ? details.lessonAudioScriptId
                  : typeof details.scriptTitle === "string"
                    ? details.scriptTitle
                    : "Bài khóa",
                scriptTitle: typeof details.scriptTitle === "string" ? details.scriptTitle : "Bài khóa",
                scriptText: typeof details.scriptText === "string" ? details.scriptText : "",
                transcript: typeof details.transcript === "string" ? details.transcript : "",
                evaluation: typeof details.evaluation === "string" ? details.evaluation : null,
                score: attempt.score,
                completedAt: attempt.completedAt.toISOString(),
              };
            }),
          activities: DASHBOARD_ACTIVITIES.map(({ tab }) => {
          const progress = progressByKey.get(`${enrollment.userId}:${lesson.id}:${tab}`);
          const attempt = progress?.attempts[0];
          const grammarSummary = tab === "GRAMMAR"
            ? grammarSummaryByUserLesson.get(`${enrollment.userId}:${lesson.id}`)
            : undefined;
          const attemptDetails = isRecord(attempt?.details) ? attempt.details : {};
          const reviewableAttemptResults: DashboardWrongAnswer[] = tab === "GRAMMAR"
            ? (() => {
                const latestAttempts = new Map<string, { details: Record<string, unknown>; sectionTitle: string }>();
                for (const grammarAttempt of [...grammarAttempts, ...grammarAutoAttempts]) {
                  if (grammarAttempt.userId !== enrollment.userId || grammarAttempt.lessonId !== lesson.id) continue;
                  const details = isRecord(grammarAttempt.details) ? grammarAttempt.details : null;
                  if (!details) continue;
                  const sectionId = typeof details.sectionId === "string" ? details.sectionId : "legacy";
                  const questionType = typeof details.questionType === "string"
                    ? details.questionType
                    : "mode" in grammarAttempt && typeof grammarAttempt.mode === "string"
                      ? grammarAttempt.mode
                      : "";
                  if (!questionType) continue;
                  const key = `${sectionId}:${questionType}`;
                  if (!latestAttempts.has(key)) {
                    latestAttempts.set(key, {
                      details,
                      sectionTitle: typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ pháp",
                    });
                  }
                }
                return [...latestAttempts.values()].flatMap(({ details, sectionTitle }): DashboardWrongAnswer[] => {
                  if (!Array.isArray(details.results)) return [];
                  return details.results.flatMap((result): DashboardWrongAnswer[] => {
                    if (!isRecord(result) || result.correct !== false) return [];
                    return [{
                      prompt: typeof result.prompt === "string" && result.prompt.trim()
                        ? result.prompt.trim()
                        : "Câu hỏi ngữ pháp",
                      full: "",
                      given: typeof result.given === "string"
                        ? result.given
                        : Array.isArray(result.givenTokens)
                          ? result.givenTokens.filter((token): token is string => typeof token === "string").join(" ")
                          : "",
                      correctAnswer: typeof result.correctAnswer === "string" ? result.correctAnswer : "",
                      answerMode: "plain",
                      translation: typeof result.hint === "string" ? result.hint : "",
                      groupLabel: sectionTitle,
                    }];
                  });
                });
              })()
            : (
              tab === "LISTENING" || tab === "VOCABULARY_TEST" || tab === "WORKBOOK"
            ) && Array.isArray(attemptDetails.results)
            ? attemptDetails.results.flatMap((result): DashboardWrongAnswer[] => {
                if (!isRecord(result) || result.correct !== false) return [];
                const isVocabularyTest = tab === "VOCABULARY_TEST";
                const isWorkbook = tab === "WORKBOOK";
                const questionNumber = typeof result.number === "number" ? `Câu ${result.number}` : "";
                const questionPrompt = typeof result.prompt === "string" ? result.prompt : "";
                return [{
                  prompt: [questionNumber, questionPrompt].filter(Boolean).join(": ") || "Câu hỏi",
                  full: typeof result.chinese === "string"
                    ? result.chinese
                    : isVocabularyTest && typeof result.prompt === "string"
                      ? result.prompt
                      : isWorkbook && typeof result.passage === "string"
                        ? result.passage
                      : "",
                  given: typeof result.givenLabel === "string"
                    ? result.givenLabel
                    : typeof result.given === "string"
                      ? result.given
                      : "",
                  correctAnswer: typeof result.correctAnswer === "string" ? result.correctAnswer : "",
                  answerMode: result.answerMode === "pinyin"
                    ? "pinyin"
                    : isVocabularyTest || isWorkbook
                      ? "plain"
                      : "chinese",
                  translation: typeof result.translation === "string" ? result.translation : "",
                  groupLabel: isWorkbook
                    ? typeof result.sectionTitle === "string" ? result.sectionTitle : "Sách bài tập"
                    : isVocabularyTest
                      ? typeof result.typeLabel === "string" ? result.typeLabel : "Ôn từ vựng"
                      : typeof attemptDetails.blockTitle === "string" ? attemptDetails.blockTitle : "Nghe câu",
                }];
              })
            : [];
          const available = lesson.availableActivities[tab];
          const completed = tab === "VOCABULARY_TEST"
            ? attempt?.passed === true
            : tab === "LESSON"
              ? lessonScriptProgress.completed
            : tab === "GRAMMAR"
              ? grammarProgress.completed
              : progress?.completed === true;
          const hasStarted = Boolean(
            attempt
            || (tab === "LESSON" && lessonScriptProgress.started)
            || (tab === "GRAMMAR" && grammarProgress.hasStarted)
            || progress?.opened
            || progress?.state === "IN_PROGRESS"
            || (progress?.percent ?? 0) > 0,
          );
          const status = !available
            ? "unavailable"
            : tab === "GRAMMAR" && grammarProgress.waiting
              ? "waiting"
              : completed
                ? "completed"
                : hasStarted
                  ? "partial"
                  : "missing";
          return {
            tab,
            status,
            score: Math.round(tab === "PHONETICS"
              ? phoneticsSummary.score
              : tab === "LESSON"
                ? lessonScriptProgress.score
                : grammarSummary && grammarSummary.totalCount > 0
                  ? (grammarSummary.correctCount / grammarSummary.totalCount) * 100
                  : attempt?.score ?? progress?.currentScore ?? progress?.bestScore ?? progress?.percent ?? 0),
            useScoreWhenPartial: tab === "PHONETICS" || tab === "LESSON",
            percent: tab === "GRAMMAR"
              ? grammarProgress.percent
              : tab === "LESSON"
                ? lessonScriptProgress.score
                : Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
            correctCount: tab === "PHONETICS"
              ? phoneticsSummary.correctCount
              : grammarSummary?.correctCount ?? attempt?.correctCount,
            totalCount: tab === "PHONETICS"
              ? phoneticsSummary.totalCount
              : grammarSummary?.totalCount ?? attempt?.totalCount,
            wrongAnswers: tab === "PHONETICS" ? phoneticsWrongAnswers : reviewableAttemptResults,
          };
          }),
        };
      });

      return {
        student: {
          ...enrollment.user,
          zaloUrl: enrollment.user.phone ? `https://zalo.me/${enrollment.user.phone.replace(/\D/g, "")}` : null,
        },
        lastActivityAt: latestActivityAt?.toISOString() ?? null,
        lessons: studentLessons,
        reviews: reviews.map((review) => {
          const key = `${enrollment.userId}:${review.id}`;
          const attempt = reviewProgressByKey.get(key);
          const attempts = reviewAttemptsByKey.get(key) ?? [];
          return {
            id: review.id,
            percentage: attempt?.percentage ?? 0,
            hasAttempt: Boolean(attempt),
            attemptCount: attempts.length,
            lastAttemptAt: attempt?.completedAt.toISOString() ?? null,
          };
        }),
        mockExams: courseMockExams.map((mockExam, index) => {
          const attempts = mockExamAttempts.filter((attempt) => (
            attempt.userId === enrollment.userId && attempt.mockExamId === mockExam.id
          ));
          const latest = mockExamProgressByKey.get(`${enrollment.userId}:${mockExam.id}`);
          return {
            id: mockExam.id,
            label: `Thi thử ${index + 1}`,
            title: mockExam.title,
            questionCount: mockExam.sections.reduce((total, section) => total + section._count.questions, 0),
            attemptCount: attempts.length,
            attempts: attempts.map((attempt) => ({
              id: attempt.id,
              attemptNumber: attempt.attemptNumber,
              status: attempt.status,
              percentage: attempt.percentage,
              passed: attempt.passed,
              startedAt: attempt.startedAt.toISOString(),
              submittedAt: attempt.submittedAt?.toISOString() ?? null,
            })),
            latest: latest ? {
              id: latest.id,
              status: latest.status,
              percentage: latest.percentage,
              passed: latest.passed,
              attemptNumber: latest.attemptNumber,
              startedAt: latest.startedAt.toISOString(),
              submittedAt: latest.submittedAt?.toISOString() ?? null,
            } : null,
          };
        }),
      };
    });

    const perStudent = new Map<string, Set<string>>();
    for (const row of progressRows) {
      const completed = row.tab === "VOCABULARY_TEST"
        ? row.attempts[0]?.passed === true
        : row.tab === "GRAMMAR"
          ? grammarProgressByUserLesson.get(`${row.userId}:${row.lessonId}`)?.completed === true
          : row.completed;
      if (!completed) continue;
      const current = perStudent.get(row.userId) ?? new Set<string>();
      current.add(`${row.lessonId}:${row.tab}`);
      perStudent.set(row.userId, current);
    }

    const totalTabs = lessonIds.length * LESSON_TAB_KEYS.length;
    const studentSummary = cls.enrollments.map((enrollment) => {
      const completedTabs = perStudent.get(enrollment.userId)?.size ?? 0;
      const completionPercent = totalTabs > 0 ? Math.round((completedTabs / totalTabs) * 100) : 0;
      return {
        student: enrollment.user,
        completedTabs,
        totalTabs,
        completionPercent,
      };
    });
    const completedTabsTotal = studentSummary.reduce((sum, item) => sum + item.completedTabs, 0);
    const overallPercent = studentSummary.length > 0 && totalTabs > 0
      ? Math.round((completedTabsTotal / (studentSummary.length * totalTabs)) * 100)
      : 0;
    const latestProgress = progressRows
      .filter((row) => row.lastAttemptAt || row.updatedAt)
      .sort((a, b) => (b.lastAttemptAt ?? b.updatedAt).getTime() - (a.lastAttemptAt ?? a.updatedAt).getTime())[0];

    return {
      ...cls,
      lessons,
      courseItems: progressItems,
      suggestedLessonId: latestProgress?.lessonId ?? lessons[0]?.id ?? null,
      overallPercent,
      pendingGrammarAttempts,
      studentSummary,
      activityData,
    };
  }));
  const requestedGrammarAttempt = initialGradeAttemptId
    ? await prisma.lessonTabAttempt.findFirst({
        where: {
          id: initialGradeAttemptId,
          userId: { in: assignedStudentIds },
          tab: "GRAMMAR",
          mode: "FILL",
          lesson: { courseId: { in: assignedCourseIds } },
        },
        select: {
          id: true,
          userId: true,
          lessonId: true,
          completedAt: true,
          details: true,
          lesson: { select: { courseId: true, title: true } },
          user: { select: { name: true, email: true } },
        },
      })
    : null;
  const requestedGrammarDetails = isRecord(requestedGrammarAttempt?.details)
    ? requestedGrammarAttempt.details
    : {};
  const requestedGrammarClass = requestedGrammarAttempt
    ? myClasses.find((cls) =>
        cls.courseId === requestedGrammarAttempt.lesson.courseId
        && cls.enrollments.some((enrollment) => enrollment.userId === requestedGrammarAttempt.userId)
      )
    : null;
  const initialGrammarAttempt = requestedGrammarAttempt
    && requestedGrammarClass
    && requestedGrammarDetails.questionType === "FILL"
    && (
      requestedGrammarDetails.reviewPending === true
      || isRecord(requestedGrammarDetails.teacherGrading)
    )
    ? {
        classId: requestedGrammarClass.id,
        courseId: requestedGrammarAttempt.lesson.courseId,
        attempt: {
          id: requestedGrammarAttempt.id,
          lessonId: requestedGrammarAttempt.lessonId,
          userId: requestedGrammarAttempt.userId,
          studentName: requestedGrammarAttempt.user.name ?? requestedGrammarAttempt.user.email,
          lessonTitle: requestedGrammarAttempt.lesson.title,
          sectionTitle: typeof requestedGrammarDetails.sectionTitle === "string"
            ? requestedGrammarDetails.sectionTitle
            : "Dịch câu",
          completedAt: requestedGrammarAttempt.completedAt.toISOString(),
        },
      }
    : null;

  return {
    user,
    myCourses,
    myClasses,
    classSummaries,
    totalLessons,
    totalStudents,
    initialGradeAttemptId,
    initialGrammarAttempt,
    initialWorkbookAttemptId,
    initialWorkbookTargetUrl,
    initialTranslationSubmissionId,
    initialTranslationSubmission,
    translationSubmissions,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  if (String(form.get("intent")) !== "grade-translation") {
    return { error: "Thao tác không hợp lệ." };
  }

  const submissionId = String(form.get("submissionId") ?? "");
  const score = Number(form.get("score"));
  const teacherComment = String(form.get("teacherComment") ?? "").trim();
  if (!submissionId) return { error: "Thiếu bài nộp luyện dịch." };
  if (!Number.isFinite(score) || score < 0) return { error: "Điểm không hợp lệ." };

  const submission = await prisma.translationSubmission.findUnique({
    where: { id: submissionId },
    include: { lesson: { select: { id: true, title: true, courseId: true } } },
  });
  if (!submission) return { error: "Không tìm thấy bài nộp." };

  const assignedClass = await prisma.class.findFirst({
    where: {
      teacherId: user.id,
      completedAt: null,
      courseId: submission.lesson.courseId,
      enrollments: { some: { userId: submission.studentId } },
    },
    select: { id: true },
  });
  if (!assignedClass) return { error: "Bạn không có quyền chấm bài này." };
  const maxScore = 10;
  if (score > maxScore) return { error: `Điểm tối đa là ${maxScore}.` };

  const gradedAnswers = Array.isArray(submission.answers)
    ? submission.answers.flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const questionId = String(record.questionId ?? "");
        return {
          questionId,
          prompt: typeof record.prompt === "string" ? record.prompt : "",
          sampleAnswer: typeof record.sampleAnswer === "string" ? record.sampleAnswer : "",
          maxScore: typeof record.maxScore === "number" ? record.maxScore : 10,
          answer: typeof record.answer === "string" ? record.answer : "",
          teacherComment: String(form.get(`translation-comment-${questionId}`) ?? "").trim(),
        };
      })
    : [];

  await prisma.translationSubmission.update({
    where: { id: submissionId },
    data: {
      score,
      maxScore,
      teacherComment,
      answers: gradedAnswers,
      teacherId: user.id,
      status: "GRADED",
      gradedAt: new Date(),
    },
  });
  const translationAttempt = await prisma.lessonTabAttempt.findFirst({
    where: { userId: submission.studentId, lessonId: submission.lessonId, tab: "TRANSLATION" },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });
  if (translationAttempt) {
    await prisma.lessonTabAttempt.update({
      where: { id: translationAttempt.id },
      data: {
        score,
        passed: score >= maxScore * 0.5,
        completedAt: new Date(),
        details: { submissionId, status: "GRADED", score, totalQuestions: Array.isArray(submission.answers) ? submission.answers.length : 0 },
      },
    });
  }
  const notificationData = {
    actorId: user.id,
    title: "Giáo viên đã trả bài luyện dịch",
    message: `Bài “${submission.lesson.title}” đã được chấm: ${score}/${maxScore}.${teacherComment ? ` Nhận xét: ${teacherComment}` : ""}`,
    targetUrl: `/student/courses/${submission.lesson.courseId}/lessons/${submission.lesson.id}?tab=TRANSLATION`,
    readAt: null,
  };
  const existingNotification = await prisma.userNotification.updateMany({
    where: {
      recipientId: submission.studentId,
      kind: "TRANSLATION_GRADED",
      entityId: submissionId,
    },
    data: notificationData,
  });
  if (existingNotification.count === 0) {
    await prisma.userNotification.create({
      data: {
        ...notificationData,
        recipientId: submission.studentId,
        kind: "TRANSLATION_GRADED",
        entityId: submissionId,
      },
    });
  }
  return { success: true as const };
}

function activityTone(status: string, isPastLesson: boolean) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (status === "waiting") return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300";
  if (status === "partial") return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  if (status === "unavailable") return "bg-muted/40 text-muted-foreground";
  if (isPastLesson) return "border border-dashed border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
  return "bg-muted text-muted-foreground";
}

function lessonProgressTone(percent: number) {
  if (percent === 0) return "bg-muted text-muted-foreground";
  if (!isLessonProgressGreen(percent)) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents, initialGradeAttemptId, initialGrammarAttempt, initialWorkbookAttemptId, initialWorkbookTargetUrl, initialTranslationSubmissionId, initialTranslationSubmission, translationSubmissions } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const gradingFetcher = useFetcher<GrammarAttemptData & { success?: boolean }>();
  const reviewProgressFetcher = useFetcher<typeof courseItemProgressLoader>();
  const mockExamAttemptFetcher = useFetcher<typeof mockExamAttemptLoader>();
  const gradeSubmitFetcher = useFetcher<{ success?: boolean; attemptId?: string; error?: string }>();
  const workbookGradingFetcher = useFetcher<WorkbookGradingData>();
  const workbookGradeSubmitFetcher = useFetcher<{ success?: boolean; attemptId?: string; error?: string }>();
  const TranslationGradeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [selectedClassId, setSelectedClassId] = useState(classSummaries[0]?.id ?? "");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [selectedMockExamId, setSelectedMockExamId] = useState<string | null>(null);
  const [progressView, setProgressView] = useState<"overview" | "lesson">("overview");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedActivityReview, setSelectedActivityReview] = useState<ActivityReviewDialogState | null>(null);
  const [selectedReviewProgress, setSelectedReviewProgress] = useState<ReviewProgressDialogState | null>(null);
  const [selectedMockExamProgress, setSelectedMockExamProgress] = useState<MockExamProgressDialogState | null>(null);
  const [selectedLessonReview, setSelectedLessonReview] = useState<LessonReviewDialogState | null>(null);
  const [selectedLessonScriptId, setSelectedLessonScriptId] = useState<string | null>(null);
  const [pendingGrammarClassId, setPendingGrammarClassId] = useState<string | null>(null);
  const [gradingAttemptId, setGradingAttemptId] = useState<string | null>(null);
  const [workbookGradingAttemptId, setWorkbookGradingAttemptId] = useState<string | null>(null);
  const [selectedTranslationSubmissionId, setSelectedTranslationSubmissionId] = useState<string | null>(initialTranslationSubmission?.id ?? null);
  const [gradingQueue, setGradingQueue] = useState<{ courseId: string; attempt: PendingGrammarAttempt }[]>([]);
  const [gradingQueueIndex, setGradingQueueIndex] = useState<number | null>(null);
  const [gradingComplete, setGradingComplete] = useState(false);
  const [grades, setGrades] = useState<TeacherGrammarGrade[]>([]);
  const [initializedGradeAttemptId, setInitializedGradeAttemptId] = useState<string | null>(null);
  const handledGradeAttemptId = useRef<string | null>(null);
  const handledInitialGradeNavigationKey = useRef<string | null>(null);
  const handledInitialWorkbookAttemptId = useRef<string | null>(null);
  const handledWorkbookGradeAttemptId = useRef<string | null>(null);
  const handledInitialTranslationNavigationKey = useRef<string | null>(null);
  const selectedClass = classSummaries.find((cls) => cls.id === selectedClassId) ?? classSummaries[0];
  const pendingGrammarClass = classSummaries.find((cls) => cls.id === pendingGrammarClassId);
  const openReviewProgress = (
    review: { id: string; title: string },
    student: { id: string; name: string | null; email: string },
  ) => {
    if (!selectedClass) return;
    setSelectedReviewProgress({
      classId: selectedClass.id,
      reviewId: review.id,
      reviewTitle: review.title,
      studentId: student.id,
      studentName: student.name ?? student.email,
    });
    reviewProgressFetcher.load(
      `/teacher/courses/${selectedClass.courseId}/progress/reviews/${review.id}?classId=${encodeURIComponent(selectedClass.id)}`,
    );
  };
  const openMockExamProgress = (
    mockExam: DashboardMockExamItem,
    student: { id: string; name: string | null; email: string },
  ) => {
    if (!selectedClass) return;
    const exam = selectedClass.activityData
      .find((entry) => entry.student.id === student.id)
      ?.mockExams.find((entry) => entry.id === mockExam.id);
    const latestAttempt = exam?.attempts[0];
    if (!latestAttempt) return;
    setSelectedMockExamProgress({
      classId: selectedClass.id,
      mockExamId: mockExam.id,
      mockExamTitle: mockExam.title,
      studentId: student.id,
      studentName: student.name ?? student.email,
      attemptId: latestAttempt.id,
    });
    mockExamAttemptFetcher.load(
      `/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${mockExam.id}/students/${student.id}/attempts/${latestAttempt.id}`,
    );
  };
  const openMockExamAttempt = (attemptId: string) => {
    if (!selectedMockExamProgress || !selectedClass) return;
    setSelectedMockExamProgress({ ...selectedMockExamProgress, attemptId });
    mockExamAttemptFetcher.load(
      `/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${selectedMockExamProgress.mockExamId}/students/${selectedMockExamProgress.studentId}/attempts/${attemptId}`,
    );
  };
  const selectedLesson = selectedClass?.lessons.find((lesson) => lesson.id === selectedLessonId)
    ?? selectedClass?.lessons.find((lesson) => lesson.id === selectedClass.suggestedLessonId)
    ?? selectedClass?.lessons[0];
  const selectedReviewItem = selectedClass?.courseItems.find(
    (item): item is DashboardReviewItem => item.kind === "review" && item.id === selectedReviewId,
  );
  const selectedMockExamItem = selectedClass?.courseItems.find(
    (item): item is DashboardMockExamItem => item.kind === "mockExam" && item.id === selectedMockExamId,
  );
  const sortedActivityData = selectedClass
    ? selectedClass.activityData
        .map((student) => {
          const lessons = progressView === "lesson"
            ? student.lessons.filter((lesson) => lesson.id === selectedLesson?.id)
            : student.lessons;
          const completedCount = lessons.reduce(
            (sum, lesson) => sum + getLessonProgress(lesson.activities).completed,
            0,
          ) + (progressView === "overview"
            ? student.reviews.filter((review) => review.hasAttempt).length
              + student.mockExams.filter((exam) => exam.latest?.status === "SUBMITTED").length
            : 0);
          return { student, completedCount };
        })
        .sort((a, b) => (
          b.completedCount - a.completedCount
          || (a.student.student.name ?? a.student.student.email)
            .localeCompare(b.student.student.name ?? b.student.student.email, "vi")
        ))
        .map(({ student }) => student)
    : [];
  const selectedLessonActivities = selectedLesson
    ? DASHBOARD_ACTIVITIES.filter(({ tab }) => selectedLesson.availableActivities[tab])
    : [];
  const selectedStudent = selectedClass?.activityData.find((item) => item.student.id === selectedStudentId);
  const reviewProgressData = reviewProgressFetcher.data;
  const selectedReviewProgressData = selectedReviewProgress
    && reviewProgressData?.item.type === "reviews"
    && reviewProgressData.item.id === selectedReviewProgress.reviewId
    && reviewProgressData.selectedClass?.id === selectedReviewProgress.classId
    ? reviewProgressData
    : null;
  const selectedReviewProgressStudent = selectedReviewProgressData?.students.find(
    (student) => student.id === selectedReviewProgress?.studentId,
  );
  const selectedReviewAttempts = selectedReviewProgressStudent && "reviewAttempts" in selectedReviewProgressStudent
    ? selectedReviewProgressStudent.reviewAttempts
    : null;
  const selectedMockExamStudent = selectedMockExamProgress
    ? selectedClass?.activityData.find((entry) => entry.student.id === selectedMockExamProgress.studentId)
    : null;
  const selectedMockExam = selectedMockExamStudent?.mockExams.find(
    (exam) => exam.id === selectedMockExamProgress?.mockExamId,
  );
  const selectedMockExamAttempts = selectedMockExam?.attempts ?? [];
  const selectedMockExamAttemptData = mockExamAttemptFetcher.data
    && mockExamAttemptFetcher.data.mockExam.id === selectedMockExamProgress?.mockExamId
    && mockExamAttemptFetcher.data.student.id === selectedMockExamProgress?.studentId
    && mockExamAttemptFetcher.data.attempt.id === selectedMockExamProgress?.attemptId
    ? mockExamAttemptFetcher.data
    : null;
  const selectedTranslationSubmission = selectedTranslationSubmissionId
    ? translationSubmissions.find((item) => item.id === selectedTranslationSubmissionId)
      ?? (initialTranslationSubmission?.id === selectedTranslationSubmissionId ? initialTranslationSubmission : null)
    : null;
  const isModalOpen = Boolean(
    selectedStudentId
    || selectedActivityReview
    || selectedReviewProgress
    || selectedMockExamProgress
    || selectedLessonReview
    || pendingGrammarClass
    || gradingAttemptId
    || workbookGradingAttemptId
    || selectedTranslationSubmissionId
    || (pendingGrammarClass && gradingComplete),
  );
  useModalScrollLock(isModalOpen);
  const upcomingClasses = myClasses
    .flatMap((cls) => {
      const nextClassTime = getNextClassTime(cls.schedule);
      return nextClassTime ? [{ cls, nextClassTime }] : [];
    })
    .sort((a, b) => a.nextClassTime.getTime() - b.nextClassTime.getTime())
    .slice(0, 1);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.key]);

  useEffect(() => {
    if (!selectedStudentId && !selectedActivityReview && !selectedReviewProgress && !selectedMockExamProgress && !selectedLessonReview && !pendingGrammarClassId && !gradingAttemptId && !workbookGradingAttemptId && !selectedTranslationSubmissionId && !gradingComplete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape"
        && gradeSubmitFetcher.state !== "submitting"
        && workbookGradeSubmitFetcher.state !== "submitting"
        && TranslationGradeFetcher.state !== "submitting"
      ) {
        setSelectedStudentId(null);
        setSelectedActivityReview(null);
        setSelectedReviewProgress(null);
        setSelectedMockExamProgress(null);
        setSelectedLessonReview(null);
        setPendingGrammarClassId(null);
        setGradingAttemptId(null);
        setWorkbookGradingAttemptId(null);
        setSelectedTranslationSubmissionId(null);
        setGradingQueueIndex(null);
        setGradingComplete(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedStudentId, selectedActivityReview, selectedReviewProgress, selectedMockExamProgress, selectedLessonReview, pendingGrammarClassId, gradingAttemptId, workbookGradingAttemptId, selectedTranslationSubmissionId, gradingComplete, gradeSubmitFetcher.state, workbookGradeSubmitFetcher.state, TranslationGradeFetcher.state]);

  const gradingData = gradingFetcher.data?.attempt ? gradingFetcher.data : null;
  useEffect(() => {
    if (
      gradingFetcher.state !== "idle"
      || !gradingData
      || gradingData.attempt.id !== gradingAttemptId
      || initializedGradeAttemptId === gradingAttemptId
    ) return;
    setGrades(gradingData.attempt.results.map((result) => ({
      questionId: result.id,
      correct: result.autoCorrect,
      teacherFeedback: result.teacherFeedback,
    })));
    setInitializedGradeAttemptId(gradingAttemptId);
  }, [gradingData, gradingAttemptId, gradingFetcher.state, initializedGradeAttemptId]);

  useEffect(() => {
    const submission = gradeSubmitFetcher.data;
    if (
      gradeSubmitFetcher.state !== "idle"
      || !submission?.success
      || !submission.attemptId
      || submission.attemptId !== gradingAttemptId
      || handledGradeAttemptId.current === submission.attemptId
    ) return;

    handledGradeAttemptId.current = submission.attemptId;
    setInitializedGradeAttemptId(null);
    revalidator.revalidate();
    const nextIndex = (gradingQueueIndex ?? -1) + 1;
    const nextItem = gradingQueue[nextIndex];
    if (!nextItem) {
      setGradingAttemptId(null);
      setGradingQueueIndex(null);
      setGradingComplete(true);
      return;
    }

    setGradingQueueIndex(nextIndex);
    setGrades([]);
    setGradingAttemptId(nextItem.attempt.id);
    gradingFetcher.load(`/teacher/courses/${nextItem.courseId}/lessons/${nextItem.attempt.lessonId}/students/${nextItem.attempt.userId}/grammar-history/attempts/${nextItem.attempt.id}`);
  }, [gradeSubmitFetcher.state, gradeSubmitFetcher.data, gradingAttemptId, gradingQueue, gradingQueueIndex, revalidator, gradingFetcher]);

  useEffect(() => {
    const submission = workbookGradeSubmitFetcher.data;
    if (
      workbookGradeSubmitFetcher.state !== "idle"
      || !submission?.success
      || !submission.attemptId
      || submission.attemptId !== workbookGradingAttemptId
      || handledWorkbookGradeAttemptId.current === submission.attemptId
    ) return;
    handledWorkbookGradeAttemptId.current = submission.attemptId;
    setWorkbookGradingAttemptId(null);
    revalidator.revalidate();
  }, [workbookGradeSubmitFetcher.data, workbookGradeSubmitFetcher.state, workbookGradingAttemptId, revalidator]);

  useEffect(() => {
    if (TranslationGradeFetcher.state === "idle" && TranslationGradeFetcher.data?.success) {
      setSelectedTranslationSubmissionId(null);
      revalidator.revalidate();
    }
  }, [TranslationGradeFetcher.data, TranslationGradeFetcher.state, revalidator]);

  const reminderRows = selectedClass && selectedLesson
    ? selectedClass.activityData.flatMap((student) => {
        const missing = student.lessons
          .filter((lesson) => lesson.order <= selectedLesson.order)
          .flatMap((lesson) => lesson.activities
            .filter((activity) => activity.status === "missing" || activity.status === "partial")
            .map((activity) => ({
              lessonTitle: lesson.title,
              lessonOrder: lesson.displayOrder,
              activity: DASHBOARD_ACTIVITIES.find((item) => item.tab === activity.tab)?.label ?? activity.tab,
              percent: activity.percent,
              isPast: lesson.order < selectedLesson.order,
            })));
        return missing.length ? [{ student, missing }] : [];
      })
    : [];
  const updateGrade = (questionId: string, patch: Partial<TeacherGrammarGrade>) => {
    setGrades((current) => current.map((grade) => grade.questionId === questionId ? { ...grade, ...patch } : grade));
  };
  const openGradingAttempt = (courseId: string, attempt: PendingGrammarAttempt, queueIndex: number) => {
    setGradingQueueIndex(queueIndex);
    setGradingAttemptId(attempt.id);
    setInitializedGradeAttemptId(null);
    setGrades([]);
    gradingFetcher.load(`/teacher/courses/${courseId}/lessons/${attempt.lessonId}/students/${attempt.userId}/grammar-history/attempts/${attempt.id}`);
  };
  const startGradingQueue = (
    classId: string,
    courseId: string,
    attempts: PendingGrammarAttempt[],
    selectedAttempt: PendingGrammarAttempt,
  ) => {
    const selectedIndex = attempts.findIndex((attempt) => attempt.id === selectedAttempt.id);
    const orderedAttempts = selectedIndex < 0
      ? attempts
      : [...attempts.slice(selectedIndex), ...attempts.slice(0, selectedIndex)];
    setPendingGrammarClassId(classId);
    setGradingQueue(orderedAttempts.map((attempt) => ({ courseId, attempt })));
    setGradingComplete(false);
    openGradingAttempt(courseId, selectedAttempt, 0);
  };

  useEffect(() => {
    if (!initialGradeAttemptId) {
      handledInitialGradeNavigationKey.current = null;
      return;
    }
    if (handledInitialGradeNavigationKey.current === location.key) return;
    const ownerClass = classSummaries.find((cls) =>
      cls.pendingGrammarAttempts.some((attempt) => attempt.id === initialGradeAttemptId)
    );
    if (ownerClass) {
      const selectedAttempt = ownerClass.pendingGrammarAttempts.find((attempt) => attempt.id === initialGradeAttemptId);
      if (!selectedAttempt) return;
      handledInitialGradeNavigationKey.current = location.key;
      setSelectedClassId(ownerClass.id);
      startGradingQueue(ownerClass.id, ownerClass.courseId, ownerClass.pendingGrammarAttempts, selectedAttempt);
    } else if (initialGrammarAttempt?.attempt.id === initialGradeAttemptId) {
      handledInitialGradeNavigationKey.current = location.key;
      setSelectedClassId(initialGrammarAttempt.classId);
      setPendingGrammarClassId(null);
      setGradingQueue([]);
      openGradingAttempt(initialGrammarAttempt.courseId, initialGrammarAttempt.attempt, 0);
    } else {
      handledInitialGradeNavigationKey.current = location.key;
      const searchParams = new URLSearchParams(location.search);
      searchParams.delete("gradeAttemptId");
      navigate(
        { pathname: location.pathname, search: searchParams.toString() ? `?${searchParams}` : "" },
        { replace: true },
      );
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("gradeAttemptId");
    navigate(
      { pathname: location.pathname, search: searchParams.toString() ? `?${searchParams}` : "" },
      { replace: true },
    );
  }, [classSummaries, initialGrammarAttempt, initialGradeAttemptId, location.key, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!initialWorkbookAttemptId || handledInitialWorkbookAttemptId.current === initialWorkbookAttemptId) return;
    handledInitialWorkbookAttemptId.current = initialWorkbookAttemptId;
    if (initialWorkbookTargetUrl) {
      handledWorkbookGradeAttemptId.current = null;
      setWorkbookGradingAttemptId(initialWorkbookAttemptId);
      workbookGradingFetcher.load(initialWorkbookTargetUrl);
    }

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("gradeWorkbookAttemptId");
    navigate(
      { pathname: location.pathname, search: searchParams.toString() ? `?${searchParams}` : "" },
      { replace: true },
    );
  }, [initialWorkbookAttemptId, initialWorkbookTargetUrl, location.pathname, location.search, navigate, workbookGradingFetcher]);

  useEffect(() => {
    const requestedSubmissionId = new URLSearchParams(location.search).get("gradeTranslationId");
    if (!requestedSubmissionId) {
      handledInitialTranslationNavigationKey.current = null;
      return;
    }
    if (handledInitialTranslationNavigationKey.current === location.key) return;
    if (initialTranslationSubmissionId !== requestedSubmissionId) return;
    handledInitialTranslationNavigationKey.current = location.key;

    if (initialTranslationSubmission?.id === requestedSubmissionId) {
      setSelectedTranslationSubmissionId(initialTranslationSubmission.id);
    } else {
      setSelectedTranslationSubmissionId(null);
    }

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("gradeTranslationId");
    navigate(
      { pathname: location.pathname, search: searchParams.toString() ? `?${searchParams}` : "" },
      { replace: true },
    );
  }, [initialTranslationSubmissionId, initialTranslationSubmission, location.key, location.pathname, location.search, navigate]);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển giáo viên</h1>
          <p className="mt-1 text-sm text-muted-foreground">Theo dõi tiến độ lớp học và những việc cần xử lý.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Khóa học của tôi" value={myCourses.length} icon={BookOpen} accent="primary" />
          <StatCard label="Lớp đang phụ trách" value={myClasses.length} icon={Layers} accent="accent" />
          <StatCard label="Tổng học viên" value={totalStudents} icon={Users} accent="success" />
          <StatCard label="Tổng bài học" value={totalLessons} icon={TrendingUp} accent="warning" />
        </div>

        {translationSubmissions.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Luyện dịch</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Bài nộp của học viên trong các lớp đang phụ trách.</p>
                </div>
                <Badge variant="secondary">{translationSubmissions.filter((item) => item.status === "SUBMITTED").length} bài chờ chấm</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {translationSubmissions.slice(0, 8).map((submission) => (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => setSelectedTranslationSubmissionId(submission.id)}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{submission.student.name ?? submission.student.email}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{submission.lesson.title} · {submission.lesson.course.title}</p>
                    </div>
                    <Badge variant={submission.status === "GRADED" ? "outline" : "secondary"}>
                      {submission.status === "GRADED" ? `${submission.score ?? 0}/${submission.maxScore}` : "Chờ chấm"}
                    </Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {upcomingClasses.length > 0 && (
          <Card>
            <CardContent className="pt-6 sm:pt-6">
              <div className="mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Lịch giảng dạy sắp tới</h2>
              </div>
              <div className="space-y-3">
                {upcomingClasses.map(({ cls }) => (
                  <div key={cls.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{cls.name}</p>
                        <span className="text-xs text-muted-foreground">· HSK{cls.course.hskLevel} · {cls.enrollments.length} học viên</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{formatSchedule(cls.schedule)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Buổi học tiếp theo: {formatNextClass(cls.schedule)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {classSummaries.length > 0 ? (
          <>
            <section className="space-y-3" aria-labelledby="classes-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="classes-heading" className="text-lg font-semibold">Lớp học của tôi</h2>
                  <p className="text-sm text-muted-foreground">Chọn lớp để xem hoạt động và tiến độ từng học viên.</p>
                </div>
                <Link to="/teacher/courses" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Khóa học của tôi <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {classSummaries.map((cls) => {
                  const selected = cls.id === selectedClass?.id;
                  return (
                    <div
                      key={cls.id}
                      className={`rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 ${selected ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedClassId(cls.id);
                          setSelectedLessonId(null);
                          setSelectedReviewId(null);
                          setSelectedStudentId(null);
                          setSelectedActivityReview(null);
                        }}
                        className="mb-3 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{cls.name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{cls.course.title} · HSK {cls.course.hskLevel}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{cls.overallPercent}%</span>
                        </div>
                        <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${cls.overallPercent}%` }} />
                        </div>
                      </button>
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{cls.enrollments.length} học viên · {cls.lessons.length} bài học</span>
                        {cls.pendingGrammarAttempts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPendingGrammarClassId(cls.id);
                              setGradingQueue(cls.pendingGrammarAttempts.map((attempt) => ({ courseId: cls.courseId, attempt })));
                              setGradingQueueIndex(null);
                              setGradingComplete(false);
                            }}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                            Cần chấm {cls.pendingGrammarAttempts.length} bài
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {selectedClass && (
              <>
                <Card>
                  <CardContent className="pt-5 sm:pt-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">Tiến độ học tập · {selectedClass.name}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{selectedClass.course.title} · {selectedClass.activityData.length} học viên</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Xếp theo số hoạt động hoàn thành giảm dần{progressView === "lesson" && selectedLesson ? ` trong Bài ${selectedLesson.displayOrder}` : ""}
                        </p>
                      </div>
                      <div className="flex rounded-lg bg-muted p-1" role="tablist" aria-label="Cách xem tiến độ lớp">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={progressView === "overview"}
                          onClick={() => {
                            setProgressView("overview");
                            setSelectedReviewId(null);
                          }}
                          className={`rounded-md px-3 py-1.5 text-sm ${progressView === "overview" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Tổng quan {selectedClass.courseItems.length} mục
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={progressView === "lesson"}
                          onClick={() => setProgressView("lesson")}
                          className={`rounded-md px-3 py-1.5 text-sm ${progressView === "lesson" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          Chi tiết từng bài
                        </button>
                      </div>
                    </div>

                    {selectedClass.courseItems.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Khóa học này chưa có nội dung để theo dõi.</p>
                    ) : selectedClass.activityData.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Lớp này chưa có học viên.</p>
                    ) : progressView === "overview" ? (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                          <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              <th scope="col" className="sticky left-0 z-10 min-w-44 bg-muted/95 px-3 py-3 font-medium">Học viên</th>
                              {selectedClass.courseItems.map((item) => (
                                <th scope="col" key={`${item.kind}:${item.id}`} className={`px-1 py-2 text-center font-medium ${item.kind === "mockExam" ? "min-w-20" : "min-w-16"}`}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (item.kind === "review") {
                                        setProgressView("lesson");
                                        setSelectedReviewId(item.id);
                                        return;
                                      }
                                      if (item.kind === "mockExam") {
                                        navigate(`/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${item.id}?classId=${encodeURIComponent(selectedClass.id)}`);
                                        return;
                                      }
                                      setSelectedLessonId(item.id);
                                      setSelectedReviewId(null);
                                      setProgressView("lesson");
                                    }}
                                    className="rounded px-1.5 py-1 hover:bg-background hover:text-primary"
                                    title={`Xem chi tiết ${item.kind === "lesson" ? `Bài ${item.displayOrder}` : item.label} · ${item.title}`}
                                  >
                                    {item.kind === "lesson" ? `B${item.displayOrder}` : item.label}
                                  </button>
                                </th>
                              ))}
                              <th scope="col" className="min-w-20 px-3 py-3 text-right font-medium">Trung bình</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedActivityData.map((student) => {
                              const lessonScores = student.lessons.map((lesson) => getLessonProgress(lesson.activities));
                              const reviewScores = student.reviews.map((review) => ({
                                percent: review.percentage,
                                total: selectedClass.courseItems.some((item) => item.kind === "review" && item.id === review.id && item.questionCount > 0) ? 1 : 0,
                              }));
                              const mockExamScores = student.mockExams.map((exam) => ({
                                percent: exam.latest?.percentage ?? 0,
                                total: exam.questionCount > 0 ? 1 : 0,
                              }));
                              const allScores = [...lessonScores, ...reviewScores, ...mockExamScores];
                              const total = allScores.reduce((sum, item) => sum + (item.total ? item.percent : 0), 0);
                              const totalAvailable = allScores.filter((item) => item.total > 0).length;
                              const average = totalAvailable ? Math.round(total / totalAvailable) : 0;
                              return (
                                <tr key={student.student.id} className="border-t">
                                  <th scope="row" className="sticky left-0 z-10 border-t bg-background px-3 py-2 text-left">
                                    <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="font-medium hover:text-primary hover:underline">
                                      {student.student.name ?? student.student.email}
                                    </button>
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      {student.lastActivityAt
                                        ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                        : "Chưa có hoạt động"}
                                    </span>
                                  </th>
                                  {selectedClass.courseItems.map((item) => {
                                    if (item.kind === "review") {
                                      const review = student.reviews.find((entry) => entry.id === item.id);
                                      return (
                                        <td key={`review:${item.id}`} className="border-t px-1 py-2 text-center">
                                          {item.questionCount === 0 ? (
                                            <span className="text-muted-foreground">—</span>
                                          ) : (
                                            <button
                                              type="button"
                                              aria-haspopup="dialog"
                                              aria-label={`Xem các lượt làm ${item.label} của ${student.student.name ?? student.student.email}`}
                                              onClick={() => openReviewProgress(item, student.student)}
                                              title={`${item.label}: ${review?.percentage ?? 0}%`}
                                              className={`min-w-12 rounded-md px-1.5 py-2 text-xs font-semibold transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${lessonProgressTone(review?.percentage ?? 0)}`}
                                            >
                                              {review?.percentage ?? 0}%
                                            </button>
                                          )}
                                        </td>
                                      );
                                    }
                                    if (item.kind === "mockExam") {
                                      const exam = student.mockExams.find((entry) => entry.id === item.id);
                                      const latest = exam?.latest;
                                      const status = latest?.status === "IN_PROGRESS"
                                        ? "Đang làm"
                                        : latest?.percentage != null
                                          ? `${Math.round(latest.percentage)}%`
                                          : latest
                                            ? "Đã nộp"
                                            : "Chưa làm";
                                      return (
                                        <td key={`mockExam:${item.id}`} className="border-t px-1 py-2 text-center">
                                          {item.questionCount === 0 ? (
                                            <span className="text-muted-foreground">—</span>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => navigate(`/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${item.id}?classId=${encodeURIComponent(selectedClass.id)}`)}
                                              title={`${item.title}: ${status}${exam?.attemptCount ? ` · ${exam.attemptCount} lượt làm` : ""}`}
                                              className={`min-w-16 rounded-md px-1.5 py-2 text-xs font-semibold ${lessonProgressTone(latest?.percentage ?? 0)}`}
                                            >
                                              <span className="block">{status}</span>
                                              {exam?.attemptCount ? <span className="block text-[10px] font-normal">Lần {latest?.attemptNumber}</span> : null}
                                            </button>
                                          )}
                                        </td>
                                      );
                                    }
                                    const lesson = student.lessons.find((entry) => entry.id === item.id);
                                    const progress = lesson ? getLessonProgress(lesson.activities) : { percent: 0, total: 0 };
                                    const hasPendingGrade = lesson?.activities.some((activity) => activity.status === "waiting") ?? false;
                                    return (
                                      <td key={`lesson:${item.id}`} className="border-t px-1 py-2 text-center">
                                        {progress.total === 0 ? (
                                          <span className="text-muted-foreground">—</span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedLessonId(item.id);
                                              setProgressView("lesson");
                                            }}
                                            title={`${item.title}: ${progress.percent}%${hasPendingGrade ? " · Có bài chờ chấm" : ""}`}
                                            className={`relative min-w-12 rounded-md px-1.5 py-2 text-xs font-semibold ${lessonProgressTone(progress.percent)}`}
                                          >
                                            {progress.percent}%
                                            {hasPendingGrade && <span className="ml-0.5 text-[10px] text-blue-700 dark:text-blue-300">✎</span>}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="border-t px-3 py-2 text-right font-semibold tabular-nums">{average}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-muted/30 text-xs text-muted-foreground">
                            <tr>
                              <th scope="row" className="sticky left-0 bg-muted/95 px-3 py-2 text-left font-medium">Trung bình lớp</th>
                              {selectedClass.courseItems.map((item) => {
                                if (item.kind === "review") {
                                  const scores = selectedClass.activityData
                                    .map((student) => student.reviews.find((review) => review.id === item.id))
                                    .filter((review) => review && item.questionCount > 0);
                                  const average = scores.length ? Math.round(scores.reduce((sum, review) => sum + (review?.percentage ?? 0), 0) / scores.length) : null;
                                  return <td key={`review:${item.id}`} className="px-1 py-2 text-center">{average === null ? "—" : `${average}%`}</td>;
                                }
                                if (item.kind === "mockExam") {
                                  const scores = selectedClass.activityData
                                    .map((student) => student.mockExams.find((exam) => exam.id === item.id))
                                    .filter((exam) => exam && item.questionCount > 0);
                                  const average = scores.length
                                    ? Math.round(scores.reduce((sum, exam) => sum + (exam?.latest?.percentage ?? 0), 0) / scores.length)
                                    : null;
                                  return <td key={`mockExam:${item.id}`} className="px-1 py-2 text-center">{average === null ? "—" : `${average}%`}</td>;
                                }
                                const scores = selectedClass.activityData
                                  .map((student) => getLessonProgress(student.lessons.find((lesson) => lesson.id === item.id)?.activities ?? []))
                                  .filter((item) => item.total > 0);
                                const average = scores.length ? Math.round(scores.reduce((sum, item) => sum + item.percent, 0) / scores.length) : null;
                                return <td key={`lesson:${item.id}`} className="px-1 py-2 text-center">{average === null ? "—" : `${average}%`}</td>;
                              })}
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <>
                        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2" aria-label="Chọn nội dung">
                          {selectedClass.courseItems.map((item) => {
                            if (item.kind === "review") {
                              return (
                                <button
                                  key={`review:${item.id}`}
                                  type="button"
                                  aria-pressed={selectedReviewId === item.id}
                                  onClick={() => {
                                    setSelectedReviewId(item.id);
                                    setSelectedMockExamId(null);
                                  }}
                                  className={`shrink-0 rounded-md border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedReviewId === item.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                                  title={item.title}
                                >
                                  {item.label}
                                </button>
                              );
                            }
                            if (item.kind === "mockExam") {
                              return (
                                <button
                                  key={`mockExam:${item.id}`}
                                  type="button"
                                  aria-pressed={selectedMockExamId === item.id}
                                  onClick={() => {
                                    setSelectedMockExamId(item.id);
                                    setSelectedReviewId(null);
                                  }}
                                  className={`shrink-0 rounded-md border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedMockExamId === item.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                                  title={item.title}
                                >
                                  {item.label}
                                </button>
                              );
                            }
                            const lesson = item;
                            const hasGaps = selectedClass.activityData.some((student) =>
                              student.lessons.find((item) => item.id === lesson.id)?.activities.some((activity) => activity.status === "missing" || activity.status === "partial"),
                            );
                            return (
                              <button
                                key={lesson.id}
                                type="button"
                                aria-pressed={selectedReviewId === null && selectedMockExamId === null && selectedLesson?.id === lesson.id}
                                onClick={() => {
                                  setSelectedLessonId(lesson.id);
                                  setSelectedReviewId(null);
                                  setSelectedMockExamId(null);
                                }}
                                className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${selectedReviewId === null && selectedMockExamId === null && selectedLesson?.id === lesson.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"} ${hasGaps && selectedLesson?.id !== lesson.id ? "border-rose-300" : ""}`}
                              >
                                Bài {lesson.displayOrder}
                                {lesson.id === selectedClass.suggestedLessonId && <span className="ml-1.5 text-emerald-500" aria-label="Bài đang học">●</span>}
                              </button>
                            );
                          })}
                        </div>
                        {selectedReviewItem ? (
                          <>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                              <div>
                                <h3 className="font-medium">{selectedReviewItem.title}</h3>
                                {selectedReviewItem.subtitle && (
                                  <p className="text-xs text-muted-foreground">{selectedReviewItem.subtitle}</p>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {selectedClass.activityData.length} học viên · {selectedReviewItem.questionCount} câu
                              </span>
                            </div>
                            {selectedReviewItem.questionCount === 0 ? (
                              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                Bài ôn tập này chưa có câu hỏi.
                              </p>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border">
                                <table className="w-full min-w-[650px] text-left text-sm">
                                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                                    <tr>
                                      <th scope="col" className="min-w-44 px-3 py-3 font-medium">Học viên</th>
                                      <th scope="col" className="px-3 py-3 text-right font-medium">Tiến độ mới nhất</th>
                                      <th scope="col" className="px-3 py-3 text-right font-medium">Số lần làm</th>
                                      <th scope="col" className="px-3 py-3 text-right font-medium">Thời gian</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {sortedActivityData.map((student) => {
                                      const review = student.reviews.find((entry) => entry.id === selectedReviewItem.id);
                                      const latestAttemptAt = review?.lastAttemptAt;
                                      return (
                                        <tr key={student.student.id}>
                                          <th scope="row" className="px-3 py-2 text-left">
                                            <span className="block font-medium">{student.student.name ?? student.student.email}</span>
                                            <span className="block text-xs font-normal text-muted-foreground">
                                              {student.lastActivityAt
                                                ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                                : "Chưa có hoạt động"}
                                            </span>
                                          </th>
                                          <td className="px-3 py-2 text-right">
                                            {review?.hasAttempt ? (
                                              <button
                                                type="button"
                                                aria-haspopup="dialog"
                                                aria-label={`Xem ${review.percentage}% và bài làm ${selectedReviewItem.label} của ${student.student.name ?? student.student.email}`}
                                                onClick={() => openReviewProgress(selectedReviewItem, student.student)}
                                                className={`min-w-16 rounded-md px-2.5 py-2 font-semibold tabular-nums transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${lessonProgressTone(review.percentage)}`}
                                              >
                                                {review.percentage}%
                                              </button>
                                            ) : (
                                              <span className="inline-flex min-w-16 justify-center rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                                                Chưa làm
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums">{review?.attemptCount ?? 0}</td>
                                          <td className="px-3 py-2 text-right text-muted-foreground">
                                            {latestAttemptAt
                                              ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(latestAttemptAt))
                                              : "—"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        ) : selectedMockExamItem ? (
                          <>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                              <div>
                                <h3 className="font-medium">{selectedMockExamItem.title}</h3>
                                <p className="text-xs text-muted-foreground">Tiến độ và kết quả thi thử của học viên trong lớp.</p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {selectedClass.activityData.length} học viên · {selectedMockExamItem.questionCount} câu
                              </span>
                            </div>
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full min-w-[650px] text-left text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                  <tr>
                                    <th scope="col" className="min-w-44 px-3 py-3 font-medium">Học viên</th>
                                    <th scope="col" className="px-3 py-3 text-right font-medium">Kết quả mới nhất</th>
                                    <th scope="col" className="px-3 py-3 text-right font-medium">Số lần thi</th>
                                    <th scope="col" className="px-3 py-3 text-right font-medium">Thời gian</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {sortedActivityData.map((student) => {
                                    const exam = student.mockExams.find((entry) => entry.id === selectedMockExamItem.id);
                                    const latest = exam?.latest;
                                    const latestAt = latest?.submittedAt ?? latest?.startedAt ?? null;
                                    const resultLabel = latest?.percentage != null
                                      ? `${latest.percentage}%`
                                      : latest?.status === "IN_PROGRESS" ? "Đang làm" : "Đã nộp";
                                    const resultTone = latest?.status === "IN_PROGRESS"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                      : latest?.passed === true
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                        : latest?.passed === false
                                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                          : "bg-muted text-muted-foreground";
                                    return (
                                      <tr key={student.student.id}>
                                        <th scope="row" className="px-3 py-2 text-left">
                                          <span className="block font-medium">{student.student.name ?? student.student.email}</span>
                                          <span className="block text-xs font-normal text-muted-foreground">
                                            {student.lastActivityAt
                                              ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                              : "Chưa có hoạt động"}
                                          </span>
                                        </th>
                                        <td className="px-3 py-2 text-right">
                                          {latest ? (
                                            <button
                                              type="button"
                                              aria-haspopup="dialog"
                                              aria-label={`Xem ${resultLabel} và bài làm ${selectedMockExamItem.label} của ${student.student.name ?? student.student.email}`}
                                              onClick={() => openMockExamProgress(selectedMockExamItem, student.student)}
                                              className={`min-w-20 rounded-md px-2.5 py-2 font-semibold tabular-nums transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${resultTone}`}
                                            >
                                              {resultLabel}
                                            </button>
                                          ) : (
                                            <span className="inline-flex min-w-20 justify-center rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                                              Chưa thi
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{exam?.attemptCount ?? 0}</td>
                                        <td className="px-3 py-2 text-right text-muted-foreground">
                                          {latestAt
                                            ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(latestAt))
                                            : "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : selectedLesson && (
                          <>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                              <div>
                                <h3 className="font-medium">{selectedLesson.title}</h3>
                                <p className="text-xs text-muted-foreground">Bài được gợi ý dựa trên hoạt động gần nhất của lớp.</p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {selectedClass.activityData.length} học viên · {selectedLesson.availableActivities && Object.values(selectedLesson.availableActivities).filter(Boolean).length} phần theo dõi
                              </span>
                            </div>
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full min-w-[650px] text-left text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                  <tr>
                                    <th scope="col" className="min-w-44 px-3 py-3 font-medium">Học viên</th>
                                    {selectedLessonActivities.map((activity) => (
                                      <th scope="col" key={activity.tab} className="min-w-28 px-2 py-3 text-center font-medium">{activity.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {sortedActivityData.map((student) => {
                                    const lesson = student.lessons.find((item) => item.id === selectedLesson.id);
                                    return (
                                      <tr key={student.student.id}>
                                        <th scope="row" className="px-3 py-2 text-left">
                                          <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="font-medium hover:text-primary hover:underline">
                                            {student.student.name ?? student.student.email}
                                          </button>
                                          <span className="block text-xs font-normal text-muted-foreground">
                                            {student.lastActivityAt
                                              ? `Hoạt động ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(student.lastActivityAt))}`
                                              : "Chưa có hoạt động"}
                                          </span>
                                        </th>
                                        {selectedLessonActivities.map((activity) => {
                                          const result = lesson?.activities.find((item) => item.tab === activity.tab);
                                          const pending = activity.tab === "GRAMMAR" && result?.status === "waiting"
                                            ? selectedClass.pendingGrammarAttempts.find((attempt) => attempt.userId === student.student.id && attempt.lessonId === selectedLesson.id)
                                            : undefined;
                                          const displayedPercent = result?.status === "completed"
                                            ? result.score
                                            : result?.status === "partial"
                                              ? activity.tab === "PHONETICS" ? result.score : result.percent
                                              : null;
                                          const progressStatus = displayedPercent == null
                                            ? result?.status
                                            : displayedPercent >= 80 ? "completed" : "partial";
                                          const activityReviewData = (
                                            activity.tab === "PHONETICS"
                                            || activity.tab === "LISTENING"
                                            || activity.tab === "VOCABULARY_TEST"
                                            || activity.tab === "WORKBOOK"
                                            || activity.tab === "GRAMMAR"
                                          )
                                            && result != null
                                            && (activity.tab === "GRAMMAR"
                                              || result.status === "partial"
                                              || result.status === "completed")
                                            && result.correctCount != null
                                            && result.totalCount != null
                                            && result.totalCount > 0
                                            && (activity.tab === "GRAMMAR" || result.wrongAnswers.length > 0)
                                            ? {
                                                activityLabel: activity.label,
                                                studentName: student.student.name ?? student.student.email,
                                                lessonTitle: selectedLesson.title,
                                                correctCount: result.correctCount,
                                                totalCount: result.totalCount,
                                                wrongAnswers: result.wrongAnswers,
                                              }
                                            : null;
                                          const tileClassName = `inline-flex min-w-20 flex-col items-center rounded-md px-2 py-1.5 ${activityTone(progressStatus ?? result?.status ?? "missing", selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0))}`;
                                          const tileContent = (
                                            <>
                                              <span className="font-semibold">
                                                {displayedPercent != null
                                                    ? `${displayedPercent}%`
                                                    : selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0)
                                                        ? "Bỏ sót"
                                                        : "Chưa làm"}
                                              </span>
                                              {result?.correctCount != null
                                                && result.totalCount != null
                                                && result.totalCount > 0
                                                && ((activity.tab !== "PHONETICS" && activity.tab !== "LISTENING") || result.status === "partial" || result.status === "completed") && (
                                                <span className={`text-[10px] ${activityReviewData ? "underline decoration-dotted underline-offset-2" : ""}`}>
                                                  {result.correctCount}/{result.totalCount}
                                                </span>
                                              )}
                                              <span className="text-[10px]">
                                                {displayedPercent != null
                                                  ? result?.status === "completed" || displayedPercent >= 80 ? "Đã làm" : "Đang làm"
                                                  : result?.status === "completed"
                                                    ? "Đã xong"
                                                    : result?.status === "partial"
                                                      ? "Đang làm"
                                                      : selectedLesson.order < (selectedClass.lessons.find((item) => item.id === selectedClass.suggestedLessonId)?.order ?? 0)
                                                        ? "Cần hoàn thành"
                                                        : "Chưa bắt đầu"}
                                              </span>
                                            </>
                                          );
                                          return (
                                            <td key={activity.tab} className="px-2 py-2 text-center">
                                              {!result || result.status === "unavailable" ? (
                                                <span className="text-xs text-muted-foreground">Không áp dụng</span>
                                              ) : result.status === "waiting" && pending ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    startGradingQueue(
                                                      selectedClass.id,
                                                      selectedClass.courseId,
                                                      selectedClass.pendingGrammarAttempts,
                                                      pending,
                                                    );
                                                  }}
                                                  className="inline-flex rounded-md bg-blue-100 px-2.5 py-2 text-xs font-medium text-blue-800 hover:bg-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950"
                                                >
                                                  Chờ chấm <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                                                </button>
                                              ) : (
                                                activityReviewData ? (
                                                  <button
                                                    type="button"
                                                    title={activityReviewData.wrongAnswers.length > 0
                                                      ? `Xem ${activityReviewData.wrongAnswers.length} câu chưa đúng`
                                                      : `Xem kết quả ${activityReviewData.activityLabel}`}
                                                    aria-haspopup="dialog"
                                                    aria-label={`Xem kết quả ${activityReviewData.activityLabel} của ${activityReviewData.studentName}: đúng ${activityReviewData.correctCount}/${activityReviewData.totalCount} câu`}
                                                    onClick={() => setSelectedActivityReview(activityReviewData)}
                                                    className={`${tileClassName} cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                                                  >
                                                    {tileContent}
                                                  </button>
                                                ) : (activity.tab === "LESSON" || activity.tab === "GRAMMAR") &&
                                                  (result.status === "partial" || result.status === "completed") ? (
                                                  <button
                                                    type="button"
                                                    title={`Xem chi tiết ${activity.label}`}
                                                    aria-label={`Xem chi tiết ${activity.label} của ${student.student.name ?? student.student.email}`}
                                                    onClick={() => {
                                                      if (activity.tab === "LESSON") {
                                                        const scriptMap = new Map<string, LessonReviewDialogState["scripts"][number]>();
                                                        for (const attempt of lesson?.lessonAttempts ?? []) {
                                                          const group = scriptMap.get(attempt.scriptId) ?? {
                                                            id: attempt.scriptId,
                                                            title: attempt.scriptTitle,
                                                            attempts: [],
                                                          };
                                                          group.attempts.push(attempt);
                                                          scriptMap.set(attempt.scriptId, group);
                                                        }
                                                        const scripts = [...scriptMap.values()].sort((first, second) =>
                                                          first.title.localeCompare(second.title, "vi", { numeric: true, sensitivity: "base" })
                                                        );
                                                        setSelectedLessonReview({
                                                          studentName: student.student.name ?? student.student.email,
                                                          lessonTitle: selectedLesson.title,
                                                          scripts,
                                                        });
                                                        setSelectedLessonScriptId(scripts[0]?.id ?? null);
                                                        return;
                                                      }
                                                    }}
                                                    className={`${tileClassName} cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                                                  >
                                                    {tileContent}
                                                  </button>
                                                ) : (
                                                  <span className={tileClassName}>
                                                    {tileContent}
                                                  </span>
                                                )
                                              )}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Đã hoàn thành</span>
                              <span className="inline-flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-amber-600" />Đang làm</span>
                              <span className="inline-flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5 text-blue-600" />Chờ chấm</span>
                              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-rose-400" />Bỏ sót</span>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5 sm:pt-5">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-rose-600" />
                        <h2 className="font-semibold">Cần nhắc</h2>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {selectedLesson ? `${reminderRows.length}/${selectedClass.activityData.length} học viên còn phần chưa xong đến Bài ${selectedLesson.displayOrder}` : "Chưa có bài học"}
                      </span>
                    </div>
                    {reminderRows.length === 0 ? (
                      <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {selectedClass.activityData.length === 0 ? "Lớp chưa có học viên." : "Không có phần học nào cần nhắc đến bài đang chọn."}
                      </p>
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {reminderRows.map(({ student, missing }) => {
                          const missingByActivity = new Map<string, typeof missing>();
                          for (const item of missing) {
                            const activityItems = missingByActivity.get(item.activity) ?? [];
                            activityItems.push(item);
                            missingByActivity.set(item.activity, activityItems);
                          }

                          return (
                            <li key={student.student.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                              <div className="min-w-48 flex-1">
                                <button type="button" onClick={() => setSelectedStudentId(student.student.id)} className="text-left text-sm font-medium hover:text-primary hover:underline">
                                  {student.student.name ?? student.student.email}
                                </button>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {[...missingByActivity].map(([activity, items]) => {
                                    const tooltipId = `reminder-${student.student.id}-${activity.replace(/\W/g, "-")}`;
                                    return (
                                      <span
                                        key={activity}
                                        tabIndex={0}
                                        aria-describedby={tooltipId}
                                        className="group relative inline-flex cursor-help rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 outline-none hover:border-rose-300 hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-ring dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                                      >
                                        {activity}
                                        <span className="ml-1 rounded-full bg-background/80 px-1.5 tabular-nums">{items.length}</span>
                                        <span
                                          id={tooltipId}
                                          role="tooltip"
                                          className="invisible absolute bottom-full left-0 z-30 max-h-56 min-w-56 max-w-80 overflow-y-auto whitespace-normal rounded-md border bg-popover p-2.5 text-left text-xs font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity after:absolute after:left-0 after:top-full after:h-2 after:w-full after:content-[''] group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
                                        >
                                          <span className="mb-1 block font-semibold">{activity} · {items.length} bài cần hoàn thành</span>
                                          {items.map((item) => (
                                            <span key={`${item.lessonOrder}-${item.lessonTitle}`} className="block">
                                              {item.isPast ? "Bỏ sót" : item.percent > 0 ? "Đang làm dở" : "Chưa hoàn thành"} · Bài {item.lessonOrder}: {item.lessonTitle}
                                            </span>
                                          ))}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                {student.student.zaloUrl ? (
                                  <a
                                    href={student.student.zaloUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    aria-label={`Nhắn Zalo cho ${student.student.name ?? student.student.email}`}
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />Nhắn Zalo
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    title="Thêm số điện thoại Zalo trong Quản lý tài khoản để nhắn học viên"
                                    className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />Nhắn Zalo
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-medium">Bạn chưa được phân công lớp học</p>
              <p className="mt-1 text-sm text-muted-foreground">Khi có lớp mới, thông tin tiến độ sẽ hiển thị tại đây.</p>
            </CardContent>
          </Card>
        )}

        {pendingGrammarClass && pendingGrammarClass.pendingGrammarAttempts.length > 0 && !gradingAttemptId && !gradingComplete && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="pending-grammar-title"
              className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 shrink-0 text-amber-600" />
                    <h2 id="pending-grammar-title" className="font-semibold">Bài ngữ pháp chờ chấm</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {pendingGrammarClass.pendingGrammarAttempts.length} bài · {pendingGrammarClass.name}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Đóng danh sách bài chờ chấm"
                  onClick={() => {
                    setPendingGrammarClassId(null);
                    setGradingQueueIndex(null);
                  }}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="divide-y overflow-y-auto p-4 sm:p-5">
                {pendingGrammarClass.pendingGrammarAttempts.map((attempt) => (
                  <li key={attempt.id}>
                    <button
                      type="button"
                      onClick={() => {
                        startGradingQueue(
                          pendingGrammarClass.id,
                          pendingGrammarClass.courseId,
                          pendingGrammarClass.pendingGrammarAttempts,
                          attempt,
                        );
                      }}
                      className="group flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 break-words font-medium">{attempt.studentName} · {attempt.lessonTitle} · {attempt.sectionTitle}</span>
                      <span className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-primary px-3 text-xs font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        Chấm bài <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {selectedStudent && selectedClass && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex justify-end bg-black/45"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-progress-title"
              className="h-full w-full max-w-xl overflow-y-auto border-l bg-background p-5 shadow-xl sm:p-6"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 id="student-progress-title" className="text-lg font-semibold">{selectedStudent.student.name ?? selectedStudent.student.email}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedClass.name} · {selectedClass.course.title}</p>
                </div>
                <button type="button" aria-label="Đóng tiến độ học viên" onClick={() => setSelectedStudentId(null)} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Bài học</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Hoàn thành</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedStudent.lessons.map((lesson) => {
                      const progress = getLessonProgress(lesson.activities);
                      return (
                        <tr key={lesson.id}>
                          <th scope="row" className="px-3 py-2 font-medium">{lesson.title}</th>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {progress.total > 0 ? `${progress.percent}% · ${progress.completed}/${progress.total}` : "Không áp dụng"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Link
                to={`/teacher/courses/${selectedClass.courseId}/students/${selectedStudent.student.id}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Mở hồ sơ tiến độ đầy đủ <ArrowUpRight className="h-4 w-4" />
              </Link>
            </section>
          </div>
        )}

        {selectedLessonReview && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedLessonReview(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="lesson-review-title"
              className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border bg-background shadow-xl"
            >
              <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background px-4 py-4 sm:px-5">
                <div>
                  <h2 id="lesson-review-title" className="text-base font-semibold">Lịch sử Bài khóa</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedLessonReview.studentName} · {selectedLessonReview.lessonTitle}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Đóng lịch sử Bài khóa"
                  onClick={() => setSelectedLessonReview(null)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="divide-y px-4 sm:px-5">
                {selectedLessonReview.scripts.length > 0 ? (
                  <>
                    <div className="sticky top-[73px] z-[9] -mx-4 overflow-x-auto border-b bg-background px-4 sm:-mx-5 sm:px-5" role="tablist" aria-label="Các bài khóa">
                      <div className="flex min-w-max gap-1">
                        {selectedLessonReview.scripts.map((script, scriptIndex) => {
                          const selected = script.id === (selectedLessonScriptId ?? selectedLessonReview.scripts[0]?.id);
                          return (
                            <button
                              key={script.id}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => setSelectedLessonScriptId(script.id)}
                              className={`border-b-2 px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                                selected
                                  ? "border-primary font-semibold text-primary"
                                  : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
                              }`}
                            >
                              {script.title || `Bài khóa ${scriptIndex + 1}`}
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                                {script.attempts.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {selectedLessonReview.scripts
                      .filter((script) => script.id === (selectedLessonScriptId ?? selectedLessonReview.scripts[0]?.id))
                      .map((script) => (
                        <section key={script.id} className="py-5 first:pt-4" role="tabpanel">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="font-semibold">{script.title}</h3>
                            <span className="text-xs text-muted-foreground tabular-nums">{script.attempts.length} lượt làm</span>
                          </div>
                          <div className="divide-y border-t">
                            {script.attempts.map((attempt, index) => (
                              <article key={attempt.id} className="py-5 first:pt-3">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                        {script.attempts.length - index}
                                      </span>
                                      <p className="font-semibold">Lượt {script.attempts.length - index}</p>
                                    </div>
                                    <p className="mt-1.5 pl-9 text-xs text-muted-foreground">
                                      {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {attempt.evaluation && (
                                      <span className="hidden rounded-md border bg-background px-2 py-1 text-xs font-medium sm:inline-flex">
                                        {attempt.evaluation}
                                      </span>
                                    )}
                                    <span
                                      className={`rounded-md px-2.5 py-1.5 text-sm font-bold tabular-nums ${
                                        attempt.score == null
                                          ? "bg-muted text-muted-foreground"
                                          : attempt.score >= 80
                                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                            : attempt.score >= 50
                                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                      }`}
                                    >
                                      {attempt.score != null ? `${Math.round(attempt.score)} / 100` : "— / 100"}
                                    </span>
                                  </div>
                                </div>
                                <div className="grid overflow-hidden rounded-lg border md:grid-cols-2">
                                  <div className="border-b p-3 md:border-b-0 md:border-r">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Script chuẩn</p>
                                    <p className="mt-2 whitespace-pre-wrap text-base leading-7">{attempt.scriptText || "—"}</p>
                                  </div>
                                  <div className="bg-rose-50/60 p-3 dark:bg-rose-950/20">
                                    <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Học viên đã đọc</p>
                                    <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-rose-950 dark:text-rose-100">
                                      {attempt.transcript || "—"}
                                    </p>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Học viên chưa có dữ liệu chi tiết lượt làm Bài khóa.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        {selectedActivityReview && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedActivityReview(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="activity-review-title"
              className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 id="activity-review-title" className="text-base font-semibold">
                    {selectedActivityReview.activityLabel}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedActivityReview.studentName} · {selectedActivityReview.lessonTitle}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm font-medium tabular-nums">
                    <span className="text-foreground">{selectedActivityReview.correctCount}/{selectedActivityReview.totalCount} câu đúng</span>
                    <span className="text-muted-foreground">· {selectedActivityReview.wrongAnswers.length} câu cần xem lại</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Đóng câu sai ${selectedActivityReview.activityLabel}`}
                  onClick={() => setSelectedActivityReview(null)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedActivityReview.wrongAnswers.length > 0 ? (
                <ol className="divide-y rounded-md border">
                  {selectedActivityReview.wrongAnswers.map((answer, index) => (
                    <li key={`${answer.groupLabel}-${answer.prompt}-${index}`} className="space-y-3 px-3 py-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{answer.prompt}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          answer.given
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                        }`}>
                          {answer.given ? "Trả lời chưa đúng" : "Chưa trả lời"}
                        </span>
                      </div>
                      {answer.groupLabel !== selectedActivityReview.activityLabel && (
                        <p className="text-xs text-muted-foreground">
                          {selectedActivityReview.activityLabel === "Ngữ âm"
                            ? `Phần: ${answer.groupLabel}`
                            : answer.groupLabel}
                        </p>
                      )}
                      {answer.full && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {selectedActivityReview.activityLabel === "Nghe câu"
                              ? "Câu nghe"
                              : selectedActivityReview.activityLabel === "Ôn từ vựng"
                                ? "Từ vựng"
                                : selectedActivityReview.activityLabel === "Ngữ âm"
                                  ? "Nội dung câu"
                                  : "Nội dung"}
                          </p>
                          <p className={`content-text text-base font-medium ${answer.answerMode === "pinyin" ? "pinyin-text" : answer.answerMode === "chinese" ? "hanzi-display" : ""}`}>
                            {answer.full}
                          </p>
                        </div>
                      )}
                      {answer.translation && (
                        <p className="text-xs text-muted-foreground">Nghĩa: {answer.translation}</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="min-w-0 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-900 dark:bg-rose-950/25">
                          <p className="text-xs font-medium text-rose-800 dark:text-rose-200">Học viên trả lời</p>
                          <p className={`mt-1 break-words font-medium text-rose-950 dark:text-rose-100 ${answer.answerMode === "pinyin" ? "pinyin-text" : answer.answerMode === "chinese" ? "hanzi-display" : ""}`}>
                            {answer.given || "Chưa trả lời"}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/25">
                          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">Đáp án đúng</p>
                          <p className={`mt-1 break-words font-medium text-emerald-950 dark:text-emerald-100 ${answer.answerMode === "pinyin" ? "pinyin-text" : answer.answerMode === "chinese" ? "hanzi-display" : ""}`}>
                            {answer.correctAnswer || "—"}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : selectedActivityReview.correctCount === selectedActivityReview.totalCount ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Học viên làm đúng tất cả câu trong phần này.
                </p>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Lượt làm này chưa lưu dữ liệu chi tiết từng câu.
                </p>
              )}
              {selectedActivityReview.wrongAnswers.length
                < selectedActivityReview.totalCount - selectedActivityReview.correctCount && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Có câu chưa làm hoặc không lưu chi tiết đáp án trong dữ liệu lượt nộp.
                </p>
              )}
            </section>
          </div>
        )}

        {selectedReviewProgress && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedReviewProgress(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-progress-title"
              className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <h2 id="review-progress-title" className="font-semibold">{selectedReviewProgress.reviewTitle}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedReviewProgress.studentName} · {selectedReviewProgressData?.selectedClass?.name ?? "Tiến độ ôn tập"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Đóng tiến độ ôn tập"
                  onClick={() => setSelectedReviewProgress(null)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-y-auto p-4 sm:p-5">
                {reviewProgressFetcher.state !== "idle" ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang tải bài làm…
                  </div>
                ) : !selectedReviewProgressData ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Chưa tải được dữ liệu ôn tập. Hãy đóng hộp thoại và thử lại.
                  </p>
                ) : !selectedReviewAttempts || selectedReviewAttempts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Học viên chưa có lượt làm bài ôn tập này.
                  </p>
                ) : (
                    <ol className="space-y-4">
                      {selectedReviewAttempts.map((attempt, index) => (
                        <li key={attempt.id} className="rounded-lg border p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h3 className="font-medium">Lượt làm {selectedReviewAttempts.length - index}</h3>
                              <time className="mt-1 block text-xs text-muted-foreground" dateTime={attempt.date}>
                                {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.date))}
                              </time>
                            </div>
                            <span className="rounded-md bg-muted px-2.5 py-1 text-sm font-semibold tabular-nums">
                              {attempt.correctCount}/{attempt.totalQuestions} câu · {attempt.percentage}%
                            </span>
                          </div>
                          <ol className="mt-3 space-y-2">
                            {attempt.answers.map((answer, answerIndex) => (
                              <li key={`${attempt.id}-${answerIndex}`} className="rounded-md bg-muted/40 p-3">
                                <p className="text-xs font-medium text-muted-foreground">
                                  Câu {answerIndex + 1}
                                  <span className={`ml-2 ${answer.correct ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                                    {answer.correct ? "Đúng" : "Chưa đúng"}
                                  </span>
                                </p>
                                <p className="mt-1 font-medium">{answer.prompt}</p>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <div className="min-w-0 rounded-md border bg-background px-3 py-2">
                                    <p className="text-xs text-muted-foreground">Học viên trả lời</p>
                                    <p className="mt-1 break-words">{answer.answer || "Chưa trả lời"}</p>
                                  </div>
                                  <div className="min-w-0 rounded-md border bg-background px-3 py-2">
                                    <p className="text-xs text-muted-foreground">Đáp án đúng</p>
                                    <p className="mt-1 break-words">{answer.correctAnswer}</p>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </li>
                      ))}
                    </ol>
                  )
                }
              </div>
            </section>
          </div>
        )}

        {selectedMockExamProgress && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedMockExamProgress(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="mock-exam-progress-title"
              className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <h2 id="mock-exam-progress-title" className="font-semibold">{selectedMockExamProgress.mockExamTitle}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedMockExamProgress.studentName} · {selectedClass?.name ?? "Tiến độ thi thử"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Đóng tiến độ thi thử"
                  onClick={() => setSelectedMockExamProgress(null)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                {selectedMockExamAttempts.length > 1 && (
                  <div className="mb-5">
                    <h3 className="mb-2 text-sm font-medium">Lịch sử các lần thi</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedMockExamAttempts.map((attempt) => (
                        <button
                          key={attempt.id}
                          type="button"
                          aria-pressed={selectedMockExamProgress.attemptId === attempt.id}
                          onClick={() => openMockExamAttempt(attempt.id)}
                          className={`rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedMockExamProgress.attemptId === attempt.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                        >
                          <span className="block font-medium">Lượt {attempt.attemptNumber}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {attempt.percentage != null
                              ? `${attempt.percentage}%`
                              : attempt.status === "IN_PROGRESS" ? "Đang làm" : "Đã nộp"}
                            {" · "}
                            {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" })
                              .format(new Date(attempt.submittedAt ?? attempt.startedAt))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {mockExamAttemptFetcher.state !== "idle" ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang tải bài thi…
                  </div>
                ) : !selectedMockExamAttemptData ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">Chưa tải được bài thi. Hãy thử tải lại.</p>
                    <button
                      type="button"
                      onClick={() => openMockExamAttempt(selectedMockExamProgress.attemptId)}
                      className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Thử lại
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <h3 className="font-medium">Lượt thi {selectedMockExamAttemptData.attempt.attemptNumber}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedMockExamAttemptData.attempt.answeredCount}/{selectedMockExamAttemptData.attempt.questionCount} câu đã trả lời
                          {" · Bắt đầu "}
                          {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" })
                            .format(new Date(selectedMockExamAttemptData.attempt.startedAt))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${selectedMockExamAttemptData.attempt.status === "IN_PROGRESS" ? "text-amber-700 dark:text-amber-300" : selectedMockExamAttemptData.attempt.passed ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                          {selectedMockExamAttemptData.attempt.status === "IN_PROGRESS"
                            ? "Đang làm"
                            : selectedMockExamAttemptData.attempt.passed ? "Đạt" : "Chưa đạt"}
                        </p>
                        {selectedMockExamAttemptData.attempt.percentage != null && (
                          <p className="mt-0.5 text-2xl font-bold tabular-nums">
                            {selectedMockExamAttemptData.attempt.percentage}%
                          </p>
                        )}
                        {selectedMockExamAttemptData.attempt.earnedPoints != null
                          && selectedMockExamAttemptData.attempt.totalPoints != null && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {selectedMockExamAttemptData.attempt.earnedPoints}/{selectedMockExamAttemptData.attempt.totalPoints} điểm
                            </p>
                          )}
                      </div>
                    </div>
                    <div className="space-y-6">
                      {selectedMockExamAttemptData.attempt.sections.map((section, sectionIndex) => (
                        <section key={`${section.title}-${sectionIndex}`} className="space-y-3">
                          <h3 className="border-b pb-2 font-semibold">{section.title}</h3>
                          {section.questions.map((question, questionIndex) => (
                            <article key={question.id} className="space-y-3 rounded-lg border p-3 sm:p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h4 className="font-medium">Câu {questionIndex + 1}</h4>
                                  {question.prompt && <p className="mt-1 whitespace-pre-wrap text-sm">{question.prompt}</p>}
                                </div>
                                {selectedMockExamAttemptData.attempt.status === "SUBMITTED" && (
                                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${question.correct ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"}`}>
                                    {question.correct ? "Đúng" : "Sai"}
                                  </span>
                                )}
                              </div>
                              {question.imageUrl && (
                                <img src={question.imageUrl} alt={`Hình câu ${questionIndex + 1}`} className="max-h-60 max-w-full rounded-md border object-contain" />
                              )}
                              <div className="grid gap-2 sm:grid-cols-2">
                                {question.options.map((option, optionIndex) => (
                                  <div
                                    key={option.id}
                                    className={`flex items-start gap-2 rounded-md border p-3 text-sm ${option.selected ? "border-primary bg-primary/5" : ""} ${option.showCorrect ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/25" : ""}`}
                                  >
                                    <span className="font-semibold text-muted-foreground">{String.fromCharCode(65 + optionIndex)}.</span>
                                    <div className="min-w-0 flex-1">
                                      {option.content && <p className="whitespace-pre-wrap">{option.content}</p>}
                                      {option.imageUrl && (
                                        <img src={option.imageUrl} alt={`Lựa chọn ${String.fromCharCode(65 + optionIndex)}`} className="mt-2 max-h-40 object-contain" />
                                      )}
                                      {option.selected && <p className="mt-1 text-xs font-medium text-primary">Học sinh chọn</p>}
                                      {option.showCorrect && <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Đáp án đúng</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {!question.options.some((option) => option.selected) && (
                                <p className="text-xs text-muted-foreground">Học sinh chưa chọn đáp án.</p>
                              )}
                            </article>
                          ))}
                        </section>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        )}

        {workbookGradingAttemptId && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget && workbookGradeSubmitFetcher.state === "idle") {
                setWorkbookGradingAttemptId(null);
              }
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="workbook-grading-title"
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <h2 id="workbook-grading-title" className="text-lg font-semibold">Chấm Sách bài tập</h2>
                  {workbookGradingFetcher.data && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {workbookGradingFetcher.data.student.name ?? workbookGradingFetcher.data.student.email}
                      {" · "}{workbookGradingFetcher.data.lesson.title}
                      {" · "}{workbookGradingFetcher.data.attempt.blockTitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Đóng cửa sổ chấm Sách bài tập"
                  disabled={workbookGradeSubmitFetcher.state !== "idle"}
                  onClick={() => setWorkbookGradingAttemptId(null)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {workbookGradingFetcher.state === "loading" ? (
                <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Đang tải bài làm...
                </div>
              ) : !workbookGradingFetcher.data ? (
                <p role="alert" className="p-8 text-center text-sm text-destructive">
                  Không tải được bài làm. Hãy đóng cửa sổ và mở lại thông báo.
                </p>
              ) : (
                <workbookGradeSubmitFetcher.Form
                  method="post"
                  action={`/teacher/courses/${workbookGradingFetcher.data.course.id}/lessons/${workbookGradingFetcher.data.lesson.id}/students/${workbookGradingFetcher.data.student.id}/workbook-history/attempts/${workbookGradingAttemptId}`}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <input type="hidden" name="intent" value="grade-workbook-dashboard" />
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
                    <p className="text-sm text-muted-foreground">
                      Đối chiếu từng câu đang chờ chấm với đáp án chuẩn.
                    </p>
                    {workbookGradeSubmitFetcher.data?.error && (
                      <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {workbookGradeSubmitFetcher.data.error}
                      </p>
                    )}
                    {workbookGradingFetcher.data.attempt.results
                      .filter((result) => result.teacherReviewPending)
                      .map((result) => (
                        <article key={result.id} className="space-y-2 rounded-lg border p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">
                                {result.sectionTitle} · Câu {result.number}
                              </p>
                              {result.prompt && <p className="text-sm font-medium">{result.prompt}</p>}
                              {result.passage && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{result.passage}</p>}
                              <p className="text-sm">
                                <span className="text-muted-foreground">Học viên trả lời: </span>
                                {result.givenLabel || "Bỏ trống"}
                              </p>
                              <p className="text-sm">
                                <span className="text-muted-foreground">Đáp án chuẩn: </span>
                                <span className="font-medium">{result.correctAnswer || "Chưa cấu hình"}</span>
                              </p>
                            </div>
                            <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                              Kết quả
                              <select
                                name={`grade-${result.id}`}
                                required
                                defaultValue=""
                                className="rounded-md border bg-background px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <option value="" disabled>Chọn</option>
                                <option value="correct">Đúng</option>
                                <option value="incorrect">Sai</option>
                              </select>
                            </label>
                          </div>
                        </article>
                      ))}
                  </div>
                  <footer className="flex justify-end gap-2 border-t p-4 sm:px-5">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={workbookGradeSubmitFetcher.state !== "idle"}
                      onClick={() => setWorkbookGradingAttemptId(null)}
                    >
                      Để sau
                    </Button>
                    <Button type="submit" disabled={workbookGradeSubmitFetcher.state !== "idle"}>
                      {workbookGradeSubmitFetcher.state !== "idle" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Lưu điểm
                    </Button>
                  </footer>
                </workbookGradeSubmitFetcher.Form>
              )}
            </section>
          </div>
        )}

        {pendingGrammarClass && gradingAttemptId && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="grammar-grading-title"
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0">
                  <h2 id="grammar-grading-title" className="text-lg font-semibold">Chấm bài ngữ pháp</h2>
                  {gradingQueueIndex != null && (
                    <p className="mt-1 text-sm font-medium text-primary">
                      Bài {gradingQueueIndex + 1}/{gradingQueue.length} · {pendingGrammarClass.name}
                    </p>
                  )}
                  {gradingData && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {gradingData.student.name ?? gradingData.student.email} · {gradingData.lesson.title} · {gradingData.attempt.sectionTitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Đóng cửa sổ chấm bài"
                  onClick={() => {
                    setPendingGrammarClassId(null);
                    setGradingAttemptId(null);
                    setGradingQueueIndex(null);
                    setGradingComplete(false);
                  }}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {gradingFetcher.state === "loading" ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Đang tải bài làm...</div>
              ) : !gradingData ? (
                <div role="alert" className="p-8 text-center text-sm text-destructive">
                  Không tải được bài làm. Hãy đóng cửa sổ và thử lại.
                </div>
              ) : (
                <gradeSubmitFetcher.Form
                  method="post"
                  action={`/teacher/courses/${gradingData.course.id}/lessons/${gradingData.lesson.id}/students/${gradingData.student.id}/grammar-history/attempts/${gradingAttemptId}`}
                  onSubmit={() => {
                    handledGradeAttemptId.current = null;
                  }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <input type="hidden" name="intent" value="grade-grammar-fill-dashboard" />
                  <input type="hidden" name="grades" value={JSON.stringify(grades)} />
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
                    {gradeSubmitFetcher.data?.error && gradeSubmitFetcher.data.attemptId === gradingAttemptId && (
                      <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {gradeSubmitFetcher.data.error}
                      </p>
                    )}
                    {gradingData.attempt.results.map((result, index) => {
                      const grade = grades.find((item) => item.questionId === result.id);
                      if (!grade) return null;
                      return (
                        <article key={`${result.id}-${index}`} className="space-y-3 rounded-lg border p-3 sm:p-4">
                          <div className="flex flex-wrap items-start gap-2">
                            <span className="mt-0.5 font-mono text-xs text-muted-foreground">{index + 1}.</span>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="content-text hanzi-display font-medium">{result.prompt}</p>
                                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{GRAMMAR_QUESTION_META[result.type].label}</span>
                              </div>
                              {result.type === "ARRANGE" && result.givenTokens && (
                                <p className="text-xs text-muted-foreground">Từ đã chọn: {result.givenTokens.join(" / ")}</p>
                              )}
                              <p className="text-sm"><span className="text-muted-foreground">Học viên trả lời: </span>{result.given || <em className="text-muted-foreground">bỏ trống</em>}</p>
                              <p className="text-sm"><span className="text-muted-foreground">Đáp án chuẩn: </span><span className="font-medium">{result.correctAnswer}</span></p>
                              {result.hint && <p className="whitespace-pre-line text-xs text-muted-foreground">{result.hint}</p>}
                            </div>
                          </div>
                          <div className="space-y-2 border-t pt-3">
                            <div className="flex gap-2" role="group" aria-label={`Chấm câu ${index + 1}`}>
                              <Button type="button" size="sm" variant={grade.correct ? "default" : "outline"} onClick={() => updateGrade(result.id, { correct: true })}>
                                <CheckCircle2 className="mr-1.5 h-4 w-4" />Đúng
                              </Button>
                              <Button type="button" size="sm" variant={!grade.correct ? "destructive" : "outline"} onClick={() => updateGrade(result.id, { correct: false })}>
                                <XCircle className="mr-1.5 h-4 w-4" />Sai
                              </Button>
                              <span className="self-center text-xs text-muted-foreground">Tự chấm: {result.autoCorrect ? "Đúng" : "Sai"}</span>
                            </div>
                            <label htmlFor={`dashboard-teacher-feedback-${result.id}`} className="text-xs font-medium">
                              Đáp án/Nhận xét <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
                            </label>
                            <Textarea
                              id={`dashboard-teacher-feedback-${result.id}`}
                              value={grade.teacherFeedback}
                              rows={2}
                              onChange={(event) => updateGrade(result.id, { teacherFeedback: event.target.value })}
                              placeholder="Nhập nhận xét hoặc đáp án thay thế"
                            />
                          </div>
                        </article>
                      );
                    })}
                    {gradingData.attempt.results.length === 0 && (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Bài làm không có dữ liệu câu trả lời để chấm.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 sm:px-5">
                    <p className="text-sm text-muted-foreground">
                      Điểm dự kiến: {grades.length ? `${Math.round((grades.filter((grade) => grade.correct).length / grades.length) * 100)}%` : "—"}
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => {
                        setPendingGrammarClassId(null);
                        setGradingAttemptId(null);
                        setGradingQueueIndex(null);
                        setGradingComplete(false);
                      }}>Đóng</Button>
                      <Button type="submit" disabled={gradeSubmitFetcher.state === "submitting" || grades.length !== gradingData.attempt.results.length || grades.length === 0}>
                        {gradeSubmitFetcher.state === "submitting"
                          ? "Đang lưu..."
                          : gradingQueueIndex != null && gradingQueueIndex < gradingQueue.length - 1
                            ? "Lưu & chấm bài tiếp"
                            : "Lưu điểm"}
                      </Button>
                    </div>
                  </div>
                </gradeSubmitFetcher.Form>
              )}
            </section>
          </div>
        )}
        {pendingGrammarClass && gradingComplete && (
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="grammar-grading-complete-title"
              className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-xl"
            >
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
              <h2 id="grammar-grading-complete-title" className="mt-3 text-lg font-semibold">Đã chấm xong</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Bạn đã chấm {gradingQueue.length} bài của lớp {pendingGrammarClass.name}.
              </p>
              <Button
                type="button"
                className="mt-5"
                onClick={() => {
                  setPendingGrammarClassId(null);
                  setGradingQueue([]);
                  setGradingQueueIndex(null);
                  setGradingComplete(false);
                }}
              >
                Đóng
              </Button>
            </section>
          </div>
        )}
        {selectedTranslationSubmission && (
          <div className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="presentation">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="translation-grading-title"
              className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl sm:max-h-[calc(100vh-3rem)]"
            >
              <header className="flex shrink-0 items-start justify-between gap-3 border-b bg-background px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <h2 id="translation-grading-title" className="text-lg font-semibold">Chấm bài Luyện dịch</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedTranslationSubmission.student?.name ?? selectedTranslationSubmission.student?.email}</span>
                    <span className="mx-2 text-muted-foreground/60">·</span>
                    {selectedTranslationSubmission.lesson.title}
                  </p>
                </div>
                <button type="button" aria-label="Đóng bài luyện dịch" onClick={() => setSelectedTranslationSubmissionId(null)} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {Array.isArray(selectedTranslationSubmission.answers)
                  ? (selectedTranslationSubmission.answers as Array<{ questionId?: string; prompt?: string; sampleAnswer?: string; maxScore?: number; answer?: string; teacherComment?: string }>).map((item, index) => (
                      <section key={item.questionId ?? index} className="border-b px-5 py-5 last:border-b-0 sm:px-6">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold">Câu {index + 1}</p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Đề bài</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-medium">{item.prompt}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Bài làm của học viên</p>
                            <p className={`mt-1 whitespace-pre-wrap rounded-md border p-3 text-sm ${item.answer ? "border-primary/15 bg-primary/[0.04]" : "border-dashed bg-muted/40 text-muted-foreground"}`}>
                              {item.answer || "Học viên chưa trả lời câu này"}
                            </p>
                          </div>
                        </div>
                        {item.sampleAnswer && (
                          <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            <span className="font-medium text-foreground">Đáp án mẫu:</span> {item.sampleAnswer}
                          </p>
                        )}
                        <div className="mt-3">
                          <label
                            htmlFor={`translation-comment-${item.questionId ?? index}`}
                            className="text-xs font-medium text-foreground"
                          >
                            Nhận xét câu {index + 1}
                          </label>
                          <Textarea
                            id={`translation-comment-${item.questionId ?? index}`}
                            name={`translation-comment-${item.questionId ?? ""}`}
                            form="translation-grade-form"
                            defaultValue={item.teacherComment ?? ""}
                            placeholder="Nhận xét lỗi hoặc cách diễn đạt tốt hơn..."
                            className="mt-1.5 min-h-16 resize-y bg-background"
                          />
                        </div>
                      </section>
                    ))
                  : <p className="px-5 py-8 text-sm text-muted-foreground sm:px-6">Không đọc được nội dung bài làm.</p>}
              </div>

              <TranslationGradeFetcher.Form
                  method="post"
                id="translation-grade-form"
                onSubmit={() => undefined}
                  className="grid shrink-0 gap-4 border-t bg-background px-5 py-4 sm:grid-cols-[150px_1fr_auto] sm:px-6"
                >
                  <input type="hidden" name="intent" value="grade-translation" />
                  <input type="hidden" name="submissionId" value={selectedTranslationSubmission.id} />
                  <div>
                    <label htmlFor="translation-score" className="text-sm font-medium">Điểm tổng</label>
                    <Input
                      id="translation-score"
                      name="score"
                      type="number"
                      min="0"
                      max={selectedTranslationSubmission.maxScore}
                      defaultValue={selectedTranslationSubmission.status === "GRADED" ? String(selectedTranslationSubmission.score ?? 0) : ""}
                      required
                      className="mt-1.5"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Tối đa {selectedTranslationSubmission.maxScore}</p>
                  </div>
                  <div>
                    <label htmlFor="translation-comment" className="text-sm font-medium">Nhận xét</label>
                    <Textarea
                      id="translation-comment"
                      name="teacherComment"
                      defaultValue={selectedTranslationSubmission.teacherComment ?? ""}
                      placeholder="Nhận xét ưu điểm và lỗi cần sửa..."
                      className="mt-1.5 min-h-20 resize-y"
                    />
                  </div>
                  {TranslationGradeFetcher.data?.error && (
                    <p className="text-sm text-destructive sm:col-span-2">{TranslationGradeFetcher.data.error}</p>
                  )}
                  <div className="flex items-end justify-end gap-2 sm:self-end">
                    <Button type="button" variant="outline" onClick={() => setSelectedTranslationSubmissionId(null)}>Đóng</Button>
                    <Button type="submit" disabled={TranslationGradeFetcher.state === "submitting"}>
                      {TranslationGradeFetcher.state === "submitting"
                        ? "Đang lưu..."
                        : selectedTranslationSubmission.status === "GRADED"
                          ? "Cập nhật kết quả"
                          : "Trả bài cho học viên"}
                    </Button>
                  </div>
              </TranslationGradeFetcher.Form>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
