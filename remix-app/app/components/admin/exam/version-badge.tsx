import { EXAM_STATUS_META, type ExamStatus } from "~/lib/exams";
import { cn } from "~/lib/utils";

/** Badge trạng thái đề / phiên bản. Nhãn và màu lấy từ registry. */
export function ExamStatusBadge({
  status,
  className,
}: {
  status: ExamStatus;
  className?: string;
}) {
  const meta = EXAM_STATUS_META[status];
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        meta.className,
        className
      )}
    >
      {meta.label}
    </span>
  );
}

/** Nhãn phiên bản kèm badge trạng thái: "v2" + "Bản nháp". */
export function VersionBadge({
  version,
  status,
  className,
}: {
  version: number;
  status: ExamStatus;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
        v{version}
      </span>
      <ExamStatusBadge status={status} />
    </span>
  );
}
