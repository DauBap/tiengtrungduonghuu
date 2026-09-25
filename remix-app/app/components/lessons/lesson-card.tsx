import { Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import type { Lesson } from "~/types/lesson";
import type { ProgressStatus } from "~/types/progress";
import { Play, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";

interface LessonCardProps { lesson: Lesson; status: ProgressStatus; href?: string; index: number; }

export function LessonCard({ lesson, status, href, index }: LessonCardProps) {
  // Không còn trạng thái khóa: mọi bài đều vào được.
  // Chỉ phân biệt bài đã hoàn thành để học viên nhìn ra mình đã học tới đâu.
  const isCompleted = status === "COMPLETED";
  const Icon = isCompleted ? CheckCircle2 : Play;

  const content = (
    <Card className="transition-all hover:shadow-md hover:border-primary/30 cursor-pointer group">
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isCompleted ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono text-muted-foreground">Bài {index + 1}</span>
          <h3 className="text-sm font-semibold mt-0.5 truncate">{lesson.title}</h3>
          <p className="text-sm text-muted-foreground truncate">{lesson.subtitle}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </CardContent>
    </Card>
  );

  if (!href) return content;
  return <Link to={href}>{content}</Link>;
}
