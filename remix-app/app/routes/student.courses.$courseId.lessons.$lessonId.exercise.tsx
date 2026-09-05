import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Link, Form, redirect } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonById, getLessonProgress, upsertLessonProgress, computeLessonStatus } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { LockedContent } from "~/components/lessons/locked-content";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lesson = await getLessonById(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy", { status: 404 });
  const progress = await getLessonProgress(user.id, lesson.id);
  const lessonStatus = computeLessonStatus(progress);
  return { user, lesson, lessonStatus };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  await upsertLessonProgress(user.id, params.lessonId!, { learningCompleted: true, exerciseCompleted: true });
  return redirect(`/student/courses/${params.courseId}/lessons/${params.lessonId}/test`);
}

export default function ExercisePage() {
  const { user, lesson, lessonStatus } = useLoaderData<typeof loader>();

  if (lessonStatus.exerciseStatus === "LOCKED") {
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học</Link>
          </Button>
          <LockedContent title="Bài tập chưa mở khóa" message="Hãy hoàn thành phần lý thuyết trước để mở khóa bài tập." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}`}><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học</Link>
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {lesson.course.hskLevel}</span>
            <span>{lesson.title} - Bài tập</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{lesson.exercise?.title}</h1>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Bài tập</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/5 p-8 text-center">
              <div className="flex justify-center mb-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
              </div>
              <p className="text-muted-foreground">Nội dung bài tập sẽ được bổ sung sau.</p>
            </div>
            {lessonStatus.exerciseStatus === "COMPLETED" ? (
              <div className="flex items-center gap-2 text-success justify-center">
                <CheckCircle2 className="h-5 w-5" /><span className="text-sm font-medium">Đã hoàn thành bài tập</span>
              </div>
            ) : (
              <Form method="post">
                <Button type="submit" size="lg" className="w-full">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />Hoàn thành bài tập
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
