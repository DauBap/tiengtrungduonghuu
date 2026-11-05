import { AlertTriangle } from "lucide-react";

export function ConsecutiveAbsenceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      Vắng 3 buổi liên tiếp
    </span>
  );
}

export function ConsecutiveAbsenceNotice({ studentNames }: { studentNames: string[] }) {
  if (studentNames.length === 0) return null;

  const visibleNames = studentNames.slice(0, 4);
  const remainingCount = studentNames.length - visibleNames.length;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">{studentNames.length} học sinh vắng 3 buổi liên tiếp:</span>{" "}
        {visibleNames.join(", ")}
        {remainingCount > 0 ? ` và ${remainingCount} học sinh khác` : ""}.
      </p>
    </div>
  );
}
