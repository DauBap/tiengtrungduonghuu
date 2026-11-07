import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseProgressMap } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { CourseCard } from "~/components/courses/course-card";
import { EmptyState } from "~/components/common/empty-state";
import { BookOpen } from "lucide-react";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: user.id },
    select: {
      course: true,
      class: {
        select: {
          completedAt: true,
          name: true,
          schedule: true,
          teacher: { select: { name: true } },
        },
      },
    },
    orderBy: { course: { order: "asc" } },
  });
  const myCourses = enrollments.map(({ course, class: classroom }) => ({
    course,
    isClassCompleted: Boolean(classroom?.completedAt),
    classTitle: classroom?.name ?? null,
    classSchedule: classroom?.schedule,
    teacherName: classroom?.teacher?.name ?? null,
  }));
  const courseList = myCourses.map(({ course }) => course);

  const courseProgress = await getCourseProgressMap(
    user.id,
    courseList.map((course) => course.id),
  );

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
          : <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {myCourses.map(({ course, isClassCompleted, classTitle, classSchedule, teacherName }) => (
                <CourseCard key={course.id} course={{ ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() }}
                  href={`/student/courses/${course.id}`} progress={courseProgress[course.id]} ctaLabel="Tiếp tục học" compactOnMobile
                  isClassCompleted={isClassCompleted} classTitle={classTitle} classSchedule={classSchedule} teacherName={teacherName} />
              ))}
            </div>}
      </div>
    </AppShell>
  );
}
