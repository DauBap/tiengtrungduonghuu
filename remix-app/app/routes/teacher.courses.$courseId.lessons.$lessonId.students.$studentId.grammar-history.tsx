import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { ArrowLeft, BookOpen, ClipboardList, UserRound } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { GRAMMAR_QUESTION_TYPES } from "~/lib/grammar";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const QUESTION_TYPE_LABELS: Record<string, string> = {
  SINGLE_CHOICE: "Chọn đáp án",
  ARRANGE: "Sắp xếp từ",
  FILL: "Nhập câu trả lời",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, course.id))) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  const [attempts, sections] = await Promise.all([
    prisma.lessonTabAttempt.findMany({
      where: { userId: enrollment.userId, lessonId: lesson.id, tab: "GRAMMAR" },
      orderBy: { completedAt: "desc" },
    }),
    prisma.grammarSection.findMany({
      where: { lessonId: lesson.id },
      orderBy: { order: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  return {
    user,
    course,
    lesson,
    student: enrollment.user,
    sections,
    attempts: attempts.map((attempt) => {
      const details = isRecord(attempt.details) ? attempt.details : {};
      const questionType = typeof details.questionType === "string" ? details.questionType : attempt.mode ?? "";
      return {
        id: attempt.id,
        score: attempt.score,
        correctCount: attempt.correctCount,
        totalCount: attempt.totalCount,
        passed: attempt.passed,
        completedAt: attempt.completedAt.toISOString(),
        sectionId: typeof details.sectionId === "string" ? details.sectionId : null,
        sectionTitle: typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ pháp",
        questionType,
        questionTypeLabel: QUESTION_TYPE_LABELS[questionType] ?? questionType,
      };
    }),
  };
}

export default function TeacherGrammarHistory() {
  const { user, course, lesson, student, sections, attempts } = useLoaderData<typeof loader>();
  const progressUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}?tab=GRAMMAR`;
  const historyUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/grammar-history`;
  const availableTypes = GRAMMAR_QUESTION_TYPES.filter((type) =>
    attempts.some((attempt) => attempt.questionType === type)
  );
  const [activeType, setActiveType] = useState<string | null>(null);
  const selectedType = activeType && availableTypes.includes(activeType as typeof availableTypes[number])
    ? activeType
    : availableTypes[0] ?? null;
  const visibleAttempts = selectedType
    ? attempts.filter((attempt) => attempt.questionType === selectedType)
    : [];
  const sectionGroups = visibleAttempts.reduce<Array<{
    id: string;
    title: string;
    attempts: typeof visibleAttempts;
  }>>((groups, attempt) => {
    const groupId = attempt.sectionId ?? `legacy:${attempt.sectionTitle}`;
    let group = groups.find((item) => item.id === groupId);
    if (!group) {
      group = { id: groupId, title: attempt.sectionTitle, attempts: [] };
      groups.push(group);
    }
    group.attempts.push(attempt);
    return groups;
  }, []);
  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  sectionGroups.sort((left, right) =>
    (sectionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
    - (sectionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={progressUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại tiến độ Ngữ pháp</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{course.title} · {lesson.title}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Lịch sử luyện tập Ngữ pháp</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
          </div>
        </div>

        {availableTypes.length > 0 && (
          <div role="tablist" aria-label="Dạng bài tập Ngữ pháp" className="flex gap-2 overflow-x-auto border-b">
            {availableTypes.map((type) => (
              <button
                key={type}
                id={`grammar-history-tab-${type}`}
                type="button"
                role="tab"
                aria-selected={selectedType === type}
                aria-controls={`grammar-history-panel-${type}`}
                onClick={() => setActiveType(type)}
                className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  selectedType === type
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {QUESTION_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />Các lượt nộp ({visibleAttempts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attempts.length === 0 ? (
              <EmptyState title="Chưa có lịch sử Ngữ pháp" message="Học viên chưa nộp kết quả luyện tập trong bài này." />
            ) : (
              <div
                id={selectedType ? `grammar-history-panel-${selectedType}` : undefined}
                role="tabpanel"
                aria-labelledby={selectedType ? `grammar-history-tab-${selectedType}` : undefined}
                className="space-y-6"
              >
                {sectionGroups.map((group) => (
                  <section key={group.id} className="space-y-1">
                    <h3 className="border-b pb-2 text-base font-semibold">{group.title}</h3>
                    <ol className="divide-y">
                      {group.attempts.map((attempt, index) => (
                        <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            <span className="font-medium">Lần {group.attempts.length - index}</span>
                            <span className="text-muted-foreground">
                              {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
                            </span>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${attempt.passed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                              {attempt.passed ? "Đạt" : "Chưa đạt"}
                            </span>
                            <span className="font-semibold tabular-nums">{attempt.score != null ? `${attempt.score}%` : "-"}</span>
                          </div>
                          <Button asChild size="sm" variant="outline">
                            <Link to={`${historyUrl}/attempts/${attempt.id}`}>Chi tiết</Link>
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
