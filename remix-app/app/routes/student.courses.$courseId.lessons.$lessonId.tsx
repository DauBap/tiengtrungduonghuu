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
} from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { BlockRenderer, isBlockLearnable, type ResolvedBlock } from "~/components/lessons/blocks/block-renderer";
import { isLearningBlockType, parseWorkbookConfig } from "~/lib/learning-blocks";
import { LessonTabs, type LessonTab } from "~/components/lessons/lesson-tabs";
import { LessonTabEmpty } from "~/components/lessons/lesson-tab-empty";
import { VocabularyTable } from "~/components/lessons/vocabulary-table";
import { GrammarSection } from "~/components/lessons/grammar-section";
import { WorkbookListeningTest } from "~/components/lessons/workbook-listening-test";
import { VocabularyTest } from "~/components/lessons/vocabulary-test";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import { ArrowLeft, BookOpen, PartyPopper, XCircle, RefreshCw, CheckCircle2, Lightbulb, Volume2 } from "lucide-react";
import { prisma } from "~/lib/prisma.server";
import { createVocabularyTest, gradeVocabularyTest } from "~/lib/vocabulary-test";
import { cn } from "~/lib/utils";
import { speakChinese } from "~/lib/speech";

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

  const [progress, courseWords] = await Promise.all([
    getLessonProgress(user.id, lesson.id),
    prisma.vocabItem.findMany({
      where: { lesson: { courseId: lesson.courseId } },
      select: { id: true, chinese: true, pinyin: true, translation: true, wordTypes: true },
    }),
  ]);
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
        config: b.config,
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
  const blockProgressMap = await getBlockProgressMap(user.id, blocks.map((b) => b.id));
  const blockStatuses = computeBlockStatuses(blocks, blockProgressMap);

  const vocabularyQuestions = createVocabularyTest(lesson.content, courseWords);
  const passScore = lesson.test?.passScore ?? 50;
  const timeLimitMinutes = lesson.test ? lesson.test.timeLimitMinutes : 30;

  return { user, lesson, lessonStatus, blocks, blockStatuses, vocabularyQuestions, passScore, timeLimitMinutes };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "complete-learning");

  if (intent === "save-pronunciation-score") {
    const scriptId = String(form.get("lessonAudioScriptId") ?? "");
    const rawScore = Number(String(form.get("score") ?? "0"));
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
    const transcript = String(form.get("transcript") ?? "").trim();

    if (!scriptId) return { error: "Thiếu đoạn nghe để lưu điểm." };

    const script = await prisma.lessonAudioScript.findUnique({
      where: { id: scriptId },
      select: { id: true, lessonId: true },
    });
    if (!script || script.lessonId !== params.lessonId) {
      return { error: "Không tìm thấy đoạn nghe trong bài học này." };
    }

    await prisma.pronunciationAssessment.upsert({
      where: { userId_lessonAudioScriptId: { userId: user.id, lessonAudioScriptId: script.id } },
      update: { score, transcript: transcript || null },
      create: { userId: user.id, lessonAudioScriptId: script.id, score, transcript: transcript || null },
    });
    return { success: true };
  }

  if (intent === "complete-block") {
    const blockId = String(form.get("blockId"));
    const block = await prisma.learningBlock.findFirst({
      where: { id: blockId, lessonId: params.lessonId! },
      select: { id: true },
    });
    if (!block) return { error: "Không tìm thấy phần học" };

    await markBlockCompleted(user.id, block.id);
    await syncLearningCompleted(user.id, params.lessonId!);
    return { success: true };
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
    if (testResult.passed) {
      await upsertLessonProgress(user.id, lessonId, { testCompleted: true });
    }
    return { testResult };
  }

  await upsertLessonProgress(user.id, params.lessonId!, { learningCompleted: true });
  return redirect(`/student/courses/${params.courseId}/lessons/${params.lessonId}/exercise`);
}

export default function LessonDetail() {
  const { user, lesson, blocks, blockStatuses, vocabularyQuestions, passScore, timeLimitMinutes, lessonStatus } = useLoaderData<typeof loader>();
  const testFetcher = useFetcher<{ testResult?: { percentage: number; earnedPoints: number; totalPoints: number; correctCount: number; blankCount: number; passed: boolean; passScore: number; questionCount: number; results: { id: string; prompt: string; typeLabel: string; points: number; correct: boolean; given: string; correctAnswer: string; hint: string | null }[] }; testError?: string }>();
  const [activeTab, setActiveTab] = useState<LessonTab>("VOCABULARY");
  const [showScript, setShowScript] = useState(true);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [phoneticScore, setPhoneticScore] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recognizedTranscript, setRecognizedTranscript] = useState("");
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [isPlayingReplay, setIsPlayingReplay] = useState(false);
  const [pronunciationFeedback, setPronunciationFeedback] = useState<React.ReactNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const manualStopRequestedRef = useRef(false);

  const normalizePronunciationText = (value: string) =>
    value
      .toLowerCase()
      .replace(/\p{P}/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const computePronunciationScore = (scriptText: string, spokenText: string) => {
    const scriptWords = normalizePronunciationText(scriptText)
      .split(" ")
      .filter(Boolean);
    const spokenWords = normalizePronunciationText(spokenText)
      .split(" ")
      .filter(Boolean);

    if (scriptWords.length === 0) return 0;
    if (spokenWords.length === 0) return 0;

    const scriptWordCounts = new Map<string, number>();
    for (const word of scriptWords) {
      scriptWordCounts.set(word, (scriptWordCounts.get(word) ?? 0) + 1);
    }

    let matched = 0;
    for (const word of spokenWords) {
      const remaining = scriptWordCounts.get(word) ?? 0;
      if (remaining > 0) {
        scriptWordCounts.set(word, remaining - 1);
        matched += 1;
      }
    }

    return Math.min(100, Math.max(0, Math.round((matched / scriptWords.length) * 100)));
  };

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
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
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
    const selected = lessonAudioScripts.find((script) => script.id === selectedScriptId) ?? lessonAudioScripts[0];
    if (selected) {
      setShowScript(selected.showScript ?? true);
    }
  }, [lessonAudioScripts, selectedScriptId]);

  // Khi nộp bài xong, tự giữ kết quả trong fetcher.data
  const testResult = testFetcher.data && "testResult" in testFetcher.data ? testFetcher.data.testResult : null;
  const testError = testFetcher.data && "testError" in testFetcher.data ? testFetcher.data.testError : null;
  const isSubmittingTest = testFetcher.state !== "idle";

  // Dạng bài có mặt trong bài này. Dùng để làm mờ tab của dạng bài chưa soạn —
  // block đã tạo nhưng chưa chọn nội dung vẫn tính là có, để học viên bấm vào
  // và thấy lời nhắn cụ thể thay vì tưởng dạng đó không tồn tại.
  const availableTypes = new Set(blocks.map((b) => b.type));
  // Từ vựng/Ngữ pháp hiện tab theo nội dung có sẵn, không qua LearningBlock —
  // khác với Flashcard/Nghe câu, admin cấu hình xong mới có block.
  if (lesson.content.length > 0) availableTypes.add("VOCABULARY");
  if (lesson.grammarSections.length > 0) availableTypes.add("GRAMMAR");

  const isEmptyLesson =
    lesson.content.length === 0 &&
    lesson.grammarSections.length === 0 &&
    !blocks.some(isBlockLearnable);

  const renderTabContent = () => {
    // Từ vựng đọc trực tiếp kho từ của bài, không qua block.
    if (activeTab === "VOCABULARY") {
      return <VocabularyTable items={lesson.content} />;
    }

    // Ngữ pháp cũng đọc trực tiếp từ bài, mỗi section một card.
    if (activeTab === "GRAMMAR") {
      if (lesson.grammarSections.length === 0) return <LessonTabEmpty tab="GRAMMAR" />;
      return (
        <div className="space-y-4 max-w-3xl mx-auto">
          {lesson.grammarSections.map((section, index) => (
            <GrammarSection key={section.id} section={section} number={index + 1} />
          ))}
        </div>
      );
    }

    // Sách bài tập — đọc từ block config thật
    if (activeTab === "WORKBOOK") {
      const workbookBlock = blocks.find((b) => b.type === "WORKBOOK");
      if (!workbookBlock) return <LessonTabEmpty tab="WORKBOOK" />;
      const parsed = parseWorkbookConfig(workbookBlock.config);
      if (!parsed.ok) return <LessonTabEmpty tab="WORKBOOK" />;
      return <WorkbookListeningTest config={parsed.data} />;
    }

    // Tab Kiểm tra — inline, dùng fetcher để không rời trang
    if (activeTab === "TEST") {
      // Kết quả sau khi nộp
      if (testResult) {
        return (
          <div className="space-y-4 max-w-3xl mx-auto">
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
                  ) : (
                    // Xóa kết quả cũ bằng cách reload loader (trộn lại câu ARRANGE)
                    <Button onClick={() => window.location.reload()}>
                      <RefreshCw className="h-4 w-4 mr-1.5" />Làm lại
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Chi tiết từng câu</CardTitle>
                <CardDescription>Đối chiếu đáp án đúng để lần sau làm tốt hơn.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {testResult.results.map((q, i) => (
                  <div key={q.id}
                    className={cn("rounded-lg border p-3 space-y-1.5",
                      q.correct ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
                    <div className="flex items-start gap-2">
                      {q.correct
                        ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                        : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                          <p className="font-medium">{q.prompt}</p>
                          <Badge variant="outline" className="bg-background/60 text-muted-foreground text-[10px]">
                            {q.typeLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {q.correct ? q.points : 0}/{q.points} điểm
                          </span>
                        </div>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Bạn trả lời: </span>
                          {q.given
                            ? <span className={q.correct ? "text-success" : "text-destructive"}>{q.given}</span>
                            : <span className="italic text-muted-foreground">bỏ trống</span>}
                        </p>
                        {!q.correct && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">Đáp án đúng: </span>
                            <span className="font-medium">{q.correctAnswer}</span>
                          </p>
                        )}
                        {q.hint && (
                          <p className="flex items-start gap-1.5 text-sm text-muted-foreground whitespace-pre-line">
                            <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />{q.hint}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        );
      }

      // Chưa có câu hỏi
      if (vocabularyQuestions.length === 0) return <LessonTabEmpty tab="TEST" />;

      // Form làm bài
      return (
        <div className="max-w-3xl mx-auto space-y-4">
          {lessonStatus.testStatus === "COMPLETED" && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
              <PartyPopper className="h-4 w-4 shrink-0" />
              <span className="font-medium">Bạn đã đạt bài kiểm tra này. Làm lại để ôn cũng được.</span>
            </div>
          )}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {vocabularyQuestions.length} từ · cần {passScore}% để đạt
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
                  questions={vocabularyQuestions}
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

        if (!navigator.mediaDevices?.getUserMedia) {
          setRecordingError("Trình duyệt của bạn chưa cho phép ghi âm giọng nói.");
          return;
        }

        manualStopRequestedRef.current = false;

        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;
          recordedAudioChunksRef.current = [];

          const mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined);
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              recordedAudioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(recordedAudioChunksRef.current, {
              type: mediaRecorder.mimeType || "audio/webm",
            });

            if (recordedAudioUrl) {
              URL.revokeObjectURL(recordedAudioUrl);
            }

            setRecordedAudioUrl(URL.createObjectURL(audioBlob));
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          };

          mediaRecorder.start();
        } catch {
          setRecordingError("Không thể truy cập micrôphone. Hãy cấp quyền ghi âm để luyện nói.");
          return;
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
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            transcript += event.results[i][0].transcript;
          }
          spokenText = transcript.trim();
          setRecognizedTranscript(spokenText);
        };

        recognition.onend = () => {
          if (!manualStopRequestedRef.current && isRecording) {
            try {
              recognition.start();
            } catch {
              // Ignore restart race conditions.
            }
            return;
          }

          const scriptText = selectedAudioScript.speakers.map((speaker) => speaker.chinese).join(" ");
          const finalTranscript = spokenText || recognizedTranscript;
          const score = computePronunciationScore(scriptText, finalTranscript);
          const finalScore = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
          setPhoneticScore(finalScore);
          setPronunciationFeedback(buildPronunciationFeedback(finalScore));
          setRecordingSeconds(0);
          setIsRecording(false);

          if (recordingTimerRef.current) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          recordingStartedAtRef.current = null;
          mediaRecorderRef.current?.stop();

          if (selectedAudioScript.id) {
            testFetcher.submit(
              {
                intent: "save-pronunciation-score",
                lessonAudioScriptId: selectedAudioScript.id,
                score: String(finalScore),
                transcript: finalTranscript || lesson.title,
              },
              { method: "post" }
            );
          }
        };

        recognition.onerror = (event: any) => {
          if (event?.error === "no-speech") {
            return;
          }
          setRecordingError("Không nhận dạng được giọng nói. Hãy thử lại sau vài giây.");
          setIsRecording(false);
        };

        setRecordingError(null);
        setRecognizedTranscript("");
        setPronunciationFeedback(null);
        setRecordingSeconds(0);
        setIsRecording(true);
        recordingStartedAtRef.current = Date.now();
        recognition.start();

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
        setIsRecording(false);
      };

      const replayLastRecording = () => {
        if (!recordedAudioUrl) {
          setRecordingError("Bạn chưa có bản ghi âm nào để nghe lại.");
          return;
        }

        if (replayAudioRef.current) {
          replayAudioRef.current.pause();
          replayAudioRef.current.currentTime = 0;
          replayAudioRef.current = null;
          setIsPlayingReplay(false);
          return;
        }

        const audio = new Audio(recordedAudioUrl);
        replayAudioRef.current = audio;
        audio.onended = () => {
          setIsPlayingReplay(false);
          replayAudioRef.current = null;
        };
        audio.onerror = () => {
          setRecordingError("Không thể phát lại âm thanh của bạn ngay lúc này.");
          setIsPlayingReplay(false);
          replayAudioRef.current = null;
        };
        setIsPlayingReplay(true);
        audio.play().catch(() => {
          setRecordingError("Không thể phát lại âm thanh của bạn ngay lúc này.");
          setIsPlayingReplay(false);
          replayAudioRef.current = null;
        });
      };

      if (!selectedAudioScript) {
        return <LessonTabEmpty tab="LESSON" />;
      }

      return (
        <div className="max-w-5xl mx-auto rounded-xl border bg-card shadow-sm">
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
                        <div className="mt-2 text-sm">
                          <p className="font-medium text-foreground">{speaker.chinese}</p>
                          <p className="text-xs font-mono text-muted-foreground mt-1">{speaker.pinyin}</p>
                          <p className="text-xs text-muted-foreground mt-1">{speaker.translation}</p>
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
                    variant="outline"
                    onClick={replayLastRecording}
                    disabled={!recordedAudioUrl}
                  >
                    {isPlayingReplay ? "Dừng lại" : "Nghe lại bài đọc của tôi"}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-bold uppercase text-muted-foreground">Điểm luyện nói</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary tabular-nums">{phoneticScore}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-bold uppercase text-muted-foreground">Đánh giá</div>
                  <div className="mt-2 font-medium">
                    {phoneticScore >= 90
                      ? "TỐT"
                      : phoneticScore >= 75
                        ? "KHÁ"
                        : phoneticScore >= 60
                          ? "CẦN CẢI THIỆN"
                          : "CHƯA ĐẠT"}
                  </div>
                </div>
              </div>

              {recordingError ? (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {recordingError}
                </div>
              ) : null}

              {pronunciationFeedback && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-foreground">
                  {pronunciationFeedback}
                </div>
              )}

              {recognizedTranscript && !isRecording && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="font-medium text-foreground">Bạn đã đọc:</div>
                  <p className="mt-1 text-muted-foreground">{recognizedTranscript}</p>
                </div>
              )}

              {isRecording && (
                <div className="mt-4 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
                  <span className="font-bold">Đang lắng nghe...</span>
                  <span className="ml-2 text-success/80">Đã nghe {recordingSeconds}s · đang so sánh với bài khóa.</span>
                </div>
              )}
            </section>
          </div>
        </div>
      );
    }

    const blockIndex = blocks.findIndex((b) => b.type === activeTab);
    // Bài chưa có block dạng này — khác với block đã có nhưng chưa chọn nội
    // dung, trường hợp đó BlockRenderer hiện "chưa có nội dung" của riêng nó.
    if (blockIndex === -1) return <LessonTabEmpty tab={activeTab} />;

    return <BlockRenderer block={blocks[blockIndex]} status={blockStatuses[blockIndex]} />;
  };

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
              onTabChange={setActiveTab}
              availableTypes={availableTypes}
              hasQuiz={lesson.content.length > 0}
            />


            <div className="max-w-6xl mx-auto px-4">
              {renderTabContent()}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

