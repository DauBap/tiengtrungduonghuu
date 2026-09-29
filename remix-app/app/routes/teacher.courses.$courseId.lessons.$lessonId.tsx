import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { ArrowLeft, BookOpen, Check, MessageSquareText, UserRound, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { isLessonTabKey, LESSON_TAB_KEYS, type LessonTab } from "~/lib/lesson-tab-progress";
import { cn } from "~/lib/utils";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const TAB_LABELS: Record<string, string> = {
  FLASHCARD: "Flashcard",
  VOCABULARY_TEST: "Ôn từ vựng",
  LISTENING: "Nghe câu",
  VOCABULARY: "Từ vựng",
  LESSON: "Bài học",
  GRAMMAR: "Ngữ pháp",
  WORKBOOK: "Workbook",
};

const ANSWER_REVIEW_TABS = new Set<LessonTab>(["VOCABULARY_TEST", "LISTENING", "GRAMMAR", "WORKBOOK"]);

function getTabStateTone(state: string | null | undefined) {
  switch (state) {
    case "COMPLETED": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "IN_PROGRESS": return "bg-amber-100 text-amber-700 border-amber-200";
    case "NEEDS_REVIEW": return "bg-rose-100 text-rose-700 border-rose-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function TeacherTabComment({
  studentId,
  tab,
  studentName,
  feedback,
}: {
  studentId: string;
  tab: string;
  studentName: string;
  feedback?: { comment: string; createdAt: Date; teacher: { name: string | null } };
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={feedback ? "outline" : "ghost"}
        size="sm"
        className={feedback ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800" : undefined}
        onClick={() => setIsOpen(true)}
      >
        {feedback ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />}
        {feedback ? "Đã nhận xét" : "Nhận xét"}
      </Button>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`tab-comment-title-${studentId}-${tab}`}
            className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id={`tab-comment-title-${studentId}-${tab}`} className="text-base font-semibold">Nhận xét học sinh</h2>
                <p className="mt-1 text-sm text-muted-foreground">{studentName} · {TAB_LABELS[tab] ?? tab}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Đóng" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {feedback ? (
              <div className="mb-4 rounded-md border bg-muted/30 p-3">
                <p className="whitespace-pre-wrap text-sm">{feedback.comment}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {feedback.teacher.name ?? "Giáo viên"} · {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(feedback.createdAt)}
                </p>
              </div>
            ) : (
              <p className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">Chưa có nhận xét cho tab này.</p>
            )}

            <form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="save-tab-comment" />
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="tab" value={tab} />
              <label className="block text-sm font-medium" htmlFor={`tab-comment-input-${studentId}-${tab}`}>Nhận xét mới</label>
              <textarea
                id={`tab-comment-input-${studentId}-${tab}`}
                name="comment"
                required
                rows={4}
                placeholder="Viết nhận xét cho học sinh..."
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Hủy</Button>
                <Button type="submit">Lưu nhận xét</Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const students = await prisma.enrollment.findMany({
    where: { courseId: course.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const answerReviewTabs = await prisma.lesson.findUnique({
    where: { id: lesson.id },
    select: { answerReviewTabs: true },
  });

  const progressRows = students.length === 0
    ? []
    : await prisma.lessonTabProgress.findMany({
        where: {
          lessonId: lesson.id,
          userId: { in: students.map((enrollment) => enrollment.userId) },
        },
        include: {
          attempts: {
            where: { tab: { in: ["VOCABULARY_TEST", "LISTENING", "GRAMMAR", "WORKBOOK"] } },
            orderBy: { completedAt: "desc" },
          },
          feedback: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { teacher: { select: { name: true } } },
          },
        },
        orderBy: { userId: "asc" },
      });

  return { user, course, lesson, students, progressRows, answerReviewTabs: answerReviewTabs?.answerReviewTabs ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const allowed = await isTeacherOfCourse(user.id, course.id);
  if (!allowed) throw new Response("Không có quyền truy cập", { status: 403 });

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save-tab-grade");
  const studentId = String(form.get("studentId") ?? "").trim();
  const tab = String(form.get("tab") ?? "").trim();
  const rawScore = Number(form.get("score") ?? 0);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  const comment = String(form.get("comment") ?? "").trim();

  if (intent === "open-answer-review") {
    if (!isLessonTabKey(tab) || !ANSWER_REVIEW_TABS.has(tab)) {
      return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}`);
    }
    const current = await prisma.lesson.findUnique({
      where: { id: lesson.id },
      select: { answerReviewTabs: true },
    });
    if (!current) throw new Response("Không tìm thấy bài học", { status: 404 });
    if (!current.answerReviewTabs.includes(tab)) {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { answerReviewTabs: { push: tab } },
      });
    }
    return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}?tab=${tab}`);
  }

  if (!studentId || !isLessonTabKey(tab)) {
    return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}`);
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: studentId, courseId: course.id } },
    select: { userId: true },
  });
  if (!enrollment) throw new Response("Học viên không thuộc khóa học này", { status: 404 });

  if (intent === "save-tab-comment") {
    if (!comment) return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}?tab=${tab}`);

    const tabProgress = await prisma.lessonTabProgress.upsert({
      where: { userId_lessonId_tab: { userId: studentId, lessonId: lesson.id, tab } },
      update: { opened: true },
      create: { userId: studentId, lessonId: lesson.id, tab, opened: true },
    });
    const { addLessonTabFeedback } = await import("~/lib/lesson-tab-progress.server");
    await addLessonTabFeedback(prisma, {
      tabProgressId: tabProgress.id,
      teacherId: user.id,
      targetType: "teacher_comment",
      targetId: `${studentId}:${lesson.id}:${tab}`,
      comment,
    });
    return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}?tab=${tab}`);
  }

  const progress = await prisma.lessonTabProgress.upsert({
    where: { userId_lessonId_tab: { userId: studentId, lessonId: lesson.id, tab } },
    update: {
      opened: true,
      state: score >= 80 ? "COMPLETED" : score > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      completed: score >= 80,
      percent: score,
      currentScore: score,
      bestScore: score,
      lastAttemptAt: new Date(),
      completedAt: score >= 80 ? new Date() : null,
    },
    create: {
      userId: studentId,
      lessonId: lesson.id,
      tab,
      opened: true,
      state: score >= 80 ? "COMPLETED" : score > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      completed: score >= 80,
      percent: score,
      currentScore: score,
      bestScore: score,
      lastAttemptAt: new Date(),
      completedAt: score >= 80 ? new Date() : null,
    },
  });

  if (comment) {
    const { addLessonTabFeedback } = await import("~/lib/lesson-tab-progress.server");
    await addLessonTabFeedback(prisma, {
      tabProgressId: progress.id,
      teacherId: user.id,
      targetType: "manual_grade",
      targetId: `${studentId}:${lesson.id}:${tab}`,
      score,
      comment,
    });
  }

  return redirect(`/teacher/courses/${course.id}/lessons/${lesson.id}?tab=${tab}`);
}

export default function TeacherLessonProgress() {
  const { user, course, lesson, students, progressRows, answerReviewTabs } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") ?? "";
  const activeTab = isLessonTabKey(requestedTab) ? requestedTab : LESSON_TAB_KEYS[0];
  const progressByStudent = new Map<string, typeof progressRows>();

  for (const row of progressRows) {
    const rows = progressByStudent.get(row.userId) ?? [];
    rows.push(row);
    progressByStudent.set(row.userId, rows);
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/teacher/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại danh sách bài học</Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{course.title}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{lesson.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{lesson.subtitle}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="h-4 w-4" />Tiến độ theo tab ({students.length} học viên)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {students.length === 0 ? (
              <EmptyState title="Chưa có học viên" message="Khóa học này chưa có học viên đăng ký." />
            ) : (
              <>
                <div role="tablist" aria-label="Tiến độ theo từng tab" className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2">
                  {LESSON_TAB_KEYS.map((tab) => {
                    const completedCount = progressRows.filter((row) => {
                      if (row.tab !== tab) return false;
                      return tab === "VOCABULARY_TEST" ? row.attempts[0]?.passed === true : row.completed;
                    }).length;
                    const selected = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setSearchParams({ tab }, { preventScrollReset: true })}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span>{TAB_LABELS[tab] ?? tab}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px]", selected ? "bg-primary-foreground/15" : "bg-muted")}>
                          {completedCount}/{students.length}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div role="tabpanel" aria-label={TAB_LABELS[activeTab]}>
                  {ANSWER_REVIEW_TABS.has(activeTab) && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {answerReviewTabs.includes(activeTab) ? "Đã mở xem đáp án chi tiết" : "Đáp án chi tiết đang đóng"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {answerReviewTabs.includes(activeTab)
                            ? "Học sinh đã có lượt làm sẽ không thể nộp lại phần này."
                            : "Mở đáp án sẽ khóa các lượt làm lại của học sinh ở tab này."}
                        </p>
                      </div>
                      {answerReviewTabs.includes(activeTab) ? (
                        <span className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm font-medium text-success">
                          Đã mở
                        </span>
                      ) : (
                        <form method="post">
                          <input type="hidden" name="intent" value="open-answer-review" />
                          <input type="hidden" name="tab" value={activeTab} />
                          <Button type="submit" size="sm">Mở đáp án và khóa làm lại</Button>
                        </form>
                      )}
                    </div>
                  )}
                  {activeTab === "FLASHCARD" || activeTab === "VOCABULARY" ? (
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                            <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                            <th scope="col" className="w-48 px-4 py-3 font-medium">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {students.map((enrollment, index) => {
                            const student = enrollment.user;
                            const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === activeTab);
                            const stateLabel = row?.state === "COMPLETED"
                              ? "Hoàn thành"
                              : row?.state === "IN_PROGRESS"
                                ? "Đang học"
                                : row?.state === "NEEDS_REVIEW"
                                  ? "Cần xem lại"
                                  : "Chưa bắt đầu";

                            return (
                              <tr key={student.id}>
                                <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                                <td className="px-4 py-3 font-medium">{student.name ?? "Học viên"}</td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(row?.state))}>
                                      {stateLabel}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : activeTab === "VOCABULARY_TEST" ? (
                    <>
                      <div className="overflow-hidden rounded-md border">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                              <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                              <th scope="col" className="px-4 py-3 font-medium">Kết quả mới nhất</th>
                              <th scope="col" className="px-4 py-3 font-medium">Số câu đúng / tổng</th>
                              <th scope="col" className="px-4 py-3 font-medium">Số lần làm</th>
                              <th scope="col" className="px-4 py-3 text-right font-medium">Lịch sử</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {students.map((enrollment, index) => {
                              const student = enrollment.user;
                              const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === activeTab);
                              const latestAttempt = row?.attempts[0];
                              const latestResult = latestAttempt == null
                                ? "Chưa làm"
                                : latestAttempt.passed === true
                                  ? "Đạt"
                                  : latestAttempt.passed === false
                                    ? "Chưa đạt"
                                    : "Chưa xác định";
                              const resultState = latestAttempt?.passed === true
                                ? "COMPLETED"
                                : latestAttempt == null
                                  ? "NOT_STARTED"
                                  : "IN_PROGRESS";

                              return (
                                <tr key={student.id}>
                                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                                  <td className="px-4 py-3 font-medium">{student.name ?? "Học viên"}</td>
                                  <td className="px-4 py-3">
                                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(resultState))}>
                                      {latestResult}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 font-medium tabular-nums">
                                    {latestAttempt?.correctCount != null && latestAttempt.totalCount != null
                                      ? `${latestAttempt.correctCount}/${latestAttempt.totalCount}`
                                      : "-"}
                                  </td>
                                  <td className="px-4 py-3 font-medium tabular-nums">
                                    {row?.attempts.length ?? 0}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      <TeacherTabComment studentId={student.id} studentName={student.name ?? "Học viên"} tab={activeTab} feedback={row?.feedback[0]} />
                                      <Button asChild size="sm" variant="outline">
                                        <Link to={`/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/vocabulary-history`}>
                                          Chi tiết
                                        </Link>
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : activeTab === "LISTENING" ? (
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                            <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                            <th scope="col" className="px-4 py-3 font-medium">Kết quả mới nhất</th>
                            <th scope="col" className="px-4 py-3 font-medium">Số câu đúng / tổng</th>
                            <th scope="col" className="px-4 py-3 font-medium">Số lần làm</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {students.map((enrollment, index) => {
                            const student = enrollment.user;
                            const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === "LISTENING");
                            const attempts = row?.attempts.filter((attempt) => attempt.tab === "LISTENING") ?? [];
                            const latestAttempt = attempts[0];
                            const latestResult = latestAttempt == null
                              ? "Chưa làm"
                              : latestAttempt.passed === true
                                ? "Đạt"
                                : "Chưa đạt";
                            const latestState = latestAttempt == null
                              ? "NOT_STARTED"
                              : latestAttempt.passed === true
                                ? "COMPLETED"
                                : "NEEDS_REVIEW";

                            return (
                              <tr key={student.id}>
                                <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                                <td className="px-4 py-3 font-medium">{student.name ?? "Học viên"}</td>
                                <td className="px-4 py-3">
                                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(latestState))}>
                                    {latestResult}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">
                                  {latestAttempt?.correctCount != null && latestAttempt.totalCount != null
                                    ? `${latestAttempt.correctCount}/${latestAttempt.totalCount}`
                                    : "-"}
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">{attempts.length}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <TeacherTabComment
                                      studentId={student.id}
                                      studentName={student.name ?? "Học viên"}
                                      tab={activeTab}
                                      feedback={row?.feedback[0]}
                                    />
                                    <Button asChild size="sm" variant="outline">
                                      <Link to={`/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/listening-history`}>
                                        Chi tiết
                                      </Link>
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : activeTab === "WORKBOOK" ? (
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                            <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                            <th scope="col" className="px-4 py-3 font-medium">Kết quả mới nhất</th>
                            <th scope="col" className="px-4 py-3 font-medium">Điểm</th>
                            <th scope="col" className="px-4 py-3 font-medium">Số lượt nộp</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Lịch sử</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {students.map((enrollment, index) => {
                            const student = enrollment.user;
                            const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === "WORKBOOK");
                            const attempts = row?.attempts.filter((attempt) => attempt.tab === "WORKBOOK") ?? [];
                            const latestAttempt = attempts[0];
                            const latestState = latestAttempt == null
                              ? "NOT_STARTED"
                              : latestAttempt.passed === true
                                ? "COMPLETED"
                                : "NEEDS_REVIEW";

                            return (
                              <tr key={student.id}>
                                <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                                <td className="px-4 py-3 font-medium">{student.name ?? "Học viên"}</td>
                                <td className="px-4 py-3">
                                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(latestState))}>
                                    {latestAttempt == null ? "Chưa làm" : latestAttempt.passed ? "Đạt" : "Chưa đạt"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">
                                  {latestAttempt?.score != null ? `${Math.round(latestAttempt.score)}%` : "-"}
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">{attempts.length}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <TeacherTabComment
                                      studentId={student.id}
                                      studentName={student.name ?? "Học viên"}
                                      tab="WORKBOOK"
                                      feedback={row?.feedback[0]}
                                    />
                                    <Button asChild size="sm" variant="outline">
                                      <Link to={`/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/workbook-history`}>
                                        Chi tiết
                                      </Link>
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : activeTab === "GRAMMAR" ? (
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th scope="col" className="w-16 px-4 py-3 font-medium">STT</th>
                            <th scope="col" className="px-4 py-3 font-medium">Họ tên</th>
                            <th scope="col" className="px-4 py-3 font-medium">Kết quả mới nhất</th>
                            <th scope="col" className="px-4 py-3 font-medium">Số lần làm</th>
                            <th scope="col" className="px-4 py-3 text-right font-medium">Lịch sử</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {students.map((enrollment, index) => {
                            const student = enrollment.user;
                            const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === "GRAMMAR");
                            const attempts = row?.attempts.filter((attempt) => attempt.tab === "GRAMMAR") ?? [];
                            const latestAttempt = attempts[0];
                            const latestState = latestAttempt == null
                              ? "NOT_STARTED"
                              : latestAttempt.passed === true
                                ? "COMPLETED"
                                : "NEEDS_REVIEW";

                            return (
                              <tr key={student.id}>
                                <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                                <td className="px-4 py-3 font-medium">{student.name ?? "Học viên"}</td>
                                <td className="px-4 py-3">
                                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(latestState))}>
                                    {latestAttempt == null ? "Chưa làm" : latestAttempt.passed ? "Đạt" : "Chưa đạt"}
                                  </span>
                                  {latestAttempt?.passed === true && latestAttempt.score != null && (
                                    <span className="ml-2 font-semibold tabular-nums">{latestAttempt.score}%</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums">{attempts.length}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <TeacherTabComment
                                      studentId={student.id}
                                      studentName={student.name ?? "Học viên"}
                                      tab="GRAMMAR"
                                      feedback={row?.feedback[0]}
                                    />
                                    <Button asChild size="sm" variant="outline">
                                      <Link to={`/teacher/courses/${course.id}/lessons/${lesson.id}/students/${student.id}/grammar-history`}>
                                        Chi tiết
                                      </Link>
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {students.map((enrollment) => {
                        const student = enrollment.user;
                        const row = (progressByStudent.get(student.id) ?? []).find((item) => item.tab === activeTab);
                        const stateLabel = row?.state === "COMPLETED"
                          ? "Hoàn thành"
                          : row?.state === "IN_PROGRESS"
                            ? "Đang học"
                            : row?.state === "NEEDS_REVIEW"
                              ? "Cần xem lại"
                              : "Chưa bắt đầu";

                        return (
                          <section key={student.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{student.name ?? "Học viên"}</p>
                                <p className="truncate text-xs text-muted-foreground">{student.email}</p>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", getTabStateTone(row?.state))}>
                                  {stateLabel}
                                </span>
                                <span className="min-w-12 text-right text-sm font-semibold tabular-nums">
                                  {row?.currentScore != null ? `${Math.round(row.currentScore)}%` : "-"}
                                </span>
                                <Button asChild size="sm" variant="outline">
                                  <Link to={`/teacher/courses/${course.id}/students/${student.id}?lessonId=${encodeURIComponent(lesson.id)}&tab=${activeTab}`}>Chi tiết</Link>
                                </Button>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <TeacherTabComment studentId={student.id} studentName={student.name ?? "Học viên"} tab={activeTab} feedback={row?.feedback[0]} />
                              <form method="post" className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2">
                                <input type="hidden" name="intent" value="save-tab-grade" />
                                <input type="hidden" name="studentId" value={student.id} />
                                <input type="hidden" name="tab" value={activeTab} />
                                <div className="w-24">
                                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Điểm</label>
                                  <input type="number" name="score" min={0} max={100} defaultValue={row?.currentScore ?? 0} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
                                </div>
                                <Button type="submit" size="sm" className="whitespace-nowrap">Lưu điểm</Button>
                              </form>
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}