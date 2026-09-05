import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses, getAllProgressForCourse, getLessonsByCourse, computeCourseProgress } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { CourseCard } from "~/components/courses/course-card";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { BookOpen, TrendingUp, CheckCircle2, PlayCircle } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const myCourses = await getEnrolledCourses(user.id);

  // overall stats
  let totalLessons = 0;
  let totalCompleted = 0;
  let currentLesson = null;

  for (const course of myCourses) {
    const lessons = await getLessonsByCourse(course.id);
    const progressList = await getAllProgressForCourse(user.id, course.id);
    const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));
    totalLessons += lessons.length;
    totalCompleted += lessons.filter((l) => progressMap.get(l.id)?.testCompleted).length;
    if (!currentLesson) {
      currentLesson = lessons.find((l) => !progressMap.get(l.id)?.testCompleted) ?? null;
    }
  }

  const overallProgress = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

  // progress per course
  const courseProgress: Record<string, number> = {};
  for (const course of myCourses) {
    const lessons = await getLessonsByCourse(course.id);
    const progressList = await getAllProgressForCourse(user.id, course.id);
    courseProgress[course.id] = computeCourseProgress(lessons, progressList);
  }

  return { user, myCourses, overallProgress, totalCompleted, currentLesson, courseProgress };
}

export default function StudentIndex() {
  const { user, myCourses, overallProgress, totalCompleted, currentLesson, courseProgress } =
    useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bảng điều khiển học viên</h1>
          <p className="text-muted-foreground text-sm mt-1">Tiếp tục hành trình học tiếng Trung của bạn.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Khóa học của tôi" value={myCourses.length} icon={BookOpen} accent="primary" />
          <StatCard label="Tổng tiến độ" value={`${overallProgress}%`} icon={TrendingUp} accent="success" />
          <StatCard label="Bài đã hoàn thành" value={totalCompleted} icon={CheckCircle2} accent="accent" />
          <StatCard label="Bài học hiện tại"
            value={currentLesson ? `Bài ${currentLesson.order}` : "Hoàn thành!"}
            icon={PlayCircle} accent="warning" />
        </div>

        {currentLesson && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <p className="text-xs font-medium text-primary mb-1">TIẾP TỤC HỌC</p>
                <h3 className="text-lg font-semibold">{currentLesson.title}</h3>
                <p className="text-sm text-muted-foreground font-mono">{currentLesson.subtitle}</p>
              </div>
              <Button asChild>
                <Link to={`/student/courses/${currentLesson.courseId}/lessons/${currentLesson.id}`}>Tiếp tục</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Khóa học của tôi</h2>
            <Link to="/student/courses" className="text-sm text-primary hover:underline">Xem tất cả</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.map((c) => (
              <CourseCard key={c.id} course={{ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }}
                href={`/student/courses/${c.id}`} progress={courseProgress[c.id]} ctaLabel="Tiếp tục học" />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
