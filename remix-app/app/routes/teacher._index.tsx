import type { LoaderFunctionArgs } from "react-router";
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
  MessageCircle,
  TrendingUp,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import { GRAMMAR_QUESTION_META, type GrammarQuestionType, type TeacherGrammarGrade } from "~/lib/grammar";
import { aggregatePhoneticsSections, getBestPhoneticsSectionAttempts, type PhoneticsReviewResult } from "~/lib/phonetics";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

const DASHBOARD_ACTIVITIES = [
  { tab: "FLASHCARD", label: "Flashcard" },
  { tab: "LESSON", label: "Bài khóa" },
  { tab: "PHONETICS", label: "Ngữ âm" },
  { tab: "VOCABULARY_TEST", label: "Ôn từ vựng" },
  { tab: "LISTENING", label: "Nghe câu" },
  { tab: "GRAMMAR", label: "Ngữ pháp" },
  { tab: "WORKBOOK", label: "Sách bài tập" },
] as const;

type DashboardActivityTab = (typeof DASHBOARD_ACTIVITIES)[number]["tab"];

type PendingGrammarAttempt = Awaited<ReturnType<typeof loader>>["classSummaries"][number]["pendingGrammarAttempts"][number];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const myCourses = await getTeacherCourses(user.id);
  const myClasses = await prisma.class.findMany({
    where: { teacherId: user.id },
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
    const [progressRows, phoneticsSections, phoneticsAttempts, grammarAttempts, grammarAutoAttempts, grammarQuestionRows, reviewAttempts, mockExamAttempts] = (lessonIds.length > 0 || reviewSetIds.length > 0 || mockExamIds.length > 0) && userIds.length > 0
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
              type: { in: ["SINGLE_CHOICE", "ARRANGE"] },
            },
            select: {
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
      : [[], [], [], [], [], [], [], []];

    const enrollmentsByUserId = new Map(cls.enrollments.map((enrollment) => [enrollment.userId, enrollment]));
    const lessonsById = new Map(courseLessons.map((lesson) => [lesson.id, lesson]));
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
    for (const question of grammarQuestionRows) {
      grammarQuestionTotalsByLesson.set(
        question.section.lessonId,
        (grammarQuestionTotalsByLesson.get(question.section.lessonId) ?? 0) + 1,
      );
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
    for (const attempt of reviewAttempts) {
      const key = `${attempt.userId}:${attempt.reviewSetId}`;
      if (!reviewProgressByKey.has(key)) reviewProgressByKey.set(key, attempt);
    }
    const mockExamProgressByKey = new Map<string, (typeof mockExamAttempts)[number]>();
    for (const attempt of mockExamAttempts) {
      const key = `${attempt.userId}:${attempt.mockExamId}`;
      if (!mockExamProgressByKey.has(key)) mockExamProgressByKey.set(key, attempt);
    }
    const pendingGrammarKeys = new Set(pendingGrammarAttempts.map((attempt) => `${attempt.userId}:${attempt.lessonId}`));
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
          activities: DASHBOARD_ACTIVITIES.map(({ tab }) => {
          const progress = progressByKey.get(`${enrollment.userId}:${lesson.id}:${tab}`);
          const attempt = progress?.attempts[0];
          const grammarSummary = tab === "GRAMMAR"
            ? grammarSummaryByUserLesson.get(`${enrollment.userId}:${lesson.id}`)
            : undefined;
          const attemptDetails = isRecord(attempt?.details) ? attempt.details : {};
          const reviewableAttemptResults = (
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
            : progress?.completed === true;
          const hasStarted = Boolean(
            attempt
            || progress?.opened
            || progress?.state === "IN_PROGRESS"
            || (progress?.percent ?? 0) > 0,
          );
          const status = !available
            ? "unavailable"
            : tab === "GRAMMAR" && pendingGrammarKeys.has(`${enrollment.userId}:${lesson.id}`)
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
              : grammarSummary && grammarSummary.totalCount > 0
                ? (grammarSummary.correctCount / grammarSummary.totalCount) * 100
                : attempt?.score ?? progress?.currentScore ?? progress?.bestScore ?? progress?.percent ?? 0),
            percent: Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
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
          const attempt = reviewProgressByKey.get(`${enrollment.userId}:${review.id}`);
          return {
            id: review.id,
            percentage: attempt?.percentage ?? 0,
            hasAttempt: Boolean(attempt),
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
            latest: latest ? {
              status: latest.status,
              percentage: latest.percentage,
              passed: latest.passed,
              attemptNumber: latest.attemptNumber,
            } : null,
          };
        }),
      };
    });

    const perStudent = new Map<string, Set<string>>();
    for (const row of progressRows) {
      const completed = row.tab === "VOCABULARY_TEST"
        ? row.attempts[0]?.passed === true
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

  return { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents };
}

function getLessonProgress(activities: { status: string; percent: number }[]) {
  const available = activities.filter((activity) => activity.status !== "unavailable");
  if (available.length === 0) return { percent: 0, completed: 0, total: 0 };
  const completed = available.filter((activity) => activity.status === "completed" || activity.status === "waiting").length;
  const percent = Math.round(available.reduce((sum, activity) => {
    if (activity.status === "completed" || activity.status === "waiting") return sum + 100;
    return sum + (activity.status === "partial" ? activity.percent : 0);
  }, 0) / available.length);
  return { percent, completed, total: available.length };
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
  if (percent <= 80) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
}

export default function TeacherIndex() {
  const { user, myCourses, myClasses, classSummaries, totalLessons, totalStudents } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const gradingFetcher = useFetcher<GrammarAttemptData & { success?: boolean }>();
  const gradeSubmitFetcher = useFetcher<{ success?: boolean; attemptId?: string; error?: string }>();
  const revalidator = useRevalidator();
  const [selectedClassId, setSelectedClassId] = useState(classSummaries[0]?.id ?? "");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [progressView, setProgressView] = useState<"overview" | "lesson">("overview");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedActivityReview, setSelectedActivityReview] = useState<ActivityReviewDialogState | null>(null);
  const [pendingGrammarClassId, setPendingGrammarClassId] = useState<string | null>(null);
  const [gradingAttemptId, setGradingAttemptId] = useState<string | null>(null);
  const [gradingQueue, setGradingQueue] = useState<{ courseId: string; attempt: PendingGrammarAttempt }[]>([]);
  const [gradingQueueIndex, setGradingQueueIndex] = useState<number | null>(null);
  const [gradingComplete, setGradingComplete] = useState(false);
  const [grades, setGrades] = useState<TeacherGrammarGrade[]>([]);
  const [initializedGradeAttemptId, setInitializedGradeAttemptId] = useState<string | null>(null);
  const handledGradeAttemptId = useRef<string | null>(null);
  const selectedClass = classSummaries.find((cls) => cls.id === selectedClassId) ?? classSummaries[0];
  const pendingGrammarClass = classSummaries.find((cls) => cls.id === pendingGrammarClassId);
  const selectedLesson = selectedClass?.lessons.find((lesson) => lesson.id === selectedLessonId)
    ?? selectedClass?.lessons.find((lesson) => lesson.id === selectedClass.suggestedLessonId)
    ?? selectedClass?.lessons[0];
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
  const isModalOpen = Boolean(
    selectedStudentId
    || selectedActivityReview
    || pendingGrammarClass
    || gradingAttemptId
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
    if (!selectedStudentId && !selectedActivityReview && !pendingGrammarClassId && !gradingAttemptId && !gradingComplete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gradeSubmitFetcher.state !== "submitting") {
        setSelectedStudentId(null);
        setSelectedActivityReview(null);
        setPendingGrammarClassId(null);
        setGradingAttemptId(null);
        setGradingQueueIndex(null);
        setGradingComplete(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedStudentId, selectedActivityReview, pendingGrammarClassId, gradingAttemptId, gradingComplete, gradeSubmitFetcher.state]);

  const gradingData = gradingFetcher.data?.attempt ? gradingFetcher.data : null;
  useEffect(() => {
    if (!gradingData || gradingData.attempt.id !== gradingAttemptId || initializedGradeAttemptId === gradingAttemptId) return;
    setGrades(gradingData.attempt.results.map((result) => ({
      questionId: result.id,
      correct: result.autoCorrect,
      teacherFeedback: result.teacherFeedback,
    })));
    setInitializedGradeAttemptId(gradingAttemptId);
  }, [gradingData, gradingAttemptId, initializedGradeAttemptId]);

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
                          onClick={() => setProgressView("overview")}
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
                                        navigate(`/teacher/courses/${selectedClass.courseId}/progress/reviews/${item.id}`);
                                        return;
                                      }
                                      if (item.kind === "mockExam") {
                                        navigate(`/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${item.id}`);
                                        return;
                                      }
                                      setSelectedLessonId(item.id);
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
                                              onClick={() => navigate(`/teacher/courses/${selectedClass.courseId}/progress/reviews/${item.id}`)}
                                              title={`${item.label}: ${review?.percentage ?? 0}%`}
                                              className={`min-w-12 rounded-md px-1.5 py-2 text-xs font-semibold ${lessonProgressTone(review?.percentage ?? 0)}`}
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
                                              onClick={() => navigate(`/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${item.id}`)}
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
                        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2" aria-label="Chọn bài học">
                          {selectedClass.courseItems.map((item) => {
                            if (item.kind === "review") {
                              return (
                                <Link
                                  key={`review:${item.id}`}
                                  to={`/teacher/courses/${selectedClass.courseId}/progress/reviews/${item.id}`}
                                  className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                                  title={item.title}
                                >
                                  {item.label}
                                </Link>
                              );
                            }
                            if (item.kind === "mockExam") {
                              return (
                                <Link
                                  key={`mockExam:${item.id}`}
                                  to={`/teacher/courses/${selectedClass.courseId}/progress/mock-exams/${item.id}`}
                                  className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                                  title={item.title}
                                >
                                  {item.label}
                                </Link>
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
                                aria-pressed={selectedLesson?.id === lesson.id}
                                onClick={() => setSelectedLessonId(lesson.id)}
                                className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${selectedLesson?.id === lesson.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"} ${hasGaps && selectedLesson?.id !== lesson.id ? "border-rose-300" : ""}`}
                              >
                                Bài {lesson.displayOrder}
                                {lesson.id === selectedClass.suggestedLessonId && <span className="ml-1.5 text-emerald-500" aria-label="Bài đang học">●</span>}
                              </button>
                            );
                          })}
                        </div>
                        {selectedLesson && (
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
                                            : displayedPercent > 80 ? "completed" : "partial";
                                          const activityReviewData = (
                                            activity.tab === "PHONETICS"
                                            || activity.tab === "LISTENING"
                                            || activity.tab === "VOCABULARY_TEST"
                                            || activity.tab === "WORKBOOK"
                                          )
                                            && result != null
                                            && (result.status === "partial" || result.status === "completed")
                                            && result.correctCount != null
                                            && result.totalCount != null
                                            && result.totalCount > 0
                                            && result.wrongAnswers.length > 0
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
                                                  ? displayedPercent > 80 ? "Đã làm" : "Đang làm"
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
                        <p className="text-xs text-muted-foreground">{answer.groupLabel}</p>
                      )}
                      {answer.full && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {selectedActivityReview.activityLabel === "Nghe câu"
                              ? "Câu nghe"
                              : selectedActivityReview.activityLabel === "Ôn từ vựng"
                                ? "Từ vựng"
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
      </div>
    </AppShell>
  );
}
