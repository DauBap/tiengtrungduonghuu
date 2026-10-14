import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { ProgressBar } from "~/components/progress/progress-bar";
import type { Course } from "~/types/course";
import { BookOpen, ArrowRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface CourseCardProps {
  course: Course;
  href: string;
  progress?: number;
  showStatus?: boolean;
  ctaLabel?: string;
  compactOnMobile?: boolean;
}

/** Mỗi cấp HSK một sắc thái đỏ, đậm dần theo trình độ. */
const HSK_SHADE: Record<number, { tint: string; text: string }> = {
  1: { tint: "from-brand-1/15 to-brand-1/5", text: "text-brand-1" },
  2: { tint: "from-brand-2/15 to-brand-2/5", text: "text-brand-2" },
  3: { tint: "from-brand-3/15 to-brand-3/5", text: "text-brand-3" },
  4: { tint: "from-brand-4/15 to-brand-4/5", text: "text-brand-4" },
  5: { tint: "from-brand-4/15 to-brand-4/5", text: "text-brand-4" },
  6: { tint: "from-brand-4/15 to-brand-4/5", text: "text-brand-4" },
};

export function CourseCard({
  course,
  href,
  progress,
  showStatus = false,
  ctaLabel = "Xem khóa học",
  compactOnMobile = false,
}: CourseCardProps) {
  const shade = HSK_SHADE[course.hskLevel] ?? HSK_SHADE[1];
  return (
    <Card className="group overflow-hidden transition-all hover:shadow-md hover:border-primary/30">
      <div className={cn("relative flex h-32 items-center justify-center bg-gradient-to-br", shade.tint, compactOnMobile && "max-sm:h-16")}>
        <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl bg-background/70", shade.text, compactOnMobile && "max-sm:h-10 max-sm:w-10 max-sm:rounded-xl")}>
          <BookOpen className={cn("h-8 w-8", compactOnMobile && "max-sm:h-5 max-sm:w-5")} />
        </div>
        <div className={cn("absolute left-3 top-3", compactOnMobile && "max-sm:left-2 max-sm:top-2")}>
          <span className={cn("rounded-md bg-background/90 px-2 py-1 text-xs font-bold shadow-sm", shade.text, compactOnMobile && "max-sm:px-1.5 max-sm:py-0.5")}>
            HSK {course.hskLevel}
          </span>
        </div>
        {showStatus && (
          <div className={cn("absolute right-3 top-3", compactOnMobile && "max-sm:right-2 max-sm:top-2")}>
            <CourseStatusBadge status={course.status} />
          </div>
        )}
      </div>
      <CardHeader className={cn("pb-2", compactOnMobile && "max-sm:space-y-1 max-sm:p-3 max-sm:pb-1")}>
        <CardTitle className="text-base font-semibold leading-tight line-clamp-1">{course.title}</CardTitle>
        <p className="text-xs text-muted-foreground font-mono">{course.code}</p>
      </CardHeader>
      <CardContent className={cn("space-y-3", compactOnMobile && "max-sm:space-y-2 max-sm:p-3 max-sm:pt-0")}>
        <p className={cn("text-sm text-muted-foreground line-clamp-2", compactOnMobile && "max-sm:line-clamp-1")}>{course.description}</p>
        {typeof progress === "number" && <ProgressBar value={progress} className={compactOnMobile ? "max-sm:space-y-1" : undefined} />}
        <Button asChild size="sm" className={cn("w-full", compactOnMobile && "max-sm:h-8")}>
          <Link to={href}>
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
