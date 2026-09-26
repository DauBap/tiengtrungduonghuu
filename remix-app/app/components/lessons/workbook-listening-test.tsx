import { useState, useEffect, useMemo, useRef } from "react";
import { Play, Pause, Volume2, Check, X, Clock } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { WorkbookConfig } from "~/lib/learning-blocks";

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
  prompt: string;
  pinyin: string;
  translation: string;
  passage: string;
  imageUrl?: string;
  images?: { label: "A" | "B" | "C" | "D" | "E" | "F"; url: string }[];
  dialogue?: { chinese: string; pinyin: string; translation: string };
  options: QuestionOption[];
  correctAnswer: string;
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

export function WorkbookListeningTest({ config }: { config: WorkbookConfig }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.8 | 1 | 1.5>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [audioPlayCount, setAudioPlayCount] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(config.timeLimit ? config.timeLimit * 60 : 0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Timer countdown
  useEffect(() => {
    if (!config.timeLimit || timeRemaining <= 0 || isSubmitted) return;
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setIsSubmitted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [config.timeLimit, timeRemaining, isSubmitted]);

  const formatTime = (seconds: number) => {
    const wholeSeconds = Math.floor(seconds);
    const mins = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

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
      <div className="max-w-4xl mx-auto rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">Chưa có nội dung bài tập.</p>
      </div>
    );
  }

  const questions = sections.flatMap((section) => section.questions);
  const gradableQuestions = questions.filter((question) => question.gradable);
  const correctCount = gradableQuestions.filter((question) => {
    const answer = answers[question.id]?.trim();
    return answer && (question.kind === "input"
      ? answer === question.correctAnswer.trim()
      : answer === question.correctAnswer);
  }).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Audio Player Header - Sticky */}
      <Card className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="p-6 space-y-4">
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
          <div className="flex items-center gap-4">
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
              className="shrink-0"
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
            <div className="flex gap-2">
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
                  className="min-w-[60px]"
                >
                  {s}×
                </Button>
              ))}
            </div>

            {/* Time Display */}
            <div className="ml-auto text-sm text-muted-foreground font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          {/* Progress Bar */}
          <Progress value={progress} className="h-2" />
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
                  {(section.example.chinese || (config.showPinyin && section.example.pinyin) || (config.showTranslation && section.example.translation)) && (
                    <div className="space-y-1">
                      {section.example.chinese && <p className="font-medium">{section.example.chinese}</p>}
                      {config.showPinyin && section.example.pinyin && <p className="text-sm text-muted-foreground">{section.example.pinyin}</p>}
                      {config.showTranslation && section.example.translation && <p className="text-sm italic">{section.example.translation}</p>}
                    </div>
                  )}
                  <div className="space-y-2">
                    {section.example.options.map((option) => (
                      <div
                        key={option.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border-2 transition-colors",
                          option.id === section.example?.correctAnswer
                            ? "border-success bg-success/10 text-success-foreground"
                            : "border-border bg-background"
                        )}
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-current font-medium">
                          {option.label}
                        </div>
                        {(option.text || (config.showPinyin && option.pinyin)) && (
                          <span className="min-w-0 flex-1">
                            {option.text && <span className="block">{option.text}</span>}
                            {config.showPinyin && option.pinyin && <span className="block text-xs text-muted-foreground">{option.pinyin}</span>}
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
                showResultsImmediately={config.showResultsImmediately}
                showTranslation={config.showTranslation}
                showPinyin={config.showPinyin}
                isSubmitted={isSubmitted}
              />
            ))}
          </div>
        </Card>
      ))}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        {isSubmitted ? (
          <div>
            <p className="text-sm font-medium">Kết quả: {correctCount}/{gradableQuestions.length} câu có đáp án</p>
            {questions.length > gradableQuestions.length && (
              <p className="text-xs text-muted-foreground">{questions.length - gradableQuestions.length} câu chưa có answer key, không tính điểm</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Đã trả lời {Object.values(answers).filter(Boolean).length}/{questions.length} câu</p>
        )}
        <Button type="button" onClick={() => setIsSubmitted(true)} disabled={isSubmitted}>Nộp bài</Button>
      </Card>
    </div>
  );
}

function QuestionCard({
  question,
  selectedAnswer,
  onAnswer,
  showResultsImmediately = false,
  showTranslation = true,
  showPinyin = true,
  isSubmitted = false,
}: {
  question: Question;
  selectedAnswer?: string;
  onAnswer: (optId: string) => void;
  showResultsImmediately?: boolean;
  showTranslation?: boolean;
  showPinyin?: boolean;
  isSubmitted?: boolean;
}) {
  const isAnswered = !!selectedAnswer;
  const isCorrect = question.gradable && (question.kind === "input"
    ? selectedAnswer?.trim() === question.correctAnswer.trim()
    : selectedAnswer === question.correctAnswer);
  const showResults = question.gradable && isAnswered && (showResultsImmediately || isSubmitted);

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
      </div>

      {question.passage && <p className="whitespace-pre-line font-medium leading-relaxed">{question.passage}</p>}
      {question.prompt && <p className="whitespace-pre-line font-medium leading-relaxed">{question.prompt}</p>}
      {showPinyin && question.pinyin && <p className="whitespace-pre-line text-sm text-muted-foreground">{question.pinyin}</p>}
      {showTranslation && question.translation && <p className="whitespace-pre-line text-sm italic text-muted-foreground">{question.translation}</p>}

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
              {question.dialogue.chinese && <p className="font-medium">{question.dialogue.chinese}</p>}
              {showPinyin && question.dialogue.pinyin && <p className="text-sm text-muted-foreground">{question.dialogue.pinyin}</p>}
              {showTranslation && question.dialogue.translation && <p className="text-sm italic">{question.dialogue.translation}</p>}
            </Card>
          )}
        </div>
      )}

      {/* Options */}
      {question.kind === "input" ? (
        <Input
          value={selectedAnswer ?? ""}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Nhập đáp án"
          disabled={isSubmitted}
          aria-label={`Đáp án câu ${question.number}`}
        />
      ) : <div className="space-y-2">
        {question.options.map((option) => {
          const isSelected = selectedAnswer === option.id;
          const isCorrectOption = option.id === question.correctAnswer;
          const showAsCorrect = showResults && isCorrectOption;
          const showAsIncorrect = showResults && isSelected && !isCorrect;

          return (
            <button
              key={option.id}
              onClick={() => !showResults && !isSubmitted && onAnswer(option.id)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left",
                showAsCorrect && "border-success bg-success/10 text-success-foreground",
                showAsIncorrect && "border-destructive bg-destructive/10 text-destructive-foreground",
                !showResults && !isSelected && "border-border bg-background hover:border-primary hover:bg-primary/5",
                !showResults && isSelected && "border-primary bg-primary/5"
              )}
              disabled={showResults || isSubmitted}
            >
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-medium transition-colors",
                showAsCorrect && "border-success bg-success text-success-foreground",
                showAsIncorrect && "border-destructive bg-destructive text-destructive-foreground",
                !showAsCorrect && !showAsIncorrect && "border-current"
              )}>
                {option.label}
              </div>
              {(option.text || (showPinyin && option.pinyin)) && (
                <span className="min-w-0 flex-1">
                  {option.text && <span className="block">{option.text}</span>}
                  {showPinyin && option.pinyin && <span className="block text-xs text-muted-foreground">{option.pinyin}</span>}
                </span>
              )}
              {showAsCorrect && <Check className="ml-auto h-5 w-5" />}
              {showAsIncorrect && <X className="ml-auto h-5 w-5" />}
            </button>
          );
        })}
      </div>}
    </Card>
  );
}
