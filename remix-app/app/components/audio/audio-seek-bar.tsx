import type { CSSProperties } from "react";
import { cn } from "~/lib/utils";

interface AudioSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  className?: string;
}

function formatTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function AudioSeekBar({
  currentTime,
  duration,
  onSeek,
  disabled = false,
  className,
}: AudioSeekBarProps) {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.min(safeDuration, Math.max(0, currentTime))
    : 0;
  const progress = safeDuration > 0 ? (safeCurrentTime / safeDuration) * 100 : 0;

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {formatTime(safeCurrentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={safeDuration}
        step={0.01}
        value={safeCurrentTime}
        disabled={disabled || safeDuration <= 0}
        aria-label="Tua âm thanh"
        aria-valuetext={`${formatTime(safeCurrentTime)} / ${formatTime(safeDuration)}`}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
        className="audio-seek-bar min-w-0 flex-1"
        style={{ "--audio-progress": `${progress}%` } as CSSProperties}
      />
      <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatTime(safeDuration)}
      </span>
    </div>
  );
}
