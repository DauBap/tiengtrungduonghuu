import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, RefreshCw, RotateCcw, Shuffle, Trash2, Volume2, X } from "lucide-react";
import { speakChinese, isSpeechSupported } from "~/lib/speech";
import type { FlashcardConfig } from "~/lib/learning-blocks";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";
import { useAppSettings } from "~/lib/app-settings";
import { VocabularyTable } from "~/components/lessons/vocabulary-table";

export interface FlashcardVocab {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordTypes: WordType[];
  audioUrl: string | null;
  note: string | null;
}

type VocabStatus = "known" | "unknown";
type StudyMode = "all" | "unknown";
type StoredProgress = Record<string, VocabStatus>;

interface FlashcardBlockProps {
  config: FlashcardConfig;
  items: FlashcardVocab[];
  courseId: string;
  lessonId: string;
  isCompleted: boolean;
  onComplete: () => void;
  progressStorageKey?: string;
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function FlashcardBlock({ config, items, courseId, lessonId, isCompleted, onComplete, progressStorageKey }: FlashcardBlockProps) {
  const settings = useAppSettings();
  const storageKey = progressStorageKey ?? `flashcard-progress:${courseId}:${lessonId}`;
  const [round, setRound] = useState(0);
  const cards = useMemo(() => (config.shuffle ? shuffled(items) : items), [items, config.shuffle, round]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<StudyMode>("all");
  const [queue, setQueue] = useState<string[]>(() => items.map((item) => item.id));
  const [flipped, setFlipped] = useState(false);
  const [statuses, setStatuses] = useState<StoredProgress>({});
  const [speechReady, setSpeechReady] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const completionSubmitted = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const isDragging = useRef(false);
  const suppressCardClick = useRef(false);
  const [dragX, setDragX] = useState(0);

  useEffect(() => {
    setSpeechReady(isSpeechSupported());
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          const valid = Object.fromEntries(
            Object.entries(parsed).filter(([, value]) => value === "known" || value === "unknown")
          ) as StoredProgress;
          setStatuses(valid);
        }
      }
    } catch {
      setStatuses({});
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(statuses));
      } catch {
        // Bỏ qua khi trình duyệt không cho phép ghi localStorage.
      }
    }
  }, [hydrated, statuses, storageKey]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
  }, []);

  const allKnown = items.length > 0 && items.every((item) => statuses[item.id] === "known");

  useEffect(() => {
    if (isCompleted) {
      completionSubmitted.current = true;
      return;
    }
    if (
      !hydrated
      || completionSubmitted.current
      || !allKnown
    ) {
      return;
    }

    completionSubmitted.current = true;
    onComplete();
  }, [allKnown, hydrated, isCompleted, onComplete]);

  const card = cards.find((item) => item.id === queue[index]);
  const counts = useMemo(() => {
    const knownCount = items.filter((item) => statuses[item.id] === "known").length;
    const unknownCount = items.filter((item) => statuses[item.id] === "unknown").length;
    const unreviewedCount = items.filter((item) => statuses[item.id] === undefined).length;
    return {
      known: knownCount,
      unknown: unknownCount,
      unreviewed: unreviewedCount,
      toReview: unknownCount + unreviewedCount,
      total: items.length,
    };
  }, [items, statuses]);
  const unknownItems = useMemo(
    () => items.filter((item) => statuses[item.id] === "unknown"),
    [items, statuses],
  );

  const speak = useCallback((item: FlashcardVocab) => speakChinese(item.chinese, item.audioUrl), []);
  const interacted = useRef(false);
  const lastSpokenId = useRef<string | null>(null);

  useEffect(() => {
    if (!card || lastSpokenId.current === card.id) return;
    lastSpokenId.current = card.id;
    if (config.autoSpeak && interacted.current) speak(card);
  }, [card, config.autoSpeak, speak]);

  const startSession = useCallback((nextMode: StudyMode) => {
    const nextCards = config.shuffle ? shuffled(items) : items;
    const nextQueue = nextMode === "unknown"
      ? nextCards.filter((item) => statuses[item.id] !== "known").map((item) => item.id)
      : nextCards.map((item) => item.id);
    setMode(nextMode);
    setQueue(nextQueue);
    setIndex(0);
    setFlipped(false);
    setFinished(nextQueue.length === 0);
    setRound((value) => value + 1);
    interacted.current = true;
  }, [config.shuffle, items, statuses]);

  const goTo = useCallback((next: number) => {
    if (isTransitioning || next < 0 || next >= queue.length) return;
    interacted.current = true;
    setIndex(next);
    setFlipped(false);
  }, [isTransitioning, queue.length]);

  const flip = useCallback(() => {
    if (!card || isTransitioning) return;
    interacted.current = true;
    setFlipped((value) => !value);
    speak(card);
  }, [card, isTransitioning, speak]);

  const mark = useCallback((status: VocabStatus, swipeDirection = status === "known" ? -1 : 1) => {
    if (!card || isTransitioning) return;
    setStatuses((previous) => ({ ...previous, [card.id]: status }));
    setIsTransitioning(true);
    setDragX(swipeDirection * Math.max(window.innerWidth, 500));
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setFlipped(false);
      if (index >= queue.length - 1) {
        setDragX(0);
        setFinished(true);
      } else {
        setIndex((value) => value + 1);
        setDragX(-swipeDirection * Math.min(window.innerWidth * 0.16, 96));
        window.setTimeout(() => setDragX(0), 20);
      }
      setIsTransitioning(false);
    }, 260);
  }, [card, index, isTransitioning, queue.length]);

  const handleCardPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || isTransitioning) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    isDragging.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCardPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (!isDragging.current && Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
      isDragging.current = true;
    }
    if (isDragging.current) {
      event.preventDefault();
      setDragX(deltaX);
    }
  };

  const finishCardPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pointerStart.current = null;

    if (!isDragging.current) return;
    isDragging.current = false;
    suppressCardClick.current = true;
    window.setTimeout(() => {
      suppressCardClick.current = false;
    }, 500);

    const deltaX = event.clientX - start.x;
    const threshold = Math.max(70, event.currentTarget.clientWidth * 0.2);
    if (Math.abs(deltaX) < threshold) {
      setDragX(0);
      return;
    }
    const direction = deltaX < 0 ? -1 : 1;
    setDragX(direction * event.currentTarget.clientWidth);
    mark(direction < 0 ? "known" : "unknown", direction);
  };

  const cancelCardPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId !== event.pointerId) return;
    pointerStart.current = null;
    isDragging.current = false;
    setDragX(0);
  };

  const handleCardClick = () => {
    if (suppressCardClick.current) {
      suppressCardClick.current = false;
      return;
    }
    flip();
  };

  const resetProgress = () => {
    if (!window.confirm("Bạn có chắc muốn xóa toàn bộ trạng thái từ vựng của bài này không?")) return;
    window.localStorage.removeItem(storageKey);
    setStatuses({});
    startSession("all");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
      else if (event.key === " " || event.key === "Enter") { event.preventDefault(); flip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, goTo, index]);

  if (!card && !finished) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Block này chưa có thẻ nào. Vui lòng liên hệ giáo viên.</p>;
  }

  if (finished) {
    return (
      <div className="space-y-6">
        <div className="space-y-5 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <div>
            <h3 className="text-xl font-semibold">Hoàn thành lượt học</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {allKnown
                ? "Bạn đã thuộc toàn bộ từ; tiến độ tab flashcard đã được cập nhật."
                : "Tiến độ từ vựng được lưu trên thiết bị này. Hãy đánh dấu các từ đã thuộc để hoàn thành tab."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg border bg-success/5 p-3"><strong className="block text-lg text-success">{counts.known}</strong>Đã thuộc</div>
            <div className="rounded-lg border bg-destructive/5 p-3"><strong className="block text-lg text-destructive">{counts.unknown}</strong>Chưa thuộc</div>
            <div className="rounded-lg border bg-muted/40 p-3"><strong className="block text-lg">{counts.unreviewed}</strong>Chưa đánh giá</div>
            <div className="rounded-lg border bg-muted/40 p-3"><strong className="block text-lg">{counts.total}</strong>Tổng số</div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => startSession("all")}><RefreshCw className="mr-1.5 h-4 w-4" />Học lại tất cả</Button>
            <Button variant="outline" onClick={() => startSession("unknown")} disabled={counts.toReview === 0}><CircleHelp className="mr-1.5 h-4 w-4" />Ôn từ chưa thuộc</Button>
          </div>
          <Button variant="ghost" size="sm" onClick={resetProgress}><Trash2 className="mr-1.5 h-4 w-4" />Đặt lại tiến độ</Button>
        </div>
        {mode === "unknown" && unknownItems.length > 0 && (
          <section className="space-y-3 text-left">
            <h3 className="text-lg font-semibold">Từ chưa thuộc ({unknownItems.length})</h3>
            <VocabularyTable items={unknownItems} />
          </section>
        )}
      </div>
    );
  }

  if (!card) return null;

  const frontIsChinese = config.frontSide === "chinese";
  const frontMain = frontIsChinese ? card.chinese : card.translation;
  const backMain = frontIsChinese ? card.translation : card.chinese;
  const position = index + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border p-1">
          <Button size="sm" variant={mode === "all" ? "destructive" : "ghost"} onClick={() => startSession("all")} disabled={isTransitioning}>TẤT CẢ TỪ</Button>
          <Button size="sm" variant={mode === "unknown" ? "destructive" : "ghost"} onClick={() => startSession("unknown")} disabled={isTransitioning || counts.toReview === 0}>TỪ CHƯA THUỘC</Button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">Đã thuộc {counts.known} · Chưa thuộc {counts.unknown} · Chưa đánh giá {counts.unreviewed} · Tổng {counts.total}</span>
      </div>
      <div className="flex items-center gap-3">
        <Progress value={(position / queue.length) * 100} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{position}/{queue.length}</span>
      </div>

      <button
        type="button"
        onClick={handleCardClick}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={finishCardPointer}
        onPointerCancel={cancelCardPointer}
        disabled={isTransitioning}
        className="group relative block w-full touch-none select-none [perspective:1200px]"
        style={{
          transform: `translate3d(${dragX}px, 0, 0) rotate(${dragX / 24}deg)`,
          opacity: Math.max(0, 1 - Math.abs(dragX) / Math.max(window.innerWidth, 500)),
          transition: isDragging.current
            ? "none"
            : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease-out",
          willChange: "transform, opacity",
        }}
        aria-label={flipped ? "Xem mặt trước; vuốt trái để đánh dấu đã thuộc, vuốt phải để đánh dấu chưa thuộc" : "Xem mặt sau; vuốt trái để đánh dấu đã thuộc, vuốt phải để đánh dấu chưa thuộc"}
      >
        <div className={cn("relative h-72 w-full transition-transform duration-500 [transform-style:preserve-3d]", flipped && "[transform:rotateY(180deg)]")}>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/20 bg-primary/5 p-6 transition-colors [backface-visibility:hidden] group-hover:border-primary/40">
            <p className={cn("content-text w-full min-w-0 max-w-full break-words whitespace-normal px-1 text-center font-semibold [overflow-wrap:anywhere]", frontIsChinese ? "hanzi-display text-5xl" : "text-2xl")}>{frontMain}</p>
            {frontIsChinese && config.showPinyinOnFront && settings.showPinyin && <p className="content-text pinyin-text w-full min-w-0 max-w-full break-words whitespace-normal px-1 text-center text-lg text-primary [overflow-wrap:anywhere]">{card.pinyin}</p>}
            <p className="absolute bottom-4 text-xs text-muted-foreground">Bấm để lật thẻ</p>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/30 bg-primary/10 p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className={cn("content-text w-full min-w-0 max-w-full break-words whitespace-normal px-1 text-center font-semibold [overflow-wrap:anywhere]", frontIsChinese ? "text-2xl" : "hanzi-display text-5xl")}>{backMain}</p>
            {settings.showPinyin && <p className="content-text pinyin-text w-full min-w-0 max-w-full break-words whitespace-normal px-1 text-center text-base text-primary [overflow-wrap:anywhere]">{card.pinyin}</p>}
            {!!card.wordTypes?.length && <div className="flex flex-wrap justify-center gap-1">{card.wordTypes.map((type) => <span key={type} className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs text-muted-foreground">{WORD_TYPE_META[type].label}</span>)}</div>}
            {card.note && <p className="content-text mt-1 w-full min-w-0 max-w-xs break-words whitespace-normal text-center text-sm text-muted-foreground [overflow-wrap:anywhere]">{card.note}</p>}
          </div>
        </div>
      </button>
      <p className="-mt-2 text-center text-xs text-muted-foreground">Vuốt trái: đã thuộc · Vuốt phải: chưa thuộc</p>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => goTo(index - 1)} disabled={index === 0 || isTransitioning}><ChevronLeft className="mr-1 h-4 w-4" />Trước</Button>
        <div className="flex gap-2">
          {speechReady && <Button variant="ghost" size="sm" title="Nghe phát âm" onClick={() => { interacted.current = true; speak(card); }} disabled={isTransitioning}><Volume2 className="h-4 w-4" /></Button>}
          <Button variant="ghost" size="sm" onClick={() => goTo(Math.floor(Math.random() * queue.length))} title="Nhảy tới thẻ ngẫu nhiên" disabled={isTransitioning}><Shuffle className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={flip} title="Lật thẻ" disabled={isTransitioning}><RotateCcw className="h-4 w-4" /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => goTo(index + 1)} disabled={index === queue.length - 1 || isTransitioning}>Sau<ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t pt-3">
        <Button variant={statuses[card.id] === "known" ? "secondary" : "outline"} onClick={() => mark("known")} disabled={isTransitioning} className="border-success/40 text-success hover:bg-success/10"><Check className="mr-1.5 h-4 w-4" />ĐÃ THUỘC</Button>
        <Button variant={statuses[card.id] === "unknown" ? "secondary" : "outline"} onClick={() => mark("unknown")} disabled={isTransitioning} className="border-destructive/40 text-destructive hover:bg-destructive/10"><X className="mr-1.5 h-4 w-4" />CHƯA THUỘC</Button>
      </div>
      <div className="flex items-center justify-between border-t pt-2">
        <Button variant="ghost" size="sm" onClick={() => startSession(mode)} disabled={isTransitioning}><RefreshCw className="mr-1.5 h-4 w-4" />Học lại lượt này</Button>
        <Button variant="ghost" size="sm" onClick={resetProgress} disabled={isTransitioning}><Trash2 className="mr-1.5 h-4 w-4" />Đặt lại tiến độ</Button>
      </div>
      {mode === "unknown" && unknownItems.length > 0 && (
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-lg font-semibold">Từ chưa thuộc ({unknownItems.length})</h3>
          <VocabularyTable items={unknownItems} />
        </section>
      )}
    </div>
  );
}
