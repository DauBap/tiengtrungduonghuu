import type { LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, Eye, PencilLine, Repeat2, Send, Volume2 } from "lucide-react";
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
import { formatAudioScript, getCorrectionTargetFields, type ContentCorrectionTargetType } from "~/lib/content-corrections";
import { listLessonCorrectionTargets } from "~/lib/content-corrections.server";
import { WORD_TYPE_META, isWordType } from "~/lib/word-types";
import { WordTypeMultiSelect } from "~/components/ui/word-type-multi-select";
import { AudioScriptCorrectionEditor } from "~/components/ui/audio-script-correction-editor";
import { GrammarQuestionsCorrectionEditor } from "~/components/ui/grammar-questions-correction-editor";

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

  const [lesson, courseWords, correctionTargets] = await Promise.all([
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
    prisma.$transaction((tx) => listLessonCorrectionTargets(tx, lessonId)),
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
    correctionTargets: correctionTargets ?? [],
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
  const { user, lesson, blocks, phonetics, availableTypes: availableTypeList, hasQuiz, initialTab, vocabularyQuestionSets, correctionTargets } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<LessonTab>(initialTab);
  const [isCorrectionFormOpen, setIsCorrectionFormOpen] = useState(false);
  const [selectedCorrectionKey, setSelectedCorrectionKey] = useState("");
  const [grammarCorrectionTab, setGrammarCorrectionTab] = useState<"content" | "practice">("content");
  const [reasonError, setReasonError] = useState("");
  const correctionDialogRef = useRef<HTMLDialogElement>(null);
  const [selectedScriptId, setSelectedScriptId] = useState(lesson.audioScripts[0]?.id ?? "");
  const [showLessonPinyin, setShowLessonPinyin] = useState(true);
  const [autoReplay, setAutoReplay] = useState(false);
  const availableTypes = new Set<LearningBlockType | "PHONETICS">(availableTypeList);
  const activeBlock = blocks.find((block) => block.type === activeTab);
  const workbookBlock = blocks.find((block) => block.type === "WORKBOOK");
  const selectedScript = lesson.audioScripts.find((script) => script.id === selectedScriptId) ?? lesson.audioScripts[0];
  const correctionFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const currentTabTargets = useMemo(() => {
    const allowedTypes: ContentCorrectionTargetType[] = (() => {
      switch (activeTab) {
        case "FLASHCARD":
          return ["VOCABULARY_ITEM", "SENTENCE_ITEM", "LEARNING_BLOCK"];
        case "LISTENING":
        case "WORKBOOK":
          return ["LEARNING_BLOCK"];
        case "VOCABULARY":
        case "TEST":
          return ["VOCABULARY_ITEM"];
        case "LESSON":
          return ["AUDIO_SCRIPT"];
        case "PHONETICS":
          return ["PHONETICS_QUESTION"];
        case "GRAMMAR":
          return ["GRAMMAR_SECTION"];
        case "TRANSLATION":
          return ["TRANSLATION_QUESTION"];
      }
    })();
    const matchingTargets = correctionTargets.filter((target) => allowedTypes.includes(target.type));
    if (activeTab === "FLASHCARD") {
      const blockItemIds = new Set([
        ...(activeBlock?.vocabItems.map((item) => item.id) ?? []),
        ...(activeBlock?.sentenceItems.map((item) => item.id) ?? []),
        ...(activeBlock ? [activeBlock.id] : []),
      ]);
      return matchingTargets.filter((target) => blockItemIds.has(target.id));
    }
    if (activeTab === "LISTENING" || activeTab === "WORKBOOK") {
      return matchingTargets.filter((target) => target.id === activeBlock?.id);
    }
    return matchingTargets;
  }, [activeBlock, activeTab, correctionTargets]);
  const selectedCorrection = useMemo(() => {
    const separator = selectedCorrectionKey.indexOf(":");
    if (separator < 0) return null;
    const type = selectedCorrectionKey.slice(0, separator);
    const id = selectedCorrectionKey.slice(separator + 1);
    return currentTabTargets.find((target) => target.type === type && target.id === id) ?? null;
  }, [currentTabTargets, selectedCorrectionKey]);

  useEffect(() => {
    if (!selectedCorrection && currentTabTargets.length > 0) {
      setSelectedCorrectionKey(`${currentTabTargets[0].type}:${currentTabTargets[0].id}`);
    } else if (selectedCorrectionKey && !selectedCorrection) {
      setSelectedCorrectionKey("");
    }
  }, [currentTabTargets, selectedCorrection, selectedCorrectionKey]);

  useEffect(() => {
    setGrammarCorrectionTab("content");
  }, [selectedCorrectionKey]);

  useEffect(() => {
    const dialog = correctionDialogRef.current;
    if (!dialog) return;
    if (isCorrectionFormOpen && !dialog.open) dialog.showModal();
    if (!isCorrectionFormOpen && dialog.open) dialog.close();
  }, [isCorrectionFormOpen]);

  useEffect(() => {
    if (!correctionFetcher.data) return;
    if (correctionFetcher.data.success) {
      toast.success("Đã gửi góp ý cho quản trị viên duyệt.");
      setIsCorrectionFormOpen(false);
    } else if (correctionFetcher.data.error) {
      toast.error(correctionFetcher.data.error);
    }
  }, [correctionFetcher.data]);

  function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCorrection) return;
    const formData = new FormData(event.currentTarget);
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 5) {
      setReasonError("Vui lòng nhập lý do góp ý (ít nhất 5 ký tự).");
      return;
    }
    if (reason.length > 2000) {
      setReasonError("Lý do góp ý không được vượt quá 2.000 ký tự.");
      return;
    }
    setReasonError("");
    const proposedData: Record<string, unknown> = {};
    for (const field of getCorrectionTargetFields(selectedCorrection.type)) {
      const currentValue = selectedCorrection.data[field];
      const value = String(formData.get(`field_${field}`) ?? "");
      if (field === "speakers" || field === "questions") {
        try {
          proposedData[field] = JSON.parse(value);
        } catch {
          toast.error(field === "speakers" ? "Nội dung bài khóa cần đúng định dạng." : "Câu hỏi luyện tập cần đúng định dạng.");
          return;
        }
      } else if (Array.isArray(currentValue)) {
        proposedData[field] = field === "wordTypes"
          ? formData.getAll(`field_${field}`).filter(isWordType)
          : value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      } else if (typeof currentValue === "boolean") {
        proposedData[field] = value === "true";
      } else if (field === "answerTone") {
        proposedData[field] = value.trim() === "" ? null : Number(value);
      } else if (typeof currentValue === "number") {
        proposedData[field] = value.trim() === "" ? Number.NaN : Number(value);
      } else if (typeof currentValue === "object" && currentValue !== null) {
        try {
          proposedData[field] = JSON.parse(value);
        } catch {
          toast.error(`Trường “${field}” cần là JSON hợp lệ.`);
          return;
        }
      } else if (currentValue === null && value.trim() === "") {
        proposedData[field] = null;
      } else {
        proposedData[field] = value;
      }
    }
    correctionFetcher.submit({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      targetType: selectedCorrection.type,
      targetId: selectedCorrection.id,
      reason,
      proposedData: JSON.stringify(proposedData),
    }, { method: "post", action: "/teacher/content-corrections" });
  }

  function correctionFieldLabel(field: string) {
    const labels: Record<string, string> = {
      chinese: "Tiếng Trung",
      chineseAlternatives: "Cách viết tiếng Trung khác (mỗi dòng một cách)",
      pinyin: "Pinyin",
      pinyinAlternatives: "Pinyin khác (mỗi dòng một cách)",
      translation: "Nghĩa tiếng Việt",
      translationAlternatives: "Nghĩa khác (mỗi dòng một nghĩa)",
      wordTypes: "Từ loại",
      speakers: "Toàn bộ script",
      questions: "Câu hỏi luyện tập",
      note: "Ghi chú",
      prompt: "Nội dung câu hỏi",
      options: "Các lựa chọn (mỗi dòng một lựa chọn)",
      answer: "Đáp án",
      acceptedAnswers: "Các đáp án được chấp nhận (mỗi dòng một đáp án)",
      hint: "Giải thích / gợi ý",
      title: "Tiêu đề",
      explanation: "Giải thích",
      formula: "Công thức",
      examples: "Ví dụ",
      given: "Nội dung cho trước",
      syllable: "Âm tiết",
      answerTone: "Thanh điệu đáp án (1–5)",
      full: "Đáp án đầy đủ",
      audioText: "Nội dung đọc",
      description: "Mô tả",
      sampleAnswer: "Đáp án mẫu",
      isCorrect: "Đây là đáp án đúng",
      imageUrl: "Đường dẫn hình ảnh",
      audioUrl: "Đường dẫn âm thanh",
      points: "Điểm câu hỏi",
      payload: "Dữ liệu câu hỏi (JSON)",
    };
    return labels[field] ?? field;
  }

  function correctionInputValue(value: unknown) {
    if (Array.isArray(value)) return value.join("\n");
    if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
    return value == null ? "" : String(value);
  }

  function correctionDisplayValue(field: string, value: unknown) {
    if (selectedCorrection?.type === "AUDIO_SCRIPT" && field === "speakers") return formatAudioScript(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return "—";
      return value.map((item) => isWordType(item) ? WORD_TYPE_META[item].label : String(item)).join(", ");
    }
    if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
    if (typeof value === "boolean") return value ? "Có" : "Không";
    return value == null || value === "" ? "—" : String(value);
  }

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
                lessonId={lesson.id}
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
            lessonId={lesson.id}
            assessmentDrafts={{}}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsCorrectionFormOpen((isOpen) => !isOpen)}
            disabled={currentTabTargets.length === 0}
          >
            <PencilLine className="mr-2 h-4 w-4" aria-hidden="true" />
            Góp ý tab này
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

        <dialog
          ref={correctionDialogRef}
          aria-labelledby="content-correction-heading"
          aria-describedby="content-correction-description"
          onCancel={(event) => {
            event.preventDefault();
            setIsCorrectionFormOpen(false);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsCorrectionFormOpen(false);
          }}
          className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-6xl overflow-y-auto rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 sm:w-[calc(100%-2rem)]"
        >
          <section className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="content-correction-heading" className="text-lg font-semibold">Góp ý chỉnh sửa nội dung bài học</h2>
                <p id="content-correction-description" className="text-sm text-muted-foreground">
                  Chọn nội dung trong tab đang mở, đề xuất phần sửa và gửi quản trị viên duyệt.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsCorrectionFormOpen(false)}>
                Đóng
              </Button>
            </div>

            {currentTabTargets.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Tab này chưa có nội dung hỗ trợ góp ý.
              </p>
            ) : (
              <form key={selectedCorrectionKey} noValidate onSubmit={submitCorrection} className="space-y-4">
                <label className="block space-y-1.5 text-sm font-medium">
                  Nội dung cần chỉnh sửa
                  <select
                    value={selectedCorrectionKey}
                    onChange={(event) => setSelectedCorrectionKey(event.currentTarget.value)}
                    required
                    className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {currentTabTargets.map((target) => (
                      <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedCorrection && (
                  <>
                  {selectedCorrection.type === "GRAMMAR_SECTION" && (
                    <div role="tablist" aria-label="Nội dung góp ý ngữ pháp" className="flex gap-2 border-b">
                      <button
                        type="button"
                        role="tab"
                        id="grammar-correction-content-tab"
                        aria-selected={grammarCorrectionTab === "content"}
                        aria-controls="grammar-correction-content-panel"
                        onClick={() => setGrammarCorrectionTab("content")}
                        className={`border-b-2 px-3 py-2 text-sm font-medium ${grammarCorrectionTab === "content" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        Nội dung ngữ pháp
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="grammar-correction-practice-tab"
                        aria-selected={grammarCorrectionTab === "practice"}
                        aria-controls="grammar-correction-practice-panel"
                        onClick={() => setGrammarCorrectionTab("practice")}
                        className={`border-b-2 px-3 py-2 text-sm font-medium ${grammarCorrectionTab === "practice" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        Bài luyện tập ({Array.isArray(selectedCorrection.data.questions) ? selectedCorrection.data.questions.length : 0})
                      </button>
                    </div>
                  )}
                  <div
                    id="grammar-correction-content-panel"
                    role={selectedCorrection.type === "GRAMMAR_SECTION" ? "tabpanel" : undefined}
                    aria-labelledby={selectedCorrection.type === "GRAMMAR_SECTION" ? "grammar-correction-content-tab" : undefined}
                    hidden={selectedCorrection.type === "GRAMMAR_SECTION" && grammarCorrectionTab !== "content"}
                    className="rounded-md border"
                  >
                    <table className="w-full table-fixed text-left text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th scope="col" className="w-[24%] px-3 py-2.5 font-semibold">Trường dữ liệu</th>
                          <th scope="col" className="w-[34%] px-3 py-2.5 font-semibold">Hiện tại</th>
                          <th scope="col" className="w-[42%] px-3 py-2.5 font-semibold">Góp ý</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                    {getCorrectionTargetFields(selectedCorrection.type)
                      .filter((field) => selectedCorrection.type !== "GRAMMAR_SECTION" || field !== "questions")
                      .map((field) => {
                      const value = selectedCorrection.data[field];
                      return (
                        <tr key={field} className="align-top">
                          <th scope="row" className="px-3 py-3 font-medium">{correctionFieldLabel(field)}</th>
                          <td className="px-3 py-3">
                            <div className="min-h-10 whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm font-normal text-muted-foreground">
                              {correctionDisplayValue(field, value)}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                          {field === "speakers" ? (
                            <AudioScriptCorrectionEditor name={`field_${field}`} value={value} />
                          ) : field === "questions" && selectedCorrection.type === "GRAMMAR_SECTION" ? (
                            <GrammarQuestionsCorrectionEditor name={`field_${field}`} value={value} />
                          ) : field === "wordTypes" ? (
                            <WordTypeMultiSelect name={`field_${field}`} value={value} />
                          ) : typeof value === "boolean" ? (
                            <select
                              name={`field_${field}`}
                              defaultValue={String(value)}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <option value="true">Có</option>
                              <option value="false">Không</option>
                            </select>
                          ) : Array.isArray(value) || (typeof value === "object" && value !== null) ? (
                            <textarea
                              name={`field_${field}`}
                              defaultValue={correctionInputValue(value)}
                              rows={Array.isArray(value) ? Math.min(5, Math.max(2, value.length + 1)) : 5}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          ) : (
                            <input
                              name={`field_${field}`}
                              type={typeof value === "number" || field === "answerTone" ? "number" : "text"}
                              min={field === "answerTone" ? 1 : undefined}
                              max={field === "answerTone" ? 5 : undefined}
                              step={field === "points" ? "0.1" : undefined}
                              defaultValue={correctionInputValue(value)}
                              className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          )}
                          </td>
                        </tr>
                      );
                    })}
                      </tbody>
                    </table>
                  </div>
                  {selectedCorrection.type === "GRAMMAR_SECTION" && (
                    <section
                      id="grammar-correction-practice-panel"
                      role="tabpanel"
                      aria-labelledby="grammar-correction-practice-tab"
                      hidden={grammarCorrectionTab !== "practice"}
                      className="rounded-md border p-3"
                    >
                      <GrammarQuestionsCorrectionEditor name="field_questions" value={selectedCorrection.data.questions} />
                    </section>
                  )}
                  </>
                )}

                <label className="block space-y-1.5 text-sm font-medium">
                  Lý do góp ý
                  <textarea
                    name="reason"
                    maxLength={2000}
                    rows={3}
                    placeholder="Cho biết nội dung nào chưa chính xác và bạn đề xuất sửa ra sao."
                    aria-invalid={Boolean(reasonError)}
                    aria-describedby={reasonError ? "content-correction-reason-error" : "content-correction-reason-help"}
                    onChange={() => setReasonError("")}
                    className={`w-full rounded-md border bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${reasonError ? "border-destructive" : "border-input"}`}
                  />
                  {reasonError ? (
                    <span id="content-correction-reason-error" role="alert" className="block text-sm font-normal text-destructive">
                      {reasonError}
                    </span>
                  ) : (
                    <span id="content-correction-reason-help" className="block text-xs font-normal text-muted-foreground">
                      Tối thiểu 5 ký tự.
                    </span>
                  )}
                </label>
                {correctionFetcher.data?.error && (
                  <p role="alert" className="text-sm text-destructive">{correctionFetcher.data.error}</p>
                )}
                <div className="flex justify-end">
                  <Button type="submit" disabled={!selectedCorrection || correctionFetcher.state !== "idle"} className="gap-2">
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {correctionFetcher.state !== "idle" ? "Đang gửi..." : "Gửi quản trị viên duyệt"}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </dialog>

        <LessonTabs
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setIsCorrectionFormOpen(false);
          }}
          availableTypes={availableTypes}
          hasQuiz={hasQuiz}
        />
        {renderActiveTab()}
      </div>
    </AppShell>
  );
}
