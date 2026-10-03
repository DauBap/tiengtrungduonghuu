import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { requireRole } from "~/lib/session.server";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { ArrowLeft, BookOpen, CheckCircle2, ClipboardCheck, MessageSquareText, UserRound } from "lucide-react";
import { cn } from "~/lib/utils";
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS, isLessonTabKey } from "~/lib/lesson-tab-progress";

const TAB_LABELS: Record<string, string> = {
  FLASHCARD: "Flashcard",
  VOCABULARY_TEST: "Ôn từ vựng",
  LISTENING: "Nghe",
  VOCABULARY: "Từ vựng",
  LESSON: "Bài khóa",
  PHONETICS: "Ngữ âm",
  GRAMMAR: "Ngữ pháp",
  WORKBOOK: "Workbook",
};

function getTabStateTone(state: string | null | undefined) {
  switch (state) {
    case "COMPLETED": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "IN_PROGRESS": return "bg-amber-100 text-amber-700 border-amber-200";
    case "NEEDS_REVIEW": return "bg-rose-100 text-rose-700 border-rose-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: params.studentId!, courseId: course.id } },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });

  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  const lessons = await getLessonsByCourse(course.id);
  const progressRows = await prisma.lessonTabProgress.findMany({
    where: {
      userId: enrollment.userId,
      lessonId: { in: lessons.map((lesson) => lesson.id) },
    },
    include: {
      attempts: { orderBy: { completedAt: "desc" } },
      feedback: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { lessonId: "asc" },
  });

  return { user, course, student: enrollment.user, lessons, progressRows };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const returnLessonId = searchParams.get("lessonId");
  const returnTab = searchParams.get("tab");
  const returnQuery = returnLessonId && returnTab && isLessonTabKey(returnTab)
    ? `?lessonId=${encodeURIComponent(returnLessonId)}&tab=${returnTab}`
    : "";
  const detailPath = `/teacher/courses/${params.courseId}/students/${params.studentId}${returnQuery}`;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "save-student-tab-feedback") {
    return redirect(detailPath);
  }

  const studentId = String(form.get("studentId") ?? "").trim();
  const lessonId = String(form.get("lessonId") ?? "").trim();
  const tab = String(form.get("tab") ?? "").trim();
  const score = Number(form.get("score") ?? 0);
  const comment = String(form.get("comment") ?? "").trim();

  if (!studentId || !lessonId || !tab || !isLessonTabKey(tab)) {
    return redirect(detailPath);
  }

  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;

  const progress = await prisma.lessonTabProgress.upsert({
    where: { userId_lessonId_tab: { userId: studentId, lessonId, tab } },
    update: {
      opened: true,
      state: safeScore >= 80 ? "COMPLETED" : safeScore > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      completed: safeScore >= 80,
      percent: safeScore,
      currentScore: safeScore,
      bestScore: Math.max(safeScore, 0),
      lastAttemptAt: new Date(),
      completedAt: safeScore >= 80 ? new Date() : null,
    },
    create: {
      userId: studentId,
      lessonId,
      tab,
      opened: true,
      state: safeScore >= 80 ? "COMPLETED" : safeScore > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      completed: safeScore >= 80,
      percent: safeScore,
      currentScore: safeScore,
      bestScore: Math.max(safeScore, 0),
      lastAttemptAt: new Date(),
      completedAt: safeScore >= 80 ? new Date() : null,
    },
  });

  const { addLessonTabFeedback } = await import("~/lib/lesson-tab-progress.server");
  await addLessonTabFeedback(prisma, {
    tabProgressId: progress.id,
    teacherId: user.id,
    targetType: "manual_grade",
    targetId: `${studentId}:${lessonId}:${tab}`,
    score: safeScore,
    comment: comment || "Đã chấm tay bằng điểm thủ công.",
  });

  return redirect(detailPath);
}

export default function TeacherStudentDetail() {
  const { user, course, student, lessons, progressRows } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const returnLessonId = searchParams.get("lessonId");
  const returnTab = searchParams.get("tab") ?? "";
  const returnLesson = lessons.find((lesson) => lesson.id === returnLessonId);
  const selectedLessonProgress = returnLesson && returnTab === "LESSON"
    ? progressRows.find((row) => row.lessonId === returnLesson.id && row.tab === "LESSON")
    : undefined;
  const lessonAttempts = selectedLessonProgress?.attempts.filter((attempt) => attempt.tab === "LESSON") ?? [];
  const lessonScriptGroups = new Map<string, { title: string; attempts: typeof lessonAttempts }>();
  for (const attempt of lessonAttempts) {
    const details = isRecord(attempt.details) ? attempt.details : {};
    const title = typeof details.scriptTitle === "string" ? details.scriptTitle : "Bài khóa";
    const scriptId = typeof details.lessonAudioScriptId === "string" ? details.lessonAudioScriptId : title;
    const group = lessonScriptGroups.get(scriptId) ?? { title, attempts: [] };
    group.attempts.push(attempt);
    lessonScriptGroups.set(scriptId, group);
  }
  const orderedLessonScriptGroups = [...lessonScriptGroups.entries()]
    .sort(([, first], [, second]) => first.title.localeCompare(second.title, "vi", { numeric: true, sensitivity: "base" }));
  const activeScriptId = selectedScriptId && lessonScriptGroups.has(selectedScriptId)
    ? selectedScriptId
    : orderedLessonScriptGroups[0]?.[0] ?? null;
  const activeScriptGroup = activeScriptId ? lessonScriptGroups.get(activeScriptId) : undefined;
  const returnToProgress = returnLesson && isLessonTabKey(returnTab)
    ? `/teacher/courses/${course.id}/lessons/${returnLesson.id}?tab=${returnTab}`
    : null;

  const progressByLesson = new Map<string, typeof progressRows[number][]>();
  for (const row of progressRows) {
    const list = progressByLesson.get(row.lessonId) ?? [];
    list.push(row);
    progressByLesson.set(row.lessonId, list);
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={returnToProgress ?? `/teacher/courses/${course.id}`}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />{returnToProgress ? "Quay lại tiến độ bài học" : "Quay lại tiến độ"}
            </Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserRound className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Học viên</p>
              <h1 className="text-2xl font-bold tracking-tight">{student.name ?? "Học viên"}</h1>
              <p className="text-sm text-muted-foreground">{student.email}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              {returnLesson && returnTab === "LESSON"
                ? `Lịch sử Bài khóa: ${returnLesson.title}`
                : `Tiến độ khóa học: ${course.title}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {returnLesson && returnTab === "LESSON" ? (
              lessonAttempts.length === 0 ? (
                <EmptyState title="Chưa có bài nộp" message="Học viên chưa nộp lượt đọc nào cho bài khóa này." />
              ) : (
                <div className="space-y-4">
                  <div role="tablist" aria-label="Lịch sử từng bài khóa" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                    {orderedLessonScriptGroups.map(([scriptId, group]) => {
                      const selected = scriptId === activeScriptId;
                      return (
                        <button
                          key={scriptId}
                          id={`lesson-script-tab-${scriptId}`}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls="lesson-script-history-panel"
                          onClick={() => setSelectedScriptId(scriptId)}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span>{group.title}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px]", selected ? "bg-primary-foreground/15" : "bg-muted")}>
                            {group.attempts.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeScriptGroup && (
                    <section
                      id="lesson-script-history-panel"
                      role="tabpanel"
                      aria-labelledby={`lesson-script-tab-${activeScriptId}`}
                      className="divide-y"
                    >
                      {activeScriptGroup.attempts.map((attempt, index) => {
                        const details = isRecord(attempt.details) ? attempt.details : {};
                        const scriptText = typeof details.scriptText === "string" ? details.scriptText : "";
                        const transcript = typeof details.transcript === "string" ? details.transcript : "";
                        const evaluation = typeof details.evaluation === "string" ? details.evaluation : null;

                        return (
                          <article key={attempt.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <h2 className="font-medium">Lượt {activeScriptGroup.attempts.length - index}</h2>
                                <p className="text-xs text-muted-foreground">
                                  {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(attempt.completedAt)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {evaluation && (
                                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(attempt.score != null && attempt.score >= 80 ? "COMPLETED" : "IN_PROGRESS"))}>
                                    {evaluation}
                                  </span>
                                )}
                                <span className="font-semibold tabular-nums">
                                  {attempt.score != null ? `${Math.round(attempt.score)} / 100` : "— / 100"}
                                </span>
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-md border p-3">
                                <h3 className="text-xs font-semibold text-muted-foreground">Script bài khóa</h3>
                                <p className="mt-1 whitespace-pre-wrap text-sm">{scriptText || "—"}</p>
                              </div>
                              <div className="rounded-md border p-3">
                                <h3 className="text-xs font-semibold text-muted-foreground">Học viên đã đọc</h3>
                                <p className="mt-1 whitespace-pre-wrap text-sm">{transcript || "—"}</p>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  )}
                </div>
              )
            ) : lessons.length === 0 ? (
              <EmptyState title="Chưa có bài học" message="Khóa học này chưa có nội dung để theo dõi." />
            ) : (
              <div className="space-y-4">
                {lessons.map((lesson) => {
                  const rows = progressByLesson.get(lesson.id) ?? [];
                  const completedCount = rows.filter((row) => row.tab === "VOCABULARY_TEST"
                    ? row.attempts[0]?.passed === true
                    : row.completed).length;

                  return (
                    <div key={lesson.id} className="rounded-xl border bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">{lesson.title}</p>
                          <p className="text-xs text-muted-foreground">{completedCount}/{LESSON_TAB_KEYS.length} tab hoàn thành</p>
                        </div>
                        {completedCount === LESSON_TAB_KEYS.length ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />Hoàn tất
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            <ClipboardCheck className="h-3 w-3" />Đang theo dõi
                          </span>
                        )}
                      </div>

                      <div className="mb-3 flex flex-wrap gap-2">
                        {LESSON_TAB_KEYS.map((tab) => {
                          const row = rows.find((item) => item.tab === tab);
                          const latestVocabularyAttempt = tab === "VOCABULARY_TEST" ? row?.attempts[0] : undefined;
                          const state = tab === "VOCABULARY_TEST"
                            ? latestVocabularyAttempt?.passed === true
                              ? "COMPLETED"
                              : row?.opened
                                ? "IN_PROGRESS"
                                : "NOT_STARTED"
                            : row?.state ?? "NOT_STARTED";
                          const score = row?.currentScore ?? null;
                          return (
                            <div key={`${lesson.id}-${tab}`} className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium", getTabStateTone(state))}>
                              <span>{TAB_LABELS[tab] ?? tab}</span>
                              <span>{score != null ? `${Math.round(score)}%` : "-"}</span>
                            </div>
                          );
                        })}
                      </div>

                      <form method="post" className="flex flex-col gap-2 rounded-md border bg-white p-3 md:flex-row md:items-end">
                        <input type="hidden" name="intent" value="save-student-tab-feedback" />
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="lessonId" value={lesson.id} />
                        <div className="w-full md:max-w-[220px]">
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Tab cần chấm</label>
                          <select name="tab" defaultValue={LESSON_TAB_KEYS[0]} className="w-full rounded-md border bg-slate-50 px-2 py-1.5 text-sm">
                            {LESSON_TAB_KEYS.map((tab) => (
                              <option key={tab} value={tab}>{TAB_LABELS[tab] ?? tab}</option>
                            ))}
                          </select>
                        </div>
                        <div className="w-full md:max-w-[100px]">
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Điểm</label>
                          <input type="number" name="score" min={0} max={100} defaultValue={0} className="w-full rounded-md border bg-slate-50 px-2 py-1.5 text-sm" />
                        </div>
                        <div className="flex-1">
                          <input type="text" name="comment" placeholder="Nhận xét cho học sinh..." className="w-full rounded-md border bg-slate-50 px-2 py-1.5 text-sm" />
                        </div>
                        <Button type="submit" size="sm" className="whitespace-nowrap">
                          <MessageSquareText className="h-3.5 w-3.5 mr-1.5" />Lưu chấm
                        </Button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
