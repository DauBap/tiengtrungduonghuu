import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Volume2, CheckCircle2, ArrowLeft, ArrowRight, RefreshCw, Loader2, Send } from "lucide-react";
import { speakChinese, stopSpeaking, isSpeechSupported } from "~/lib/speech";
import type { SpeechPlaybackState } from "~/lib/speech";
import type { ListeningConfig } from "~/lib/learning-blocks";
import { getListeningGrade } from "~/lib/listening-score";

const playbackRates = [0.8, 1, 1.5] as const;
type PlaybackRate = (typeof playbackRates)[number];

/** Một câu hỏi nghe — đã được loader phẳng hoá từ VocabItem hoặc SentenceItem. */
export interface ListeningQuestion {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  audioUrl: string | null;
}

export interface ListeningAnswerResult {
  id: string;
  prompt: string;
  answerMode: "pinyin" | "chinese";
  given: string;
  correctAnswer: string;
  chinese: string;
  pinyin: string;
  translation: string;
  correct: boolean;
  matchPercent: number;
}

interface ListeningBlockProps {
  config: ListeningConfig;
  questions: ListeningQuestion[];
  onComplete: (answers: { questionId: string; answer: string }[]) => void;
  isSubmitting?: boolean;
  savedResult?: {
    score: number;
    correctCount: number;
    totalCount: number;
    results: ListeningAnswerResult[];
  } | null;
  submissionError?: string | null;
}

/** Trộn mảng, không đụng vào mảng gốc */
function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ListeningBlock({
  config,
  questions,
  onComplete,
  isSubmitting = false,
  savedResult = null,
  submissionError = null,
}: ListeningBlockProps) {
  const [round, setRound] = useState(0);
  const items = useMemo(
    () => (config.shuffle ? shuffled(questions) : questions),
    // round đổi → trộn lại khi học viên làm lại từ đầu
    [questions, config.shuffle, round]
  );

  const [index, setIndex] = useState(0);
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [replaysByQuestion, setReplaysByQuestion] = useState<Record<string, number>>({});
  const [speechReady, setSpeechReady] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [playbackState, setPlaybackState] = useState<SpeechPlaybackState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => setSpeechReady(isSpeechSupported()), []);

  const question = items[index];
  const isLast = index === items.length - 1;
  const answer = question ? answersByQuestion[question.id] ?? "" : "";
  const replays = question ? replaysByQuestion[question.id] ?? 0 : 0;
  const savedGrade = getListeningGrade(savedResult?.score ?? null);

  const outOfReplays = config.maxReplays > 0 && replays >= config.maxReplays;

  const play = useCallback(() => {
    if (!question) return;
    speakChinese(question.chinese, question.audioUrl, {
      preferAudio: true,
      rate: playbackRate,
      onPlaybackStateChange: setPlaybackState,
    });
    setReplaysByQuestion((previous) => ({
      ...previous,
      [question.id]: (previous[question.id] ?? 0) + 1,
    }));
  }, [question, playbackRate]);

  const togglePlayback = useCallback(() => {
    if (playbackState !== "idle") {
      stopSpeaking();
      return;
    }
    if (!outOfReplays) play();
  }, [outOfReplays, play, playbackState]);

  const next = useCallback(() => {
    if (isLast || isSubmitting) return;
    stopSpeaking();
    setIndex((current) => current + 1);
  }, [isLast, isSubmitting]);

  const previous = useCallback(() => {
    if (index === 0 || isSubmitting) return;
    stopSpeaking();
    setIndex((current) => current - 1);
  }, [index, isSubmitting]);

  const submitAttempt = useCallback(() => {
    if (hasSubmitted || isSubmitting) return;
    stopSpeaking();
    setHasSubmitted(true);
    onComplete(items.map((item) => ({ questionId: item.id, answer: (answersByQuestion[item.id] ?? "").trim() })));
  }, [answersByQuestion, hasSubmitted, isSubmitting, items, onComplete]);

  const restart = () => {
    stopSpeaking();
    setIndex(0);
    setAnswersByQuestion({});
    setHasSubmitted(false);
    setReplaysByQuestion({});
    setRound((r) => r + 1);
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => stopSpeaking();
  }, [index]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || event.keyCode === 229
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || hasSubmitted
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.isContentEditable
        || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
        || target.closest("button, a, [role='button']")
      ) {
        return;
      }

      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (isLast) submitAttempt();
        else next();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSubmitted, isLast, next, submitAttempt, togglePlayback]);

  if (!question) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Phần nghe này chưa có câu hỏi nào. Vui lòng liên hệ giáo viên.
      </p>
    );
  }

  const submittedAnswers = items.map((item) => ({ questionId: item.id, answer: answersByQuestion[item.id] ?? "" }));

  return (
    <div className="space-y-5">
      {hasSubmitted ? (
        <>
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Đang chấm và lưu kết quả...
            </div>
          ) : submissionError ? (
            <div role="alert" className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{submissionError}</p>
              <Button type="button" size="sm" onClick={() => onComplete(submittedAnswers)}>
                Thử lưu lại
              </Button>
            </div>
          ) : savedResult ? (
            <>
              <Card className={cn(savedResult.score === 100 ? "border-success/40" : "border-primary/30")}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex flex-col items-center gap-2 text-center">
                    {savedResult.score === 100
                      ? <CheckCircle2 className="h-10 w-10 text-success" />
                      : <CheckCircle2 className="h-10 w-10 text-primary" />}
                    <p className="text-lg font-bold">Đã lưu kết quả Nghe câu</p>
                    <p className="text-4xl font-bold tabular-nums">{savedGrade?.points ?? "0.0"} / 10</p>
                    <p className="text-base font-semibold text-primary">{savedGrade?.message}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Khớp hoàn toàn {savedResult.correctCount}/{savedResult.totalCount} câu
                    </p>
                  </div>
                  <Progress value={savedResult.score} className="h-2" />
                  <div className="flex justify-center">
                    <Button type="button" variant="outline" size="sm" onClick={restart}>
                      <RefreshCw className="mr-1.5 h-4 w-4" />Làm lại
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <section className="space-y-3" aria-label="Đáp án chi tiết phần nghe câu">
                <h3 className="text-base font-semibold">Đáp án chi tiết</h3>
                {savedResult.results.length > 0 ? savedResult.results.map((result) => (
                  <Card key={result.id}>
                    <CardContent className="space-y-2 p-4 sm:pt-4">
                      <p className="content-text font-semibold">{result.prompt}</p>
                      <p className="content-text text-sm leading-7">
                        <span className="text-muted-foreground">Bạn trả lời: </span>
                        <span className={cn(result.correct ? "text-success" : "text-destructive")}>
                          {result.given.trim() || "Bỏ trống"}
                        </span>
                        <span className="ml-2 text-muted-foreground">({result.matchPercent}% khớp)</span>
                      </p>
                      <p className="content-text text-sm leading-7">
                        <span className="text-muted-foreground">Đáp án đúng: </span>
                        <span className={result.answerMode === "chinese" ? "hanzi-display" : "pinyin-text"}>
                          {result.correctAnswer}
                        </span>
                      </p>
                      {((result.answerMode !== "chinese" && result.chinese)
                        || (result.answerMode !== "pinyin" && result.pinyin)
                        || result.translation) && (
                        <p className="content-text text-sm leading-7 text-muted-foreground">
                          {result.answerMode !== "chinese" && result.chinese && (
                            <span className="hanzi-display">{result.chinese}</span>
                          )}
                          {result.answerMode !== "pinyin" && result.pinyin && (
                            <>{result.answerMode !== "chinese" && result.chinese ? " · " : ""}{result.pinyin}</>
                          )}
                          {result.translation && (
                            <>{(result.answerMode !== "chinese" && result.chinese)
                              || (result.answerMode !== "pinyin" && result.pinyin) ? " · " : ""}{result.translation}</>
                          )}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )) : (
                  <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                    Lượt làm này chưa lưu được đáp án chi tiết.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Đang nhận kết quả từ máy chủ...
            </div>
          )}
        </>
      ) : (
        <>
      <div className="flex items-center gap-3">
        <Progress value={((index + 1) / items.length) * 100} className="h-1.5 flex-1" />
        <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
          Câu {index + 1}/{items.length}
        </span>
      </div>

      {/* Khu vực nghe */}
      <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-8">
        <div className="flex flex-col items-center gap-4">
          <Button
            type="button"
            size="lg"
            onClick={togglePlayback}
            disabled={!speechReady || (outOfReplays && playbackState === "idle")}
            className="h-20 w-20 rounded-full"
            title={
              playbackState !== "idle"
                ? "Dừng phát âm thanh"
                : outOfReplays
                  ? "Đã hết số lần nghe lại"
                  : "Nghe câu"
            }
            aria-label={
              playbackState !== "idle"
                ? "Dừng phát âm thanh"
                : outOfReplays
                  ? "Đã hết số lần nghe lại"
                  : "Nghe câu"
            }
          >
            {playbackState === "loading"
              ? <Loader2 className="h-8 w-8 animate-spin" />
              : <Volume2 className={cn("h-8 w-8", playbackState === "playing" && "animate-pulse")} />}
          </Button>

          <div className="text-center" aria-live="polite">
            <p className="text-sm font-medium">
              {playbackState === "loading"
                ? "Đang chuẩn bị âm thanh…"
                : playbackState === "playing"
                  ? "Đang phát — bấm để dừng"
                  : replays === 0
                    ? "Bấm để nghe"
                    : outOfReplays
                      ? "Đã hết số lần nghe"
                      : "Nghe lại"}
            </p>
            {config.maxReplays > 0 && (
              <p className="text-xs font-medium text-foreground/70 mt-0.5 tabular-nums">
                Còn {Math.max(0, config.maxReplays - replays)}/{config.maxReplays} lần
              </p>
            )}
          </div>

          {!speechReady && (
            <p className="text-xs text-foreground/70 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang chuẩn bị bộ đọc…
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs font-medium text-foreground/70">Tốc độ phát</span>
            <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Tốc độ phát">
              {playbackRates.map((rate) => (
                <Button
                  key={rate}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={playbackRate === rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={cn(
                    "h-8 rounded-none px-3 text-xs",
                    playbackRate === rate
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {rate}×
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ô nhập đáp án */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isComposingRef.current) return;
          if (isLast) submitAttempt();
          else next();
        }}
        className="space-y-3"
      >
        <div className="rounded-lg border bg-background transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 focus-within:ring-offset-2">
          <Input
            ref={inputRef}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            value={answer}
            onChange={(event) => {
              if (!question) return;
              setAnswersByQuestion((previousAnswers) => ({ ...previousAnswers, [question.id]: event.target.value }));
            }}
            placeholder={config.answerMode === "pinyin" ? "Nhập pinyin vừa nghe…" : "Nhập câu tiếng Trung vừa nghe…"}
            aria-label={config.answerMode === "pinyin" ? "Đáp án pinyin" : "Đáp án tiếng Trung"}
            className="h-14 border-0 bg-transparent px-4 text-center text-lg shadow-none focus-visible:ring-0"
          />
        </div>

        <p className="hidden -mt-2 text-center text-xs text-muted-foreground md:block">
          Mẹo: Khi không gõ, nhấn Space để nghe · Enter để {isLast ? "nộp bài" : "sang câu tiếp theo"}
        </p>

        <div className="flex justify-center border-t pt-3">
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={previous}
              disabled={index === 0 || isSubmitting}
              className="min-h-11 border-primary/40 px-4 text-foreground transition-colors duration-150 hover:border-primary hover:bg-primary/10"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />Câu trước
            </Button>
            {isLast ? (
              <Button type="submit" size="lg" disabled={isSubmitting} className="min-h-11 px-5 transition-colors duration-150">
                <Send className="mr-1.5 h-4 w-4" />Nộp bài
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={isSubmitting} className="min-h-11 px-5 transition-colors duration-150">
                Câu tiếp theo<ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </form>

        </>
      )}
    </div>
  );
}
