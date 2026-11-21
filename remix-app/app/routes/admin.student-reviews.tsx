import type { LoaderFunctionArgs } from "react-router";
import { Fragment, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { StudentInfoModal } from "~/components/common/student-info-modal";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { resolveFinalEvaluationStatus } from "~/lib/student-review-status";

const HSK_LEVELS = [1, 2, 3, 4, 5] as const;
const PAGE_SIZE = 10;

type ProgressClass = {
  id: string;
  name: string;
  createdAt: Date;
  completedAt: Date | null;
  teacher: { name: string } | null;
  course: { hskLevel: number; code: string; title: string };
};

type ProgressReview = {
  id: string;
  sessionType: "MIDTERM" | "FINAL";
  sessionNumber: number;
  status: string;
  updatedAt: Date;
  teacher: { name: string } | null;
  classroom: ProgressClass;
};

type ProgressFinalResult = {
  score: number;
  comment: string;
  attendedSessions: number;
  totalSessions: number;
  decision: string | null;
  classroom: ProgressClass;
};

type StudentProgressData = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  enrollments: { createdAt: Date; class: ProgressClass | null }[];
  studentClassReviews: ProgressReview[];
  classFinalResults: ProgressFinalResult[];
};

type HskCell = {
  status: "IN_PROGRESS" | "COMPLETED" | "DROPPED_OUT" | "NONE";
  selectedClass: ClassHistoryEntry | null;
};

type ClassHistoryEntry = {
  classroom: ProgressClass;
  enrolledAt: Date | null;
  finalReviewStatus: string | null;
  legacyDecision: string | null;
  reviews: ProgressReview[];
  finalResult: ProgressFinalResult | null;
};

type TransitionStatus = "ENROLLED" | "CAN_CONTINUE" | "STOPPED" | "DROPPED_OUT" | "UNKNOWN";
type SelectedStudentInfo =
  | { kind: "student"; student: StudentProgressData }
  | { kind: "class"; student: StudentProgressData; hskLevel: number; history: ClassHistoryEntry };

function parsePage(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function getStudentHskProgress(student: StudentProgressData) {
  const classHistory = new Map<string, ClassHistoryEntry>();
  const ensureClass = (classroom: ProgressClass) => {
    let entry = classHistory.get(classroom.id);
    if (!entry) {
      entry = {
        classroom,
        enrolledAt: null,
        finalReviewStatus: null,
        legacyDecision: null,
        reviews: [],
        finalResult: null,
      };
      classHistory.set(classroom.id, entry);
    }
    return entry;
  };

  for (const enrollment of student.enrollments) {
    if (!enrollment.class) continue;
    const entry = ensureClass(enrollment.class);
    if (!entry.enrolledAt || enrollment.createdAt > entry.enrolledAt) {
      entry.enrolledAt = enrollment.createdAt;
    }
  }

  for (const review of student.studentClassReviews) {
    const entry = ensureClass(review.classroom);
    entry.reviews.push(review);
    if (review.sessionType === "FINAL") entry.finalReviewStatus = review.status;
  }

  for (const result of student.classFinalResults) {
    const entry = ensureClass(result.classroom);
    entry.legacyDecision = result.decision;
    entry.finalResult = result;
  }

  const entries = [...classHistory.values()];
  const levels: HskCell[] = HSK_LEVELS.map((hskLevel) => {
    const levelEntries = entries.filter((entry) => entry.classroom.course.hskLevel === hskLevel);
    const inProgressEntries = levelEntries
      .filter((entry) => entry.classroom.completedAt === null)
      .sort((left, right) =>
        (left.enrolledAt ?? left.classroom.createdAt).getTime()
        - (right.enrolledAt ?? right.classroom.createdAt).getTime());
    const completedEntries = levelEntries
      .filter((entry) => entry.classroom.completedAt !== null)
      .sort((left, right) =>
        (left.classroom.completedAt?.getTime() ?? 0)
        - (right.classroom.completedAt?.getTime() ?? 0));
    const selectedClass = inProgressEntries[inProgressEntries.length - 1]
      ?? completedEntries[completedEntries.length - 1]
      ?? null;
    const evaluationStatus = selectedClass
      ? resolveFinalEvaluationStatus(selectedClass.finalReviewStatus, selectedClass.legacyDecision)
      : null;

    return {
      status: evaluationStatus === "DROPPED_OUT"
        ? "DROPPED_OUT"
        : selectedClass
          ? selectedClass.classroom.completedAt === null ? "IN_PROGRESS" : "COMPLETED"
          : "NONE",
      selectedClass,
    };
  });

  const transitions: TransitionStatus[] = HSK_LEVELS.slice(0, -1).map((hskLevel, index) => {
    const previousClass = levels[index].selectedClass;
    if (!previousClass) return "UNKNOWN";

    if (entries.some((entry) =>
      entry.classroom.course.hskLevel === hskLevel + 1 && entry.enrolledAt !== null)) {
      return "ENROLLED";
    }

    const status = resolveFinalEvaluationStatus(
      previousClass.finalReviewStatus,
      previousClass.legacyDecision,
    );
    if (status === "DROPPED_OUT") return "DROPPED_OUT";
    if (previousClass.classroom.completedAt === null) return "UNKNOWN";
    if (status === "CAN_ADVANCE" || status === "PROMOTE" || status === "ELIGIBLE_NOT_ENROLLED") {
      return "CAN_CONTINUE";
    }
    if (status === "CANNOT_ADVANCE" || status === "REPEAT") {
      return "STOPPED";
    }
    return "UNKNOWN";
  });

  return { levels, transitions };
}

function getTransitionDescription(status: TransitionStatus, hskLevel: number, previousLevel: HskCell) {
  switch (status) {
    case "ENROLLED":
      return `Đã ghi danh học HSK ${hskLevel + 1}`;
    case "CAN_CONTINUE":
      return `Đánh giá cuối kỳ cho phép học lên HSK ${hskLevel + 1}, chưa ghi danh`;
    case "STOPPED":
      return `Đánh giá cuối kỳ cho biết không học tiếp sau HSK ${hskLevel}`;
    case "DROPPED_OUT":
      return `Đánh giá cuối kỳ ghi nhận học viên đã bỏ học sau HSK ${hskLevel}`;
    default:
      if (previousLevel.status === "NONE") return `Chưa có dữ liệu học HSK ${hskLevel}`;
      if (previousLevel.status === "IN_PROGRESS") {
        return `Đang học HSK ${hskLevel}, chưa có kết quả cuối kỳ`;
      }
      return `Chưa có kết quả cuối kỳ cho HSK ${hskLevel}`;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const requestedPage = parsePage(url.searchParams.get("page"));
  const studentFilter = {
    role: "student" as const,
    deletedAt: null,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const hskClassFilter = {
    is: { course: { is: { hskLevel: { in: [...HSK_LEVELS] } } } },
  };

  const totalStudents = await prisma.user.count({ where: studentFilter });
  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const students = await prisma.user.findMany({
    where: studentFilter,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      enrollments: {
        where: {
          classId: { not: null },
          class: hskClassFilter,
        },
        select: {
          createdAt: true,
          class: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              completedAt: true,
              teacher: { select: { name: true } },
              course: { select: { hskLevel: true, code: true, title: true } },
            },
          },
        },
      },
      studentClassReviews: {
        where: {
          classroom: hskClassFilter,
        },
        orderBy: [{ createdAt: "asc" }, { sessionNumber: "asc" }],
        select: {
          id: true,
          sessionType: true,
          sessionNumber: true,
          status: true,
          updatedAt: true,
          teacher: { select: { name: true } },
          classroom: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              completedAt: true,
              teacher: { select: { name: true } },
              course: { select: { hskLevel: true, code: true, title: true } },
            },
          },
        },
      },
      classFinalResults: {
        where: { classroom: hskClassFilter },
        select: {
          score: true,
          comment: true,
          attendedSessions: true,
          totalSessions: true,
          decision: true,
          classroom: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              completedAt: true,
              teacher: { select: { name: true } },
              course: { select: { hskLevel: true, code: true, title: true } },
            },
          },
        },
      },
    },
  });

  return {
    user,
    students,
    query,
    page,
    pageSize: PAGE_SIZE,
    totalStudents,
    totalPages,
    backTo: url.search,
  };
}

export default function AdminStudentReviews() {
  const { user, students, query, page, pageSize, totalStudents, totalPages, backTo } =
    useLoaderData<typeof loader>();
  const [selectedInfo, setSelectedInfo] = useState<SelectedStudentInfo | null>(null);

  function getPageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("page", String(nextPage));
    return `/admin/student-reviews?${params.toString()}`;
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-[90rem] space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Lịch sử đánh giá học viên</h1>
          <p className="text-sm text-muted-foreground">
            Theo dõi tiến trình HSK 1–5 của từng học viên. Đường nối dựa trên đánh giá cuối kỳ và ghi danh thực tế.
          </p>
        </header>

        <form method="get" className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
          <label className="w-full space-y-1.5 sm:max-w-md">
            <span className="text-sm font-medium">Tìm học viên</span>
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={query}
                placeholder="Tên, số điện thoại hoặc email"
                className="pl-9"
              />
            </span>
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit">Tìm kiếm</Button>
            {query && (
              <Link
                to="/admin/student-reviews"
                className="inline-flex h-10 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xóa tìm kiếm
              </Link>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {totalStudents === 0
              ? "Chưa có học viên khớp tìm kiếm."
              : `Hiển thị ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalStudents)} / ${totalStudents} học viên`}
          </p>
          <p className="text-xs text-muted-foreground">Mỗi trang {pageSize} học viên</p>
        </div>

        <div role="group" aria-label="Chú giải tiến trình HSK" className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2 py-1 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">Đang học</span>
            Học viên đang ở lớp chưa kết thúc
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">Đã xong</span>
            Lớp đã kết thúc
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-1 w-8 rounded-full bg-emerald-500" />
            Đã ghi danh cấp tiếp theo
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-1 w-8 rounded-full bg-amber-400" />
            Được đánh giá có thể học lên
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="relative h-1 w-8 rounded-full bg-muted">
              <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-rose-500" />
            </span>
            Đánh giá không học tiếp
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              Bỏ học
            </span>
            Đánh giá ghi nhận bỏ học
          </span>
        </div>

        {students.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <h2 className="font-semibold">
              {query ? "Không tìm thấy học viên" : "Chưa có học viên"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query ? "Thử tìm bằng tên, số điện thoại hoặc email khác." : "Học viên sẽ xuất hiện tại đây khi được tạo trong hệ thống."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[1160px] border-collapse text-left">
              <caption className="sr-only">Tiến trình học HSK 1 đến HSK 5 của học viên</caption>
              <thead className="bg-muted/70">
                <tr className="border-b">
                  <th scope="col" className="sticky left-0 z-10 min-w-56 border-r bg-muted/90 px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Học viên
                  </th>
                  {HSK_LEVELS.map((level, index) => (
                    <Fragment key={level}>
                      {index > 0 && (
                        <th scope="col" className="w-14 min-w-14 px-1 py-3">
                          <span className="sr-only">Nối HSK {level - 1} đến HSK {level}</span>
                        </th>
                      )}
                      <th scope="col" className="min-w-36 px-3 py-3 text-center text-xs font-semibold text-muted-foreground">
                        HSK {level}
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((student) => {
                  const progress = getStudentHskProgress(student);
                  return (
                    <tr key={student.id} className="group hover:bg-muted/30">
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] min-w-56 border-r bg-card px-4 py-3 font-medium group-hover:bg-muted/30"
                      >
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setSelectedInfo({ kind: "student", student })}
                          className="inline-flex max-w-full items-center text-left text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate">{student.name}</span>
                        </button>
                      </th>
                      {progress.levels.map((level, index) => (
                        <Fragment key={HSK_LEVELS[index]}>
                          {index > 0 && (() => {
                            const status = progress.transitions[index - 1];
                            const description = getTransitionDescription(
                              status,
                              HSK_LEVELS[index - 1],
                              progress.levels[index - 1],
                            );
                            return (
                              <td key={`transition-${HSK_LEVELS[index]}`} className="w-14 min-w-14 px-1 py-3">
                                <div
                                  role="img"
                                  aria-label={description}
                                  title={description}
                                  className="relative flex h-6 items-center"
                                >
                                  {status === "ENROLLED" && (
                                    <span aria-hidden="true" className="h-1 w-full rounded-full bg-emerald-500" />
                                  )}
                                  {status === "CAN_CONTINUE" && (
                                    <span aria-hidden="true" className="h-1 w-full rounded-full bg-amber-400" />
                                  )}
                                  {(status === "STOPPED" || status === "DROPPED_OUT") && (
                                    <span aria-hidden="true" className="h-1 w-full rounded-full bg-muted" />
                                  )}
                                  {(status === "STOPPED" || status === "DROPPED_OUT") && (
                                    <span aria-hidden="true" className="absolute left-1/2 h-6 w-0.5 -translate-x-1/2 rotate-45 bg-rose-500" />
                                  )}
                                </div>
                              </td>
                            );
                          })()}
                          <td className="min-w-36 px-3 py-3 text-center">
                            {level.status === "NONE" || !level.selectedClass ? (
                              <span className="sr-only">Chưa có dữ liệu HSK {HSK_LEVELS[index]}</span>
                            ) : (
                              <div className="space-y-1">
                                <button
                                  type="button"
                                  aria-haspopup="dialog"
                                  aria-label={`Xem thông tin HSK ${HSK_LEVELS[index]} của ${student.name}`}
                                  onClick={() => setSelectedInfo({
                                    kind: "class",
                                    student,
                                    hskLevel: HSK_LEVELS[index],
                                    history: level.selectedClass!,
                                  })}
                                  className={`${
                                    level.status === "DROPPED_OUT"
                                      ? "bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:hover:bg-rose-900/60"
                                      : level.status === "IN_PROGRESS"
                                      ? "bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/60"
                                      : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                                  } inline-flex cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                                >
                                  {level.status === "DROPPED_OUT"
                                    ? "Bỏ học"
                                    : level.status === "IN_PROGRESS" ? "Đang học" : "Đã xong"}
                                </button>
                              </div>
                            )}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selectedInfo && (
          <StudentInfoModal
            student={selectedInfo.student}
            classInfo={selectedInfo.kind === "class"
              ? {
                  name: selectedInfo.history.classroom.name,
                  teacherName: selectedInfo.history.classroom.teacher?.name ?? null,
                  courseLabel: `HSK ${selectedInfo.history.classroom.course.hskLevel} · ${selectedInfo.history.classroom.course.title}`,
                  statusLabel: selectedInfo.history.classroom.completedAt ? "Đã kết thúc" : "Đang học",
                  enrolledAt: selectedInfo.history.enrolledAt,
                  completedAt: selectedInfo.history.classroom.completedAt,
                }
              : undefined}
            evaluations={selectedInfo.kind === "class"
              ? selectedInfo.history.reviews.map((review) => ({
                  id: review.id,
                  sessionType: review.sessionType,
                  sessionNumber: review.sessionNumber,
                  status: review.status,
                  updatedAt: review.updatedAt,
                  teacherName: review.teacher?.name ?? null,
                }))
              : undefined}
            finalResult={selectedInfo.kind === "class" && selectedInfo.history.finalResult
              ? {
                  score: selectedInfo.history.finalResult.score,
                  comment: selectedInfo.history.finalResult.comment,
                  attendedSessions: selectedInfo.history.finalResult.attendedSessions,
                  totalSessions: selectedInfo.history.finalResult.totalSessions,
                  decision: selectedInfo.history.finalResult.decision,
                }
              : selectedInfo.kind === "class" ? null : undefined}
            onClose={() => setSelectedInfo(null)}
          />
        )}

        {totalPages > 1 && (
          <nav aria-label="Phân trang học viên" className="flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">Trang {page} / {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to={getPageHref(page - 1)}>
                    <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />Trước
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />Trước
                </Button>
              )}
              {page < totalPages ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to={getPageHref(page + 1)}>
                    Sau<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  Sau<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </nav>
        )}
      </div>
    </AppShell>
  );
}
