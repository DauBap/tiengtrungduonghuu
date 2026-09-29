import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Inbox, UsersRound } from "lucide-react";
import { cn } from "~/lib/utils";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessons = await getLessonsByCourse(course.id);
  return { user, course, lessons };
}

export default function TeacherCourseDetail() {
  const { user, course, lessons } = useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Button asChild variant="ghost" size="sm">
            <Link to="/teacher/courses"><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
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
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />Bài học ({lessons.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lessons.length === 0
              ? <EmptyState title="Chưa có bài học" message="Khóa học này chưa có bài học nào." />
              : <div className="space-y-3">
                  {lessons.map((lesson, index) => {
                    const isEmpty = lesson.content.length === 0;

                    return (
                      <Link
                        key={lesson.id}
                        to={`/teacher/courses/${course.id}/lessons/${lesson.id}`}
                        className={cn("group flex items-center gap-4 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/20", isEmpty && "border-dashed")}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-sm font-bold text-muted-foreground">{index + 1}</div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold">{lesson.title}</h3>
                          <p className="text-sm text-muted-foreground font-mono">{lesson.subtitle}</p>
                          {isEmpty
                            ? <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Inbox className="h-3.5 w-3.5" />Bài học trống — chưa có nội dung</p>
                            : <p className="mt-1 text-xs text-muted-foreground">{lesson.content.length} từ vựng</p>}
                        </div>
                        <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
                          <UsersRound className="h-4 w-4" />Xem tiến độ
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </Link>
                    );
                  })}
                </div>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
