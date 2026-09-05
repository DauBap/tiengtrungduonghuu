import { cn } from "~/lib/utils";
import { Lock, CheckCircle2, Play } from "lucide-react";
import type { ProgressStatus } from "~/types/progress";

const STATUS_LABEL: Record<ProgressStatus, string> = {
  LOCKED: "Chưa mở khóa", AVAILABLE: "Có thể học", IN_PROGRESS: "Đang học", COMPLETED: "Hoàn thành",
};

export function LessonProgress({ steps, className }: { steps: { label: string; status: ProgressStatus }[]; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {steps.map((step, index) => {
        const Icon = step.status === "COMPLETED" ? CheckCircle2 : step.status === "LOCKED" ? Lock : Play;
        return (
          <div key={index} className={cn("flex items-center gap-3 rounded-lg border p-3",
            step.status === "LOCKED" ? "border-border bg-muted/30 opacity-60" :
            step.status === "COMPLETED" ? "border-success/30 bg-success/5" : "border-primary/30 bg-primary/5"
          )}>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg",
              step.status === "COMPLETED" ? "bg-success/15 text-success" :
              step.status === "LOCKED" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
            )}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{step.label}</p>
              <p className="text-xs text-muted-foreground">{STATUS_LABEL[step.status]}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
