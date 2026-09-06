import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { Volume2, CheckCircle2, XCircle, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { speakChinese, isSpeechSupported } from "~/lib/speech";
import { isAnswerCorrect } from "~/lib/listening-answer";
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
  isCompleted: boolean;
  onComplete: () => void;
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

export function ListeningBlock({ config, questions, isCompleted, onComplete }: ListeningBlockProps) {
  const [round, setRound] = useState(0);
  const items = useMemo(
    () => (config.shuffle ? shuffled(questions) : questions),
    // round đổi → trộn lại khi học viên làm lại từ đầu
    [questions, config.shuffle, round]
  );

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<"correct" | "wrong" | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [replays, setReplays] = useState(0);
  const [speechReady, setSpeechReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSpeechReady(isSpeechSupported()), []);

  const question = items[index];
  const isLast = index === items.length - 1;
  const finished = verdict !== null && isLast;
  const answered = verdict !== null;

  const outOfReplays = config.maxReplays > 0 && replays >= config.maxReplays;

  const play = useCallback(() => {
    if (!question) return;
    speakChinese(question.chinese, question.audioUrl);
    setReplays((r) => r + 1);
  }, [question]);

  // Tự focus ô nhập khi sang câu mới để học viên gõ được ngay
  useEffect(() => {
    if (!answered) inputRef.current?.focus();
  }, [index, answered]);

  const check = () => {
    if (!question || answered || !answer.trim()) return;
    const correct = isAnswerCorrect(answer, config.answerMode === "pinyin" ? question.pinyin : question.chinese, config.answerMode);
    setVerdict(correct ? "correct" : "wrong");
    if (correct) setCorrectCount((c) => c + 1);
  };

  const next = () => {
    if (isLast) return;
    setIndex((i) => i + 1);
    setAnswer("");
    setVerdict(null);
    setReplays(0);
  };

  const restart = () => {
    setIndex(0);
    setAnswer("");
    setVerdict(null);
    setCorrectCount(0);
    setReplays(0);
    setRound((r) => r + 1);
  };

  if (!question) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Phần nghe này chưa có câu hỏi nào. Vui lòng liên hệ giáo viên.
      </p>
    );
  }

  const expected = config.answerMode === "pinyin" ? question.pinyin : question.chinese;

  return (
    <div className="space-y-5">
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
        onSubmit={(e) => {
          e.preventDefault();
          if (answered) next();
          else check();
        }}
        className="space-y-3"
      >
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={answered}
          placeholder={config.answerMode === "pinyin" ? "Nhập pinyin vừa nghe…" : "Nhập câu tiếng Trung vừa nghe…"}
          aria-label={config.answerMode === "pinyin" ? "Đáp án pinyin" : "Đáp án tiếng Trung"}
          aria-invalid={verdict === "wrong" || undefined}
          className={cn(
            "text-lg h-12 text-center",
            verdict === "correct" && "border-success bg-success/5",
            verdict === "wrong" && "border-destructive bg-destructive/5"
          )}
        />

        {verdict === null ? (
          <Button type="submit" size="lg" className="w-full" disabled={!answer.trim()}>
            Kiểm tra
          </Button>
        ) : (
          <div
            className={cn(
              "rounded-lg border p-4",
              verdict === "correct" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 text-sm font-medium",
                verdict === "correct" ? "text-success" : "text-destructive"
              )}
            >
              {verdict === "correct" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {verdict === "correct" ? "Chính xác!" : "Chưa đúng"}
            </div>

            {/* Sai thì hiện đáp án để học viên đối chiếu */}
            {verdict === "wrong" && (
              <div className="mt-3 space-y-1 border-t border-destructive/20 pt-3">
                <p className="text-xs text-muted-foreground">Đáp án đúng</p>
                <p className="text-lg font-medium">{expected}</p>
                {config.answerMode === "chinese" && (
                  <p className="text-sm text-primary font-mono">{question.pinyin}</p>
                )}
                <p className="text-sm text-muted-foreground">{question.translation}</p>
              </div>
            )}

            {!isLast && (
              <Button type="submit" size="lg" className="w-full mt-4">
                Câu tiếp theo
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            )}
          </div>
        )}
      </form>

      {/* Xong hết câu */}
      {finished && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm text-center">
            Kết quả: <span className="font-semibold tabular-nums">{correctCount}/{items.length}</span> câu đúng
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="ghost" size="sm" onClick={restart} className="sm:w-auto">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Làm lại từ đầu
            </Button>
            {isCompleted ? (
              <div className="flex items-center justify-center gap-2 text-success text-sm font-medium flex-1 py-2">
                <CheckCircle2 className="h-4 w-4" />
                Đã hoàn thành
              </div>
            ) : (
              <Button onClick={onComplete} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Hoàn thành phần này
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
