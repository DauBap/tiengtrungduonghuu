import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { ProgressBar } from "~/components/progress/progress-bar";
import type { Course } from "~/types/course";
import { BookOpen, ArrowRight } from "lucide-react";
import { Button } from "~/components/ui/button";

interface CourseCardProps {
  course: Course;
  href: string;
  progress?: number;
  showStatus?: boolean;
  ctaLabel?: string;
}

export function CourseCard({ course, href, progress, showStatus = false, ctaLabel = "Xem khóa học" }: CourseCardProps) {
  return (
    <Card className="group overflow-hidden transition-all hover:shadow-md hover:border-primary/30">
      <div className="relative h-32 bg-gradient-to-br from-primary/10 via-primary/5 to-accent/10 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <BookOpen className="h-8 w-8" />
        </div>
        <div className="absolute top-3 left-3">
          <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-bold text-primary shadow-sm">
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
