import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { CourseCard } from "~/components/courses/course-card";
import { EmptyState } from "~/components/common/empty-state";
import { BookOpen } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const myCourses = await getEnrolledCourses(user.id);
  return { user, myCourses };
}

export default function TeacherCourses() {
  const { user, myCourses } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Khóa học của tôi</h1>
          <p className="text-muted-foreground text-sm mt-1">Các khóa học bạn đang phụ trách giảng dạy.</p>
        </div>
        {myCourses.length === 0
          ? <EmptyState icon={<BookOpen className="h-10 w-10" />} title="Chưa có khóa học nào" message="Bạn chưa được phân công khóa học nào." />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myCourses.map((c) => (
                <CourseCard key={c.id} course={{ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }}
                  href={`/teacher/courses/${c.id}`} ctaLabel="Xem khóa học" />
              ))}
            </div>}
      </div>
    </AppShell>
  );
}
