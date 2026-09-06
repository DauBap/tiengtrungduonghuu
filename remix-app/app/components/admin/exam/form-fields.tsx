import { useState } from "react";
import { cn } from "~/lib/utils";

/**
 * Hàng bật/tắt cho các form của module Bài thi.
 *
 * State do component cha giữ (khác `ToggleRow` nội bộ của listening-form, cái
 * đó có chế độ uncontrolled) — form thi luôn cần đọc giá trị để bật/tắt field
 * khác, nên không có lý do dùng uncontrolled.
 *
 * Giá trị gửi lên server qua input hidden ngay trong component, không cần cha
 * khai thêm.
 */
export function ToggleField({
  name,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  name?: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-start gap-3", disabled ? "opacity-60" : "cursor-pointer")}>
      {name && <input type="hidden" name={name} value={String(checked)} />}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all",
            checked ? "left-[1.125rem]" : "left-0.5"
          )}
        />
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}

/**
 * Nhóm nút chọn một trong nhiều, kiểu thẻ có mô tả — lối đã dùng ở
 * listening-form (nguồn câu hỏi, chế độ trả lời).
 */
export function CardRadioGroup<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  const grid = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3" }[columns];
  return (
    <div className={cn("grid gap-2", grid)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            value === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            opt.disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <p className="text-sm font-medium">{opt.label}</p>
          {opt.hint && <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>}
        </button>
      ))}
    </div>
  );
}

/** Ô nhập số có kẹp biên, dùng cho các setting kiểu "0 = không giới hạn". */
export function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step,
  name,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  name?: string;
}) {
  // Giữ chuỗi đang gõ riêng: ép về số ngay mỗi lần onChange thì xoá hết ô sẽ
  // nhảy về 0 và không gõ tiếp được số nhiều chữ số.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      {name && <input type="hidden" name={name} value={String(value)} />}
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
        }}
        onBlur={() => setDraft(null)}
        className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function clamp(n: number, min: number, max?: number) {
  const low = Math.max(min, n);
  return max === undefined ? low : Math.min(max, low);
}
