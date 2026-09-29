import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Volume2, CheckCircle2, ArrowLeft, ArrowRight, RefreshCw, Loader2, Send } from "lucide-react";
import { speakChinese, isSpeechSupported } from "~/lib/speech";
import type { ListeningConfig } from "~/lib/learning-blocks";

/** Một câu hỏi nghe — đã được loader phẳng hoá từ VocabItem hoặc SentenceItem. */
export interface ListeningQuestion {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  audioUrl: string | null;
}

interface ListeningBlockProps {
  config: ListeningConfig;
  questions: ListeningQuestion[];
  onComplete: (answers: { questionId: string; answer: string }[]) => void;
  isSubmitting?: boolean;
  savedResult?: { score: number; correctCount: number; totalCount: number } | null;
  submissionError?: string | null;
  showAnswerDetails?: boolean;
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
  showAnswerDetails = false,
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSpeechReady(isSpeechSupported()), []);

  const question = items[index];
  const isLast = index === items.length - 1;
  const answer = question ? answersByQuestion[question.id] ?? "" : "";
  const replays = question ? replaysByQuestion[question.id] ?? 0 : 0;

  const outOfReplays = config.maxReplays > 0 && replays >= config.maxReplays;

  const play = useCallback(() => {
    if (!question) return;
    speakChinese(question.chinese, question.audioUrl);
    setReplaysByQuestion((previous) => ({
      ...previous,
      [question.id]: (previous[question.id] ?? 0) + 1,
    }));
  }, [question]);

  // Tự focus ô nhập khi chuyển câu để học viên gõ được ngay
  useEffect(() => {
    inputRef.current?.focus();
  }, [index]);

  const next = () => {
    if (isLast) return;
    setIndex((current) => current + 1);
  };

  const previous = () => {
    if (index === 0) return;
    setIndex((current) => current - 1);
  };

  const submitAttempt = () => {
    if (hasSubmitted || isSubmitting) return;
    setHasSubmitted(true);
    onComplete(items.map((item) => ({ questionId: item.id, answer: (answersByQuestion[item.id] ?? "").trim() })));
  };

  const restart = () => {
    setIndex(0);
    setAnswersByQuestion({});
    setHasSubmitted(false);
    setReplaysByQuestion({});
    setRound((r) => r + 1);
  };

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
                    <p className="text-4xl font-bold tabular-nums">{savedResult.score}%</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Khớp hoàn toàn {savedResult.correctCount}/{savedResult.totalCount} câu
                    </p>
                  </div>
                  <Progress value={savedResult.score} className="h-2" />
                  {!showAnswerDetails && (
                    <div className="flex justify-center">
                      <Button type="button" variant="outline" size="sm" onClick={restart}>
                        <RefreshCw className="mr-1.5 h-4 w-4" />Làm lại
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                {showAnswerDetails
                  ? "Đáp án chi tiết đã được mở ở phía trên."
                  : "Đáp án chi tiết sẽ hiện khi giáo viên mở xem kết quả."}
              </p>
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
            onClick={play}
            disabled={!speechReady || outOfReplays}
            className="h-20 w-20 rounded-full"
            title={outOfReplays ? "Đã hết số lần nghe lại" : "Nghe câu"}
          >
            <Volume2 className="h-8 w-8" />
          </Button>

          <div className="text-center">
            <p className="text-sm font-medium">
              {replays === 0 ? "Bấm để nghe" : outOfReplays ? "Đã hết số lần nghe" : "Nghe lại"}
            </p>
            {config.maxReplays > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                Còn {Math.max(0, config.maxReplays - replays)}/{config.maxReplays} lần
              </p>
            )}
          </div>

          {!speechReady && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang chuẩn bị bộ đọc…
            </p>
          )}
        </div>
      </div>

      {/* Ô nhập đáp án */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isLast) submitAttempt();
          else next();
        }}
        className="space-y-3"
      >
        <div className="rounded-lg border bg-background">
          <Input
            ref={inputRef}
            value={answer}
            onChange={(event) => {
              if (!question) return;
              setAnswersByQuestion((previousAnswers) => ({ ...previousAnswers, [question.id]: event.target.value }));
            }}
            placeholder={config.answerMode === "pinyin" ? "Nhập pinyin vừa nghe…" : "Nhập câu tiếng Trung vừa nghe…"}
            aria-label={config.answerMode === "pinyin" ? "Đáp án pinyin" : "Đáp án tiếng Trung"}
            className="h-12 border-0 bg-transparent text-center text-lg shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Button type="button" variant="outline" onClick={previous} disabled={index === 0 || isSubmitting}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />Câu trước
          </Button>
          {isLast ? (
            <Button type="submit" size="lg" disabled={isSubmitting}>
              <Send className="mr-1.5 h-4 w-4" />Nộp bài
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={isSubmitting}>
              Câu tiếp theo<ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </form>

        </>
      )}
    </div>
  );
}
