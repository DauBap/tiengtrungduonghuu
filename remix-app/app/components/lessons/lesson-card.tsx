import { Link } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import type { Lesson } from "~/types/lesson";
import type { ProgressStatus } from "~/types/progress";
import { Play, CheckCircle2, ChevronRight, Video } from "lucide-react";
import { cn } from "~/lib/utils";

interface LessonCardProps {
  lesson: Lesson;
  status: ProgressStatus;
  href?: string;
  index: number;
  badgeText?: string;
  videoUrl?: string;
  variant?: "default" | "review";
}

export function LessonCard({ lesson, status, href, index, badgeText, videoUrl, variant = "default" }: LessonCardProps) {
  // Không còn trạng thái khóa: mọi bài đều vào được.
  // Chỉ phân biệt bài đã hoàn thành để học viên nhìn ra mình đã học tới đâu.
  const isCompleted = status === "COMPLETED";
  const Icon = isCompleted ? CheckCircle2 : Play;
  const displayBadge = badgeText ?? `Bài ${index + 1}`;

  return (
    <Card className={cn(
      "relative transition-all hover:shadow-md group",
      href && "cursor-pointer",
      variant === "review"
        ? "border-red-200 bg-red-50/70 hover:border-red-300 hover:bg-red-100/70"
        : "hover:border-primary/30"
    )}>
      {href && (
        <Link
          to={href}
          aria-label={`Mở ${displayBadge}: ${lesson.title}`}
          className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        />
      )}
      <CardContent className={cn(
        "relative z-10 flex items-center gap-4 p-4 sm:!p-4",
        href && "pointer-events-none",
      )}>
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isCompleted ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{displayBadge}</span>
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Mở video bài học ${lesson.title} trong tab mới`}
                title="Video bài học"
                className="pointer-events-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Video aria-hidden="true" className="h-3 w-3" />
                <span>Video bài học</span>
              </a>
            )}
          </div>
          <h3 className="text-sm font-semibold mt-0.5 truncate">{lesson.title}</h3>
          <p className="text-sm text-muted-foreground truncate">{lesson.subtitle}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </CardContent>
    </Card>
  );
}
