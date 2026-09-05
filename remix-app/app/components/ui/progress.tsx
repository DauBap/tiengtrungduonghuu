import { cn } from "~/lib/utils";

interface ProgressProps { value?: number; className?: string; }

const Progress = ({ value = 0, className }: ProgressProps) => (
  <div className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

export { Progress };
