import { useState, useEffect, useMemo, useRef } from "react";
import { Play, Pause, Volume2, Check, X, Clock } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { AudioSeekBar } from "~/components/audio/audio-seek-bar";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { isHorizontalWorkbookChoice, type WorkbookConfig } from "~/lib/learning-blocks";
import { useAppSettings } from "~/lib/app-settings";
import { answerVariants, isAnswerCorrectForAny } from "~/lib/listening-answer";

interface QuestionOption {
  id: string;
  label: "A" | "B" | "C" | "D" | "E" | "F";
  text?: string;
  pinyin?: string;
}

interface Question {
  id: string;
  number: number;
  kind: "choice" | "input";
  gradable: boolean;
  teacherReview?: boolean;
  prompt: string;
  pinyin: string;
  translation: string;
  passage: string;
  imageUrl?: string;
  images?: { label: "A" | "B" | "C" | "D" | "E" | "F"; url: string }[];
  dialogue?: { chinese: string; pinyin: string; translation: string };
  options: QuestionOption[];
  correctAnswer: string;
  acceptedAnswers: string[];
  selectedAnswer?: string;
}

interface Section {
  id: string;
  title: string;
  titleChinese: string;
  description: string;
  descriptionVietnamese: string;
  imageUrl?: string;
  example?: {
    chinese: string;
    pinyin: string;
    translation: string;
    options: QuestionOption[];
    correctAnswer: string;
  };
  questions: Question[];
}

export function WorkbookListeningTest({
  config,
  blockTitle,
  onSubmitAttempt,
  isSaving = false,
  answerReviewEnabled = false,
  savedResult = null,
  submissionError = null,
}: {
  config: WorkbookConfig;
  blockTitle: string;
  onSubmitAttempt: (answers: Record<string, string>) => void;
  isSaving?: boolean;
  answerReviewEnabled?: boolean;
  savedResult?: {
    score: number | null;
    correctCount: number;
    totalCount: number;
    pendingReviewCount: number;
    answerReview: { id: string; correct: boolean | null; correctAnswer: string }[];
    answers: { id: string; given: string }[];
  } | null;
  submissionError?: string | null;
}) {
  const appSettings = useAppSettings();
  const showPinyin = config.showPinyin && appSettings.showPinyin;
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.8 | 1 | 1.5>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries((savedResult?.answers ?? []).map((answer) => [answer.id, answer.given]))
  );
  const [audioPlayCount, setAudioPlayCount] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(config.timeLimit ? config.timeLimit * 60 : 0);
  const [isSubmitted, setIsSubmitted] = useState(savedResult != null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const submitAttemptRef = useRef<() => void>(() => undefined);

  const submitAttempt = () => {
    if (isSubmitted) return;
    setIsSubmitted(true);
    onSubmitAttempt(answers);
  };
  submitAttemptRef.current = submitAttempt;

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Timer countdown
  useEffect(() => {
    if (!config.timeLimit || timeRemaining <= 0 || isSubmitted) return;
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [config.timeLimit, timeRemaining, isSubmitted]);

  useEffect(() => {
    if (config.timeLimit > 0 && timeRemaining === 0 && !isSubmitted) {
      submitAttemptRef.current();
    }
  }, [config.timeLimit, timeRemaining, isSubmitted]);

  useEffect(() => {
    if (submissionError && !isSaving) setIsSubmitted(false);
  }, [submissionError, isSaving]);

  const formatTime = (seconds: number) => {
    const wholeSeconds = Math.floor(seconds);
    const mins = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Shuffle questions if enabled
  const sections = useMemo(() => {
    const rawSections = config.sections as Section[];
    if (!config.shuffleQuestions) return rawSections;
    return rawSections.map((section) => ({
      ...section,
      questions: [...section.questions].sort(() => Math.random() - 0.5),
    }));
  }, [config.sections, config.shuffleQuestions]);

  if (sections.length === 0) {
    return (
      <div className="max-w-6xl mx-auto rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">Chưa có nội dung bài tập.</p>
      </div>
    );
  }

  const questions = sections.flatMap((section) => section.questions);
  const gradableQuestions = questions.filter((question) => question.gradable);
  const reviewResults = new Map((savedResult?.answerReview ?? []).map((result) => [result.id, result]));
  const correctCount = gradableQuestions.filter((question) => {
    const answer = answers[question.id]?.trim();
    return answer && (question.kind === "input"
      ? isAnswerCorrectForAny(answer, answerVariants(question.correctAnswer, question.acceptedAnswers), "chinese")
      : answer === question.correctAnswer);
  }).length;

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      {/* Audio Player Header - Sticky */}
      <Card className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="p-4 space-y-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Sách bài tập</h2>
            <div className="flex items-center gap-2">
              {config.timeLimit > 0 && (
                <Badge variant={timeRemaining < 60 ? "destructive" : "outline"} className="text-sm">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatTime(timeRemaining)}
                </Badge>
              )}
              {config.audioUrl && <Badge variant="outline" className="text-primary border-primary"><Volume2 className="h-3 w-3 mr-1" />Có audio</Badge>}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
            {config.audioUrl && <audio
              ref={audioRef}
              src={config.audioUrl}
              preload="metadata"
              className="hidden"
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={(event) => {
                event.currentTarget.currentTime = 0;
                setCurrentTime(0);
                setIsPlaying(false);
              }}
            />}
            {config.audioUrl && <Button
              size="lg"
              variant={isPlaying ? "outline" : "default"}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (audio.paused) {
                  if (config.maxReplays > 0 && audio.currentTime === 0 && audioPlayCount >= config.maxReplays) return;
                  if (audio.currentTime === 0) setAudioPlayCount((prev) => prev + 1);
                  void audio.play().catch(() => setIsPlaying(false));
                } else {
                  audio.pause();
                }
              }}
              disabled={config.maxReplays > 0 && audioPlayCount >= config.maxReplays && !isPlaying && currentTime === 0}
              className="shrink-0 sm:flex-none"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-5 w-5 mr-2" />
                  Tạm dừng
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Nghe {config.maxReplays > 0 && `(${audioPlayCount}/${config.maxReplays})`}
                </>
              )}
            </Button>}

            {/* Speed Controls */}
            <div className="flex gap-1.5 sm:gap-2">
              {[0.8, 1, 1.5].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={speed === s ? "default" : "outline"}
                  onClick={() => {
                    const nextSpeed = s as 0.8 | 1 | 1.5;
                    setSpeed(nextSpeed);
                    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
                  }}
                  disabled={!config.audioUrl}
                  className="min-w-[48px] px-2 sm:min-w-[60px] sm:px-3"
                >
                  {s}×
                </Button>
              ))}
            </div>

          </div>

          {config.audioUrl && (
            <AudioSeekBar
              currentTime={currentTime}
              duration={duration}
              disabled={!duration}
              onSeek={(time) => {
                if (audioRef.current) audioRef.current.currentTime = time;
              }}
            />
          )}
        </div>
      </Card>

      {/* Test Content */}
      {sections.map((section) => (
        <Card key={section.id} className="p-6">
          <div className="space-y-6">
            {/* Section Header */}
            <div className="space-y-2">
              <h3 className="text-xl font-bold">
                {section.titleChinese ? `${section.titleChinese} - ` : ""}{section.title}
              </h3>
              {section.description && <p className="text-muted-foreground">{section.description}</p>}
              {section.descriptionVietnamese && <p className="text-sm text-muted-foreground italic">{section.descriptionVietnamese}</p>}
            </div>

            {section.imageUrl && (
              <div className="overflow-hidden rounded-lg border">
                <img src={section.imageUrl} alt={section.title} className="w-full" />
              </div>
            )}

            {/* Example (if exists) */}
            {section.example && (
              section.example.options.length > 0
              || section.example.chinese
              || section.example.pinyin
              || section.example.translation
            ) && (
              <Card className="bg-accent/5 border-accent/20">
                <div className="p-4 space-y-3">
                  <div className="font-medium text-accent">Ví dụ</div>
                  {(section.example.chinese || (showPinyin && section.example.pinyin) || (config.showTranslation && section.example.translation)) && (
                    <div className="space-y-1">
                      {section.example.chinese && <p className="content-text hanzi-display font-medium">{section.example.chinese}</p>}
                      {showPinyin && section.example.pinyin && <p className="content-text pinyin-text text-sm text-muted-foreground">{section.example.pinyin}</p>}
                      {config.showTranslation && section.example.translation && <p className="content-text text-sm italic">{section.example.translation}</p>}
                    </div>
                  )}
                  <div className="space-y-2">
                    {section.example.options.map((option) => (
                      <div
                        key={option.id}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border-2 p-3 transition-colors",
                          option.id === section.example?.correctAnswer
                            ? "border-success bg-success/10 text-success-foreground"
                            : "border-border bg-background"
                        )}
                      >
                        <div                         className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-current font-medium">
                          {option.label}
                        </div>
                        {(option.text || (showPinyin && option.pinyin)) && (
                          <span className="min-w-0 flex-1">
                            {option.text && <span className="content-text hanzi-display block">{option.text}</span>}
                            {showPinyin && option.pinyin && <span className="content-text pinyin-text block text-xs text-muted-foreground">{option.pinyin}</span>}
                          </span>
                        )}
                        {option.id === section.example?.correctAnswer && (
                          <Check className="ml-auto h-5 w-5" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {/* Questions */}
            {section.questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                selectedAnswer={answers[question.id]}
                onAnswer={(optId) => setAnswers((prev) => ({ ...prev, [question.id]: optId }))}
                horizontalChoices={
                  question.kind === "choice"
                  && isHorizontalWorkbookChoice(blockTitle, question.number)
                }
                showTranslation={config.showTranslation}
                showPinyin={showPinyin}
                isSubmitted={isSubmitted}
                answerReviewEnabled={answerReviewEnabled}
                reviewResult={reviewResults.get(question.id)}
              />
            ))}
          </div>
        </Card>
      ))}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        {isSubmitted ? (
          <div>
            <p className="text-sm font-medium">
              {savedResult && !isSaving
                ? savedResult.pendingReviewCount > 0
                  ? `Đã nộp bài · ${savedResult.pendingReviewCount} câu đang chờ giáo viên chấm`
                  : `Đã lưu kết quả: ${savedResult.correctCount}/${savedResult.totalCount} câu · ${savedResult.score}%`
                : isSaving
                  ? "Đang lưu kết quả bài làm..."
                  : `Kết quả: ${correctCount}/${gradableQuestions.length} câu có đáp án`}
            </p>
            {savedResult && !isSaving && (
              <p className="mt-1 text-xs text-muted-foreground">
                {savedResult.pendingReviewCount > 0
                  ? "Kết quả cuối cùng sẽ được cập nhật sau khi giáo viên chấm."
                  : answerReviewEnabled
                  ? "Đáp án chi tiết đã mở ở phần kết quả phía trên."
                  : "Đáp án chi tiết sẽ hiện khi giáo viên mở xem kết quả."}
              </p>
            )}
            {isSaving && <p className="mt-1 text-xs text-muted-foreground">Đang lưu kết quả...</p>}
            {submissionError && <p role="alert" className="mt-1 text-xs text-destructive">{submissionError}</p>}
            {questions.length > gradableQuestions.length && (
              <p className="text-xs text-muted-foreground">{questions.length - gradableQuestions.length} câu chưa có answer key, không tính điểm</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Đã trả lời {Object.values(answers).filter(Boolean).length}/{questions.length} câu</p>
        )}
        {!isSubmitted
          ? <Button type="button" onClick={submitAttempt} disabled={isSaving}>Nộp bài</Button>
          : savedResult && savedResult.pendingReviewCount === 0 && !isSaving
            ? <Button type="button" variant="outline" onClick={() => {
                setAnswers({});
                setIsSubmitted(false);
              }}>Làm lại</Button>
            : null}
      </Card>
    </div>
  );
}

function QuestionCard({
  question,
  selectedAnswer,
  onAnswer,
  horizontalChoices,
  showTranslation = true,
  showPinyin = true,
  isSubmitted = false,
  answerReviewEnabled = false,
  reviewResult,
}: {
  question: Question;
  selectedAnswer?: string;
  onAnswer: (optId: string) => void;
  horizontalChoices: boolean;
  showTranslation?: boolean;
  showPinyin?: boolean;
  isSubmitted?: boolean;
  answerReviewEnabled?: boolean;
  reviewResult?: { correct: boolean | null; correctAnswer: string } | undefined;
}) {
  const isAnswered = !!selectedAnswer;
  const isCorrect = reviewResult?.correct === true;
  const showResults = isSubmitted && answerReviewEnabled && reviewResult != null;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Câu {question.number}</Badge>
        {showResults && (
          <Badge variant={isCorrect ? "default" : "destructive"} className="ml-auto">
            {isCorrect ? (
              <><Check className="h-3 w-3 mr-1" />Đúng</>
            ) : (
              <><X className="h-3 w-3 mr-1" />Sai</>
            )}
          </Badge>
        )}
        {isSubmitted && !question.gradable && (
          <Badge variant="outline" className="ml-auto">Chưa có answer key</Badge>
        )}
        {isSubmitted && question.teacherReview && (
          <Badge variant="outline" className="ml-auto">Chờ giáo viên chấm</Badge>
        )}
      </div>

      {question.passage && <p className="content-text whitespace-pre-line font-medium leading-relaxed">{question.passage}</p>}
      {question.prompt && <p className="content-text hanzi-display whitespace-pre-line font-medium leading-relaxed">{question.prompt}</p>}
      {showPinyin && question.pinyin && <p className="content-text pinyin-text whitespace-pre-line text-sm text-muted-foreground">{question.pinyin}</p>}
      {showTranslation && question.translation && <p className="content-text whitespace-pre-line text-sm italic text-muted-foreground">{question.translation}</p>}

      {/* Single Image Question */}
      {question.imageUrl && (
        <div className="rounded-lg overflow-hidden border">
          <img src={question.imageUrl} alt={`Câu ${question.number}`} className="w-full" />
        </div>
      )}

      {/* Multiple Images Grid */}
      {question.images && question.images.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {question.images.map((img) => (
              <div key={img.label} className="space-y-2">
                <div className="relative rounded-lg overflow-hidden border aspect-[4/3]">
                  <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                </div>
                <div className="text-center font-medium text-sm">{img.label}</div>
              </div>
            ))}
          </div>
          {question.dialogue && (
            <Card className="bg-muted/50 p-4 space-y-2">
              <div className="font-medium text-sm text-muted-foreground">Hội thoại:</div>
              {question.dialogue.chinese && <p className="content-text hanzi-display font-medium">{question.dialogue.chinese}</p>}
              {showPinyin && question.dialogue.pinyin && <p className="content-text pinyin-text text-sm text-muted-foreground">{question.dialogue.pinyin}</p>}
              {showTranslation && question.dialogue.translation && <p className="content-text text-sm italic">{question.dialogue.translation}</p>}
            </Card>
          )}
        </div>
      )}

      {/* Options */}
      {question.kind === "input" ? (
        <div className="space-y-2">
          <Input
            value={selectedAnswer ?? ""}
            onChange={(event) => onAnswer(event.target.value)}
            placeholder="Nhập đáp án"
            disabled={isSubmitted}
            aria-label={`Đáp án câu ${question.number}`}
          />
          {showResults && reviewResult?.correctAnswer && (
            <p className="text-sm text-success-foreground"><span className="text-muted-foreground">Đáp án đúng: </span>{reviewResult.correctAnswer}</p>
          )}
        </div>
      ) : <div
        className={cn(horizontalChoices ? "grid gap-1.5" : "space-y-2")}
        style={horizontalChoices
          ? { gridTemplateColumns: `repeat(${question.options.length}, minmax(0, 1fr))` }
          : undefined}
      >
        {question.options.map((option) => {
          const isSelected = selectedAnswer === option.id;
          const isCorrectOption = reviewResult?.correctAnswer.startsWith(`${option.label} ·`) === true
            || reviewResult?.correctAnswer === option.label;
          const showAsCorrect = showResults && isCorrectOption;
          const showAsIncorrect = showResults && isSelected && !isCorrect;

          return (
            <button
              key={option.id}
              onClick={() => !showResults && !isSubmitted && onAnswer(option.id)}
              className={cn(
                "w-full min-w-0 flex items-center rounded-lg border-2 text-left transition-colors",
                horizontalChoices ? "gap-1 p-1.5" : "gap-3 p-3",
                showAsCorrect && "border-success bg-success/10 text-success-foreground",
                showAsIncorrect && "border-destructive bg-destructive/10 text-destructive-foreground",
                !showResults && !isSelected && "border-border bg-background hover:border-primary hover:bg-primary/5",
                !showResults && isSelected && "border-primary bg-primary/5"
              )}
              disabled={showResults || isSubmitted}
            >
              <div className={cn(
                "option-label flex shrink-0 items-center justify-center rounded-full border-2 font-medium transition-colors",
                horizontalChoices ? "h-5 w-5 text-xs" : "h-8 w-8 text-sm",
                showAsCorrect && "border-success bg-success text-success-foreground",
                showAsIncorrect && "border-destructive bg-destructive text-destructive-foreground",
                !showAsCorrect && !showAsIncorrect && "border-current"
              )}>
                {option.label}
              </div>
              {(option.text || (showPinyin && option.pinyin)) && (
                <span className={cn("min-w-0 flex-1", horizontalChoices && "break-words text-xs")}>
                  {option.text && <span className="content-text hanzi-display block">{option.text}</span>}
                  {showPinyin && option.pinyin && <span className={cn("option-pinyin content-text pinyin-text block text-xs text-muted-foreground", horizontalChoices && "text-[10px]")}>{option.pinyin}</span>}
                </span>
              )}
              {showAsCorrect && (
                <Check className={cn("ml-auto shrink-0", horizontalChoices ? "h-3.5 w-3.5" : "h-5 w-5")} />
              )}
              {showAsIncorrect && (
                <X className={cn("ml-auto shrink-0", horizontalChoices ? "h-3.5 w-3.5" : "h-5 w-5")} />
              )}
            </button>
          );
        })}
      </div>}
      {showResults && question.kind === "choice" && reviewResult?.correctAnswer && (
        <p className="text-sm text-success-foreground"><span className="text-muted-foreground">Đáp án đúng: </span>{reviewResult.correctAnswer}</p>
      )}
    </Card>
  );
}
