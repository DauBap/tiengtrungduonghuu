import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, ArrowRight, BookOpen, FileCheck2, FileText, Inbox, RotateCcw, UsersRound } from "lucide-react";
import { cn } from "~/lib/utils";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const [lessons, reviewSets, mockExams] = await Promise.all([
    getLessonsByCourse(course.id),
    prisma.courseReviewSet.findMany({
      where: { courseId: course.id },
      orderBy: { order: "asc" },
      include: { _count: { select: { questions: true } } },
    }),
    prisma.mockExam.findMany({
      where: { courseId: course.id },
      orderBy: { createdAt: "asc" },
      include: {
        sections: { include: { _count: { select: { questions: true } } } },
        _count: { select: { attempts: true } },
      },
    }),
  ]);
  return { user, course, lessons, reviewSets, mockExams };
}

export default function TeacherCourseDetail() {
  const { user, course, lessons, reviewSets, mockExams } = useLoaderData<typeof loader>();

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
            {reviewSets.length > 0 && (
              <section className="mt-6 space-y-3 border-t pt-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <RotateCcw className="h-4 w-4 text-primary" />Ôn tập ({reviewSets.length})
                </h3>
                {reviewSets.map((reviewSet) => (
                  <Link
                    key={reviewSet.id}
                    to={`/teacher/courses/${course.id}/progress/reviews/${reviewSet.id}`}
                    className="group flex items-center gap-4 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <RotateCcw className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold">{reviewSet.title}</h4>
                      <p className="text-sm text-muted-foreground">{reviewSet.subtitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{reviewSet._count.questions} câu hỏi</p>
                    </div>
                    <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
                      <UsersRound className="h-4 w-4" />Xem tiến độ
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))}
              </section>
            )}
            {mockExams.length > 0 && (
              <section className="mt-6 space-y-3 border-t pt-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <FileCheck2 className="h-4 w-4 text-primary" />Bài thi thử ({mockExams.length})
                </h3>
                {mockExams.map((mockExam, index) => (
                  <Link
                    key={mockExam.id}
                    to={`/teacher/courses/${course.id}/progress/mock-exams/${mockExam.id}`}
                    className="group flex items-center gap-4 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileCheck2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold">{mockExam.title || `Đề số ${index + 1}`}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {mockExam.sections.reduce((total, section) => total + section._count.questions, 0)} câu hỏi · {mockExam._count.attempts} lượt làm
                      </p>
                    </div>
                    <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
                      <UsersRound className="h-4 w-4" />Xem tiến độ
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))}
              </section>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
