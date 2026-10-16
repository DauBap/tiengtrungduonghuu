import { useEffect, useId, useRef, useState } from "react";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import {
  initializeAppSettings,
  updateAppSetting,
  useAppSettings,
  type ThemePreference,
} from "~/lib/app-settings";
import { cn } from "~/lib/utils";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Sáng", Icon: Sun },
  { value: "dark", label: "Tối", Icon: Moon },
  { value: "system", label: "Hệ thống", Icon: Monitor },
];

export function AppearanceMenu({
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
  const themeGroupName = useId();
  const settings = useAppSettings();

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Giao diện"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName
        )}
      >
        <SunMoon className="h-4 w-4" aria-hidden="true" />
        {triggerLabel && <span>{triggerLabel}</span>}
      </button>
      {open && (
        <section
          role="dialog"
          aria-label="Cài đặt giao diện"
          className={cn(
            "absolute z-[60] w-[min(18rem,calc(100vw-2rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <h2 className="px-2 pb-2 text-sm font-semibold">Giao diện</h2>
          <fieldset>
            <legend className="sr-only">Chọn giao diện</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1 rounded-md border px-1.5 py-2 text-center text-xs transition-colors hover:bg-muted/60",
                    settings.themePreference === value && "border-primary bg-primary/5 text-foreground"
                  )}
                >
                  <input
                    type="radio"
                    name={themeGroupName}
                    value={value}
                    checked={settings.themePreference === value}
                    onChange={() => updateAppSetting("themePreference", value)}
                    className="h-3.5 w-3.5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      )}
    </div>
  );
}
