import { Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { ProgressStatusBadge } from "~/components/progress/progress-status-badge";
import type { Lesson } from "~/types/lesson";
import type { ProgressStatus } from "~/types/progress";
import { Lock, Play, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";

interface LessonCardProps { lesson: Lesson; status: ProgressStatus; href?: string; index: number; }

export function LessonCard({ lesson, status, href, index }: LessonCardProps) {
  const isLocked = status === "LOCKED";
  const isCompleted = status === "COMPLETED";
  const Icon = isCompleted ? CheckCircle2 : isLocked ? Lock : Play;

  const content = (
    <Card className={cn("transition-all", isLocked ? "opacity-60 cursor-not-allowed" : "hover:shadow-md hover:border-primary/30 cursor-pointer group")}>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isCompleted ? "bg-success/15 text-success" : isLocked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">Bài {index + 1}</span>
            <ProgressStatusBadge status={status} />
          </div>
          <h3 className="text-sm font-semibold mt-0.5 truncate">{lesson.title}</h3>
          <p className="text-sm text-muted-foreground truncate font-mono">{lesson.subtitle}</p>
        </div>
        {!isLocked && <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />}
      </CardContent>
    </Card>
  );

  if (isLocked || !href) return content;
  return <Link to={href}>{content}</Link>;
}
