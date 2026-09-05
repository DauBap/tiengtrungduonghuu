import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses, getLessonsByCourse, getAllProgressForCourse, computeCourseProgress, computeLessonStatus } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { ProgressBar } from "~/components/progress/progress-bar";
import { ProgressStatusBadge } from "~/components/progress/progress-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { TrendingUp, BookOpen, CheckCircle2 } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const myCourses = await getEnrolledCourses(user.id);

  let totalLessons = 0;
  let totalCompleted = 0;

  const coursesWithProgress = await Promise.all(
    myCourses.map(async (course) => {
      const lessons = await getLessonsByCourse(course.id);
      const progressList = await getAllProgressForCourse(user.id, course.id);
      const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));
      const courseProgress = computeCourseProgress(lessons, progressList);

      totalLessons += lessons.length;
      totalCompleted += lessons.filter((l) => progressMap.get(l.id)?.testCompleted).length;

      const lessonsWithStatus = lessons.map((lesson) => {
        const p = progressMap.get(lesson.id) ?? null;
        return { ...lesson, progress: computeLessonStatus(p) };
      });

      return {
        course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
        courseProgress,
        lessons: lessonsWithStatus,
      };
    })
  );

  const overallProgress = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;
  return { user, coursesWithProgress, overallProgress, totalLessons, totalCompleted };
}

export default function StudentProgress() {
  const { user, coursesWithProgress, overallProgress, totalLessons, totalCompleted } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tiến độ của tôi</h1>
          <p className="text-muted-foreground text-sm mt-1">Theo dõi hành trình học tập của bạn qua các khóa học.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Tổng tiến độ</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressBar value={overallProgress} className="max-w-md" />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground"><BookOpen className="h-4 w-4" /><span className="text-xs font-medium">Tổng số bài</span></div>
                <p className="text-2xl font-bold mt-1">{totalLessons}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-medium">Đã hoàn thành</span></div>
                <p className="text-2xl font-bold mt-1">{totalCompleted}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {coursesWithProgress.map(({ course, courseProgress, lessons }) => (
          <Card key={course.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link to={`/student/courses/${course.id}`} className="hover:text-primary transition-colors">{course.title}</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProgressBar value={courseProgress} />
              <div className="space-y-2">
                {lessons.map((lesson, index) => (
                  <div key={lesson.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-8">B{index + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{lesson.title}</p>
                        <p className="text-xs text-muted-foreground font-mono">{lesson.subtitle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressStatusBadge status={lesson.progress.learningStatus} />
                      <ProgressStatusBadge status={lesson.progress.exerciseStatus} />
                      <ProgressStatusBadge status={lesson.progress.testStatus} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
