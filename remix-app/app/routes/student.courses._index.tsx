import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses, getAllProgressForCourse, getLessonsByCourse, computeCourseProgress } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { CourseCard } from "~/components/courses/course-card";
import { EmptyState } from "~/components/common/empty-state";
import { BookOpen } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const myCourses = await getEnrolledCourses(user.id);

  const courseProgress: Record<string, number> = {};
  for (const course of myCourses) {
    const lessons = await getLessonsByCourse(course.id);
    const progressList = await getAllProgressForCourse(user.id, course.id);
    courseProgress[course.id] = computeCourseProgress(lessons, progressList);
  }

  return { user, myCourses, courseProgress };
}

export default function StudentCourses() {
  const { user, myCourses, courseProgress } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Khóa học của tôi</h1>
          <p className="text-muted-foreground text-sm mt-1">Các khóa học bạn đang theo học.</p>
        </div>
        {myCourses.length === 0
          ? <EmptyState icon={<BookOpen className="h-10 w-10" />} title="Chưa đăng ký khóa học nào" message="Bạn chưa đăng ký khóa học nào." />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myCourses.map((c) => (
                <CourseCard key={c.id} course={{ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }}
                  href={`/student/courses/${c.id}`} progress={courseProgress[c.id]} ctaLabel="Tiếp tục học" />
              ))}
            </div>}
      </div>
    </AppShell>
  );
}
