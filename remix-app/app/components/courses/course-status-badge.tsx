import { cn } from "~/lib/utils";
import type { CourseStatus } from "~/types/course";
import { Badge } from "~/components/ui/badge";

const STATUS_CONFIG: Record<CourseStatus, { label: string; className: string }> = {
  DRAFT: { label: "Nháp", className: "bg-muted text-muted-foreground border-border" },
  PUBLISHED: { label: "Đã xuất bản", className: "bg-success/15 text-success border-success/30" },
  ARCHIVED: { label: "Đã lưu trữ", className: "bg-muted text-muted-foreground border-border line-through" },
};

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
