import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsByCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, BookOpen, FileText, Inbox } from "lucide-react";
import { cn } from "~/lib/utils";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy", { status: 404 });
  const lessons = await getLessonsByCourse(course.id);
  return { user, course, lessons };
}

export default function TeacherCourseDetail() {
  const { user, course, lessons } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/teacher/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-7 w-7" />
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
                    // Block lý thuyết chỉ tham chiếu từ vựng của chính bài học này,
                    // nên hết từ vựng là không còn gì học được → bài trống.
                    // Cùng điều kiện với isEmptyLesson ở trang học của học viên.
                    const isEmpty = lesson.content.length === 0;
                    return (
                      <div key={lesson.id} className={cn("flex items-center gap-4 rounded-lg border p-4", isEmpty && "border-dashed")}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground font-mono text-sm font-bold">{index + 1}</div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold">{lesson.title}</h3>
                          <p className="text-sm text-muted-foreground font-mono">{lesson.subtitle}</p>
                          {isEmpty
                            ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"><Inbox className="h-3.5 w-3.5" />Bài học trống — chưa có nội dung</p>
                            : <p className="text-xs text-muted-foreground mt-1">{lesson.content.length} từ vựng</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
