import { useEffect, useMemo, useState, useCallback } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { ChevronLeft, ChevronRight, Volume2, RotateCcw, Check, CheckCircle2, RefreshCw, Shuffle } from "lucide-react";
import { speakChinese, isSpeechSupported } from "~/lib/speech";
import type { FlashcardConfig } from "~/lib/learning-blocks";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";

export interface FlashcardVocab {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordType: WordType | null;
  audioUrl: string | null;
  note: string | null;
}

interface FlashcardBlockProps {
  config: FlashcardConfig;
  items: FlashcardVocab[];
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

export function FlashcardBlock({ config, items, isCompleted, onComplete }: FlashcardBlockProps) {
  const [round, setRound] = useState(0);
  const cards = useMemo(
    () => (config.shuffle ? shuffled(items) : items),
    // round đổi → trộn lại khi học viên bắt đầu vòng ôn mới
    [items, config.shuffle, round]
  );

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [speechReady, setSpeechReady] = useState(false);

  useEffect(() => setSpeechReady(isSpeechSupported()), []);

  const card = cards[index];
  const isLast = index === cards.length - 1;
  const allSeen = known.size === cards.length;

  const speak = useCallback(
    (item: FlashcardVocab) => speakChinese(item.chinese, item.audioUrl),
    []
  );

  // Tự đọc khi mở thẻ mới nếu admin bật autoSpeak
  useEffect(() => {
    if (config.autoSpeak && card) speak(card);
  }, [card, config.autoSpeak, speak]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= cards.length) return;
      setIndex(next);
      setFlipped(false);
    },
    [cards.length]
  );

  const goToRandom = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * cards.length);
    goTo(randomIndex);
  }, [cards.length, goTo]);

  const markKnown = useCallback(() => {
    if (!card) return;
    setKnown((prev) => new Set(prev).add(card.id));
    if (!isLast) goTo(index + 1);
  }, [card, isLast, index, goTo]);

  const restart = () => {
    setKnown(new Set());
    setIndex(0);
    setFlipped(false);
    setRound((r) => r + 1);
  };

  // Phím tắt: ←/→ điều hướng, Space lật thẻ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo]);

  if (!card) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Block này chưa có thẻ nào. Vui lòng liên hệ giáo viên.
      </p>
    );
  }

  const frontIsChinese = config.frontSide === "chinese";
  const frontMain = frontIsChinese ? card.chinese : card.translation;
  const backMain = frontIsChinese ? card.translation : card.chinese;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={((index + 1) / cards.length) * 100} className="h-1.5 flex-1" />
        <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
          {index + 1}/{cards.length}
        </span>
      </div>

      {/* Thẻ lật — bấm vào thẻ để lật */}
      <button
        type="button"
        onClick={() => {
          setFlipped((f) => !f);
          if (config.autoSpeak && card) speak(card);
        }}
        className="group relative block w-full [perspective:1200px]"
        aria-label={flipped ? "Xem mặt trước" : "Xem mặt sau"}
      >
        <div
          className={cn(
            "relative h-72 w-full transition-transform duration-500 [transform-style:preserve-3d]",
            flipped && "[transform:rotateY(180deg)]"
          )}
        >
          {/* Mặt trước */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/20 bg-primary/5 p-6 [backface-visibility:hidden] group-hover:border-primary/40 transition-colors">
            <p className={cn("font-semibold text-center", frontIsChinese ? "text-5xl" : "text-2xl")}>{frontMain}</p>
            {frontIsChinese && config.showPinyinOnFront && (
              <p className="text-lg text-primary font-mono">{card.pinyin}</p>
            )}
            <p className="absolute bottom-4 text-xs text-muted-foreground">Bấm để lật thẻ</p>
          </div>

          {/* Mặt sau — tông thương hiệu; xanh lá để dành riêng cho "đúng/hoàn thành" */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/30 bg-primary/10 p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className={cn("font-semibold text-center", frontIsChinese ? "text-2xl" : "text-5xl")}>{backMain}</p>
            <p className="text-base text-primary font-mono">{card.pinyin}</p>
            {card.wordType && (
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                {WORD_TYPE_META[card.wordType].label}
              </span>
            )}
            {card.note && <p className="text-sm text-muted-foreground text-center mt-1 max-w-xs">{card.note}</p>}
          </div>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => goTo(index - 1)} disabled={index === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" />Trước
        </Button>

        <div className="flex gap-2">
          {speechReady && (
            <Button variant="ghost" size="sm" onClick={() => speak(card)} title="Nghe phát âm">
              <Volume2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={goToRandom} title="Nhảy tới thẻ ngẫu nhiên">
            <Shuffle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setFlipped((f) => !f)} title="Lật thẻ">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant={known.has(card.id) ? "secondary" : "outline"}
            size="sm"
            onClick={markKnown}
            title="Đánh dấu đã biết từ này"
          >
            <Check className="h-4 w-4 mr-1" />
            {known.has(card.id) ? "Đã biết" : "Tôi đã biết"}
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={() => goTo(index + 1)} disabled={isLast}>
          Sau<ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={restart} className="sm:w-auto">
          <RefreshCw className="h-4 w-4 mr-1.5" />Học lại từ đầu
        </Button>
        {isCompleted ? (
          <div className="flex items-center justify-center gap-2 text-success text-sm font-medium flex-1 py-2">
            <CheckCircle2 className="h-4 w-4" />Đã hoàn thành
          </div>
        ) : (
          <Button onClick={onComplete} disabled={!allSeen} className="flex-1">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {allSeen ? "Hoàn thành phần này" : `Còn ${cards.length - known.size} thẻ chưa đánh dấu`}
          </Button>
        )}
      </div>
    </div>
  );
}
