import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import {
  initializeAppSettings,
  updateAppSetting,
  useAppSettings,
  useSpeechStatus,
  type SpeechEngine,
} from "~/lib/app-settings";
import { cn } from "~/lib/utils";

function SettingsSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm hover:bg-muted/60">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full bg-muted transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-background after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          !checked && "peer-focus-visible:ring-offset-background"
        )}
      />
    </label>
  );
}

export function SettingsMenu({ align = "left" }: { align?: "left" | "right" }) {
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <section
          role="dialog"
          aria-label="Cài đặt học tập"
          className={cn(
            "absolute top-full z-[60] mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <h2 className="px-2 pb-2 text-sm font-semibold">Cài đặt</h2>
          <div className="space-y-0.5">
            <SettingsSwitch
              label="Hiện Pinyin"
              checked={settings.showPinyin}
              onChange={(value) => updateAppSetting("showPinyin", value)}
            />
          </div>
          <fieldset className="mt-2 border-t pt-2">
            <legend className="px-2 text-xs font-semibold text-muted-foreground">Giọng đọc</legend>
            {([
              ["edge", "Edge TTS", "Giọng Neural Xiaoxiao"],
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
          {settings.speechEngine === "edge" && speechStatus === "fallback" && (
            <p role="status" className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs leading-5 text-foreground">
              Edge TTS không trả được audio. Đang dùng giọng đọc của trình duyệt.
            </p>
          )}
        </section>
      )}
    </div>
  );
}