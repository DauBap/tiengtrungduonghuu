import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsByCourse, getAllProgressForCourse, computeCourseProgress, computeLessonStatus } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { LessonCard } from "~/components/lessons/lesson-card";
import { ProgressBar } from "~/components/progress/progress-bar";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { ProgressStatus } from "~/types/progress";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy", { status: 404 });

  const lessons = await getLessonsByCourse(course.id);
  const progressList = await getAllProgressForCourse(user.id, course.id);
  const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));
  const courseProgress = computeCourseProgress(lessons, progressList);

  // Compute per-lesson status and unlock
  const lessonsWithStatus = lessons.map((lesson, index) => {
    // A lesson is unlocked if it's first, or if prev lesson test is completed
    const isUnlocked = index === 0
      ? true
      : progressMap.get(lessons[index - 1].id)?.testCompleted === true;

    let status: ProgressStatus;
    if (!isUnlocked) {
      status = "LOCKED";
    } else {
      const p = progressMap.get(lesson.id) ?? null;
      const s = computeLessonStatus(p);
      if (s.testStatus === "COMPLETED") status = "COMPLETED";
      else if (s.learningStatus === "COMPLETED" || s.exerciseStatus !== "LOCKED") status = "IN_PROGRESS";
      else status = "AVAILABLE";
    }

    return { ...lesson, status, isUnlocked };
  });

  return {
    user,
    course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
    lessonsWithStatus,
    courseProgress,
  };
}

export default function StudentCourseDetail() {
  const { user, course, lessonsWithStatus, courseProgress } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/student/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {course.hskLevel}</span>
                <span className="text-xs font-mono text-muted-foreground">{course.code}</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">{course.title}</h1>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{course.description}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Tiến độ khóa học</CardTitle></CardHeader>
          <CardContent><ProgressBar value={courseProgress} /></CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold mb-4">Bài học</h2>
          {lessonsWithStatus.length === 0
            ? <EmptyState title="Chưa có bài học" message="Khóa học này chưa có bài học nào." />
            : <div className="space-y-3">
                {lessonsWithStatus.map((lesson, index) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={{ id: lesson.id, courseId: lesson.courseId, order: lesson.order, title: lesson.title, subtitle: lesson.subtitle, content: lesson.content }}
                    status={lesson.status}
                    index={index}
                    href={lesson.status !== "LOCKED" ? `/student/courses/${course.id}/lessons/${lesson.id}` : undefined}
                  />
                ))}
              </div>}
        </div>
      </div>
    </AppShell>
  );
}
