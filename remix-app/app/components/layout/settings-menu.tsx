import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import {
  initializeAppSettings,
  updateAppSetting,
  useAppSettings,
  useSpeechStatus,
  type SpeechEngine,
} from "~/lib/app-settings";
import { SPEECH_VOICES } from "~/lib/speech-voices";
import { cn } from "~/lib/utils";

export function SettingsMenu({
  align = "left",
  side = "bottom",
  triggerClassName,
  triggerLabel,
}: {
  align?: "left" | "right";
  side?: "top" | "bottom";
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const settings = useAppSettings();
  const speechStatus = useSpeechStatus();

  useEffect(() => {
    initializeAppSettings();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const setEngine = (engine: SpeechEngine) => updateAppSetting("speechEngine", engine);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Cài đặt"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName
        )}
      >
        <Settings className="h-4 w-4" />
        {triggerLabel && <span>{triggerLabel}</span>}
      </button>
      {open && (
        <section
          role="dialog"
          aria-label="Cài đặt học tập"
          className={cn(
            "absolute z-[60] w-[min(18rem,calc(100vw-2rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <h2 className="px-2 pb-2 text-sm font-semibold">Cài đặt</h2>
          <fieldset className="mt-2 border-t pt-2">
            <legend className="px-2 text-xs font-semibold text-muted-foreground">Giọng đọc</legend>
            {([
              ["edge", "Edge TTS", "Giọng Edge Neural"],
              ["local", "Local TTS", "Giọng có sẵn trên thiết bị"],
            ] as const).map(([value, label, description]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
              >
                <input
                  type="radio"
                  name="speech-engine"
                  value={value}
                  checked={settings.speechEngine === value}
                  onChange={() => setEngine(value)}
                  className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span className="min-w-0">
                  <span className="block">{label}</span>
                  <span className="block text-xs text-muted-foreground">{description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {settings.speechEngine === "edge" && (
            <fieldset className="mt-2 border-t pt-2">
              <legend className="px-2 text-xs font-semibold text-muted-foreground">Chọn giọng nữ</legend>
              {SPEECH_VOICES.map((voice) => (
                <label
                  key={voice.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60"
                >
                  <input
                    type="radio"
                    name="speech-voice"
                    value={voice.id}
                    checked={settings.speechVoice === voice.id}
                    onChange={() => updateAppSetting("speechVoice", voice.id)}
                    className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <span className="min-w-0">
                    <span className="block">{voice.name}</span>
                    <span className="block text-xs text-muted-foreground">{voice.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {settings.speechEngine === "edge" && speechStatus === "fallback" && (
            <p role="status" className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs leading-5 text-foreground">
              Dịch vụ TTS không trả được audio. Đang dùng giọng đọc của trình duyệt.
            </p>
          )}
        </section>
      )}
    </div>
  );
}