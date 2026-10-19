import { useMemo, useRef, useState } from "react";
import { Check, Eye, Headphones, Pause, RotateCcw, X } from "lucide-react";
import { AudioSeekBar } from "~/components/audio/audio-seek-bar";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import type { PhoneticsConfig, PhoneticsItem, PhoneticsSection } from "~/lib/learning-blocks";
import { TONES, isPhoneticsAnswerCorrect, type PhoneticsAnswer } from "~/lib/phonetics";

const playbackRates = [0.8, 1, 1.5] as const;

/** Điểm đã lưu của một section, đọc từ LessonTabAttempt. */
export interface PhoneticsSectionScore {
  score: number | null;
  correctCount: number | null;
  totalCount: number | null;
}

export interface PhoneticsSectionReview {
  targetKey: string;
  title: string;
  correctCount: number | null;
  totalCount: number | null;
  results: {
    id: string;
    prompt: string;
    given: string;
    correctAnswer: string;
    completeAnswer: string | null;
    correct: boolean | null;
  }[];
}

interface PhoneticsPracticeProps {
  config: PhoneticsConfig;
  /** Điểm cao nhất mỗi section, key = `section.id` */
  savedScores: Record<number, PhoneticsSectionScore>;
  reviewGroups: PhoneticsSectionReview[];
  submissionResult: PhoneticsSectionReview | null;
  isSaving: boolean;
  submissionError: string | null;
  onSubmitSection: (sectionId: number, answers: { itemId: number; answer: string }[]) => void;
}

/** Ô nhập của một câu, khác nhau theo dạng: initial / final / tone. */
function PhoneticsItemInput({
  item,
  number,
  value,
  checked,
  disabled,
  onChange,
}: {
  item: PhoneticsItem;
  number: number;
  value: PhoneticsAnswer;
  checked: boolean;
  disabled: boolean;
  onChange: (value: PhoneticsAnswer) => void;
}) {
  const correct = isPhoneticsAnswerCorrect(item, value);
  const inputId = `phonetics-${item.type}-${number}`;
  const label = item.type === "initial"
    ? `Thanh mẫu câu ${number}`
    : item.type === "final"
      ? `Vận mẫu câu ${number}`
      : `Thanh điệu câu ${number}`;

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        checked
          ? correct
            ? "border-success/50 bg-success/5"
            : "border-destructive/40 bg-destructive/5"
          : "border-primary/20",
      )}
    >
      <span className="block text-xs text-muted-foreground">Câu {number}</span>

      {item.type === "tone" ? (
        <>
          <span className="mt-1 block text-center text-lg font-medium" lang="zh-Latn">
            {item.syllable}
          </span>
          <div className="mt-1.5 flex justify-center gap-1" role="group" aria-label={label}>
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                aria-pressed={Number(value) === tone}
                disabled={disabled}
                onClick={() => onChange(Number(value) === tone ? null : tone)}
                className={cn(
                  "h-7 w-7 rounded-md border text-xs font-medium transition-colors",
                  Number(value) === tone
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/20 text-muted-foreground hover:bg-muted",
                )}
              >
                {tone}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="mt-1.5 flex items-center justify-center gap-1.5">
          {item.type === "final" && (
            <span className="min-w-6 text-right text-lg font-medium" lang="zh-Latn">{item.given}</span>
          )}
          <label className="sr-only" htmlFor={inputId}>{label}</label>
          <input
            id={inputId}
            type="text"
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            lang="zh-Latn"
            className="h-8 w-14 rounded-md border border-primary/20 bg-background px-1 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {item.type === "initial" && (
            <span className="min-w-6 text-lg font-medium" lang="zh-Latn">{item.given}</span>
          )}
        </span>
      )}

    </div>
  );
}

function PhoneticsSectionCard({
  section,
  number,
  savedScore,
  reviewGroup,
  isSaving,
  onSubmit,
}: {
  section: PhoneticsSection;
  number: number;
  savedScore: PhoneticsSectionScore | null;
  reviewGroup: PhoneticsSectionReview | null;
  isSaving: boolean;
  onSubmit: (answers: { itemId: number; answer: string }[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, PhoneticsAnswer>>({});
  const [checked, setChecked] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<(typeof playbackRates)[number]>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const correctCount = useMemo(
    () => section.items.filter((item) => isPhoneticsAnswerCorrect(item, answers[item.id])).length,
    [section.items, answers],
  );
  const answeredCount = section.items.filter((item) => {
    const value = answers[item.id];
    return item.type === "tone" ? value != null && value !== "" : typeof value === "string" && value.trim() !== "";
  }).length;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlaybackError(null);
    if (isPlaying) {
      audio.pause();
      return;
    }
    audio.playbackRate = playbackRate;
    audio.play().catch(() => setPlaybackError("Không phát được audio. Vui lòng thử lại."));
  };

  const changeRate = (rate: (typeof playbackRates)[number]) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const reset = () => {
    setAnswers({});
    setChecked(false);
  };

  const submit = () => {
    setChecked(true);
    onSubmit(
      section.items.map((item) => {
        const value = answers[item.id];
        return { itemId: item.id, answer: value == null ? "" : String(value) };
      }),
    );
  };

  return (
    <article className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold" lang="zh">{number}. {section.title}</h3>
          {section.description && (
            <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
          )}
        </div>
        {(savedScore || reviewGroup) && (
          <div className="flex flex-wrap items-center gap-2">
            {savedScore?.correctCount != null && savedScore.totalCount != null && (
              <Badge variant="outline" className="shrink-0">
                Điểm cao nhất {savedScore.correctCount}/{savedScore.totalCount}
              </Badge>
            )}
            {reviewGroup && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowReview(true)}
              >
                <Eye className="mr-1.5 h-4 w-4" />
                Chi tiết
              </Button>
            )}
          </div>
        )}
      </div>

      {showReview && reviewGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowReview(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowReview(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`phonetics-review-title-${section.id}`}
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-background p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3
                  id={`phonetics-review-title-${section.id}`}
                  className="text-lg font-semibold"
                >
                  Chi tiết kết quả · {section.title}
                </h3>
                {reviewGroup.correctCount != null && reviewGroup.totalCount != null && (
                  <p className="mt-1 text-sm font-medium text-muted-foreground">
                    {reviewGroup.correctCount}/{reviewGroup.totalCount} câu đúng
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Đóng chi tiết kết quả"
                onClick={() => setShowReview(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              {reviewGroup.results.map((result, index) => (
                <div
                  key={result.id}
                  className={cn(
                    "rounded-md border p-3",
                    result.correct === true
                      ? "border-success/30 bg-success/5"
                      : "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <p className="content-text pinyin-text font-medium">{index + 1}. {result.prompt}</p>
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">Bạn trả lời: </span>
                    <span className="content-text pinyin-text">{result.given || "Bỏ trống"}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Đáp án đúng: </span>
                    <span className="content-text pinyin-text">{result.correctAnswer || "—"}</span>
                  </p>
                  {result.completeAnswer && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Âm tiết hoàn chỉnh: </span>
                      <span className="content-text pinyin-text">{result.completeAnswer}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {section.audio ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <audio
            ref={audioRef}
            src={section.audio}
            preload="none"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            onError={() => {
              setIsPlaying(false);
              setPlaybackError("Không tải được file audio của phần này.");
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={togglePlay}>
            {isPlaying ? <Pause className="mr-1.5 h-4 w-4" /> : <Headphones className="mr-1.5 h-4 w-4" />}
            {isPlaying ? "Tạm dừng" : "Nghe"}
          </Button>
          <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Tốc độ phát">
            {playbackRates.map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={playbackRate === rate}
                onClick={() => changeRate(rate)}
                className={cn(
                  "px-2.5 py-1.5 text-xs transition-colors",
                  playbackRate === rate
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {rate}×
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Nghe được không giới hạn số lần</span>
          <AudioSeekBar
            className="basis-full"
            currentTime={currentTime}
            duration={duration}
            onSeek={(time) => {
              if (audioRef.current) audioRef.current.currentTime = time;
            }}
          />
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Phần này chưa có file ghi âm.</p>
      )}

      {playbackError && (
        <p role="alert" className="mt-2 text-sm text-destructive">{playbackError}</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {section.items.map((item, index) => (
          <PhoneticsItemInput
            key={item.id}
            item={item}
            number={index + 1}
            value={answers[item.id]}
            checked={checked}
            disabled={isSaving}
            onChange={(value) => {
              setAnswers((previous) => ({ ...previous, [item.id]: value }));
              setChecked(false);
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={isSaving || answeredCount === 0}>
          <Check className="mr-1.5 h-4 w-4" />
          {isSaving ? "Đang lưu…" : "Kiểm tra và lưu điểm"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={isSaving}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Làm lại
        </Button>
      </div>

      <p className="mt-3 text-sm font-semibold" aria-live="polite">
        {checked
          ? `Số câu đúng: ${correctCount} / ${section.items.length}`
          : `Đã làm: ${answeredCount} / ${section.items.length}`}
      </p>
    </article>
  );
}

export function PhoneticsPractice({
  config,
  savedScores,
  reviewGroups,
  submissionResult,
  isSaving,
  submissionError,
  onSubmitSection,
}: PhoneticsPracticeProps) {
  return (
    <section className="mx-auto max-w-6xl space-y-4" aria-labelledby="phonetics-title">
      <header>
        <h2 id="phonetics-title" className="text-lg font-bold">NGỮ ÂM</h2>
        <p className="text-sm text-muted-foreground">Luyện thanh mẫu – vận mẫu – thanh điệu</p>
      </header>

      {submissionError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {submissionError}
        </p>
      )}

      {config.sections.map((section, index) => (
        <PhoneticsSectionCard
          key={section.id}
          section={section}
          number={index + 1}
          savedScore={savedScores[section.id] ?? null}
          reviewGroup={
            submissionResult?.targetKey === String(section.id)
              ? submissionResult
              : reviewGroups.find((group) => group.targetKey === String(section.id)) ?? null
          }
          isSaving={isSaving}
          onSubmit={(answers) => onSubmitSection(section.id, answers)}
        />
      ))}
    </section>
  );
}
