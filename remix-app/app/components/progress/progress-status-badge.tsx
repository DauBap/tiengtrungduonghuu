import { cn } from "~/lib/utils";
import type { ProgressStatus } from "~/types/progress";
import { Badge } from "~/components/ui/badge";
import { Lock, Play, CheckCircle2, CircleDashed } from "lucide-react";

const STATUS_CONFIG: Record<ProgressStatus, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  LOCKED: { label: "Chưa mở khóa", icon: Lock, className: "bg-muted text-muted-foreground border-border" },
  AVAILABLE: { label: "Có thể học", icon: Play, className: "bg-primary/10 text-primary border-primary/30" },
  IN_PROGRESS: { label: "Đang học", icon: CircleDashed, className: "bg-warning/15 text-warning border-warning/30" },
  COMPLETED: { label: "Hoàn thành", icon: CheckCircle2, className: "bg-success/15 text-success border-success/30" },
};

export function ProgressStatusBadge({ status }: { status: ProgressStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
