import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { ArrowUpRight, CheckCheck, ClipboardCheck, Clock3 } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

type ReviewStatus = "pending" | "graded";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getReviewStatus(details: unknown): ReviewStatus | null {
  if (!isRecord(details)) return null;
  if (isRecord(details.teacherGrading) && typeof details.teacherGrading.gradedAt === "string") {
    return "graded";
  }
  return details.reviewPending === true ? "pending" : null;
}

function getReviewTitle(tab: string, details: unknown) {
  const record = isRecord(details) ? details : {};
  if (tab === "GRAMMAR") {
    const sectionTitle = typeof record.sectionTitle === "string" ? record.sectionTitle : "Ngữ pháp";
    return `Ngữ pháp · ${sectionTitle}`;
  }
  return typeof record.blockTitle === "string" ? record.blockTitle : "Sách bài tập";
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const attempts = await prisma.lessonTabAttempt.findMany({
    where: {
      userId: user.id,
      tab: { in: ["GRAMMAR", "WORKBOOK"] },
    },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      tab: true,
      score: true,
      completedAt: true,
      details: true,
      lesson: {
        select: {
          id: true,
          order: true,
          title: true,
          course: { select: { id: true, code: true } },
        },
      },
    },
  });

  const assignments = attempts.flatMap((attempt) => {
    const status = getReviewStatus(attempt.details);
    if (!status) return [];
    const details = isRecord(attempt.details) ? attempt.details : {};
    const teacherGrading = isRecord(details.teacherGrading) ? details.teacherGrading : null;
    return [{
      id: attempt.id,
      status,
      title: getReviewTitle(attempt.tab, attempt.details),
      courseCode: attempt.lesson.course.code,
      lessonOrder: attempt.lesson.order,
      lessonTitle: attempt.lesson.title,
      score: attempt.score,
      submittedAt: attempt.completedAt.toISOString(),
      gradedAt: status === "graded" && typeof teacherGrading?.gradedAt === "string"
        ? teacherGrading.gradedAt
        : null,
      href: `/student/courses/${encodeURIComponent(attempt.lesson.course.id)}/lessons/${encodeURIComponent(attempt.lesson.id)}?reviewAttemptId=${encodeURIComponent(attempt.id)}`,
    }];
  });

  return { user, assignments };
}

export default function StudentAssignments() {
  const { user, assignments } = useLoaderData<typeof loader>();
  const location = useLocation();
  const activeStatus: ReviewStatus = new URLSearchParams(location.search).get("status") === "graded"
    ? "graded"
    : "pending";
  const pendingAssignments = assignments.filter((assignment) => assignment.status === "pending");
  const gradedAssignments = assignments.filter((assignment) => assignment.status === "graded");
  const visibleAssignments = activeStatus === "pending" ? pendingAssignments : gradedAssignments;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bài cần chấm</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Theo dõi bài Ngữ pháp và Sách bài tập cần giáo viên xem.
              </p>
            </div>
          </div>
        </header>

        <nav
          aria-label="Trạng thái bài làm"
          className="flex w-full gap-1 border-b"
        >
          <Link
            to="/student/assignments?status=pending"
            aria-current={activeStatus === "pending" ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 ${
              activeStatus === "pending"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Chờ chấm
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {pendingAssignments.length}
            </span>
          </Link>
          <Link
            to="/student/assignments?status=graded"
            aria-current={activeStatus === "graded" ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 ${
              activeStatus === "graded"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Đã chấm
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
              {gradedAssignments.length}
            </span>
          </Link>
        </nav>

        {visibleAssignments.length > 0 ? (
          <ul className="overflow-hidden rounded-xl border bg-background">
            {visibleAssignments.map((assignment) => {
              const isPending = assignment.status === "pending";
              return (
                <li key={assignment.id} className="border-b last:border-b-0">
                  <Link
                    to={assignment.href}
                    className="group flex min-h-24 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-5"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      isPending
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                    }`}>
                      {isPending
                        ? <Clock3 className="h-5 w-5" aria-hidden="true" />
                        : <CheckCheck className="h-5 w-5" aria-hidden="true" />}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 className="font-semibold leading-snug">{assignment.title}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          isPending
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                            : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
                        }`}>
                          {isPending ? "Chờ giáo viên chấm" : "Đã chấm"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {assignment.courseCode} · Bài {assignment.lessonOrder}: {assignment.lessonTitle}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isPending
                          ? <>Đã nộp <time dateTime={assignment.submittedAt}>{formatDate(assignment.submittedAt)}</time></>
                          : <>Đã chấm <time dateTime={assignment.gradedAt ?? assignment.submittedAt}>
                              {formatDate(assignment.gradedAt ?? assignment.submittedAt)}
                            </time></>}
                        {!isPending && assignment.score !== null && (
                          <span className="ml-2 font-semibold text-foreground">
                            {new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(assignment.score)}%
                          </span>
                        )}
                      </p>
                    </div>

                    <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-primary sm:inline-flex">
                      Xem bài <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed px-5 py-12 text-center">
            {activeStatus === "pending" ? (
              <>
                <Clock3 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-3 font-semibold">Không có bài nào đang chờ chấm</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Bài Ngữ pháp dạng điền câu và bài tập cần giáo viên xem sẽ xuất hiện ở đây sau khi bạn nộp.
                </p>
              </>
            ) : (
              <>
                <CheckCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-3 font-semibold">Chưa có bài được chấm</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Khi giáo viên chấm xong, bài làm và điểm số sẽ được lưu tại đây.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
