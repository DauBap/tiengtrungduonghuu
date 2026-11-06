import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useFetcher } from "react-router";
import type HanziWriterInstance from "hanzi-writer";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clock3, Crown, Eraser,
  Heart, Loader2, Pause, Play, RotateCcw, Volume2, VolumeX, WandSparkles, X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  getAccuracy, getHanziCharacters, getShenbiScopeKey, getStageWords,
  type ShenbiLevel, type ShenbiVocabularyItem,
} from "~/lib/shenbi";
import { speakChinese, stopSpeaking } from "~/lib/speech";

type GameMode = "stage" | "challenge";
type DisplayMode = "hanzi-pinyin" | "hanzi" | "pinyin" | "meaning";
type Difficulty = "slow" | "normal" | "fast";
type GamePhase = "setup" | "playing" | "result";

interface GameWord extends ShenbiVocabularyItem {
  answer: string;
  cluePinyin: string;
  clueMeaning: string;
}

interface FallingWord {
  id: number;
  lane: number;
  leftPercent: number;
  word: GameWord;
  fallSeconds: number;
}

interface GameStats {
  score: number;
  correctCount: number;
  missedCount: number;
  streak: number;
  longestStreak: number;
}

interface SavedAttempt {
  id: string;
  hskLevel: number;
  mode: string;
  score: number;
  correctCount: number;
  missedCount: number;
  accuracy: number;
  elapsedSeconds: number;
  createdAt: string;
}

interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  achievedAt: string | null;
}

interface ShenbiAssignment {
  id: string;
  classId: string;
  title: string;
  hskLevel: number;
  lessonFrom: number | null;
  lessonTo: number | null;
  mode: string;
  dueAt: string | null;
  class: { name: string };
}

interface ShenbiGameProps {
  user: { id: string; name: string };
  levels: ShenbiLevel[];
  stageProgress: Record<string, number>;
  classes: Array<{ id: string; name: string }>;
  recentAttempts: SavedAttempt[];
  assignments: ShenbiAssignment[];
}

const STAGE_SIZE = 10;
const FALL_LANES = [13, 31.5, 50, 68.5, 87];
const DISPLAY_OPTIONS: Array<{ id: DisplayMode; label: string; sample: string }> = [
  { id: "hanzi-pinyin", label: "Hán tự + pinyin", sample: "学校 · xuéxiào" },
  { id: "hanzi", label: "Chỉ Hán tự", sample: "学校" },
  { id: "pinyin", label: "Chỉ pinyin", sample: "xuéxiào" },
  { id: "meaning", label: "Nghĩa tiếng Việt", sample: "Trường học" },
];
const FALL_SPEED: Record<Difficulty, number> = { slow: 15, normal: 12, fast: 9 };

function chooseGameWord(source: ShenbiVocabularyItem): GameWord {
  const variants = [{
    answer: source.chinese,
    cluePinyin: source.pinyin,
    clueMeaning: source.translation,
  }];
  source.chineseAlternatives.forEach((answer, index) => {
    const cluePinyin = source.pinyinAlternatives[index];
    const clueMeaning = source.translationAlternatives[index];
    if (answer && cluePinyin && clueMeaning) variants.push({ answer, cluePinyin, clueMeaning });
  });
  const variant = variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
  return {
    ...source,
    ...variant,
  };
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function uniqueReviewWords(words: GameWord[]): GameWord[] {
  return [...new Map(words.map((word) => [word.id, word])).values()];
}

function shuffleWords(words: GameWord[]): GameWord[] {
  const shuffled = [...words];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function HanziStrokeInput({
  character,
  onComplete,
  onMistake,
  onLoadError,
  disabled,
  retryKey,
}: {
  character: string;
  onComplete: () => void;
  onMistake: () => void;
  onLoadError: () => void;
  disabled: boolean;
  retryKey: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  const callbacksRef = useRef({ onComplete, onMistake, onLoadError });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callbacksRef.current = { onComplete, onMistake, onLoadError };
  }, [onComplete, onLoadError, onMistake]);

  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterInstance | null = null;
    completedRef.current = false;
    setLoading(true);
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    void import("hanzi-writer").then(({ default: HanziWriter }) => {
      if (cancelled || !hostRef.current) return;
      writer = HanziWriter.create(hostRef.current, character, {
        width: 252,
        height: 252,
        padding: 18,
        showCharacter: false,
        showOutline: false,
        acceptBackwardsStrokes: false,
        showHintAfterMisses: 3,
        markStrokeCorrectAfterMisses: false,
        strokeColor: "#f7e9c3",
        drawingColor: "#f1c66b",
        drawingWidth: 7,
        highlightColor: "#f5cf7a",
        onLoadCharDataSuccess: () => {
          if (!cancelled) setLoading(false);
        },
        onLoadCharDataError: () => {
          if (!cancelled) {
            setLoading(false);
            callbacksRef.current.onLoadError();
          }
        },
      });
      writer.quiz({
        onComplete: () => {
          if (cancelled || completedRef.current) return;
          completedRef.current = true;
          callbacksRef.current.onComplete();
        },
        onMistake: () => {
          if (!cancelled) callbacksRef.current.onMistake();
        },
      });
    }).catch(() => {
      if (!cancelled) {
        setLoading(false);
        callbacksRef.current.onLoadError();
      }
    });

    return () => {
      cancelled = true;
      writer?.cancelQuiz();
      host.replaceChildren();
    };
  }, [character, retryKey]);

  return (
    <div className={`shenbi-writing-canvas ${disabled ? "is-disabled" : ""}`}>
      <div ref={hostRef} className="shenbi-writer-target" aria-label={`Vùng viết chữ Hán ${character}`} />
      {loading && (
        <div className="shenbi-canvas-loading" role="status">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Đang tải dữ liệu nét chữ…</span>
        </div>
      )}
    </div>
  );
}

function InkStudent() {
  return (
    <svg viewBox="0 0 124 148" role="img" aria-label="Học trò nhỏ cầm bút lông" className="shenbi-scholar">
      <ellipse cx="63" cy="139" rx="39" ry="7" fill="#060b17" opacity=".55" />
      <path d="M37 80c-12 8-20 23-22 48l19 8 24-19 25 19 24-8c-2-25-10-40-22-48z" fill="#6b2025" stroke="#f0c86c" strokeWidth="2" />
      <path d="M44 84l19 29 18-29-8-12H52z" fill="#f3e5c4" />
      <path d="M35 99l27 21 28-21-5 30-22 15-23-15z" fill="#922e2a" stroke="#e5b95d" strokeWidth="2" />
      <path d="M50 72c2 14 24 14 27 0l-2-13H52z" fill="#f3c9a6" />
      <ellipse cx="63" cy="48" rx="29" ry="31" fill="#f2c8a4" />
      <path d="M34 47c-2-26 13-38 31-38 19 0 31 16 26 40-5-7-8-14-10-24-11 11-27 15-47 13z" fill="#171a27" />
      <path d="M36 29C42 12 53 5 68 8c14 2 22 12 24 24-16-5-33-9-56-3z" fill="#171a27" />
      <path d="M51 53c3-4 7-4 10 0M68 53c3-4 7-4 10 0" fill="none" stroke="#392722" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M59 66c4 3 8 3 12 0" fill="none" stroke="#9e5948" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 109l-8-18 17-11 17 13-14 16z" fill="#f2c8a4" />
      <path d="M95 103l15-18 10 8-14 25-18-1z" fill="#f2c8a4" />
      <path d="M104 88l17-18 4 3-14 21z" fill="#d9b27c" />
      <path d="M117 69l4-13 3 1-1 14z" fill="#f2e5c6" />
      <path d="M55 116h16" stroke="#f0c86c" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function MoonlitHouse() {
  return (
    <svg viewBox="0 0 720 218" aria-hidden="true" className="shenbi-house">
      <path d="M0 166h720v52H0z" fill="#09101c" />
      <path d="M77 136h192v57H77zM462 136h184v57H462z" fill="#101321" />
      <path d="M54 141l119-87 119 87H54zM437 141l117-87 117 87H437z" fill="#181726" stroke="#b88d48" strokeWidth="4" />
      <path d="M38 141h270M421 141h267" stroke="#d4ae62" strokeWidth="5" strokeLinecap="round" />
      <path d="M73 135l100-72 105 72M455 135l99-72 102 72" fill="none" stroke="#7d2630" strokeWidth="8" />
      <path d="M166 141v52m22-52v52M552 141v52m23-52v52" stroke="#a57d48" strokeWidth="3" />
      <path d="M99 164h34v29H99zM214 164h31v29h-31zM482 164h31v29h-31zM600 164h29v29h-29z" fill="#e2a64e" opacity=".82" />
      <path d="M92 163h48M207 163h44M475 163h44M593 163h43" stroke="#f5d992" strokeWidth="3" opacity=".8" />
      <path d="M0 194h720" stroke="#ddc58c" strokeWidth="3" opacity=".68" />
      <path d="M11 202h698m-640-13v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23m43-23v23" stroke="#ab8750" strokeWidth="2" />
      <path d="M18 127v-33m-8 12h16m-12-8h8" stroke="#b58444" strokeWidth="2" />
      <path d="M0 103h37l-6-9H7zM3 109h31l-4 8H8z" fill="#a82d32" stroke="#edc26c" strokeWidth="1.5" />
      <path d="M699 119v-42m-9 13h18m-14-7h10" stroke="#b58444" strokeWidth="2" />
      <path d="M681 88h38l-7-9h-24zM685 95h30l-5 8h-20z" fill="#a82d32" stroke="#edc26c" strokeWidth="1.5" />
    </svg>
  );
}

export function ShenbiGame({
  user,
  levels,
  stageProgress,
  classes,
  recentAttempts,
  assignments,
}: ShenbiGameProps) {
  const fetcher = useFetcher<{ success?: boolean; accuracy?: number; unlockedStage?: number; error?: string }>();
  const leaderboardFetcher = useFetcher<{ scores?: LeaderboardRow[]; error?: string }>();
  const levelWithData = levels.find((level) => level.words.length > 0)?.level ?? null;
  const [selectedLevel, setSelectedLevel] = useState(levelWithData ?? 1);
  const [lessonRangeEnabled, setLessonRangeEnabled] = useState(false);
  const [lessonFrom, setLessonFrom] = useState("1");
  const [lessonTo, setLessonTo] = useState("1");
  const [mode, setMode] = useState<GameMode>("stage");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("hanzi-pinyin");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [phase, setPhase] = useState<GamePhase>("setup");
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const [gameError, setGameError] = useState("");
  const [recognitionError, setRecognitionError] = useState(false);
  const [recognitionHint, setRecognitionHint] = useState("");
  const [retryWriter, setRetryWriter] = useState(0);
  const [targets, setTargets] = useState<FallingWord[]>([]);
  const [activeTargetId, setActiveTargetId] = useState<number | null>(null);
  const [characterIndex, setCharacterIndex] = useState(0);
  const [unlockedStage, setUnlockedStage] = useState(1);
  const [requestedStage, setRequestedStage] = useState(1);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [missedCount, setMissedCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lives, setLives] = useState(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [roundPassed, setRoundPassed] = useState(false);
  const [resultAccuracy, setResultAccuracy] = useState(0);
  const [roundReviewWords, setRoundReviewWords] = useState<GameWord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const remainingWordsRef = useRef<GameWord[]>([]);
  const targetsRef = useRef<FallingWord[]>([]);
  const resolvedIdsRef = useRef(new Set<number>());
  const reviewWordsRef = useRef<GameWord[]>([]);
  const statsRef = useRef<GameStats>({ score: 0, correctCount: 0, missedCount: 0, streak: 0, longestStreak: 0 });
  const livesRef = useRef(3);
  const phaseRef = useRef<GamePhase>("setup");
  const startedAtRef = useRef(0);
  const pauseStartedAtRef = useRef(0);
  const lastSpawnAtRef = useRef(0);
  const targetIdRef = useRef(0);
  const roundFinishedRef = useRef(false);
  const roundConfigRef = useRef<{
    hskLevel: number;
    mode: GameMode;
    stageNumber: number;
    assignmentId: string | null;
    lessonFrom: number | null;
    lessonTo: number | null;
    total: number;
  }>({ hskLevel: 1, mode: "stage", stageNumber: 1, assignmentId: null, lessonFrom: null, lessonTo: null, total: 0 });
  const speechQueueRef = useRef<GameWord[]>([]);
  const queuedSpeechIdsRef = useRef(new Set<string>());
  const speechBusyRef = useRef(false);
  const speechPumpRef = useRef<() => void>(() => undefined);

  const selectedData = levels.find((level) => level.level === selectedLevel);
  const selectedAssignment = assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null;
  const availableWords = useMemo(() => {
    if (!selectedData) return [];
    if (!lessonRangeEnabled) return selectedData.words;
    const from = Number(lessonFrom);
    const to = Number(lessonTo);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return [];
    return selectedData.words.filter((word) => word.lesson >= from && word.lesson <= to);
  }, [lessonFrom, lessonRangeEnabled, lessonTo, selectedData]);
  const scopeFrom = lessonRangeEnabled ? Number(lessonFrom) : null;
  const scopeTo = lessonRangeEnabled ? Number(lessonTo) : null;
  const scopeKey = getShenbiScopeKey(scopeFrom, scopeTo);
  const currentMaxUnlocked = stageProgress[`${selectedLevel}:${scopeKey}`] ?? 1;
  const selectedStage = Math.min(requestedStage, Math.max(unlockedStage, currentMaxUnlocked));
  const selectedTarget = targets.find((target) => target.id === activeTargetId) ?? null;
  const activeCharacters = selectedTarget ? getHanziCharacters(selectedTarget.word.answer) : [];
  const currentCharacter = activeCharacters[characterIndex] ?? null;
  const challengeMode = mode === "challenge";
  const maxStage = Math.max(1, Math.ceil(availableWords.length / STAGE_SIZE));
  const stageRange = availableWords.length
    ? getStageWords(availableWords, selectedStage, STAGE_SIZE)
    : [];
  const displayedWords = challengeMode ? availableWords : stageRange;
  const leaderboardScores = leaderboardFetcher.data?.scores ?? [];

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const initialStage = stageProgress[`${selectedLevel}:${scopeKey}`] ?? 1;
    setUnlockedStage(initialStage);
    setRequestedStage((stage) => Math.min(stage, initialStage));
  }, [scopeKey, selectedLevel, stageProgress]);

  useEffect(() => {
    if (phase !== "setup") return;
    const query = new URLSearchParams({ hskLevel: String(selectedLevel), mode });
    if (selectedClassId) query.set("classId", selectedClassId);
    leaderboardFetcher.load(`/api/student/shenbi-attempts?${query}`);
  }, [mode, phase, selectedClassId, selectedLevel]);

  useEffect(() => {
    speechPumpRef.current = () => {
      if (isMuted || speechBusyRef.current || speechQueueRef.current.length === 0) return;
      const next = speechQueueRef.current.shift();
      if (!next) return;
      speechBusyRef.current = true;
      const started = speakChinese(next.answer, next.answer === next.chinese ? next.audioUrl : null, {
        preferAudio: true,
        preferCachedServerTts: next.answer === next.chinese,
        rate: 1,
        allowBrowserFallback: true,
        onPlaybackStateChange: (state) => {
          if (state !== "idle") return;
          speechBusyRef.current = false;
          speechPumpRef.current();
        },
      });
      if (!started) {
        speechBusyRef.current = false;
        setSpeechError(true);
        speechPumpRef.current();
      }
    };
  }, [isMuted]);

  useEffect(() => {
    return () => {
      speechQueueRef.current = [];
      stopSpeaking();
    };
  }, []);

  const enqueueSpeech = useCallback((word: GameWord) => {
    if (isMuted || queuedSpeechIdsRef.current.has(word.id)) return;
    queuedSpeechIdsRef.current.add(word.id);
    speechQueueRef.current.push(word);
    speechPumpRef.current();
  }, [isMuted]);

  const finishRound = useCallback(() => {
    if (roundFinishedRef.current || phaseRef.current !== "playing") return;
    roundFinishedRef.current = true;
    if (pauseStartedAtRef.current) {
      const pausedFor = Date.now() - pauseStartedAtRef.current;
      startedAtRef.current += pausedFor;
      lastSpawnAtRef.current += pausedFor;
      pauseStartedAtRef.current = 0;
    }
    const config = roundConfigRef.current;
    const elapsed = Math.max(1, Math.min(
      config.mode === "challenge" ? 60 : 3600,
      Math.floor((Date.now() - startedAtRef.current) / 1000),
    ));
    const completed = config.mode === "stage"
      && remainingWordsRef.current.length === 0
      && targetsRef.current.length === 0
      && statsRef.current.correctCount >= Math.ceil(config.total * 0.8);
    const reviewWords = uniqueReviewWords(reviewWordsRef.current);
    setElapsedSeconds(elapsed);
    setRoundPassed(completed);
    setResultAccuracy(getAccuracy(statsRef.current.correctCount, statsRef.current.missedCount));
    setRoundReviewWords(reviewWords);
    setIsPaused(false);
    setPhase("result");
    fetcher.submit({
      hskLevel: config.hskLevel,
      assignmentId: config.assignmentId,
      mode: config.mode,
      lessonFrom: config.lessonFrom,
      lessonTo: config.lessonTo,
      stageNumber: config.mode === "stage" ? config.stageNumber : 0,
      stageCompleted: completed,
      score: statsRef.current.score,
      correctCount: statsRef.current.correctCount,
      missedCount: statsRef.current.missedCount,
      elapsedSeconds: elapsed,
      reviewWords: reviewWords.map(({ answer, cluePinyin, clueMeaning, lesson }) => ({
        chinese: answer,
        pinyin: cluePinyin,
        translation: clueMeaning,
        lesson,
      })),
    }, { method: "post", action: "/api/student/shenbi-attempts", encType: "application/json" });
  }, [fetcher]);

  useEffect(() => {
    const nextUnlocked = fetcher.data?.unlockedStage;
    if (!fetcher.data?.success || typeof nextUnlocked !== "number") return;
    setUnlockedStage((current) => Math.max(current, nextUnlocked));
  }, [fetcher.data]);

  useEffect(() => {
    if (phase !== "playing" || isPaused) return;
    const lanes = window.innerWidth < 720 ? [0, 1, 2] : [0, 1, 2, 3, 4];
    const maximumTargets = lanes.length;
    const spawnEveryMs = mode === "challenge" ? 2100 : 2800;
    const timerId = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds((current) => current === elapsed ? current : elapsed);
      if (mode === "challenge" && elapsed >= 60) {
        finishRound();
        return;
      }
      if (targetsRef.current.length === 0 && remainingWordsRef.current.length === 0) {
        finishRound();
        return;
      }
      if (
        remainingWordsRef.current.length === 0
        || targetsRef.current.length >= maximumTargets
        || Date.now() - lastSpawnAtRef.current < spawnEveryMs
      ) return;

      const occupied = new Set(targetsRef.current.map((target) => target.lane));
      const freeLanes = lanes.filter((lane) => !occupied.has(lane));
      if (freeLanes.length === 0) return;
      const nextWord = remainingWordsRef.current.shift();
      if (!nextWord) return;
      const lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
      const laneCenters = lanes.length === 3 ? [16.5, 50, 83.5] : FALL_LANES;
      const elapsedSpeed = Math.floor(elapsed / 15) * 0.6;
      const stageSpeed = mode === "stage" ? (roundConfigRef.current.stageNumber - 1) * 0.35 : 0;
      const fallSeconds = Math.max(7, FALL_SPEED[difficulty] - elapsedSpeed - stageSpeed);
      const target = {
        id: ++targetIdRef.current,
        lane,
        leftPercent: laneCenters[lane],
        word: nextWord,
        fallSeconds,
      };
      lastSpawnAtRef.current = Date.now();
      targetsRef.current = [...targetsRef.current, target];
      setTargets(targetsRef.current);
      setActiveTargetId((current) => current ?? target.id);
      setCharacterIndex(0);
    }, 250);
    return () => window.clearInterval(timerId);
  }, [difficulty, finishRound, isPaused, mode, phase]);

  const removeTarget = useCallback((targetId: number) => {
    const nextTargets = targetsRef.current.filter((target) => target.id !== targetId);
    targetsRef.current = nextTargets;
    setTargets(nextTargets);
    if (activeTargetId === targetId) {
      setActiveTargetId(nextTargets[0]?.id ?? null);
      setCharacterIndex(0);
      setRecognitionError(false);
    }
  }, [activeTargetId]);

  const resolveMiss = useCallback((targetId: number) => {
    const target = targetsRef.current.find((item) => item.id === targetId);
    if (!target || resolvedIdsRef.current.has(targetId) || phaseRef.current !== "playing") return;
    resolvedIdsRef.current.add(targetId);
    reviewWordsRef.current.push(target.word);
    statsRef.current = {
      ...statsRef.current,
      missedCount: statsRef.current.missedCount + 1,
      streak: 0,
    };
    setMissedCount(statsRef.current.missedCount);
    setStreak(0);
    enqueueSpeech(target.word);
    // Tạm thời tắt mạng/trừ mạng trong giai đoạn thử nghiệm.
    livesRef.current = 3;
    setLives(3);
    removeTarget(targetId);
  }, [enqueueSpeech, removeTarget]);

  const resolveCorrect = useCallback((target: FallingWord) => {
    if (resolvedIdsRef.current.has(target.id) || phaseRef.current !== "playing") return;
    resolvedIdsRef.current.add(target.id);
    const nextStreak = statsRef.current.streak + 1;
    const bonus = nextStreak % 5 === 0 ? 20 : 0;
    statsRef.current = {
      ...statsRef.current,
      score: statsRef.current.score + 10 + bonus,
      correctCount: statsRef.current.correctCount + 1,
      streak: nextStreak,
      longestStreak: Math.max(statsRef.current.longestStreak, nextStreak),
    };
    setScore(statsRef.current.score);
    setCorrectCount(statsRef.current.correctCount);
    setStreak(nextStreak);
    enqueueSpeech(target.word);
    removeTarget(target.id);
  }, [enqueueSpeech, removeTarget]);

  const startRound = useCallback(() => {
    const level = levels.find((item) => item.level === selectedLevel);
    if (!level || availableWords.length === 0) {
      setGameError("Chưa có từ vựng trong phạm vi đã chọn. Hãy chọn bài khác hoặc bổ sung dữ liệu HSK 3.0.");
      return;
    }
    const stageNumber = mode === "stage" ? selectedStage : 0;
    const sourceWords = mode === "stage"
      ? getStageWords(availableWords, stageNumber, STAGE_SIZE)
      : availableWords;
    if (mode === "stage" && stageNumber > unlockedStage) {
      setGameError("Hãy hoàn thành chặng trước để mở khóa chặng này.");
      return;
    }
    if (sourceWords.length === 0) {
      setGameError("Chặng này chưa có từ vựng. Chọn chặng khác trong phạm vi bài đã chọn.");
      return;
    }

    const preparedWords = shuffleWords(sourceWords.map(chooseGameWord));
    const totalWords = preparedWords.length;
    const firstWord = preparedWords.shift();
    if (!firstWord) {
      setGameError("Không có từ vựng hợp lệ để bắt đầu lượt chơi.");
      return;
    }
    roundConfigRef.current = {
      hskLevel: selectedLevel,
      mode,
      stageNumber,
      assignmentId: selectedAssignment?.id ?? null,
      lessonFrom: scopeFrom,
      lessonTo: scopeTo,
      total: totalWords,
    };
    remainingWordsRef.current = preparedWords;
    const laneCount = window.innerWidth < 720 ? 3 : 5;
    const laneIndex = Math.floor(Math.random() * laneCount);
    const laneCenters = laneCount === 3 ? [16.5, 50, 83.5] : FALL_LANES;
    const firstTarget: FallingWord = {
      id: 1,
      lane: laneIndex,
      leftPercent: laneCenters[laneIndex] ?? 50,
      word: firstWord,
      fallSeconds: FALL_SPEED[difficulty],
    };
    targetsRef.current = [firstTarget];
    resolvedIdsRef.current = new Set();
    reviewWordsRef.current = [];
    speechQueueRef.current = [];
    queuedSpeechIdsRef.current = new Set();
    statsRef.current = { score: 0, correctCount: 0, missedCount: 0, streak: 0, longestStreak: 0 };
    livesRef.current = 3;
    roundFinishedRef.current = false;
    speechBusyRef.current = false;
    stopSpeaking();
    startedAtRef.current = Date.now();
    pauseStartedAtRef.current = 0;
    lastSpawnAtRef.current = Date.now();
    targetIdRef.current = firstTarget.id;
    setTargets([firstTarget]);
    setActiveTargetId(firstTarget.id);
    setCharacterIndex(0);
    setScore(0);
    setCorrectCount(0);
    setMissedCount(0);
    setStreak(0);
    setLives(3);
    setElapsedSeconds(0);
    setRoundTotal(totalWords);
    setRoundPassed(false);
    setRoundReviewWords([]);
    setResultAccuracy(0);
    setRecognitionError(false);
    setRecognitionHint("");
    setSpeechError(false);
    setGameError("");
    setIsPaused(false);
    setPhase("playing");
  }, [availableWords, difficulty, levels, mode, scopeFrom, scopeTo, selectedAssignment, selectedLevel, selectedStage, unlockedStage]);

  const handleCharacterComplete = useCallback(() => {
    if (!selectedTarget || !currentCharacter) return;
    setRecognitionHint("");
    if (characterIndex < activeCharacters.length - 1) {
      setCharacterIndex((index) => index + 1);
      return;
    }
    resolveCorrect(selectedTarget);
  }, [activeCharacters.length, characterIndex, currentCharacter, resolveCorrect, selectedTarget]);

  const togglePause = () => {
    if (!isPaused) {
      pauseStartedAtRef.current = Date.now();
      speechQueueRef.current = [];
      speechBusyRef.current = false;
      stopSpeaking();
    } else if (pauseStartedAtRef.current) {
      const pausedFor = Date.now() - pauseStartedAtRef.current;
      startedAtRef.current += pausedFor;
      lastSpawnAtRef.current += pausedFor;
      pauseStartedAtRef.current = 0;
    }
    setIsPaused((paused) => !paused);
  };

  const toggleSound = () => {
    if (!isMuted) {
      speechQueueRef.current = [];
      speechBusyRef.current = false;
      stopSpeaking();
    }
    setIsMuted((muted) => !muted);
  };

  const selectLevel = (level: number) => {
    setSelectedLevel(level);
    setLessonRangeEnabled(false);
    setLessonFrom("1");
    setLessonTo("1");
    setRequestedStage(1);
    setGameError("");
  };

  const retryRecognition = () => {
    setRecognitionError(false);
    setRecognitionHint("");
    setRetryWriter((key) => key + 1);
  };

  return (
    <main className="shenbi-page" lang="vi">
      <div className="shenbi-sky" aria-hidden="true">
        <div className="shenbi-moon" />
        <div className="shenbi-stars">
          {Array.from({ length: 28 }, (_, index) => (
            <i key={index} style={{
              left: `${(index * 37 + 11) % 100}%`,
              top: `${(index * 53 + 6) % 54}%`,
              animationDelay: `${(index % 7) * -0.8}s`,
            }} />
          ))}
        </div>
        <div className="shenbi-snow">
          {Array.from({ length: 22 }, (_, index) => (
            <i key={index} style={{
              left: `${(index * 29 + 4) % 100}%`,
              animationDelay: `${(index % 9) * -1.7}s`,
              animationDuration: `${9 + (index % 6) * 2}s`,
            }} />
          ))}
        </div>
      </div>

      <header className="shenbi-topbar">
        <Link className="shenbi-back" to="/student" aria-label="Trở về trang học viên">
          <ArrowLeft size={17} />
          <span>Không gian học</span>
        </Link>
        <div className="shenbi-brand">
          <span className="shenbi-seal" aria-hidden="true"><WandSparkles size={18} /></span>
          <span>TIẾNG TRUNG DƯƠNG HỮU</span>
        </div>
        <div className="shenbi-account">
          <span className="shenbi-account-dot" />
          <span>{user.name}</span>
        </div>
      </header>

      <div className="shenbi-scene">
        <MoonlitHouse />
        <div className="shenbi-mountain shenbi-mountain-back" />
        <div className="shenbi-mountain shenbi-mountain-front" />
      </div>

      {phase === "setup" && (
        <section className="shenbi-setup">
          <div className="shenbi-title">
            <div className="shenbi-title-seal" aria-hidden="true">筆</div>
            <div>
              <h1>THẦN BÚT</h1>
              <p>Viết nên từng nét · Ghi nhớ từng từ</p>
            </div>
          </div>
          <div className="shenbi-setup-grid">
            <section className="shenbi-config-panel" aria-labelledby="shenbi-config-title">
              <div className="shenbi-section-heading">
                <span className="shenbi-step-mark">一</span>
                <div>
                  <h2 id="shenbi-config-title">Chọn từ vựng</h2>
                  <p>Chỉ dùng dữ liệu HSK 3.0 đã có trong khóa học.</p>
                </div>
              </div>

              {assignments.length > 0 && (
                <label className="shenbi-assignment-select">
                  <span>Bài giáo viên giao</span>
                  <span className="shenbi-select-wrap">
                    <select
                      value={selectedAssignmentId}
                      onChange={(event) => {
                        const assignmentId = event.currentTarget.value;
                        const assignment = assignments.find((item) => item.id === assignmentId);
                        setSelectedAssignmentId(assignmentId);
                        if (!assignment) {
                          setGameError("");
                          return;
                        }
                        setSelectedLevel(assignment.hskLevel);
                        setMode(assignment.mode === "challenge" ? "challenge" : "stage");
                        setSelectedClassId(assignment.classId);
                        setLessonRangeEnabled(assignment.lessonFrom !== null && assignment.lessonTo !== null);
                        setLessonFrom(String(assignment.lessonFrom ?? 1));
                        setLessonTo(String(assignment.lessonTo ?? 1));
                        setRequestedStage(1);
                        setGameError("");
                      }}
                    >
                      <option value="">Tự chọn bộ từ</option>
                      {assignments.map((assignment) => (
                        <option key={assignment.id} value={assignment.id}>
                          {assignment.title} · {assignment.class.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={15} />
                  </span>
                  {selectedAssignment && (
                    <small>
                      {selectedAssignment.class.name} · HSK {selectedAssignment.hskLevel === 7 ? "7–9" : selectedAssignment.hskLevel}
                      {selectedAssignment.lessonFrom !== null && selectedAssignment.lessonTo !== null
                        ? ` · Bài ${selectedAssignment.lessonFrom}–${selectedAssignment.lessonTo}`
                        : " · Toàn cấp"}
                      {selectedAssignment.dueAt ? ` · Hạn ${new Date(selectedAssignment.dueAt).toLocaleDateString("vi-VN")}` : ""}
                    </small>
                  )}
                </label>
              )}

              <div className="shenbi-levels" role="group" aria-label="Cấp độ HSK">
                {levels.filter((level) => level.words.length > 0).map((level) => (
                  <button
                    key={level.level}
                    type="button"
                    disabled={selectedAssignment ? selectedAssignment.hskLevel !== level.level : false}
                    aria-pressed={selectedLevel === level.level}
                    className={`shenbi-level ${selectedLevel === level.level ? "is-selected" : ""}`}
                    aria-label={`HSK ${level.level === 7 ? "7 đến 9" : level.level}, ${level.words.length} từ`}
                    onClick={() => selectLevel(level.level)}
                  >
                    <strong>{level.level === 7 ? "7–9" : level.level}</strong>
                    <span>HSK</span>
                    <small>{level.words.length} từ</small>
                  </button>
                ))}
              </div>

              <div className="shenbi-divider" />
              <div className="shenbi-section-heading shenbi-subheading">
                <span className="shenbi-step-mark">二</span>
                <div>
                  <h2>Phạm vi bài học</h2>
                  <p>{availableWords.length} từ đủ điều kiện trong lựa chọn hiện tại.</p>
                </div>
              </div>
              <label className="shenbi-toggle-row">
                <input
                  type="checkbox"
                  checked={lessonRangeEnabled}
                  onChange={(event) => {
                    setLessonRangeEnabled(event.currentTarget.checked);
                    setRequestedStage(1);
                    setGameError("");
                  }}
                  disabled={!selectedData?.lessons.length || Boolean(selectedAssignment)}
                />
                <span className="shenbi-toggle-track" aria-hidden="true" />
                <span>Chọn theo khoảng bài</span>
                <span className="shenbi-toggle-hint">Mặc định: toàn cấp</span>
              </label>
              {lessonRangeEnabled && (
                <div className="shenbi-range">
                  <label>
                    <span>Từ bài</span>
                    <span className="shenbi-select-wrap">
                      <select value={lessonFrom} disabled={Boolean(selectedAssignment)} onChange={(event) => {
                        setLessonFrom(event.currentTarget.value);
                        setRequestedStage(1);
                      }}>
                        {selectedData?.lessons.map((lesson) => (
                          <option key={lesson.order} value={lesson.order}>Bài {lesson.order}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} />
                    </span>
                  </label>
                  <ArrowRight size={16} aria-hidden="true" />
                  <label>
                    <span>Đến bài</span>
                    <span className="shenbi-select-wrap">
                      <select value={lessonTo} disabled={Boolean(selectedAssignment)} onChange={(event) => {
                        setLessonTo(event.currentTarget.value);
                        setRequestedStage(1);
                      }}>
                        {selectedData?.lessons.map((lesson) => (
                          <option key={lesson.order} value={lesson.order}>Bài {lesson.order}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} />
                    </span>
                  </label>
                </div>
              )}
              {lessonRangeEnabled && Number(lessonFrom) > Number(lessonTo) && (
                <p className="shenbi-data-note" role="alert">Bài bắt đầu phải nhỏ hơn hoặc bằng bài kết thúc.</p>
              )}

              <div className="shenbi-divider" />
              <div className="shenbi-section-heading shenbi-subheading">
                <span className="shenbi-step-mark">三</span>
                <div>
                  <h2>Chọn lối chơi</h2>
                  <p>Chặng đường dài hay một phút tập trung.</p>
                </div>
              </div>
              <div className="shenbi-mode-switch" role="group" aria-label="Chế độ chơi">
                <button type="button" disabled={Boolean(selectedAssignment)} className={mode === "stage" ? "is-selected" : ""} aria-pressed={mode === "stage"} onClick={() => setMode("stage")}>
                  <BookOpen size={17} />
                  <span><strong>Vượt ải</strong><small>10 từ mỗi chặng</small></span>
                </button>
                <button type="button" disabled={Boolean(selectedAssignment)} className={mode === "challenge" ? "is-selected" : ""} aria-pressed={mode === "challenge"} onClick={() => setMode("challenge")}>
                  <Clock3 size={17} />
                  <span><strong>Thử thách</strong><small>60 giây không ngừng</small></span>
                </button>
              </div>

              {mode === "stage" && (
                <div className="shenbi-stage-picker" aria-label="Chặng đã mở khóa">
                  <div className="shenbi-stage-label">Chặng {selectedStage} / {maxStage}</div>
                  <div className="shenbi-stage-list">
                    {Array.from({ length: maxStage }, (_, index) => {
                      const stage = index + 1;
                      const isUnlocked = stage <= Math.max(unlockedStage, currentMaxUnlocked);
                      return (
                        <button
                          key={stage}
                          type="button"
                          disabled={!isUnlocked}
                          aria-label={`Chặng ${stage}${isUnlocked ? "" : " chưa mở khóa"}`}
                          aria-pressed={stage === selectedStage}
                          className={`${stage === selectedStage ? "is-selected" : ""} ${isUnlocked ? "" : "is-locked"}`}
                          onClick={() => {
                            setRequestedStage(stage);
                            setGameError("");
                          }}
                        >
                          {isUnlocked ? stage : "·"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="shenbi-options-row">
                <label>
                  <span>Hiển thị từ</span>
                  <span className="shenbi-select-wrap">
                    <select value={displayMode} onChange={(event) => setDisplayMode(event.currentTarget.value as DisplayMode)}>
                      {DISPLAY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    <ChevronDown size={15} />
                  </span>
                </label>
                <label>
                  <span>Tốc độ rơi</span>
                  <span className="shenbi-select-wrap">
                    <select value={difficulty} onChange={(event) => setDifficulty(event.currentTarget.value as Difficulty)}>
                      <option value="slow">Thư thả</option>
                      <option value="normal">Vừa phải</option>
                      <option value="fast">Nhanh</option>
                    </select>
                    <ChevronDown size={15} />
                  </span>
                </label>
              </div>

              <div className="shenbi-recognition-note">
                <WandSparkles size={17} />
                <span>Nét bút được nhận diện theo thứ tự chuẩn của chữ. Với từ có đáp án thay thế, trò chơi dùng một biến thể đã ghi trong dữ liệu từ vựng cho mỗi lượt.</span>
              </div>
              {gameError && <p className="shenbi-error" role="alert">{gameError}</p>}
              <Button
                type="button"
                className="shenbi-start"
                disabled={!availableWords.length || (lessonRangeEnabled && Number(lessonFrom) > Number(lessonTo))}
                onClick={startRound}
              >
                Bắt đầu viết
                <ArrowRight size={17} />
              </Button>
            </section>

            <aside className="shenbi-side-panel">
              <div className="shenbi-paper-card">
                <div className="shenbi-paper-top">
                  <span className="shenbi-paper-seal">學</span>
                  <div>
                    <span className="shenbi-paper-label">LỜI NHẮN TỪ THẦY ĐỒ</span>
                    <h2>Nhất nét thành chữ</h2>
                  </div>
                </div>
                <p>Mỗi chữ được viết bằng từng nét bút thật. Hãy giữ nhịp thở đều, nhìn kỹ chữ đang rơi và viết theo đúng thứ tự.</p>
                <button type="button" className="shenbi-rules-toggle" aria-expanded={showRules} onClick={() => setShowRules((shown) => !shown)}>
                  Luật chơi <ChevronDown size={15} className={showRules ? "is-open" : ""} />
                </button>
                {showRules && (
                  <ul className="shenbi-rules">
                    <li>Viết đúng một từ: <strong>+10 điểm</strong>.</li>
                    <li>Đúng liên tiếp 5 từ: thưởng <strong>+20 điểm</strong>.</li>
                    <li>Bỏ lỡ một từ: vẫn tiếp tục chơi, tạm thời không trừ mạng trong giai đoạn thử nghiệm.</li>
                    <li>Từ ghép phải viết đủ từng chữ Hán mới tính điểm.</li>
                  </ul>
                )}
              </div>

              <div className="shenbi-ranking-panel">
                <div className="shenbi-ranking-heading">
                  <div className="shenbi-ranking-icon"><Crown size={17} /></div>
                  <div><h2>Bảng xếp hạng</h2><p>Điểm cao nhất · {mode === "stage" ? "Vượt ải" : "60 giây"}</p></div>
                </div>
                <div className="shenbi-ranking-filters">
                  <label>
                    <span className="sr-only">Phạm vi bảng xếp hạng</span>
                    <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.currentTarget.value)}>
                      <option value="">Toàn trung tâm</option>
                      {classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                </div>
                <ol className="shenbi-ranking-list">
                  {leaderboardFetcher.state !== "idle" && leaderboardScores.length === 0
                    ? <li className="shenbi-ranking-empty"><Loader2 size={16} className="animate-spin" /> Đang tải bảng điểm</li>
                    : leaderboardScores.length > 0
                      ? leaderboardScores.slice(0, 5).map((row) => (
                        <li key={`${row.rank}-${row.name}`} className={row.rank === 1 ? "is-first" : ""}>
                          <span className="shenbi-rank-number">{String(row.rank).padStart(2, "0")}</span>
                          <span className="shenbi-rank-name">{row.name}</span>
                          <strong>{row.score}<small>đ</small></strong>
                        </li>
                      ))
                      : <li className="shenbi-ranking-empty">
                        {leaderboardFetcher.data?.error ?? "Chưa có lượt chơi nào trong bảng này."}
                      </li>}
                </ol>
                <p className="shenbi-ranking-caption">HSK {selectedLevel === 7 ? "7–9" : selectedLevel} · Điểm cao nhất mỗi học viên</p>
              </div>
              <button type="button" className="shenbi-history-toggle" onClick={() => setShowHistory((shown) => !shown)} aria-expanded={showHistory}>
                Lịch sử luyện tập <ChevronDown size={15} className={showHistory ? "is-open" : ""} />
              </button>
              {showHistory && (
                <div className="shenbi-history-list">
                  {recentAttempts.length === 0
                    ? <p>Hoàn thành lượt đầu tiên để lưu lịch sử.</p>
                    : recentAttempts.map((attempt) => (
                      <div key={attempt.id}>
                        <span>HSK {attempt.hskLevel} · {attempt.mode === "challenge" ? "60 giây" : "Vượt ải"}</span>
                        <strong>{attempt.score} điểm</strong>
                        <small>{new Date(attempt.createdAt).toLocaleDateString("vi-VN")} · chính xác {attempt.accuracy}%</small>
                      </div>
                    ))}
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {phase === "playing" && (
        <section className={`shenbi-play ${isPaused ? "is-paused" : ""}`} aria-label="Màn chơi Thần Bút">
          <div className="shenbi-hud">
            <div className="shenbi-score-cluster">
              <div className="shenbi-score-readout"><span>ĐIỂM</span><strong>{String(score).padStart(4, "0")}</strong></div>
              <span className="shenbi-hud-divider" />
              <div className="shenbi-hsk-readout"><strong>HSK {selectedLevel === 7 ? "7–9" : selectedLevel}</strong><span>{mode === "stage" ? `Chặng ${selectedStage}` : "Thử thách 60s"}</span></div>
            </div>
            <div className="shenbi-hud-actions">
              {mode === "challenge" && <div className={`shenbi-time ${elapsedSeconds >= 50 ? "is-urgent" : ""}`} aria-label={`${Math.max(0, 60 - elapsedSeconds)} giây còn lại`}>{formatTime(Math.max(0, 60 - elapsedSeconds))}</div>}
              <div className="shenbi-hearts" aria-label={`Còn ${lives} trên 3 trái tim`}>
                {[0, 1, 2].map((heart) => <Heart key={heart} size={19} fill={heart < lives ? "currentColor" : "transparent"} className={heart < lives ? "is-alive" : "is-lost"} />)}
              </div>
              <button type="button" className="shenbi-icon-button" onClick={toggleSound} aria-label={isMuted ? "Bật âm thanh" : "Tắt âm thanh"} aria-pressed={!isMuted}>
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <button type="button" className="shenbi-icon-button" onClick={togglePause} aria-label={isPaused ? "Tiếp tục" : "Tạm dừng"}>
                {isPaused ? <Play size={18} /> : <Pause size={18} />}
              </button>
              <button type="button" className="shenbi-exit-button" onClick={finishRound} aria-label="Kết thúc lượt chơi"><X size={18} /></button>
            </div>
          </div>

          <div className="shenbi-game-field" aria-label="Các từ vựng đang rơi">
            <div className="shenbi-cloud shenbi-cloud-one" aria-hidden="true" />
            <div className="shenbi-cloud shenbi-cloud-two" aria-hidden="true" />
            {targets.map((target) => {
              const isSelected = target.id === activeTargetId;
              const display = displayMode === "meaning"
                ? target.word.clueMeaning
                : displayMode === "pinyin"
                  ? target.word.cluePinyin
                  : displayMode === "hanzi-pinyin"
                    ? `${target.word.answer} ${target.word.cluePinyin}`
                    : target.word.answer;
              return (
                <button
                  type="button"
                  key={target.id}
                  className={`shenbi-falling-word ${isSelected ? "is-selected" : ""} ${displayMode === "pinyin" || displayMode === "meaning" ? "is-clue" : ""}`}
                  style={{
                    left: `${target.leftPercent ?? FALL_LANES[2]}%`,
                    animationPlayState: isPaused || isSelected ? "paused" : "running",
                    "--fall-duration": `${target.fallSeconds}s`,
                  } as CSSProperties & { "--fall-duration": string }}
                  aria-pressed={isSelected}
                  aria-label={`Chọn từ đang rơi: ${display}`}
                  onClick={() => {
                    setActiveTargetId(target.id);
                    setCharacterIndex(0);
                    setRecognitionError(false);
                    setRecognitionHint("");
                  }}
                  onAnimationEnd={() => resolveMiss(target.id)}
                >
                  <span>{display}</span>
                  {isSelected && <i aria-hidden="true" />}
                </button>
              );
            })}
            {targets.length === 0 && (
              <div className="shenbi-field-whisper" aria-live="polite">
                <span className="shenbi-whisper-dot" />
                Chữ sắp xuất hiện…
              </div>
            )}
            <div className="shenbi-field-progress">
              <span>{correctCount} đúng</span>
              <span className="shenbi-progress-track"><i style={{ width: `${roundTotal ? Math.min(100, (correctCount / roundTotal) * 100) : 0}%` }} /></span>
              <span>{roundTotal} từ</span>
            </div>
            <div className="shenbi-ground" aria-hidden="true" />
            <div className="shenbi-play-house" aria-hidden="true"><MoonlitHouse /></div>
            <div className="shenbi-playing-scholar"><InkStudent /></div>
          </div>

          <div className="shenbi-writing-panel">
            <div className="shenbi-writing-instruction">
              <div className="shenbi-character-count">
                <span className="shenbi-ink-drop" aria-hidden="true" />
                <div>
                  <strong>{selectedTarget ? `Viết chữ ${characterIndex + 1} / ${activeCharacters.length}` : "Chọn một chữ đang rơi"}</strong>
                  <span>{selectedTarget ? `Bài ${selectedTarget.word.lesson} · ${selectedTarget.word.cluePinyin} · Kéo từng nét; từ đã chọn đứng yên` : "Chạm vào từ để chọn mục tiêu"}</span>
                </div>
              </div>
              {recognitionHint && <span className="shenbi-hint">{recognitionHint}</span>}
              <div className="shenbi-writing-actions">
                <span className="shenbi-writing-legend"><i /> Nét bút của bạn</span>
                {recognitionError
                  ? <button type="button" className="shenbi-clear-button" onClick={retryRecognition}><RotateCcw size={15} /> Tải lại nét chữ</button>
                  : <button type="button" className="shenbi-clear-button" onClick={retryRecognition} disabled={!selectedTarget}><Eraser size={15} /> Viết lại</button>}
              </div>
            </div>
            <div className="shenbi-canvas-frame">
              {selectedTarget && currentCharacter && !recognitionError && (
                <HanziStrokeInput
                  key={`${selectedTarget.id}-${characterIndex}-${retryWriter}`}
                  character={currentCharacter}
                  disabled={isPaused}
                  retryKey={retryWriter}
                  onComplete={handleCharacterComplete}
                  onMistake={() => setRecognitionHint("Nét chưa đúng thứ tự. Hãy thử lại chậm hơn.")}
                  onLoadError={() => setRecognitionError(true)}
                />
              )}
              {selectedTarget && recognitionError && (
                <div className="shenbi-recognition-error" role="alert">
                  <WandSparkles size={22} />
                  <strong>Không tải được dữ liệu nét chữ</strong>
                  <span>Kiểm tra kết nối internet rồi thử tải lại. Chữ chưa được tính đúng.</span>
                  <button type="button" onClick={retryRecognition}>Thử lại</button>
                </div>
              )}
              {!selectedTarget && (
                <div className="shenbi-no-target">
                  <span className="shenbi-practice-character" aria-hidden="true">筆</span>
                  <span>Chọn một từ đang rơi để bắt đầu viết</span>
                </div>
              )}
              {isPaused && <div className="shenbi-pause-wash" aria-label="Trò chơi đang tạm dừng" />}
            </div>
            {speechError && <p className="shenbi-speech-status" role="status">Âm thanh chưa sẵn sàng trên thiết bị này. Bật lại âm thanh hoặc kiểm tra kết nối.</p>}
          </div>

          {isPaused && (
            <div className="shenbi-pause-screen" role="dialog" aria-modal="true" aria-labelledby="shenbi-pause-title">
              <div className="shenbi-pause-card">
                <span className="shenbi-pause-stamp"><Pause size={24} /></span>
                <h2 id="shenbi-pause-title">Tạm nghỉ một lát</h2>
                <p>Thời gian và chữ rơi đang dừng. Khi sẵn sàng, hãy tiếp tục hành trình.</p>
                <Button type="button" onClick={togglePause}><Play size={16} /> Tiếp tục viết</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {phase === "result" && (
        <section className="shenbi-result" aria-labelledby="shenbi-result-title">
          <div className={`shenbi-result-seal ${roundPassed ? "is-clear" : ""}`} aria-hidden="true">
            {roundPassed ? <Check size={30} /> : <WandSparkles size={29} />}
          </div>
          <p className="shenbi-result-kicker">{roundPassed ? "CHẶNG ĐÃ HOÀN THÀNH" : mode === "challenge" ? "HẾT THỜI GIAN" : "HÀNH TRÌNH TẠM DỪNG"}</p>
          <h1 id="shenbi-result-title">{roundPassed ? "Nét bút đã thành công" : "Mỗi nét viết là một bước tiến"}</h1>
          <p className="shenbi-result-copy">
            {fetcher.state !== "idle" ? "Đang lưu kết quả vào hồ sơ học tập…" : fetcher.data?.error ?? "Kết quả đã được ghi lại cho lần ôn tập sau."}
          </p>
          <div className="shenbi-result-score"><strong>{score}</strong><span>điểm</span></div>
          <div className="shenbi-result-stats">
            <div><span>Viết đúng</span><strong>{correctCount}</strong></div>
            <div><span>Bỏ lỡ</span><strong>{missedCount}</strong></div>
            <div><span>Chính xác</span><strong>{resultAccuracy}%</strong></div>
            <div><span>Thời gian</span><strong>{formatTime(elapsedSeconds)}</strong></div>
          </div>
          {roundReviewWords.length > 0 && (
            <div className="shenbi-review-list">
              <h2>Từ cần ôn lại <span>{roundReviewWords.length}</span></h2>
              <ul>
                {roundReviewWords.map((word) => (
                  <li key={`${word.id}-${word.answer}`}>
                    <strong>{word.answer}</strong>
                    <span>{word.cluePinyin}</span>
                    <small>{word.clueMeaning}</small>
                    <em>Bài {word.lesson}</em>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fetcher.data?.success && roundPassed && (
            <p className="shenbi-unlock-message" role="status">Đã mở khóa chặng {fetcher.data.unlockedStage}.</p>
          )}
          <div className="shenbi-result-actions">
            <Button type="button" variant="outline" onClick={() => {
              setRequestedStage(selectedStage);
              setPhase("setup");
            }}><ArrowLeft size={16} /> Về chọn bài</Button>
            <Button type="button" onClick={startRound}><RotateCcw size={16} /> Chơi lại</Button>
          </div>
          <Link className="shenbi-exit-link" to="/student">Trở về trang học viên</Link>
        </section>
      )}

      <footer className="shenbi-footer">
        <span>「提笔即是练习，落笔便有进步」</span>
        <span>THẦN BÚT · Luyện viết HSK 3.0</span>
      </footer>
    </main>
  );
}
