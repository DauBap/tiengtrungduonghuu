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

export function CourseCard({ course, href, progress, showStatus = false, ctaLabel = "Xem khóa học" }: CourseCardProps) {
  const shade = HSK_SHADE[course.hskLevel] ?? HSK_SHADE[1];
  return (
    <Card className="group overflow-hidden transition-all hover:shadow-md hover:border-primary/30">
      <div className={cn("relative h-32 bg-gradient-to-br flex items-center justify-center", shade.tint)}>
        <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl bg-background/70", shade.text)}>
          <BookOpen className="h-8 w-8" />
        </div>
        <div className="absolute top-3 left-3">
          <span className={cn("rounded-md bg-background/90 px-2 py-1 text-xs font-bold shadow-sm", shade.text)}>
            HSK {course.hskLevel}
          </span>
        </div>
        {showStatus && (
          <div className="absolute top-3 right-3">
            <CourseStatusBadge status={course.status} />
          </div>
        )}
      </div>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold leading-tight line-clamp-1">{course.title}</CardTitle>
        <p className="text-xs text-muted-foreground font-mono">{course.code}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">{course.description}</p>
        {typeof progress === "number" && <ProgressBar value={progress} />}
        <Button asChild size="sm" className="w-full">
          <Link to={href}>
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
