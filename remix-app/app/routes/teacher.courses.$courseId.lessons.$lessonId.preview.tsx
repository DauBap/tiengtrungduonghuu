import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { ArrowLeft, BookOpen, Eye, Repeat2, Volume2 } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { LessonTabs, type LessonTab } from "~/components/lessons/lesson-tabs";
import { BlockRenderer, isBlockLearnable, type ResolvedBlock } from "~/components/lessons/blocks/block-renderer";
import { VocabularyTable } from "~/components/lessons/vocabulary-table";
import { GrammarSection } from "~/components/lessons/grammar-section";
import { WorkbookListeningTest } from "~/components/lessons/workbook-listening-test";
import { VocabularyTest } from "~/components/lessons/vocabulary-test";
import { PhoneticsPractice } from "~/components/lessons/phonetics-practice";
import { LessonTabEmpty } from "~/components/lessons/lesson-tab-empty";
import { getPhoneticsConfig, isTeacherOfCourse } from "~/lib/db.server";
import { isLearningBlockType, parseWorkbookConfig, type LearningBlockType, type PhoneticsConfig, type WorkbookConfig } from "~/lib/learning-blocks";
import { createVocabularyTest } from "~/lib/vocabulary-test";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { speakChinese } from "~/lib/speech";

function makePreviewWorkbookConfig(config: unknown): WorkbookConfig | null {
  const parsed = parseWorkbookConfig(config);
  if (!parsed.ok) return null;

  return {
    ...parsed.data,
    showResultsImmediately: false,
    sections: parsed.data.sections.map((section) => ({
      ...section,
      example: section.example ? { ...section.example, correctAnswer: "" } : undefined,
      questions: section.questions.map((question) => ({
        ...question,
        correctAnswer: "",
        acceptedAnswers: [],
      })),
    })),
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const { courseId, lessonId } = params;
  if (!courseId || !lessonId) throw new Response("Không tìm thấy khóa học hoặc bài học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, courseId))) {
    throw new Response("Không có quyền truy cập", { status: 403 });
  }

  const [lesson, courseWords] = await Promise.all([
    prisma.lesson.findFirst({
      where: { id: lessonId, courseId },
      select: {
        id: true,
        courseId: true,
        title: true,
        subtitle: true,
        order: true,
        course: { select: { id: true, title: true, hskLevel: true } },
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
            audioUrl: true,
            note: true,
          },
        },
        sentences: {
          orderBy: { order: "asc" },
          select: { id: true, chinese: true, pinyin: true, translation: true, audioUrl: true },
        },
        audioScripts: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            audioUrl: true,
            showScript: true,
            speakers: {
              orderBy: { order: "asc" },
              select: { id: true, speakerName: true, chinese: true, pinyin: true, translation: true },
            },
          },
        },
        grammarSections: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            explanation: true,
            formula: true,
            examples: true,
            note: true,
            questions: {
              orderBy: { order: "asc" },
              select: { id: true, type: true, prompt: true, options: true },
            },
          },
        },
        learningBlocks: {
          orderBy: { order: "asc" },
          select: { id: true, type: true, title: true, description: true, required: true, order: true, config: true },
        },
      },
    }),
    prisma.vocabItem.findMany({
      where: { lesson: { courseId } },
      select: {
        id: true,
        chinese: true,
        chineseAlternatives: true,
        pinyin: true,
        translation: true,
        translationAlternatives: true,
        wordTypes: true,
      },
    }),
  ]);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  const phonetics = await getPhoneticsConfig(lesson.id);

  const vocabById = new Map(lesson.content.map((item) => [item.id, item]));
  const sentenceById = new Map(lesson.sentences.map((item) => [item.id, item]));
  const learningBlocks = lesson.learningBlocks.filter(
    (block): block is (typeof lesson.learningBlocks)[number] & { type: ResolvedBlock["type"] } =>
      isLearningBlockType(block.type),
  );
  const blocks: ResolvedBlock[] = learningBlocks
    .map((block) => {
      const config = block.config as { vocabItemIds?: unknown; sentenceItemIds?: unknown };
      const vocabIds = Array.isArray(config?.vocabItemIds)
        ? config.vocabItemIds.filter((id): id is string => typeof id === "string")
        : [];
      const sentenceIds = Array.isArray(config?.sentenceItemIds)
        ? config.sentenceItemIds.filter((id): id is string => typeof id === "string")
        : [];
      return {
        id: block.id,
        type: block.type,
        title: block.title,
        description: block.description,
        required: block.required,
        order: block.order,
        config: block.type === "WORKBOOK" ? makePreviewWorkbookConfig(block.config) : block.config,
        vocabItems: vocabIds.flatMap((id) => {
          const item = vocabById.get(id);
          return item ? [{
            id: item.id,
            chinese: item.chinese,
            pinyin: item.pinyin,
            translation: item.translation,
            wordTypes: item.wordTypes,
            audioUrl: item.audioUrl,
            note: item.note,
          }] : [];
        }),
        sentenceItems: sentenceIds.flatMap((id) => {
          const item = sentenceById.get(id);
          return item ? [{
            id: item.id,
            chinese: item.chinese,
            pinyin: item.pinyin,
            translation: item.translation,
            audioUrl: item.audioUrl,
          }] : [];
        }),
      };
    })
    .map((block) => ({ ...block, required: block.required && isBlockLearnable(block) }));

  const safePhonetics: PhoneticsConfig | null = phonetics
    ? {
        ...phonetics,
        sections: phonetics.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => item.type === "tone"
            ? { ...item, answerTone: 1 as const, full: "" }
            : { ...item, answer: "", full: "" }),
        })),
      }
    : null;

  const availableTypes = new Set<LearningBlockType | "PHONETICS">(blocks.map((block) => block.type));
  if (lesson.content.length > 0) availableTypes.add("VOCABULARY");
  if (lesson.grammarSections.length > 0) availableTypes.add("GRAMMAR");
  if (safePhonetics) availableTypes.add("PHONETICS");

  return {
    user,
    lesson: {
      ...lesson,
      grammarSections: lesson.grammarSections.map((section) => ({
        ...section,
        questions: section.questions.map((question) => ({
          ...question,
          answer: "",
          acceptedAnswers: [],
          hint: null,
        })),
      })),
      audioScripts: lesson.audioScripts.map((script) => ({
        ...script,
        speakers: script.showScript ? script.speakers : [],
      })),
    },
    blocks,
    phonetics: safePhonetics,
    availableTypes: [...availableTypes],
    hasQuiz: lesson.content.length > 0,
    initialTab: availableTypes.has("FLASHCARD")
      ? "FLASHCARD" as const
      : availableTypes.has("LISTENING")
        ? "LISTENING" as const
        : availableTypes.has("VOCABULARY")
          ? "VOCABULARY" as const
          : "LESSON" as const,
    vocabularyQuestionSets: {
      sameWordType: createVocabularyTest(lesson.content, courseWords, true),
      random: createVocabularyTest(lesson.content, courseWords, false),
    },
  };
}

export default function TeacherLessonPreview() {
  const { user, lesson, blocks, phonetics, availableTypes: availableTypeList, hasQuiz, initialTab, vocabularyQuestionSets } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<LessonTab>(initialTab);
  const [selectedScriptId, setSelectedScriptId] = useState(lesson.audioScripts[0]?.id ?? "");
  const [showLessonPinyin, setShowLessonPinyin] = useState(true);
  const [autoReplay, setAutoReplay] = useState(false);
  const availableTypes = new Set<LearningBlockType | "PHONETICS">(availableTypeList);
  const activeBlock = blocks.find((block) => block.type === activeTab);
  const workbookBlock = blocks.find((block) => block.type === "WORKBOOK");
  const selectedScript = lesson.audioScripts.find((script) => script.id === selectedScriptId) ?? lesson.audioScripts[0];

  const renderActiveTab = () => {
    if (activeTab === "FLASHCARD" || activeTab === "LISTENING") {
      return activeBlock
        ? <BlockRenderer block={activeBlock} status="AVAILABLE" courseId={lesson.courseId} lessonId={lesson.id} previewOnly />
        : <LessonTabEmpty tab={activeTab} />;
    }

    if (activeTab === "VOCABULARY") {
      return <div className="mx-auto max-w-6xl"><VocabularyTable items={lesson.content} searchable /></div>;
    }

    if (activeTab === "GRAMMAR") {
      return lesson.grammarSections.length > 0
        ? <div className="mx-auto max-w-6xl space-y-4">
            {lesson.grammarSections.map((section, index) => (
              <GrammarSection
                key={section.id}
                section={section}
                number={index + 1}
                latestAttempts={{}}
                previewOnly
              />
            ))}
          </div>
        : <LessonTabEmpty tab="GRAMMAR" />;
    }

    if (activeTab === "WORKBOOK") {
      const config = workbookBlock ? makePreviewWorkbookConfig(workbookBlock.config) : null;
      return config && workbookBlock
        ? <WorkbookListeningTest config={config} blockTitle={workbookBlock.title} previewOnly onSubmitAttempt={() => undefined} />
        : <LessonTabEmpty tab="WORKBOOK" />;
    }

    if (activeTab === "TEST") {
      return <div className="mx-auto max-w-6xl">
        <VocabularyTest questionSets={vocabularyQuestionSets} timeLimitMinutes={null} previewOnly />
      </div>;
    }

    if (activeTab === "PHONETICS") {
      return phonetics
        ? <PhoneticsPractice
            config={phonetics}
            savedScores={{}}
            reviewGroups={[]}
            submissionResult={null}
            isSaving={false}
            submissionError={null}
            onSubmitSection={() => undefined}
            previewOnly
          />
        : <LessonTabEmpty tab="PHONETICS" />;
    }

    if (activeTab === "LESSON") {
      if (!selectedScript) return <LessonTabEmpty tab="LESSON" />;
      const speakers = selectedScript.speakers;
      return (
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <span className="text-lg font-bold">{selectedScript.title}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {lesson.audioScripts.map((script) => (
                    <button
                      key={script.id}
                      type="button"
                      onClick={() => setSelectedScriptId(script.id)}
                      aria-pressed={script.id === selectedScript.id}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${script.id === selectedScript.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary"}`}
                    >
                      {script.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.95fr)_minmax(420px,1.05fr)]">
                <section className="self-start rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-20">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-bold uppercase tracking-wide text-primary">File nghe</span>
                    {selectedScript.audioUrl && <span className="rounded-full bg-success/10 px-2 py-1 text-[11px] font-bold text-success">Audio</span>}
                  </div>
                  <div className="rounded-xl border bg-background p-4">
                    <div className="flex min-w-0 items-center gap-1">
                      {selectedScript.audioUrl ? (
                        <audio key={selectedScript.id} controls loop={autoReplay} className="min-w-0 flex-1" src={selectedScript.audioUrl} />
                      ) : (
                        <div className="flex min-h-20 w-full items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                          Chưa có file nghe cho bài khóa này.
                        </div>
                      )}
                      {selectedScript.audioUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={`h-9 w-9 shrink-0 rounded-full ${autoReplay ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:text-slate-900"}`}
                          aria-pressed={autoReplay}
                          aria-label={autoReplay ? "Tắt phát lại tự động" : "Bật phát lại tự động"}
                          onClick={() => setAutoReplay((enabled) => !enabled)}
                        >
                          <Repeat2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="mt-4 border-t pt-4">
                      <Button type="button" variant="outline" className="w-full" disabled={speakers.length === 0} onClick={() => speakChinese(speakers.map((speaker) => speaker.chinese).filter(Boolean).join("。"))}>
                        <Volume2 className="mr-2 h-4 w-4" />Đọc bằng giọng máy
                      </Button>
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        {selectedScript.audioUrl ? "Dùng khi file nghe không phát được." : "Nghe nội dung bài khóa bằng giọng máy."}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border bg-background p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold uppercase tracking-wide text-primary">Script</span>
                    <div className="flex items-center gap-2">
                      {speakers.some((speaker) => speaker.pinyin.trim()) && (
                        <Button type="button" variant="outline" size="sm" aria-pressed={showLessonPinyin} onClick={() => setShowLessonPinyin((visible) => !visible)}>
                          {showLessonPinyin ? "Ẩn pinyin" : "Hiện pinyin"}
                        </Button>
                      )}
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
                        {selectedScript.showScript ? "Hiển thị" : "Đã ẩn"}
                      </span>
                    </div>
                  </div>
                  {selectedScript.showScript && speakers.length > 0 ? (
                    <div className="space-y-3">
                      {speakers.map((speaker, index) => (
                        <div key={speaker.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            <span className="text-sm font-bold">{speaker.speakerName || `Người ${index + 1}`}</span>
                          </div>
                          <div className="mt-2 space-y-2 text-base">
                            <p className="content-text hanzi-display !text-[26px] font-medium leading-relaxed">{speaker.chinese}</p>
                            {showLessonPinyin && speaker.pinyin.trim() && <p className="content-text pinyin-text !text-[24px] leading-relaxed text-muted-foreground">{speaker.pinyin}</p>}
                            {speaker.translation.trim() && <p className="content-text text-sm leading-relaxed text-muted-foreground">{speaker.translation}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {selectedScript.showScript ? "Bài khóa chưa có nội dung script." : "Script đang được ẩn với học viên."}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return <LessonTabEmpty tab={activeTab} />;
  };

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/teacher/courses/${lesson.course.id}/lessons/${lesson.id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Quay lại tiến độ
            </Link>
          </Button>
          <div className="ml-auto flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
            <Eye className="h-4 w-4" aria-hidden="true" />
            Chế độ xem trước
          </div>
        </div>

        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">{lesson.course.title} · Bài {lesson.order}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{lesson.title}</h1>
          {lesson.subtitle && <p className="text-muted-foreground">{lesson.subtitle}</p>}
        </header>

        <div role="note" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          Nội dung và cách trình bày giống các tab học viên. Các câu trả lời và thao tác lưu tiến độ đã bị khóa.
        </div>

        <LessonTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          availableTypes={availableTypes}
          hasQuiz={hasQuiz}
        />
        {renderActiveTab()}
      </div>
    </AppShell>
  );
}
