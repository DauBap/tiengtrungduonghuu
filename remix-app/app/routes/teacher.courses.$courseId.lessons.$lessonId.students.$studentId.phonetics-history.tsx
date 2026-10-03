import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { ArrowLeft, BookOpen, ClipboardList, UserRound, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, getLessonsByCourse, getPhoneticsConfig, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, course.id))) {
    throw new Response("Không có quyền truy cập", { status: 403 });
  }

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  const attempts = await prisma.lessonTabAttempt.findMany({
    where: { userId: enrollment.userId, lessonId: lesson.id, tab: "PHONETICS" },
    orderBy: { completedAt: "desc" },
  });
  const phoneticsConfig = await getPhoneticsConfig(lesson.id);
  const attemptsBySection = new Map<number, typeof attempts>();
  for (const attempt of attempts) {
    const details = isRecord(attempt.details) ? attempt.details : {};
    const sectionId = typeof details.sectionId === "number" ? details.sectionId : Number(attempt.mode);
    if (!Number.isInteger(sectionId)) continue;
    const sectionAttempts = attemptsBySection.get(sectionId) ?? [];
    sectionAttempts.push(attempt);
    attemptsBySection.set(sectionId, sectionAttempts);
  }
  const sectionInfo = new Map<number, string>(
    phoneticsConfig
      ? phoneticsConfig.sections.map((section) => [section.id, section.title])
      : [],
  );
  for (const [sectionId, sectionAttempts] of attemptsBySection) {
    const details = isRecord(sectionAttempts[0].details) ? sectionAttempts[0].details : {};
    if (!sectionInfo.has(sectionId)) {
      sectionInfo.set(sectionId, typeof details.sectionTitle === "string" ? details.sectionTitle : "Ngữ âm");
    }
  }
  const sections = [...sectionInfo.entries()].map(([id, title]) => ({
    id,
    title,
    attempts: attemptsBySection.get(id) ?? [],
  }));

  return {
    user,
    course,
    lesson,
    student: enrollment.user,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      attempts: section.attempts.map((attempt) => {
      const details = isRecord(attempt.details) ? attempt.details : {};
      const results = Array.isArray(details.results)
        ? details.results.flatMap((result) => {
            if (!isRecord(result)) return [];
            return [{
              prompt: typeof result.prompt === "string" ? result.prompt : "Câu hỏi",
              full: typeof result.full === "string" ? result.full : "",
              given: typeof result.given === "string" ? result.given : "",
              correctAnswer: typeof result.correctAnswer === "string" ? result.correctAnswer : "",
              correct: result.correct === true,
            }];
          })
        : [];

      return {
        id: attempt.id,
        score: attempt.score,
        correctCount: attempt.correctCount,
        totalCount: attempt.totalCount,
        completedAt: attempt.completedAt.toISOString(),
        results,
      };
      }),
    })),
  };
}

export default function TeacherPhoneticsHistory() {
  const { user, course, lesson, student, sections } = useLoaderData<typeof loader>();
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const activeSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0] ?? null;
  const activeAttempt = activeSection?.attempts.find((attempt) => attempt.id === selectedAttemptId) ?? null;
  const activeAttemptIndex = activeSection?.attempts.findIndex((attempt) => attempt.id === activeAttempt?.id) ?? -1;
  const progressUrl = `/teacher/courses/${course.id}/lessons/${lesson.id}?tab=PHONETICS`;

  return (
    <AppShell user={user}>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 mb-6 border-b bg-background/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={progressUrl}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại tiến độ Ngữ âm</Link>
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
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Lịch sử luyện tập Ngữ âm</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />{student.name ?? "Học viên"} · {student.email}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />Các lượt nộp ({activeSection?.attempts.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sections.length === 0 ? (
              <EmptyState title="Chưa có lịch sử Ngữ âm" message="Học viên chưa nộp bài luyện tập Ngữ âm trong bài này." />
            ) : (
              <>
                <div role="tablist" aria-label="Các phần luyện tập Ngữ âm" className="mb-5 flex gap-2 overflow-x-auto border-b">
                  {sections.map((section) => {
                    const selected = activeSection?.id === section.id;
                    return (
                      <button
                        key={section.id}
                        id={`phonetics-history-tab-${section.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`phonetics-history-panel-${section.id}`}
                        onClick={() => {
                          setSelectedSectionId(section.id);
                          setSelectedAttemptId(null);
                        }}
                        className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                          selected
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {section.title}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{section.attempts.length}</span>
                      </button>
                    );
                  })}
                </div>
                {activeSection && (
                  <div
                    id={`phonetics-history-panel-${activeSection.id}`}
                    role="tabpanel"
                    aria-labelledby={`phonetics-history-tab-${activeSection.id}`}
                    className="space-y-4"
                  >
                    {activeSection.attempts.length === 0 ? (
                      <EmptyState title="Chưa có lượt nộp" message="Học viên chưa làm phần Ngữ âm này." />
                    ) : (
                      <div className="space-y-4">
                        <div className="overflow-hidden rounded-md border">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-muted/40 text-xs text-muted-foreground">
                              <tr>
                                <th scope="col" className="w-16 px-4 py-3 font-medium">Lượt</th>
                                <th scope="col" className="px-4 py-3 font-medium">Thời gian nộp</th>
                                <th scope="col" className="px-4 py-3 font-medium">Kết quả</th>
                                <th scope="col" className="px-4 py-3 text-right font-medium">Thao tác</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {activeSection.attempts.map((attempt, index) => {
                                return (
                                  <tr key={attempt.id}>
                                    <td className="px-4 py-3 font-medium tabular-nums">{activeSection.attempts.length - index}</td>
                                    <td className="px-4 py-3">
                                      {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.completedAt))}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className="font-semibold tabular-nums">
                                        {attempt.correctCount != null && attempt.totalCount != null
                                          ? `${attempt.correctCount}/${attempt.totalCount} câu đúng`
                                          : "—/— câu đúng"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setSelectedAttemptId(attempt.id)}
                                      >
                                        Chi tiết
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      {activeAttempt && activeSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedAttemptId(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelectedAttemptId(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="phonetics-attempt-detail-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border bg-background p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="phonetics-attempt-detail-title" className="text-base font-semibold">
                  {activeSection.title} · Lượt {activeSection.attempts.length - activeAttemptIndex}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeAttempt.completedAt))}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Đóng" onClick={() => setSelectedAttemptId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mb-4 rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span className="font-semibold tabular-nums">
                {activeAttempt.correctCount != null && activeAttempt.totalCount != null
                  ? `${activeAttempt.correctCount}/${activeAttempt.totalCount} câu đúng`
                  : "—/— câu đúng"}
              </span>
            </div>
            {activeAttempt.results.length > 0 ? (
              <div className="divide-y rounded-md border">
                {activeAttempt.results.map((result, resultIndex) => (
                  <div key={`${activeAttempt.id}-${resultIndex}`} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <p className="font-medium">{result.prompt}{result.full ? ` · ${result.full}` : ""}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Học viên: <span className="font-medium text-foreground">{result.given || "Bỏ trống"}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        Đáp án: <span className="font-medium text-foreground">{result.correctAnswer || "—"}</span>
                      </p>
                      <span className={result.correct
                        ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        : "rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700"}
                      >
                        {result.correct ? "Đúng" : "Chưa đúng"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Lượt nộp này không có dữ liệu chi tiết từng câu.
              </p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
