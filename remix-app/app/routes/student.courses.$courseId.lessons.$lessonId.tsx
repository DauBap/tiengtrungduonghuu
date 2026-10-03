import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, redirect } from "react-router";
import { useEffect, useRef, useState } from "react";
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
  getPhoneticsConfig,
} from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { BlockRenderer, isBlockLearnable, type ResolvedBlock } from "~/components/lessons/blocks/block-renderer";
import {
  isLearningBlockType, parseListeningConfig, parseWorkbookConfig,
  type WorkbookConfig, type PhoneticsConfig, type LearningBlockType as LearningBlockTypeKey,
} from "~/lib/learning-blocks";
import { LessonTabs, type LessonTab } from "~/components/lessons/lesson-tabs";
import { LessonTabEmpty } from "~/components/lessons/lesson-tab-empty";
import { VocabularyTable } from "~/components/lessons/vocabulary-table";
import { GrammarSection, type GrammarPracticeSummary } from "~/components/lessons/grammar-section";
import { WorkbookListeningTest } from "~/components/lessons/workbook-listening-test";
import { VocabularyTest } from "~/components/lessons/vocabulary-test";
import { PhoneticsPractice, type PhoneticsSectionScore } from "~/components/lessons/phonetics-practice";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { ArrowLeft, BookOpen, PartyPopper, XCircle, RefreshCw, CheckCircle2, Lightbulb, Volume2, MessageSquareText } from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { createVocabularyTest, gradeVocabularyTest } from "~/lib/vocabulary-test";
import { answerVariants, bestAnswerMatchPercent, isAnswerCorrectForAny } from "~/lib/listening-answer";
import {
  GRAMMAR_QUESTION_META, checkGrammarAnswer, grammarAnswerText, parseGrammarQuestionType,
  type GrammarQuestionType,
} from "~/lib/grammar";
import { cn } from "~/lib/utils";
import { speakChinese } from "~/lib/speech";
import { useAppSettings } from "~/lib/app-settings";
import { SettingsMenu } from "~/components/layout/settings-menu";
import { isLessonTabKey, openLessonTab, recordLessonTabAttempt } from "~/lib/lesson-tab-progress.server";
import type { LessonTab as ProgressTab } from "~/lib/lesson-tab-progress";
import { computePronunciationScore } from "~/lib/pronunciation";
import { gradePhoneticsSection, type PhoneticsAnswer } from "~/lib/phonetics";

const FEEDBACK_TAB_LABELS: Record<string, string> = {
  FLASHCARD: "Flashcard",
  VOCABULARY_TEST: "Ôn từ vựng",
  LISTENING: "Nghe câu",
  VOCABULARY: "Từ vựng",
  LESSON: "Bài học",
  PHONETICS: "Ngữ âm",
  GRAMMAR: "Ngữ pháp",
  WORKBOOK: "Workbook",
};

interface AnswerReviewResult {
  id: string;
  prompt: string;
  given: string;
  correctAnswer: string;
  completeAnswer: string | null;
  correct: boolean | null;
  matchPercent: number | null;
  hint: string | null;
  teacherFeedback: string | null;
}

interface AnswerReviewGroup {
  targetKey: string;
  title: string;
  score: number | null;
  correctCount: number | null;
  totalCount: number | null;
  results: AnswerReviewResult[];
}

interface ReviewTarget {
  sectionId?: string;
  questionType?: string;
  blockId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTeacherGrade(details: Record<string, unknown>) {
  return isRecord(details.teacherGrading) && typeof details.teacherGrading.gradedAt === "string";
}

function makeAnswerReviewGroup(
  attempt: { details: unknown; score: number | null; correctCount: number | null; totalCount: number | null },
  targetKey: string,
  title: string,
  isPhonetics = false,
): AnswerReviewGroup | null {
  const details = isRecord(attempt.details) ? attempt.details : null;
  if (!details || !Array.isArray(details.results)) return null;

  const results = details.results.flatMap((value, index): AnswerReviewResult[] => {
    if (!isRecord(value)) return [];
    const prompt = typeof value.prompt === "string"
      ? value.prompt
      : typeof value.number === "number"
        ? `Câu ${value.number}`
        : `Câu ${index + 1}`;
    const given = typeof value.givenLabel === "string"
      ? value.givenLabel
      : typeof value.given === "string"
        ? value.given
        : "";
    return [{
      id: typeof value.id === "string" ? value.id : `${targetKey}-${index}`,
      prompt,
      given,
      correctAnswer: typeof value.correctAnswer === "string" ? value.correctAnswer : "",
      completeAnswer: isPhonetics && typeof value.full === "string" ? value.full : null,
      correct: typeof value.correct === "boolean" ? value.correct : null,
      matchPercent: !isPhonetics && typeof value.matchPercent === "number" ? value.matchPercent : null,
      hint: typeof value.hint === "string" ? value.hint : null,
      teacherFeedback: typeof value.teacherFeedback === "string" ? value.teacherFeedback : null,
    }];
  });

  return {
    targetKey,
    title,
    score: isPhonetics ? null : attempt.score,
    correctCount: attempt.correctCount,
    totalCount: attempt.totalCount,
    results,
  };
}

async function getAnswerReviewGate(
  userId: string,
  lessonId: string,
  tab: ProgressTab,
  target: ReviewTarget = {},
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { answerReviewTabs: true },
  });
  const isOpen = lesson?.answerReviewTabs.includes(tab) ?? false;
  if (!isOpen) return { isOpen, isLocked: false };

  const attempts = await prisma.lessonTabAttempt.findMany({
    where: { userId, lessonId, tab },
    select: { mode: true, details: true },
  });
  const isLocked = attempts.some(({ mode, details }) => {
    if (!isRecord(details)) return false;
    if (tab === "GRAMMAR") {
      return details.sectionId === target.sectionId && details.questionType === target.questionType;
    }
    if (tab === "PHONETICS") {
      return String(details.sectionId ?? mode) === target.sectionId;
    }
    if (tab === "LISTENING" || tab === "WORKBOOK") return details.blockId === target.blockId;
    return true;
  });
  return { isOpen, isLocked };
}

function answerReviewLockError(tab: ProgressTab) {
  const message = "Giáo viên đã mở đáp án chi tiết. Bạn không thể nộp lại phần này.";
  if (tab === "GRAMMAR") return { grammarError: message };
  if (tab === "PHONETICS") return { phoneticsError: message };
  if (tab === "LISTENING") return { listeningError: message };
  if (tab === "WORKBOOK") return { workbookError: message };
  return { testError: message };
}

function makeStudentWorkbookConfig(config: unknown): WorkbookConfig | null {
  const parsed = parseWorkbookConfig(config);
  if (!parsed.ok) return null;
  return {
    ...parsed.data,
    showResultsImmediately: false,
    sections: parsed.data.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => ({ ...question, correctAnswer: "", acceptedAnswers: [] })),
    })),
  };
}

function getPronunciationEvaluation(score: number) {
  if (score >= 90) return "TỐT";
  if (score >= 75) return "KHÁ";
  if (score >= 60) return "CẦN CẢI THIỆN";
  return "CHƯA ĐẠT";
}

declare global {
  interface Window {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lesson = await getLessonById(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy", { status: 404 });

  const [
    progress,
    courseWords,
    teacherTabFeedback,
    pronunciationAssessments,
    grammarAttempts,
    latestVocabularyAttempt,
    latestListeningAttempt,
    latestWorkbookAttempt,
    answerReviewSetting,
    phoneticsConfig,
    phoneticsAttempts,
  ] = await Promise.all([
    getLessonProgress(user.id, lesson.id),
    prisma.vocabItem.findMany({
      where: { lesson: { courseId: lesson.courseId } },
      select: {
        id: true, chinese: true, chineseAlternatives: true, pinyin: true,
        translation: true, translationAlternatives: true, wordTypes: true,
      },
    }),
    prisma.lessonTabProgress.findMany({
      where: { userId: user.id, lessonId: lesson.id },
      select: {
        tab: true,
        feedback: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { teacher: { select: { name: true } } },
        },
      },
    }),
    prisma.pronunciationAssessment.findMany({
      where: {
        userId: user.id,
        lessonAudioScript: { is: { lessonId: lesson.id } },
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        lessonAudioScriptId: true,
        score: true,
        evaluation: true,
        scriptText: true,
        transcript: true,
        createdAt: true,
      },
    }),
    prisma.lessonTabAttempt.findMany({
      where: { userId: user.id, lessonId: lesson.id, tab: "GRAMMAR" },
      orderBy: { completedAt: "desc" },
      select: {
        mode: true,
        score: true,
        correctCount: true,
        totalCount: true,
        passed: true,
        details: true,
      },
    }),
    prisma.lessonTabAttempt.findFirst({
      where: { userId: user.id, lessonId: lesson.id, tab: "VOCABULARY_TEST", score: { not: null } },
      orderBy: [{ score: "desc" }, { completedAt: "desc" }],
      select: { score: true, correctCount: true, totalCount: true, passed: true },
    }),
    prisma.lessonTabAttempt.findFirst({
      where: { userId: user.id, lessonId: lesson.id, tab: "LISTENING", score: { not: null } },
      orderBy: [{ score: "desc" }, { completedAt: "desc" }],
      select: { score: true, correctCount: true, totalCount: true, passed: true },
    }),
    prisma.lessonTabAttempt.findFirst({
      where: { userId: user.id, lessonId: lesson.id, tab: "WORKBOOK", score: { not: null } },
      orderBy: [{ score: "desc" }, { completedAt: "desc" }],
      select: { score: true, correctCount: true, totalCount: true, passed: true },
    }),
    prisma.lesson.findUnique({ where: { id: lesson.id }, select: { answerReviewTabs: true } }),
    getPhoneticsConfig(lesson.id),
    prisma.lessonTabAttempt.findMany({
      where: { userId: user.id, lessonId: lesson.id, tab: "PHONETICS", score: { not: null } },
      orderBy: [{ score: "desc" }, { completedAt: "desc" }],
      select: { mode: true, score: true, correctCount: true, totalCount: true },
    }),
  ]);
  const answerReviewTabs = answerReviewSetting?.answerReviewTabs ?? [];
  const answerReviewAttempts = answerReviewTabs.length > 0
    ? await prisma.lessonTabAttempt.findMany({
        where: { userId: user.id, lessonId: lesson.id, tab: { in: answerReviewTabs } },
        orderBy: [{ score: "desc" }, { completedAt: "desc" }],
        select: { tab: true, mode: true, score: true, correctCount: true, totalCount: true, details: true },
      })
    : [];
  const answerReviewGroups: Partial<Record<ProgressTab, AnswerReviewGroup[]>> = {};
  const answerReviewLockedTargets: Partial<Record<ProgressTab, string[]>> = {};
  for (const attempt of answerReviewAttempts) {
    const details = isRecord(attempt.details) ? attempt.details : {};
    if (attempt.tab === "GRAMMAR"
      && details.questionType === "FILL"
      && details.reviewPending === true
      && !hasTeacherGrade(details)) continue;
    const targetKey = attempt.tab === "GRAMMAR"
      ? `${String(details.sectionId ?? "")}:${String(details.questionType ?? attempt.mode ?? "")}`
      : attempt.tab === "VOCABULARY_TEST"
        ? "vocabulary-test"
        : attempt.tab === "PHONETICS"
          ? String(details.sectionId ?? attempt.mode ?? "")
        : typeof details.blockId === "string"
          ? details.blockId
          : "";
    if (!targetKey) continue;

    const lockedTargets = answerReviewLockedTargets[attempt.tab] ??= [];
    if (!lockedTargets.includes(targetKey)) lockedTargets.push(targetKey);
    const groups = answerReviewGroups[attempt.tab] ??= [];
    if (groups.some((group) => group.targetKey === targetKey)) continue;
    const title = attempt.tab === "GRAMMAR"
      ? `${typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ pháp"} · ${String(details.questionType ?? attempt.mode ?? "")}`
      : typeof details.blockTitle === "string"
        ? details.blockTitle
        : attempt.tab === "VOCABULARY_TEST"
          ? "Ôn từ vựng"
          : attempt.tab === "PHONETICS"
            ? typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ âm"
          : "Kết quả bài làm";
    const group = makeAnswerReviewGroup(attempt, targetKey, title, attempt.tab === "PHONETICS");
    if (group) groups.push(group);
  }
  const grammarAttemptsBySection: Record<
    string,
    Partial<Record<GrammarQuestionType, GrammarPracticeSummary>>
  > = {};
  for (const attempt of grammarAttempts) {
    const details = typeof attempt.details === "object" && attempt.details !== null && !Array.isArray(attempt.details)
      ? attempt.details as Record<string, unknown>
      : {};
    const sectionId = details.sectionId;
    const questionType = parseGrammarQuestionType(details.questionType ?? attempt.mode);
    if (typeof sectionId !== "string" || !questionType) continue;

    const sectionAttempts = grammarAttemptsBySection[sectionId] ??= {};
    if (sectionAttempts[questionType]) continue;
    const pendingReview = details.reviewPending === true && !hasTeacherGrade(details);
    sectionAttempts[questionType] = {
      score: pendingReview ? null : attempt.score,
      correctCount: pendingReview ? null : attempt.correctCount,
      totalCount: pendingReview ? null : attempt.totalCount,
      passed: pendingReview ? null : attempt.passed,
      pendingReview,
    };
  }
  // Ngữ âm: config đọc từ block riêng, không qua `blocks`. Mỗi section có điểm
  // riêng nên `mode` của attempt mang id section (xem action submit-phonetics-attempt).
  const phonetics = phoneticsConfig
    ? { title: "Ngữ âm", config: phoneticsConfig }
    : null;
  const phoneticsSectionScores: Record<number, PhoneticsSectionScore> = {};
  for (const attempt of phoneticsAttempts) {
    const sectionId = Number(attempt.mode);
    if (!Number.isInteger(sectionId) || phoneticsSectionScores[sectionId]) continue;
    phoneticsSectionScores[sectionId] = {
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalCount: attempt.totalCount,
    };
  }

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
        config: b.type === "WORKBOOK" ? makeStudentWorkbookConfig(b.config) : b.config,
        vocabItems: vocabIds
          .map((id) => vocabById.get(id))
          .filter((v): v is NonNullable<typeof v> => Boolean(v))
          .map((v) => ({
            id: v.id,
            chinese: v.chinese,
            pinyin: v.pinyin,
            translation: v.translation,
            wordTypes: v.wordTypes ?? [],
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
  const studentLesson = {
    ...lesson,
    grammarSections: lesson.grammarSections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => ({ ...question, answer: "", acceptedAnswers: [], hint: null })),
    })),
    learningBlocks: lesson.learningBlocks.map((block) => ({
      ...block,
      config: block.type === "WORKBOOK" ? makeStudentWorkbookConfig(block.config) : block.config,
    })),
  };
  const blockProgressMap = await getBlockProgressMap(user.id, blocks.map((b) => b.id));
  const blockStatuses = computeBlockStatuses(blocks, blockProgressMap);

  const vocabularyQuestionSets = {
    sameWordType: createVocabularyTest(lesson.content, courseWords, true),
    random: createVocabularyTest(lesson.content, courseWords, false),
  };
  const passScore = lesson.test?.passScore ?? 50;
  const timeLimitMinutes = lesson.test ? lesson.test.timeLimitMinutes : 30;
  const teacherTabComments = teacherTabFeedback.map((item) => ({
    tab: item.tab,
    feedback: item.feedback[0]
      ? {
          comment: item.feedback[0].comment,
          teacherName: item.feedback[0].teacher.name,
          createdAt: item.feedback[0].createdAt.toISOString(),
        }
      : null,
  }));

  return {
    user,
    lesson: studentLesson,
    lessonStatus,
    blocks,
    blockStatuses,
    vocabularyQuestionSets,
    passScore,
    timeLimitMinutes,
    teacherTabComments,
    grammarAttemptsBySection,
    answerReviewTabs,
    answerReviewGroups,
    answerReviewLockedTargets,
    phonetics,
    phoneticsSectionScores,
    latestTabScores: {
      vocabularyTest: latestVocabularyAttempt,
      listening: latestListeningAttempt,
      workbook: latestWorkbookAttempt,
    },
    pronunciationAssessments: pronunciationAssessments
      .filter((assessment) => assessment.scriptText?.trim() && assessment.transcript?.trim())
      .map((assessment) => ({ ...assessment, createdAt: assessment.createdAt.toISOString() })),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "complete-learning");

  if (intent === "open-tab") {
    const rawTab = String(form.get("tab") ?? "");
    const tab = rawTab === "TEST" ? "VOCABULARY_TEST" : rawTab;
    if (!isLessonTabKey(tab)) return { error: "Tab bài học không hợp lệ." };

    await openLessonTab(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab,
    });
    return { success: true as const, intent: "open-tab" as const, tab };
  }

  const reviewSubmission = intent === "submit-test"
    ? { tab: "VOCABULARY_TEST" as const, target: {} }
    : intent === "submit-grammar-attempt"
      ? {
          tab: "GRAMMAR" as const,
          target: {
            sectionId: String(form.get("sectionId") ?? ""),
            questionType: String(form.get("questionType") ?? ""),
          },
        }
      : intent === "submit-listening-attempt"
        ? { tab: "LISTENING" as const, target: { blockId: String(form.get("blockId") ?? "") } }
        : intent === "submit-workbook-attempt"
          ? { tab: "WORKBOOK" as const, target: { blockId: String(form.get("blockId") ?? "") } }
          : intent === "submit-phonetics-attempt"
            ? { tab: "PHONETICS" as const, target: { sectionId: String(form.get("sectionId") ?? "") } }
            : null;
  let answerReviewOpen = false;
  if (reviewSubmission) {
    if (reviewSubmission.tab === "GRAMMAR" && reviewSubmission.target.questionType === "FILL") {
      const attempts = await prisma.lessonTabAttempt.findMany({
        where: { userId: user.id, lessonId: params.lessonId!, tab: "GRAMMAR", mode: "FILL" },
        select: { details: true },
      });
      const hasPendingFill = attempts.some((attempt) => {
        const details = isRecord(attempt.details) ? attempt.details : {};
        return details.sectionId === reviewSubmission.target.sectionId
          && details.reviewPending === true
          && !hasTeacherGrade(details);
      });
      if (hasPendingFill) {
        return { grammarError: "Lượt Dịch câu đang chờ giáo viên chấm. Bạn có thể luyện lại sau khi có kết quả." as const };
      }
    }
    const gate = await getAnswerReviewGate(user.id, params.lessonId!, reviewSubmission.tab, reviewSubmission.target);
    answerReviewOpen = gate.isOpen;
    if (gate.isLocked) return answerReviewLockError(reviewSubmission.tab);
  }

  if (intent === "save-pronunciation-score") {
    const scriptId = String(form.get("lessonAudioScriptId") ?? "");
    const transcript = String(form.get("transcript") ?? "").trim();

    if (!scriptId) return { error: "Thiếu đoạn nghe để lưu điểm." };
    if (!transcript) return { error: "Không có nội dung nhận diện để chấm điểm." };
    if (transcript.length > 10000) return { error: "Nội dung nhận diện quá dài." };

    const script = await prisma.lessonAudioScript.findUnique({
      where: { id: scriptId },
      select: {
        id: true,
        lessonId: true,
        title: true,
        speakers: { orderBy: { order: "asc" }, select: { chinese: true } },
      },
    });
    if (!script || script.lessonId !== params.lessonId) {
      return { error: "Không tìm thấy đoạn nghe trong bài học này." };
    }
    const scriptText = script.speakers.map((speaker) => speaker.chinese).join(" ");
    const score = computePronunciationScore(scriptText, transcript);
    const evaluation = getPronunciationEvaluation(score);
    const assessment = await prisma.pronunciationAssessment.create({
      data: {
        userId: user.id,
        lessonAudioScriptId: script.id,
        score,
        evaluation,
        scriptText: scriptText || null,
        transcript,
      },
    });
    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab: "LESSON",
      mode: "PRONUNCIATION",
      score,
      passed: score >= 50,
      startedAt: new Date(),
      completedAt: new Date(),
      details: {
        assessmentId: assessment.id,
        lessonAudioScriptId: script.id,
        scriptTitle: script.title,
        evaluation,
        scriptText: scriptText || null,
        transcript: transcript || null,
      },
    });
    return { success: true, intent: "save-pronunciation-score" as const };
  }

  if (intent === "complete-block") {
    const blockId = String(form.get("blockId"));
    const block = await prisma.learningBlock.findFirst({
      where: { id: blockId, lessonId: params.lessonId!, type: { not: "PHONETICS" } },
      select: { id: true, type: true },
    });
    // PHONETICS bị loại ở trên: block này nộp điểm qua submit-phonetics-attempt,
    // không "đánh dấu đã xem" như các dạng lý thuyết khác.
    if (!block) return { error: "Không tìm thấy phần học" };
    if (block.type === "LISTENING") {
      return { error: "Phần nghe câu cần nộp kết quả chấm điểm." as const };
    }

    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);

    const mappedTab = block.type === "FLASHCARD" ? "FLASHCARD" : null;
    if (mappedTab) {
      await recordLessonTabAttempt(prisma, {
        userId: user.id,
        lessonId: params.lessonId!,
        tab: mappedTab,
        mode: mappedTab,
        score: 100,
        passed: true,
        startedAt: new Date(),
        completedAt: new Date(),
      });
    }
    return { success: true };
  }

  if (intent === "submit-grammar-attempt") {
    const sectionId = String(form.get("sectionId") ?? "");
    const questionType = parseGrammarQuestionType(form.get("questionType"));
    let submittedAnswers: unknown;
    try {
      submittedAnswers = JSON.parse(String(form.get("answers") ?? ""));
    } catch {
      return { grammarError: "Không đọc được câu trả lời. Vui lòng thử lại." as const };
    }
    if (!sectionId || !questionType || !Array.isArray(submittedAnswers)) {
      return { grammarError: "Thông tin bài luyện tập không hợp lệ." as const };
    }
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: params.courseId! } },
      select: { userId: true },
    });
    if (!enrollment) return { grammarError: "Bạn không thuộc khóa học này." as const };

    const section = await prisma.grammarSection.findFirst({
      where: {
        id: sectionId,
        lessonId: params.lessonId!,
        lesson: { courseId: params.courseId! },
      },
      select: {
        id: true,
        title: true,
        questions: {
          where: { type: questionType },
          orderBy: { order: "asc" },
          select: { id: true, type: true, prompt: true, options: true, answer: true, acceptedAnswers: true, hint: true },
        },
      },
    });
    if (!section || section.questions.length === 0) {
      return { grammarError: "Không tìm thấy câu hỏi của dạng luyện tập này." as const };
    }

    const answerMap = new Map<string, string | string[]>();
    for (const entry of submittedAnswers) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return { grammarError: "Định dạng câu trả lời không hợp lệ." as const };
      }
      const answer = entry as Record<string, unknown>;
      const questionId = answer.questionId;
      const response = answer.response;
      const validResponse = typeof response === "string"
        || (Array.isArray(response) && response.every((item) => typeof item === "string"));
      if (typeof questionId !== "string" || !validResponse || answerMap.has(questionId)) {
        return { grammarError: "Câu trả lời không hợp lệ hoặc bị trùng." as const };
      }
      answerMap.set(questionId, response as string | string[]);
    }

    const questions = section.questions;
    if (answerMap.size !== questions.length || questions.some((question) => !answerMap.has(question.id))) {
      return { grammarError: "Vui lòng trả lời đầy đủ các câu hỏi trong tab này." as const };
    }

    const reviewPending = questionType === "FILL";
    const results = [];
    for (const question of questions) {
      const response = answerMap.get(question.id)!;
      if (question.type === "ARRANGE") {
        if (!Array.isArray(response) || response.length !== question.options.length) {
          return { grammarError: "Vui lòng sắp xếp đầy đủ các từ trong mỗi câu." as const };
        }
        const remaining = new Map<string, number>();
        for (const option of question.options) remaining.set(option, (remaining.get(option) ?? 0) + 1);
        for (const token of response) {
          const count = remaining.get(token) ?? 0;
          if (count === 0) return { grammarError: "Từ được chọn không thuộc câu hỏi này." as const };
          remaining.set(token, count - 1);
        }
      } else if (typeof response !== "string" || !response.trim()) {
        return { grammarError: "Vui lòng trả lời đầy đủ các câu hỏi trong tab này." as const };
      }

      if (question.type === "SINGLE_CHOICE" && !question.options.includes(response as string)) {
        return { grammarError: "Lựa chọn không thuộc câu hỏi này." as const };
      }

      const correct = checkGrammarAnswer(question, response);
      results.push({
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        typeLabel: GRAMMAR_QUESTION_META[question.type].label,
        given: Array.isArray(response) ? response.join("") : response,
        givenTokens: Array.isArray(response) ? response : null,
        correctAnswer: grammarAnswerText(question),
        correct,
        autoCorrect: correct,
        teacherFeedback: null,
        points: 1,
        hint: question.hint,
      });
    }

    const correctCount = results.filter((result) => result.correct).length;
    const totalCount = results.length;
    const score = Math.round((correctCount / totalCount) * 10000) / 100;
    const completedAt = new Date();
    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab: "GRAMMAR",
      mode: questionType,
      score: reviewPending ? null : score,
      correctCount: reviewPending ? null : correctCount,
      totalCount: reviewPending ? null : totalCount,
      passed: reviewPending ? null : correctCount === totalCount,
      needsReview: reviewPending,
      completedAt,
      details: {
        sectionId: section.id,
        sectionTitle: section.title,
        questionType,
        reviewPending,
        results,
      },
    });

    return {
      success: true as const,
      intent: "submit-grammar-attempt" as const,
      score: reviewPending ? null : score,
      correctCount: reviewPending ? null : correctCount,
      totalCount: reviewPending ? null : totalCount,
      reviewPending,
    };
  }

  if (intent === "submit-listening-attempt") {
    const blockId = String(form.get("blockId") ?? "");
    const rawAnswers = String(form.get("answers") ?? "");
    let submittedAnswers: unknown;
    try {
      submittedAnswers = JSON.parse(rawAnswers);
    } catch {
      return { listeningError: "Không đọc được câu trả lời. Vui lòng thử lại." as const };
    }
    if (!Array.isArray(submittedAnswers)) {
      return { listeningError: "Danh sách câu trả lời không hợp lệ." as const };
    }

    const block = await prisma.learningBlock.findFirst({
      where: { id: blockId, lessonId: params.lessonId!, type: "LISTENING" },
      select: { id: true, title: true, config: true },
    });
    if (!block) throw new Response("Không tìm thấy phần nghe câu", { status: 404 });

    const parsedConfig = parseListeningConfig(block.config);
    if (!parsedConfig.ok) throw new Response("Cấu hình phần nghe không hợp lệ", { status: 400 });

    const { source, answerMode } = parsedConfig.data;
    const chosenIds = source === "sentence" ? parsedConfig.data.sentenceItemIds : parsedConfig.data.vocabItemIds;
    const sourceItems = source === "sentence"
      ? await prisma.sentenceItem.findMany({
          where: { id: { in: chosenIds }, lessonId: params.lessonId! },
          select: {
            id: true, chinese: true, chineseAlternatives: true, pinyin: true,
            pinyinAlternatives: true, translation: true,
          },
        })
      : await prisma.vocabItem.findMany({
          where: { id: { in: chosenIds }, lessonId: params.lessonId! },
          select: {
            id: true, chinese: true, chineseAlternatives: true, pinyin: true,
            pinyinAlternatives: true, translation: true,
          },
        });
    const itemsById = new Map(sourceItems.map((item) => [item.id, item]));
    const questions = chosenIds.map((id) => itemsById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (questions.length === 0 || questions.length !== chosenIds.length) {
      throw new Response("Không tìm thấy đầy đủ câu hỏi của phần nghe", { status: 400 });
    }

    const answerMap = new Map<string, string>();
    for (const entry of submittedAnswers) {
      if (typeof entry !== "object" || entry === null || !("questionId" in entry) || !("answer" in entry)) {
        return { listeningError: "Định dạng câu trả lời không hợp lệ." as const };
      }
      const questionId = entry.questionId;
      const answer = entry.answer;
      if (typeof questionId !== "string" || typeof answer !== "string" || answerMap.has(questionId)) {
        return { listeningError: "Câu trả lời không hợp lệ hoặc bị trùng." as const };
      }
      answerMap.set(questionId, answer);
    }

    if (answerMap.size !== questions.length || questions.some((question) => !answerMap.has(question.id))) {
      return { listeningError: "Câu trả lời chưa khớp với danh sách câu hỏi." as const };
    }

    const results = questions.map((question, index) => {
      const given = answerMap.get(question.id) ?? "";
      const correctAnswer = answerMode === "pinyin" ? question.pinyin : question.chinese;
      const expectedAnswers = answerMode === "pinyin"
        ? answerVariants(question.pinyin, question.pinyinAlternatives)
        : answerVariants(question.chinese, question.chineseAlternatives);
      const matchPercent = bestAnswerMatchPercent(given, expectedAnswers, answerMode);
      return {
        id: question.id,
        prompt: `Câu ${index + 1}`,
        answerMode,
        given,
        correctAnswer,
        pinyin: question.pinyin,
        translation: question.translation,
        correct: matchPercent === 100,
        matchPercent,
        points: 1,
      };
    });
    const correctCount = results.filter((result) => result.correct).length;
    const totalCount = results.length;
    const score = totalCount > 0
      ? Math.round((results.reduce((sum, result) => sum + result.matchPercent, 0) / totalCount) * 100) / 100
      : 0;
    const completedAt = new Date();

    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab: "LISTENING",
      mode: answerMode,
      score,
      correctCount,
      totalCount,
      passed: correctCount === totalCount,
      startedAt: completedAt,
      completedAt,
      details: {
        blockId: block.id,
        blockTitle: block.title,
        source,
        answerMode,
        results,
      },
    });
    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);

    return { success: true as const, intent: "submit-listening-attempt" as const, score, correctCount, totalCount };
  }

  // Ngữ âm: nộp theo từng section, mỗi section một lượt điểm riêng.
  // `mode` lưu id section để loader dựng lại điểm cao nhất của từng phần.
  if (intent === "submit-phonetics-attempt") {
    const sectionId = Number(form.get("sectionId"));
    if (!Number.isInteger(sectionId)) {
      return { phoneticsError: "Phần ngữ âm không hợp lệ." as const };
    }

    let submitted: unknown;
    try {
      submitted = JSON.parse(String(form.get("answers") ?? ""));
    } catch {
      return { phoneticsError: "Không đọc được câu trả lời. Vui lòng thử lại." as const };
    }
    if (!Array.isArray(submitted)) {
      return { phoneticsError: "Danh sách câu trả lời không hợp lệ." as const };
    }

    const config = await getPhoneticsConfig(params.lessonId!);
    if (!config) throw new Response("Không tìm thấy phần ngữ âm", { status: 404 });

    const section = config.sections.find((item) => item.id === sectionId);
    if (!section) return { phoneticsError: "Không tìm thấy phần ngữ âm này." as const };

    const answers = new Map<number, PhoneticsAnswer>();
    for (const entry of submitted) {
      if (!isRecord(entry)) return { phoneticsError: "Định dạng câu trả lời không hợp lệ." as const };
      const itemId = Number(entry.itemId);
      const answer = entry.answer;
      if (!Number.isInteger(itemId) || typeof answer !== "string" || answers.has(itemId)) {
        return { phoneticsError: "Câu trả lời không hợp lệ hoặc bị trùng." as const };
      }
      if (answer.length > 20) {
        return { phoneticsError: "Câu trả lời quá dài." as const };
      }
      answers.set(itemId, answer);
    }

    const grade = gradePhoneticsSection(section, answers);
    const completedAt = new Date();

    // Tiến độ tab tính trên toàn bộ section: xong khi đã nộp hết, điểm tab là
    // trung bình điểm tốt nhất của từng section (section chưa nộp tính 0).
    const previousAttempts = await prisma.lessonTabAttempt.findMany({
      where: { userId: user.id, lessonId: params.lessonId!, tab: "PHONETICS", score: { not: null } },
      select: { mode: true, score: true },
    });
    const bestBySection = new Map<number, number>([[sectionId, grade.score]]);
    for (const attempt of previousAttempts) {
      const id = Number(attempt.mode);
      if (!Number.isInteger(id) || attempt.score == null) continue;
      bestBySection.set(id, Math.max(bestBySection.get(id) ?? 0, attempt.score));
    }
    const totalSections = config.sections.length;
    const submittedSections = config.sections.filter((item) => bestBySection.has(item.id)).length;
    const tabScore = config.sections.reduce((sum, item) => sum + (bestBySection.get(item.id) ?? 0), 0)
      / Math.max(1, totalSections);

    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab: "PHONETICS",
      mode: String(sectionId),
      score: grade.score,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
      passed: grade.correctCount === grade.totalCount,
      startedAt: completedAt,
      completedAt,
      details: {
        sectionId,
        sectionTitle: section.title,
        results: grade.results,
      },
      progress: {
        percent: Math.round((submittedSections / Math.max(1, totalSections)) * 100),
        completed: submittedSections >= totalSections,
        score: Math.round(tabScore * 100) / 100,
      },
    });

    return {
      success: true as const,
      intent: "submit-phonetics-attempt" as const,
      sectionId,
      score: grade.score,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
    };
  }

  if (intent === "submit-workbook-attempt") {
    const blockId = String(form.get("blockId") ?? "");
    let submittedAnswers: unknown;
    try {
      submittedAnswers = JSON.parse(String(form.get("answers") ?? ""));
    } catch {
      return { workbookError: "Không đọc được câu trả lời. Vui lòng thử lại." as const };
    }
    if (!blockId || typeof submittedAnswers !== "object" || submittedAnswers === null || Array.isArray(submittedAnswers)) {
      return { workbookError: "Thông tin bài làm không hợp lệ." as const };
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: params.courseId! } },
      select: { userId: true },
    });
    if (!enrollment) return { workbookError: "Bạn không thuộc khóa học này." as const };

    const block = await prisma.learningBlock.findFirst({
      where: {
        id: blockId,
        lessonId: params.lessonId!,
        lesson: { courseId: params.courseId! },
        type: "WORKBOOK",
      },
      select: { id: true, title: true, config: true },
    });
    if (!block) return { workbookError: "Không tìm thấy sách bài tập này." as const };

    const parsedConfig = parseWorkbookConfig(block.config);
    if (!parsedConfig.ok) return { workbookError: "Cấu hình sách bài tập không hợp lệ." as const };

    const questions = parsedConfig.data.sections.flatMap((section) =>
      section.questions.map((question) => ({ ...question, sectionId: section.id, sectionTitle: section.title }))
    );
    const gradableQuestions = questions.filter((question) => question.gradable);
    if (gradableQuestions.length === 0) {
      return { workbookError: "Sách bài tập chưa có câu hỏi với đáp án để chấm." as const };
    }

    const answers = submittedAnswers as Record<string, unknown>;
    const questionIds = new Set(questions.map((question) => question.id));
    for (const [questionId, answer] of Object.entries(answers)) {
      if (!questionIds.has(questionId) || typeof answer !== "string") {
        return { workbookError: "Danh sách câu trả lời không hợp lệ." as const };
      }
    }

    const results = questions.map((question) => {
      const given = typeof answers[question.id] === "string" ? answers[question.id] as string : "";
      const selectedOption = question.kind === "choice"
        ? question.options.find((option) => option.id === given)
        : undefined;
      if (question.gradable && question.kind === "choice" && given && !selectedOption) {
        return null;
      }

      const correctOption = question.kind === "choice"
        ? question.options.find((option) => option.id === question.correctAnswer)
        : undefined;
      const correct = !question.gradable
        ? null
        : question.kind === "input"
          ? isAnswerCorrectForAny(given, answerVariants(question.correctAnswer, question.acceptedAnswers), "chinese")
          : given === question.correctAnswer;

      return {
        id: question.id,
        number: question.number,
        sectionId: question.sectionId,
        sectionTitle: question.sectionTitle,
        prompt: question.prompt,
        passage: question.passage,
        translation: question.translation,
        kind: question.kind,
        gradable: question.gradable,
        given,
        givenLabel: selectedOption ? `${selectedOption.label}${selectedOption.text ? ` · ${selectedOption.text}` : ""}` : given,
        correctAnswer: question.kind === "choice" && correctOption
          ? `${correctOption.label}${correctOption.text ? ` · ${correctOption.text}` : ""}`
          : question.correctAnswer,
        correct,
        points: question.gradable ? 1 : 0,
      };
    });
    if (results.some((result) => result === null)) {
      return { workbookError: "Lựa chọn câu trả lời không hợp lệ." as const };
    }

    const savedResults = results.filter((result): result is NonNullable<typeof result> => result !== null);
    const correctCount = savedResults.filter((result) => result.correct === true).length;
    const totalCount = gradableQuestions.length;
    const score = Math.round((correctCount / totalCount) * 10000) / 100;
    const completedAt = new Date();

    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId: params.lessonId!,
      tab: "WORKBOOK",
      mode: "workbook",
      score,
      correctCount,
      totalCount,
      passed: correctCount === totalCount,
      startedAt: completedAt,
      completedAt,
      details: {
        blockId: block.id,
        blockTitle: block.title,
        ungradableCount: questions.length - totalCount,
        results: savedResults,
      },
    });
    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);

    return {
      success: true as const,
      intent: "submit-workbook-attempt" as const,
      score,
      correctCount,
      totalCount,
    };
  }

  if (intent === "submit-test") {
    const lessonId = params.lessonId!;
    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, courseId: params.courseId },
      select: {
        content: {
          orderBy: { order: "asc" },
          select: { id: true, chinese: true, pinyin: true, translation: true, wordTypes: true },
        },
        test: { select: { passScore: true } },
      },
    });
    if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
    if (lesson.content.length === 0) {
      return { testError: "Bài học này chưa có từ vựng để kiểm tra." as const };
    }

    const testResult = gradeVocabularyTest(lesson.content, form, lesson.test?.passScore ?? 50);
    const rawQuizMode = String(form.get("quizMode") ?? "");
    const quizMode = rawQuizMode === "zh2vi" || rawQuizMode === "vi2zh" || rawQuizMode === "mixed"
      ? rawQuizMode
      : "mixed";
    if (testResult.passed) {
      await upsertLessonProgress(user.id, lessonId, { testCompleted: true });
    }

    await recordLessonTabAttempt(prisma, {
      userId: user.id,
      lessonId,
      tab: "VOCABULARY_TEST",
      mode: quizMode,
      score: testResult.percentage,
      correctCount: testResult.correctCount,
      totalCount: testResult.questionCount,
      passed: testResult.passed,
      startedAt: new Date(),
      completedAt: new Date(),
      details: {
        earnedPoints: testResult.earnedPoints,
        totalPoints: testResult.totalPoints,
        blankCount: testResult.blankCount,
        passScore: testResult.passScore,
        results: testResult.results,
      },
    });

    return { testResult: { ...testResult, results: answerReviewOpen ? testResult.results : [] } };
  }

  await upsertLessonProgress(user.id, params.lessonId!, { learningCompleted: true });
  return redirect(`/student/courses/${params.courseId}/lessons/${params.lessonId}/exercise`);
}

function AnswerReviewDetails({ groups }: { groups: AnswerReviewGroup[] }) {
  if (groups.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">Chưa có lượt làm để đối chiếu đáp án.</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      {groups.map((group) => (
        <section key={group.targetKey} className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{group.title}</h3>
            {group.score != null && (
              <span className="text-sm font-medium tabular-nums">
                {group.score}%{group.correctCount != null && group.totalCount != null ? ` · ${group.correctCount}/${group.totalCount} câu đúng` : ""}
              </span>
            )}
          </div>
          {group.results.map((result, index) => (
            (() => {
              const isCorrect = result.correct === true || result.matchPercent === 100;
              const isIncorrect = result.correct === false || result.matchPercent === 0;
              return (
            <div
              key={result.id}
              className={cn(
                "rounded-md border p-3",
                isCorrect ? "border-success/30 bg-success/5" : isIncorrect ? "border-destructive/30 bg-destructive/5" : "bg-muted/20",
              )}
            >
              <div className="flex items-start gap-2">
                {isCorrect
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  : isIncorrect
                    ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    : null}
                <div className="min-w-0 space-y-1.5">
                  <p className="font-medium">{index + 1}. {result.prompt}</p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Bạn trả lời: </span>{result.given || "Bỏ trống"}
                    {result.matchPercent != null ? ` · Khớp ${result.matchPercent}%` : ""}
                  </p>
                  {result.correctAnswer && (
                    <p className="text-sm"><span className="text-muted-foreground">Đáp án đúng: </span>{result.correctAnswer}</p>
                  )}
                  {result.completeAnswer && (
                    <p className="text-sm"><span className="text-muted-foreground">Âm tiết hoàn chỉnh: </span>{result.completeAnswer}</p>
                  )}
                  {result.teacherFeedback && (
                    <p className="whitespace-pre-wrap text-sm">
                      <span className="text-muted-foreground">Đáp án/Nhận xét của giáo viên: </span>{result.teacherFeedback}
                    </p>
                  )}
                  {result.hint && <p className="whitespace-pre-line text-xs text-muted-foreground">{result.hint}</p>}
                </div>
              </div>
            </div>
              );
            })()
          ))}
        </section>
      ))}
    </div>
  );
}

export default function LessonDetail() {
  const { user, lesson, blocks, blockStatuses, vocabularyQuestionSets, passScore, timeLimitMinutes, lessonStatus, teacherTabComments, pronunciationAssessments, grammarAttemptsBySection, latestTabScores, answerReviewTabs, answerReviewGroups, answerReviewLockedTargets, phonetics, phoneticsSectionScores } = useLoaderData<typeof loader>();
  const settings = useAppSettings();
  const testFetcher = useFetcher<{ testResult?: { percentage: number; earnedPoints: number; totalPoints: number; correctCount: number; blankCount: number; passed: boolean; passScore: number; questionCount: number; results: { id: string; prompt: string; lessonPinyin: string; typeLabel: string; points: number; correct: boolean; given: string; correctAnswer: string; hint: string | null }[] }; testError?: string; error?: string }>();
  const workbookFetcher = useFetcher<{
    intent?: string;
    success?: boolean;
    score?: number;
    correctCount?: number;
    totalCount?: number;
    workbookError?: string;
  }>();
  const pronunciationFetcher = useFetcher<{ success?: boolean; intent?: string; error?: string }>();
  const phoneticsFetcher = useFetcher<{ phoneticsError?: string }>();
  const progressFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<LessonTab>("FLASHCARD");
  const hasGrammar = lesson.grammarSections.length > 0;
  const hasWorkbook = blocks.some((block) => block.type === "WORKBOOK");
  const hasPhonetics = phonetics !== null;

  useEffect(() => {
    if (
      (activeTab === "GRAMMAR" && !hasGrammar)
      || (activeTab === "WORKBOOK" && !hasWorkbook)
      || (activeTab === "PHONETICS" && !hasPhonetics)
    ) {
      setActiveTab("FLASHCARD");
    }
  }, [activeTab, hasGrammar, hasWorkbook, hasPhonetics]);

  const feedbackTab = activeTab === "TEST" ? "VOCABULARY_TEST" : activeTab;
  const activeTabComment = feedbackTab === "FLASHCARD" || feedbackTab === "VOCABULARY"
    ? null
    : teacherTabComments.find((item) => item.tab === feedbackTab)?.feedback ?? null;
  const activeScore = activeTab === "TEST"
    ? latestTabScores.vocabularyTest
    : activeTab === "LISTENING"
      ? latestTabScores.listening
      : activeTab === "WORKBOOK"
        ? latestTabScores.workbook
        : null;
    const activeReviewTab: ProgressTab | null = activeTab === "TEST"
      ? "VOCABULARY_TEST"
      : activeTab === "LISTENING" || activeTab === "PHONETICS" || activeTab === "GRAMMAR" || activeTab === "WORKBOOK"
        ? activeTab
        : null;
    const answerReviewEnabled = activeReviewTab !== null && answerReviewTabs.includes(activeReviewTab);
    const showAnswerReviewControls = answerReviewEnabled
      && activeTab !== "GRAMMAR"
      && activeTab !== "PHONETICS";
    const activeReviewGroups = activeReviewTab ? answerReviewGroups[activeReviewTab] ?? [] : [];
    const activeLockedTargets = activeReviewTab ? answerReviewLockedTargets[activeReviewTab] ?? [] : [];
    const testRetakeLocked = answerReviewEnabled && activeLockedTargets.includes("vocabulary-test");
    const [showAnswerReview, setShowAnswerReview] = useState(false);
  const [showScript, setShowScript] = useState(true);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [phoneticScore, setPhoneticScore] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recognizedTranscript, setRecognizedTranscript] = useState("");
  const [pronunciationFeedback, setPronunciationFeedback] = useState<React.ReactNode | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const manualStopRequestedRef = useRef(false);
  const recognitionErrorRef = useRef(false);

  const buildPronunciationFeedback = (score: number) => {
    if (score >= 90) {
      return (
        <div className="text-sm">
          <p className="mt-1">Nội dung đọc khớp tốt với bài khóa.<br />Tiếp tục giữ độ chính xác này.</p>
        </div>
      );
    }

    if (score >= 75) {
      return (
        <div className="text-sm">
          <p className="mt-1">Bạn đọc đúng phần lớn nội dung,<br />nhưng vẫn còn một số chỗ chưa khớp.</p>
          <p className="mt-1">Hãy xem lại phần được đánh dấu và đọc lại.</p>
        </div>
      );
    }

    if (score >= 60) {
      return (
        <div className="text-sm">
          <p className="mt-1">Còn khá nhiều nội dung chưa được nhận diện đúng.</p>
          <p className="mt-1">Nghe lại bài khóa,<br />xem phần chưa khớp và thử lại.</p>
        </div>
      );
    }

    return (
      <div className="text-sm">
        <p className="mt-1">Nội dung đọc còn khác nhiều so với bài khóa.</p>
        <p className="mt-1">Hãy nghe lại từng câu<br />và luyện lại chậm hơn.</p>
      </div>
    );
  };

  const lessonAudioScripts = [...(lesson.audioScripts ?? [])].sort((a, b) => a.order - b.order);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!lessonAudioScripts.length) {
      setSelectedScriptId(null);
      return;
    }

    if (!selectedScriptId || !lessonAudioScripts.some((script) => script.id === selectedScriptId)) {
      setSelectedScriptId(lessonAudioScripts[0].id);
    }
  }, [lessonAudioScripts, selectedScriptId]);

  useEffect(() => {
    const best = pronunciationAssessments.find((assessment) => assessment.lessonAudioScriptId === selectedScriptId);
    setPhoneticScore(best?.score ?? 0);
    setRecognizedTranscript(best?.transcript ?? "");
    setPronunciationFeedback(best ? buildPronunciationFeedback(best.score) : null);
  }, [pronunciationAssessments, selectedScriptId]);

  useEffect(() => {
    const selected = lessonAudioScripts.find((script) => script.id === selectedScriptId) ?? lessonAudioScripts[0];
    if (selected) {
      setShowScript(selected.showScript ?? true);
    }
  }, [lessonAudioScripts, selectedScriptId]);

  // Khi nộp bài xong, tự giữ kết quả trong fetcher.data
  const testResult = testFetcher.data && "testResult" in testFetcher.data ? testFetcher.data.testResult : null;
  const testError = testFetcher.data && "testError" in testFetcher.data ? testFetcher.data.testError : null;
  const pronunciationSaveError = pronunciationFetcher.data?.error ?? null;
  const isSubmittingPronunciation = pronunciationFetcher.state !== "idle";
  const isSubmittingTest = testFetcher.state !== "idle";

  // Dạng bài có mặt trong bài này. Dùng để làm mờ tab của dạng bài chưa soạn —
  // block đã tạo nhưng chưa chọn nội dung vẫn tính là có, để học viên bấm vào
  // và thấy lời nhắn cụ thể thay vì tưởng dạng đó không tồn tại.
  const availableTypes = new Set<LearningBlockTypeKey | "PHONETICS">(blocks.map((b) => b.type));
  // Từ vựng/Ngữ pháp hiện tab theo nội dung có sẵn, không qua LearningBlock —
  // khác với Flashcard/Nghe câu, admin cấu hình xong mới có block.
  if (lesson.content.length > 0) availableTypes.add("VOCABULARY");
  if (lesson.grammarSections.length > 0) availableTypes.add("GRAMMAR");
  // Ngữ âm đọc từ block riêng, không nằm trong `blocks`.
  if (hasPhonetics) availableTypes.add("PHONETICS");

  const isEmptyLesson =
    lesson.content.length === 0 &&
    lesson.grammarSections.length === 0 &&
    !hasPhonetics &&
    !blocks.some(isBlockLearnable);

  const renderTabContent = () => {
    // Ngữ âm — config từ block riêng, mỗi section nộp và lưu điểm độc lập.
    if (activeTab === "PHONETICS") {
      if (!phonetics) return <LessonTabEmpty tab="PHONETICS" />;
      return (
        <PhoneticsPractice
          config={phonetics.config as PhoneticsConfig}
          savedScores={phoneticsSectionScores}
          lockedSectionIds={activeLockedTargets
            .map(Number)
            .filter(Number.isInteger)}
          reviewGroups={answerReviewGroups.PHONETICS ?? []}
          isSaving={phoneticsFetcher.state !== "idle"}
          submissionError={phoneticsFetcher.data?.phoneticsError ?? null}
          onSubmitSection={(sectionId, answers) => phoneticsFetcher.submit({
            intent: "submit-phonetics-attempt",
            sectionId: String(sectionId),
            answers: JSON.stringify(answers),
          }, { method: "post" })}
        />
      );
    }

    // Từ vựng đọc trực tiếp kho từ của bài, không qua block.
    if (activeTab === "VOCABULARY") {
      return (
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex justify-end">
            <SettingsMenu align="right" />
          </div>
          <VocabularyTable items={lesson.content} lessonName={lesson.title} />
        </div>
      );
    }

    // Ngữ pháp cũng đọc trực tiếp từ bài, mỗi section một card.
    if (activeTab === "GRAMMAR") {
      if (lesson.grammarSections.length === 0) return <LessonTabEmpty tab="GRAMMAR" />;
      return (
        <div className="space-y-4 max-w-6xl mx-auto">
          {lesson.grammarSections.map((section, index) => (
            <GrammarSection
              key={section.id}
              section={section}
              number={index + 1}
              latestAttempts={grammarAttemptsBySection[section.id] ?? {}}
              answerReviewGroups={(answerReviewGroups.GRAMMAR ?? []).filter((group) =>
                group.targetKey.startsWith(`${section.id}:`)
              )}
              lockedPracticeTypes={activeLockedTargets.flatMap((targetKey) => {
                const [lockedSectionId, lockedType] = targetKey.split(":");
                return lockedSectionId === section.id && parseGrammarQuestionType(lockedType) ? [parseGrammarQuestionType(lockedType)!] : [];
              })}
            />
          ))}
        </div>
      );
    }

    // Sách bài tập — đọc từ block config thật
    if (activeTab === "WORKBOOK") {
      const workbookBlock = blocks.find((b) => b.type === "WORKBOOK");
      if (!workbookBlock) return <LessonTabEmpty tab="WORKBOOK" />;
      if (!workbookBlock.config) return <LessonTabEmpty tab="WORKBOOK" />;
      if (answerReviewEnabled && activeLockedTargets.includes(workbookBlock.id)) {
        return <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">Lượt làm này đã được chốt. Hãy xem đáp án chi tiết ở phía trên.</p>;
      }
      return (
        <WorkbookListeningTest
          config={workbookBlock.config as WorkbookConfig}
          isSaving={workbookFetcher.state !== "idle"}
          savedResult={workbookFetcher.data?.intent === "submit-workbook-attempt" && workbookFetcher.data.success
            && workbookFetcher.data.score != null && workbookFetcher.data.correctCount != null && workbookFetcher.data.totalCount != null
            ? {
                score: workbookFetcher.data.score,
                correctCount: workbookFetcher.data.correctCount,
                totalCount: workbookFetcher.data.totalCount,
              }
            : null}
          submissionError={workbookFetcher.data?.workbookError ?? null}
          onSubmitAttempt={(answers) => workbookFetcher.submit({
            intent: "submit-workbook-attempt",
            blockId: workbookBlock.id,
            answers: JSON.stringify(answers),
          }, { method: "post" })}
        />
      );
    }

    // Tab Ôn từ vựng — inline, dùng fetcher để không rời trang
    if (activeTab === "TEST") {
      // Kết quả sau khi nộp
      if (testResult) {
        return (
          <div className="space-y-4 max-w-6xl mx-auto">
            <Card className={cn(testResult.passed ? "border-success/40" : "border-destructive/40")}>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-col items-center text-center gap-2">
                  {testResult.passed ? (
                    <>
                      <PartyPopper className="h-10 w-10 text-success" />
                      <p className="text-lg font-bold text-success">Đạt — bài học hoàn tất!</p>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-10 w-10 text-destructive" />
                      <p className="text-lg font-bold text-destructive">Chưa đạt</p>
                      <p className="text-sm text-muted-foreground">
                        Cần từ {testResult.passScore}% trở lên. Bạn làm lại được bao nhiêu lần cũng không sao.
                      </p>
                    </>
                  )}
                  <p className="text-4xl font-bold tabular-nums mt-1">{testResult.percentage}%</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {testResult.earnedPoints}/{testResult.totalPoints} điểm · đúng {testResult.correctCount}/{testResult.questionCount} câu
                    {testResult.blankCount > 0 && ` · bỏ trống ${testResult.blankCount} câu`}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Progress value={testResult.percentage} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">Điểm đạt: {testResult.passScore}%</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center pt-1">
                  {testResult.passed ? (
                    <Button asChild>
                      <Link to={`/student/courses/${lesson.courseId}`}>Quay lại khóa học</Link>
                    </Button>
                  ) : testRetakeLocked ? (
                    <p className="text-sm font-medium text-muted-foreground">Phần làm bài đã bị khóa. Xem đáp án chi tiết ở phía trên.</p>
                  ) : (
                    // Xóa kết quả cũ bằng cách reload loader (trộn lại câu ARRANGE)
                    <Button onClick={() => window.location.reload()}>
                      <RefreshCw className="h-4 w-4 mr-1.5" />Làm lại
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        );
      }

      // Chưa có câu hỏi
      if (vocabularyQuestionSets.sameWordType.length === 0) return <LessonTabEmpty tab="TEST" />;
      if (testRetakeLocked) {
        return <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">Phần làm bài đã bị khóa. Xem đáp án chi tiết ở phía trên.</p>;
      }

      // Form làm bài
      return (
        <div className="max-w-6xl mx-auto space-y-4">
          {lessonStatus.testStatus === "COMPLETED" && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
              <PartyPopper className="h-4 w-4 shrink-0" />
              <span className="font-medium">Bạn đã đạt bài kiểm tra này. Làm lại để ôn cũng được.</span>
            </div>
          )}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {vocabularyQuestionSets.sameWordType.length} từ · cần {passScore}% để đạt
              </CardTitle>
              <CardDescription>
                Chọn nghĩa tiếng Việt phù hợp cho từng từ. Đề được trộn lại mỗi lần tải trang.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {testError && (
                <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {testError}
                </div>
              )}
              <testFetcher.Form method="post">
                <input type="hidden" name="intent" value="submit-test" />
                <VocabularyTest
                  questionSets={vocabularyQuestionSets}
                  timeLimitMinutes={timeLimitMinutes}
                  isSubmitting={isSubmittingTest}
                />
              </testFetcher.Form>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (activeTab === "LESSON") {
      const selectedAudioScript = lessonAudioScripts.find((script) => script.id === selectedScriptId) ?? lessonAudioScripts[0] ?? null;
      const scriptSpeakers = selectedAudioScript?.speakers ?? [];

      const startRecording = async () => {
        if (!selectedAudioScript) return;

        const SpeechRecognitionCtor = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
          setRecordingError("Trình duyệt của bạn chưa hỗ trợ nhận dạng giọng nói. Hãy thử trên Chrome hoặc Edge.");
          return;
        }

        manualStopRequestedRef.current = false;
        recognitionErrorRef.current = false;

        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }

        const recognition = new SpeechRecognitionCtor();
        recognitionRef.current = recognition;
        recognition.lang = "zh-CN";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let spokenText = "";
        recognition.onresult = (event: any) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i += 1) {
            transcript += event.results[i][0].transcript;
          }
          spokenText = transcript.trim();
          setRecognizedTranscript(spokenText);
        };

        recognition.onend = () => {
          if (recognitionErrorRef.current) {
            setRecordingSeconds(0);
            setIsRecording(false);
            if (recordingTimerRef.current) {
              window.clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
            recordingStartedAtRef.current = null;
            return;
          }

          if (!manualStopRequestedRef.current) {
            try {
              recognition.start();
            } catch {
              // Ignore restart race conditions.
            }
            return;
          }

          const scriptText = selectedAudioScript.speakers.map((speaker) => speaker.chinese).join(" ");
          const finalTranscript = spokenText.trim();
          if (!finalTranscript) {
            setRecordingError("Chưa nhận diện được nội dung. Hãy thử đọc lại.");
            setRecordingSeconds(0);
            setIsRecording(false);
            if (recordingTimerRef.current) {
              window.clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
            recordingStartedAtRef.current = null;
            return;
          }

          const score = computePronunciationScore(scriptText, finalTranscript);
          const finalScore = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
          setPhoneticScore(finalScore);
          setRecognizedTranscript(finalTranscript);
          setPronunciationFeedback(buildPronunciationFeedback(finalScore));
          setRecordingSeconds(0);
          setIsRecording(false);

          if (recordingTimerRef.current) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          recordingStartedAtRef.current = null;
        };

        recognition.onerror = (event: any) => {
          if (event?.error === "no-speech") {
            return;
          }
          setRecordingError("Không nhận dạng được giọng nói. Hãy thử lại sau vài giây.");
          recognitionErrorRef.current = true;
          manualStopRequestedRef.current = true;
          setRecognizedTranscript("");
          setPronunciationFeedback(null);
          setIsRecording(false);
        };

        setRecordingError(null);
        setRecognizedTranscript("");
        setPronunciationFeedback(null);
        setRecordingSeconds(0);
        setIsRecording(true);
        recordingStartedAtRef.current = Date.now();
        try {
          recognition.start();
        } catch {
          setRecordingError("Không thể bắt đầu nhận diện giọng nói. Vui lòng thử lại.");
          setIsRecording(false);
          return;
        }

        recordingTimerRef.current = window.setInterval(() => {
          if (recordingStartedAtRef.current) {
            const elapsed = Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
            setRecordingSeconds(elapsed);
          }
        }, 250);
      };

      const stopRecording = () => {
        manualStopRequestedRef.current = true;

        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      };

      const submitPronunciation = () => {
        if (!selectedAudioScript || !recognizedTranscript.trim() || isRecording || isSubmittingPronunciation) return;
        const formData = new FormData();
        formData.append("intent", "save-pronunciation-score");
        formData.append("lessonAudioScriptId", selectedAudioScript.id);
        formData.append("transcript", recognizedTranscript.trim());
        pronunciationFetcher.submit(formData, { method: "post" });
      };

      if (!selectedAudioScript) {
        return <LessonTabEmpty tab="LESSON" />;
      }

      const bestPronunciationAssessment = pronunciationAssessments.find(
        (assessment) => assessment.lessonAudioScriptId === selectedAudioScript.id
      );
      const hasCurrentTranscript = !isRecording && Boolean(recognizedTranscript.trim());
      const displayedScore = isRecording
        ? null
        : hasCurrentTranscript ? phoneticScore : bestPronunciationAssessment?.score ?? null;
      const displayedEvaluation = isRecording
        ? "CHỜ DỪNG ĐỌC"
        : hasCurrentTranscript
        ? displayedScore === null ? "CHƯA CÓ LƯỢT ĐỌC" : getPronunciationEvaluation(displayedScore)
        : bestPronunciationAssessment?.evaluation
          ?? (displayedScore === null ? "CHƯA CÓ LƯỢT ĐỌC" : getPronunciationEvaluation(displayedScore));

      return (
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex justify-end">
            <SettingsMenu align="right" />
          </div>
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b px-6 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                <span className="font-bold text-lg">{selectedAudioScript.title}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {lessonAudioScripts.map((script) => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => setSelectedScriptId(script.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      script.id === selectedAudioScript.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    {script.title}
                  </button>
                ))}
              </div>
            </div>
            </div>

            <div className="space-y-5 p-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.95fr)_minmax(420px,1.05fr)]">
              <section className="rounded-xl border bg-muted/20 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-bold uppercase tracking-wide text-primary">File nghe</span>
                  <span className="rounded-full bg-success/10 px-2 py-1 text-[11px] font-bold text-success">Audio</span>
                </div>
                <div className="rounded-xl border bg-background p-4">
                  <div className="flex items-center justify-center">
                    <audio controls className="w-full" src={selectedAudioScript.audioUrl ?? ""}>
                      <source src={selectedAudioScript.audioUrl ?? ""} />
                    </audio>
                  </div>
                  <div className="mt-4 border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={scriptSpeakers.length === 0}
                      onClick={() => speakChinese(scriptSpeakers.map((speaker) => speaker.chinese).filter(Boolean).join("。"))}
                    >
                      <Volume2 className="mr-2 h-4 w-4" />
                      Đọc bằng giọng máy
                    </Button>
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Dùng khi file nghe không phát được.
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-bold uppercase tracking-wide text-primary">Script</span>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
                    {showScript ? "Hiển thị" : "Đã ẩn"}
                  </span>
                </div>

                {showScript && scriptSpeakers.length > 0 ? (
                  <div className="space-y-3">
                    {scriptSpeakers.map((speaker, idx) => (
                      <div key={speaker.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-primary" />
                          <span className="text-sm font-bold">{speaker.speakerName || `Người ${idx + 1}`}</span>
                        </div>
                        <div className="mt-2 text-base">
                          <p className="font-medium text-foreground">{speaker.chinese}</p>
                          {settings.showPinyin && (
                            <p className="text-lg font-mono text-muted-foreground mt-1">{speaker.pinyin}</p>
                          )}
                          <p className="text-base text-muted-foreground mt-1">{speaker.translation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    {showScript ? "Chưa có script" : "Script đã được ẩn theo cài đặt của giáo viên."}
                  </div>
                )}
              </section>
            </div>

            <section className="rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Đọc theo script</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant={isRecording ? "destructive" : "default"} onClick={async () => {
                    if (isRecording) {
                      stopRecording();
                    } else {
                      await startRecording();
                    }
                  }}>
                    {isRecording ? "Dừng đọc" : "Bắt đầu đọc"}
                  </Button>
                  <Button
                    type="button"
                    onClick={submitPronunciation}
                    disabled={!recognizedTranscript.trim() || isRecording || isSubmittingPronunciation}
                  >
                    {isSubmittingPronunciation ? "Đang nộp..." : "Nộp bài"}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                    <div className="text-xs font-bold uppercase text-muted-foreground">
                      {isRecording ? "Điểm" : hasCurrentTranscript ? "Điểm bài đọc hiện tại" : "Điểm cao nhất"}
                    </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary tabular-nums">{displayedScore ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-bold uppercase text-muted-foreground">Đánh giá</div>
                  <div className="mt-2 font-medium">
                    {displayedEvaluation}
                  </div>
                </div>
              </div>

              {recordingError ? (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {recordingError}
                </div>
              ) : null}

              {pronunciationSaveError && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {pronunciationSaveError}
                </div>
              )}

              {displayedScore !== null && pronunciationFeedback && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-foreground">
                  {pronunciationFeedback}
                </div>
              )}

              {!isRecording && bestPronunciationAssessment && (
                <div className="mt-4 space-y-3 rounded-lg border p-3 text-sm">
                  <div className="text-xs font-bold uppercase text-muted-foreground">
                    Kết quả tốt nhất · {new Date(bestPronunciationAssessment.createdAt).toLocaleString("vi-VN")}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Script đã đọc</div>
                    <p className="mt-1 text-muted-foreground">{bestPronunciationAssessment.scriptText || "—"}</p>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Bạn đã đọc</div>
                    <p className="mt-1 text-muted-foreground">
                      {bestPronunciationAssessment.transcript || "Không nhận diện được nội dung trong lượt đọc này."}
                    </p>
                  </div>
                </div>
              )}

              {recognizedTranscript && !isRecording && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="font-medium text-foreground">Văn bản nhận diện:</div>
                  <p className="mt-1 text-muted-foreground">{recognizedTranscript}</p>
                </div>
              )}

              {isRecording && (
                <div className="mt-4 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
                  <span className="font-bold">Đang lắng nghe...</span>
                  <span className="ml-2 text-success/80">Đã nghe {recordingSeconds}s · đang nhận dạng giọng nói.</span>
                </div>
              )}
            </section>
            </div>
          </div>
        </div>
      );
    }

    const blockIndex = blocks.findIndex((b) => b.type === activeTab);
    // Bài chưa có block dạng này — khác với block đã có nhưng chưa chọn nội
    // dung, trường hợp đó BlockRenderer hiện "chưa có nội dung" của riêng nó.
    if (blockIndex === -1) return <LessonTabEmpty tab={activeTab} />;

    return <BlockRenderer
      block={blocks[blockIndex]}
      status={blockStatuses[blockIndex]}
      courseId={lesson.courseId}
      lessonId={lesson.id}
      lessonName={lesson.title}
      isRetakeLocked={answerReviewEnabled && activeTab === "LISTENING" && activeLockedTargets.includes(blocks[blockIndex].id)}
      showAnswerDetails={answerReviewEnabled}
    />;
  };

  const answerReviewControl = showAnswerReviewControls ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">Đáp án chi tiết</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {activeReviewGroups.length > 0
            ? "Xem câu trả lời và đáp án đúng của lượt làm tốt nhất."
            : "Sau khi nộp lượt làm cuối, kết quả chi tiết sẽ hiện tại đây."}
        </p>
      </div>
      {activeReviewGroups.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => setShowAnswerReview((visible) => !visible)}>
          {showAnswerReview ? "Ẩn kết quả" : "Xem kết quả chi tiết"}
        </Button>
      )}
    </div>
  ) : null;

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
            <p className="text-xl text-muted-foreground mt-2">{lesson.subtitle}</p>
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
              onTabChange={(tab) => {
                setActiveTab(tab);
                setShowAnswerReview(false);
                progressFetcher.submit(
                  { intent: "open-tab", tab },
                  { method: "post" },
                );
              }}
              availableTypes={availableTypes}
              hasQuiz={lesson.content.length > 0}
            />

            {activeTabComment && (
              <aside className="mx-auto mt-4 max-w-6xl rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <MessageSquareText className="h-4 w-4" />Nhận xét của giáo viên · {FEEDBACK_TAB_LABELS[feedbackTab] ?? feedbackTab}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm">{activeTabComment.comment}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {activeTabComment.teacherName ?? "Giáo viên"} · {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeTabComment.createdAt))}
                </p>
              </aside>
            )}

            {activeTab === "TEST" || activeScore ? (
              <div className="mx-auto max-w-6xl space-y-3">
                {activeTab === "TEST" && (testResult || vocabularyQuestionSets.sameWordType.length > 0) && (
                  <div className="flex justify-end">
                    <SettingsMenu align="right" />
                  </div>
                )}
                {activeScore && (
                  <section className="rounded-md border bg-card px-4 py-3" aria-label="Điểm cao nhất">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Điểm cao nhất</p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums">
                          {activeScore.score != null ? `${Math.round(activeScore.score)}%` : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Số câu đúng / tổng số</p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums">
                          {activeScore.correctCount != null && activeScore.totalCount != null
                            ? `${activeScore.correctCount}/${activeScore.totalCount}`
                            : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Kết quả</p>
                        <p className={cn("mt-0.5 text-sm font-semibold", activeScore.passed ? "text-success" : "text-destructive")}>
                          {activeScore.passed ? "Đạt" : "Chưa đạt"}
                        </p>
                      </div>
                      {answerReviewControl}
                    </div>
                  </section>
                )}
                {showAnswerReviewControls && !activeScore && (
                  <section className="rounded-md border bg-card px-4 py-3">{answerReviewControl}</section>
                )}
                {showAnswerReview && showAnswerReviewControls && <AnswerReviewDetails groups={activeReviewGroups} />}
                <div>{renderTabContent()}</div>
              </div>
            ) : (
              <div className="max-w-6xl mx-auto space-y-3">
                {showAnswerReviewControls && (
                  <section className="rounded-md border bg-card px-4 py-3">{answerReviewControl}</section>
                )}
                {showAnswerReview && showAnswerReviewControls && <AnswerReviewDetails groups={activeReviewGroups} />}
                {renderTabContent()}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
