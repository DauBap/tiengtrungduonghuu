import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, RefreshCw, RotateCcw, Shuffle, Trash2, Volume2, X } from "lucide-react";
import { speakChinese, isSpeechSupported } from "~/lib/speech";
import type { FlashcardConfig } from "~/lib/learning-blocks";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";
import { useAppSettings } from "~/lib/app-settings";

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
  lessonName?: string;
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

export function FlashcardBlock({ config, items, courseId, lessonId, isCompleted, onComplete, lessonName, progressStorageKey }: FlashcardBlockProps) {
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

  const card = cards.find((item) => item.id === queue[index]);
  const counts = useMemo(() => {
    const knownCount = items.filter((item) => statuses[item.id] === "known").length;
    const unknownCount = items.filter((item) => statuses[item.id] === "unknown").length;
    return { known: knownCount, unknown: unknownCount, total: items.length };
  }, [items, statuses]);

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
      ? nextCards.filter((item) => statuses[item.id] === "unknown").map((item) => item.id)
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

  const mark = useCallback((status: VocabStatus) => {
    if (!card || isTransitioning) return;
    setStatuses((previous) => ({ ...previous, [card.id]: status }));
    setIsTransitioning(true);
    window.setTimeout(() => {
      setFlipped(false);
      if (index >= queue.length - 1) {
        setFinished(true);
      } else {
        setIndex((value) => value + 1);
      }
      setIsTransitioning(false);
    }, 350);
  }, [card, index, isTransitioning, queue.length]);

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
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <div>
          <h3 className="text-xl font-semibold">Hoàn thành lượt học</h3>
          <p className="mt-1 text-sm text-muted-foreground">Tiến độ của bài học đã được lưu trên thiết bị này.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg border bg-success/5 p-3"><strong className="block text-lg text-success">{counts.known}</strong>Đã thuộc</div>
          <div className="rounded-lg border bg-destructive/5 p-3"><strong className="block text-lg text-destructive">{counts.unknown}</strong>Chưa thuộc</div>
          <div className="rounded-lg border bg-muted/40 p-3"><strong className="block text-lg">{counts.total}</strong>Tổng số</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => startSession("all")}><RefreshCw className="mr-1.5 h-4 w-4" />Học lại tất cả</Button>
          <Button variant="outline" onClick={() => startSession("unknown")} disabled={counts.unknown === 0}><CircleHelp className="mr-1.5 h-4 w-4" />Ôn từ chưa thuộc</Button>
          {!isCompleted && <Button variant="secondary" onClick={onComplete}><CheckCircle2 className="mr-1.5 h-4 w-4" />Hoàn thành phần này</Button>}
        </div>
        <Button variant="ghost" size="sm" onClick={resetProgress}><Trash2 className="mr-1.5 h-4 w-4" />Đặt lại tiến độ</Button>
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
          <Button size="sm" variant={mode === "unknown" ? "destructive" : "ghost"} onClick={() => startSession("unknown")} disabled={isTransitioning}>TỪ CHƯA THUỘC</Button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">Đã thuộc {counts.known} · Chưa thuộc {counts.unknown} · Tổng {counts.total}</span>
      </div>
      <div className="flex items-center gap-3">
        <Progress value={(position / queue.length) * 100} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{position}/{queue.length}</span>
      </div>

      <button type="button" onClick={flip} disabled={isTransitioning} className="group relative block w-full [perspective:1200px]" aria-label={flipped ? "Xem mặt trước" : "Xem mặt sau"}>
        <div className={cn("relative h-72 w-full transition-transform duration-500 [transform-style:preserve-3d]", flipped && "[transform:rotateY(180deg)]")}>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/20 bg-primary/5 p-6 transition-colors [backface-visibility:hidden] group-hover:border-primary/40">
            <p className={cn("text-center font-semibold", frontIsChinese ? "text-5xl" : "text-2xl")}>{frontMain}</p>
            {lessonName && <p className="text-xs text-muted-foreground">{lessonName}</p>}
            {frontIsChinese && config.showPinyinOnFront && settings.showPinyin && <p className="font-mono text-lg text-primary">{card.pinyin}</p>}
            <p className="absolute bottom-4 text-xs text-muted-foreground">Bấm để lật thẻ</p>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/30 bg-primary/10 p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className={cn("text-center font-semibold", frontIsChinese ? "text-2xl" : "text-5xl")}>{backMain}</p>
            {settings.showPinyin && <p className="font-mono text-base text-primary">{card.pinyin}</p>}
            {!!card.wordTypes?.length && <div className="flex flex-wrap justify-center gap-1">{card.wordTypes.map((type) => <span key={type} className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs text-muted-foreground">{WORD_TYPE_META[type].label}</span>)}</div>}
            {card.note && <p className="mt-1 max-w-xs text-center text-sm text-muted-foreground">{card.note}</p>}
          </div>
        </div>
      </button>

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
    </div>
  );
}
