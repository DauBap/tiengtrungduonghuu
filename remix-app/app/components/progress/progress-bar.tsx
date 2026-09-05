import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";

interface ProgressBarProps { value: number; className?: string; showLabel?: boolean; }

export function ProgressBar({ value, className, showLabel = true }: ProgressBarProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {showLabel && (
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Tiến độ</span>
          <span className="font-medium">{value}%</span>
        </div>
      )}
      <Progress value={value} className="h-2" />
    </div>
  );
}
