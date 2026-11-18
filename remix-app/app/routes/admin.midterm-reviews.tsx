import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Check, ChevronLeft, ChevronRight, Search, SkipForward } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { normalizeFilterSearch, SearchableDropdown } from "~/components/common/searchable-dropdown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type AdminAction = "PROCESSED" | "SKIPPED";
type StatusTab = "pending" | "processed" | "skipped";
type ReviewStatus = "CAN_ADVANCE" | "CANNOT_ADVANCE" | "DROPPED_OUT";

const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string; tone: string }[] = [
  { value: "CAN_ADVANCE", label: "Có khả năng học lên", tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  { value: "CANNOT_ADVANCE", label: "Không có khả năng học lên", tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  { value: "DROPPED_OUT", label: "Bỏ học", tone: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
];

function isAdminAction(value: string): value is AdminAction {
  return value === "PROCESSED" || value === "SKIPPED";
}

function getReviewStatusLabel(status: string) {
  return REVIEW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Chưa xác định";
}

function getReviewStatusTone(status: string) {
  return REVIEW_STATUS_OPTIONS.find((option) => option.value === status)?.tone ?? "bg-muted text-muted-foreground";
}

function formatReviewDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const reviews = await prisma.studentClassReview.findMany({
    where: {
      sessionType: "MIDTERM",
      student: { is: { role: "student", deletedAt: null } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      sessionNumber: true,
      status: true,
      adminAction: true,
      adminActionReason: true,
      updatedAt: true,
      student: { select: { id: true, name: true, phone: true, email: true } },
      teacher: { select: { id: true, name: true } },
      classroom: {
        select: {
          id: true,
          name: true,
          course: { select: { hskLevel: true, code: true } },
          teacher: { select: { id: true, name: true } },
        },
      },
    },
  });
  return { user, reviews };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  if (form.get("intent") !== "save-admin-action") {
    return { error: "Thao tác không hợp lệ." };
  }

  const reviewId = String(form.get("reviewId") ?? "").trim();
  const adminAction = String(form.get("adminAction") ?? "");
  const adminActionReason = String(form.get("adminActionReason") ?? "").trim();
  if (
    !reviewId
    || reviewId.length > 100
    || !isAdminAction(adminAction)
    || adminActionReason.length > 2000
  ) {
    return { error: "Hành động không hợp lệ. Vui lòng tải lại trang và thử lại." };
  }

  const updated = await prisma.studentClassReview.updateMany({
    where: { id: reviewId, sessionType: "MIDTERM", adminAction: null },
    data: { adminAction, adminActionReason: adminActionReason || null },
  });
  if (updated.count !== 1) {
    return { error: "Yêu cầu đã được xử lý hoặc không còn tồn tại. Vui lòng tải lại trang." };
  }

  return { success: true as const, reviewId, adminAction };
}

export default function AdminMidtermReviews() {
  const { user, reviews } = useLoaderData<typeof loader>();
  const actionFetcher = useFetcher<typeof action>();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [selectedHsk, setSelectedHsk] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("pending");
  const [page, setPage] = useState(1);
  const [pendingAdminAction, setPendingAdminAction] = useState<{
    reviewId: string;
    adminAction: AdminAction;
  } | null>(null);
  const [adminActionReason, setAdminActionReason] = useState("");

  const classes = useMemo(() => {
    const uniqueClasses = new Map(reviews.map(({ classroom }) => [classroom.id, classroom]));
    return [...uniqueClasses.values()].sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }, [reviews]);
  const classOptions = useMemo(
    () => [
      { value: "", label: "Tất cả lớp" },
      ...classes.map((classroom) => ({ value: classroom.id, label: classroom.name })),
    ],
    [classes],
  );
  const teachers = useMemo(() => {
    const uniqueTeachers = new Map<string, string>();
    for (const review of reviews) {
      const teacher = review.teacher ?? review.classroom.teacher;
      uniqueTeachers.set(teacher?.id ?? "unassigned", teacher?.name ?? "Chưa phân công");
    }
    return [...uniqueTeachers.entries()].sort((left, right) => left[1].localeCompare(right[1], "vi"));
  }, [reviews]);
  const teacherOptions = useMemo(
    () => [
      { value: "", label: "Tất cả giáo viên" },
      ...teachers.map(([value, label]) => ({ value, label })),
    ],
    [teachers],
  );
  const hskLevels = useMemo(
    () => [...new Set(reviews.map(({ classroom }) => classroom.course.hskLevel))]
      .sort((left, right) => left - right),
    [reviews],
  );
  const filteredReviews = useMemo(() => {
    const normalizedQuery = normalizeFilterSearch(query);
    return reviews.filter((review) => {
      const teacher = review.teacher ?? review.classroom.teacher;
      const matchesQuery = !normalizedQuery
        || normalizeFilterSearch(review.student.name).includes(normalizedQuery)
        || normalizeFilterSearch(review.student.phone ?? "").includes(normalizedQuery)
        || normalizeFilterSearch(review.student.email ?? "").includes(normalizedQuery);
      return matchesQuery
        && (!classFilter || review.classroom.id === classFilter)
        && (!teacherFilter || (teacher?.id ?? "unassigned") === teacherFilter)
        && (!selectedHsk || String(review.classroom.course.hskLevel) === selectedHsk)
        && (!selectedStatus || review.status === selectedStatus);
    });
  }, [classFilter, query, reviews, selectedHsk, selectedStatus, teacherFilter]);
  const pendingReviews = filteredReviews.filter(({ adminAction }) => adminAction === null);
  const processedReviews = filteredReviews.filter(({ adminAction }) => adminAction === "PROCESSED");
  const skippedReviews = filteredReviews.filter(({ adminAction }) => adminAction === "SKIPPED");
  const statusReviews = statusTab === "pending"
    ? pendingReviews
    : statusTab === "processed"
      ? processedReviews
      : skippedReviews;
  const hasActiveFilters = Boolean(
    query.trim() || classFilter || teacherFilter || selectedHsk || selectedStatus,
  );
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(statusReviews.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageReviews = statusReviews.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pendingActionReview = reviews.find(({ id }) => id === pendingAdminAction?.reviewId) ?? null;
  const savingReviewId = actionFetcher.state !== "idle"
    ? String(actionFetcher.formData?.get("reviewId") ?? "")
    : null;

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result || !("success" in result) || !result.success) return;
    setStatusTab(result.adminAction === "PROCESSED" ? "processed" : "skipped");
    setPage(1);
    setPendingAdminAction(null);
    setAdminActionReason("");
  }, [actionFetcher.data]);

  useEffect(() => {
    if (!pendingAdminAction) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || actionFetcher.state !== "idle") return;
      setPendingAdminAction(null);
      setAdminActionReason("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionFetcher.state, pendingAdminAction]);

  function clearFilters() {
    setQuery("");
    setClassFilter("");
    setTeacherFilter("");
    setSelectedHsk("");
    setSelectedStatus("");
    setPage(1);
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Đánh giá giữa kỳ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Giáo viên gửi kết quả đánh giá học lên hoặc bỏ học để quản trị viên xem và xử lý.
          </p>
        </header>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label>
            <span className="sr-only">Tìm học viên</span>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setPage(1);
                }}
                placeholder="Tên, SĐT hoặc email"
                className="pl-9"
              />
            </div>
          </label>
          <SearchableDropdown
            id="midterm-class-filter"
            label="Lọc theo lớp"
            placeholder="Tất cả lớp"
            searchPlaceholder="Tìm lớp..."
            options={classOptions}
            value={classFilter}
            onChange={(value) => {
              setClassFilter(value);
              setPage(1);
            }}
            className="w-full"
          />
          <SearchableDropdown
            id="midterm-teacher-filter"
            label="Lọc theo giáo viên"
            placeholder="Tất cả giáo viên"
            searchPlaceholder="Tìm giáo viên..."
            options={teacherOptions}
            value={teacherFilter}
            onChange={(value) => {
              setTeacherFilter(value);
              setPage(1);
            }}
            className="w-full"
          />
          <label>
            <span className="sr-only">Lọc theo khóa học</span>
            <select
              value={selectedHsk}
              onChange={(event) => {
                setSelectedHsk(event.currentTarget.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả khóa học</option>
              {hskLevels.map((level) => <option key={level} value={level}>HSK {level}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Lọc theo đánh giá của giáo viên</span>
            <select
              value={selectedStatus}
              onChange={(event) => {
                setSelectedStatus(event.currentTarget.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả đánh giá</option>
              <optgroup label="Đánh giá hiện tại">
                {REVIEW_STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            </select>
          </label>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" onClick={clearFilters} className="h-10 justify-start px-2">
              Xóa bộ lọc
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {hasActiveFilters
            ? `${filteredReviews.length} / ${reviews.length} yêu cầu`
            : `${filteredReviews.length} yêu cầu`}
        </p>

        <div className="flex flex-wrap gap-2 border-b" aria-label="Trạng thái xử lý đánh giá">
          {([
            { value: "pending", label: "Đang chờ xử lý", count: pendingReviews.length },
            { value: "processed", label: "Đã xử lý", count: processedReviews.length },
            { value: "skipped", label: "Bỏ qua", count: skippedReviews.length },
          ] as const).map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              aria-pressed={statusTab === value}
              onClick={() => {
                setStatusTab(value);
                setPage(1);
              }}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                statusTab === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {reviews.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Không còn học viên nào đang chờ xử lý.
          </p>
        ) : filteredReviews.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Không có yêu cầu nào khớp bộ lọc.
          </p>
        ) : statusReviews.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {statusTab === "pending"
              ? "Không còn yêu cầu nào đang chờ xử lý."
              : statusTab === "processed"
                ? "Chưa có yêu cầu nào được đánh dấu đã xử lý."
                : "Chưa có yêu cầu nào được bỏ qua."}
          </p>
        ) : (
          <>
            <div className="overflow-auto rounded-lg border bg-card">
              <table className="w-full min-w-[1280px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-muted/90">
                  <tr className="border-b">
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Lớp</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Giáo viên</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Khóa học</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Mốc</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Đánh giá của giáo viên</th>
                    {statusTab === "pending" ? (
                      <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Hành động</th>
                    ) : (
                      <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Ghi chú admin</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageReviews.map((review) => {
                    const teacher = review.teacher ?? review.classroom.teacher;
                    return (
                      <tr key={review.id} className="hover:bg-muted/20">
                        <th scope="row" className="border-r px-3 py-3 text-sm font-medium">
                          <span>{review.student.name}</span>
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            {review.student.phone || review.student.email || "Chưa có thông tin liên hệ"}
                          </span>
                        </th>
                        <td className="whitespace-nowrap border-r px-3 py-3 text-sm">{review.classroom.name}</td>
                        <td className="whitespace-nowrap border-r px-3 py-3 text-sm">{teacher?.name ?? "Không còn tài khoản"}</td>
                        <td className="whitespace-nowrap border-r px-3 py-3 text-sm">HSK {review.classroom.course.hskLevel}</td>
                        <td className="whitespace-nowrap border-r px-3 py-3 text-sm">
                          Buổi {review.sessionNumber}
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Cập nhật {formatReviewDate(review.updatedAt)}
                          </span>
                        </td>
                        <td className="border-r px-3 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getReviewStatusTone(review.status)}`}>
                            {getReviewStatusLabel(review.status)}
                          </span>
                        </td>
                        {statusTab === "pending" ? (
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              {([
                                { value: "PROCESSED", label: "Đã xử lý" },
                                { value: "SKIPPED", label: "Bỏ qua" },
                              ] as const).map(({ value, label }) => {
                                const isSaving = savingReviewId === review.id;
                                return (
                                  <Button
                                    key={value}
                                    type="button"
                                    variant={value === "PROCESSED" ? "default" : "outline"}
                                    size="sm"
                                    disabled={isSaving}
                                    className={value === "PROCESSED"
                                      ? "h-9 gap-1.5 rounded-lg border border-emerald-700 bg-emerald-700 px-3 text-white shadow-sm hover:border-emerald-800 hover:bg-emerald-800 dark:border-emerald-600 dark:bg-emerald-700 dark:text-white dark:hover:bg-emerald-600"
                                      : "h-9 gap-1.5 rounded-lg border-amber-300 bg-amber-50 px-3 text-amber-950 shadow-sm hover:border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"}
                                    onClick={() => {
                                      setPendingAdminAction({ reviewId: review.id, adminAction: value });
                                      setAdminActionReason("");
                                    }}
                                  >
                                    {isSaving && actionFetcher.formData?.get("adminAction") === value
                                      ? "Đang lưu..."
                                      : value === "PROCESSED"
                                        ? <><Check aria-hidden="true" className="h-4 w-4" />{label}</>
                                        : <><SkipForward aria-hidden="true" className="h-4 w-4" />{label}</>}
                                  </Button>
                                );
                              })}
                            </div>
                          </td>
                        ) : (
                          <td className="max-w-sm whitespace-pre-wrap px-3 py-3 text-sm text-muted-foreground">
                            {review.adminActionReason || "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <nav aria-label="Phân trang yêu cầu đánh giá giữa kỳ" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  Hiển thị {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, statusReviews.length)} / {statusReviews.length} yêu cầu
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />Trang trước
                  </Button>
                  <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
                    {currentPage} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                    disabled={currentPage === pageCount}
                  >
                    Trang sau<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>

      {pendingAdminAction && pendingActionReview && (
        <Overlay
          className="max-w-lg"
          onClose={() => {
            if (actionFetcher.state === "idle") {
              setPendingAdminAction(null);
              setAdminActionReason("");
            }
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="admin-midterm-action-title" className="space-y-5">
            <header>
              <h2 id="admin-midterm-action-title" className="text-lg font-semibold">
                {pendingAdminAction.adminAction === "PROCESSED" ? "Đánh dấu đã xử lý" : "Bỏ qua đánh giá"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingActionReview.student.name} · {pendingActionReview.classroom.name}
              </p>
            </header>
            <label htmlFor="admin-midterm-action-reason" className="block space-y-2 text-sm font-medium">
              Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <Textarea
                id="admin-midterm-action-reason"
                value={adminActionReason}
                onChange={(event) => setAdminActionReason(event.currentTarget.value)}
                maxLength={2000}
                rows={4}
                placeholder="Nhập ghi chú để tiện theo dõi..."
                disabled={actionFetcher.state !== "idle"}
              />
              <span className="block text-right text-xs font-normal text-muted-foreground">
                {adminActionReason.length}/2000
              </span>
            </label>
            {actionFetcher.data && "error" in actionFetcher.data && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {actionFetcher.data.error}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                disabled={actionFetcher.state !== "idle"}
                onClick={() => {
                  setPendingAdminAction(null);
                  setAdminActionReason("");
                }}
              >
                Hủy
              </Button>
              <Button
                type="button"
                disabled={actionFetcher.state !== "idle"}
                onClick={() => actionFetcher.submit(
                  {
                    intent: "save-admin-action",
                    reviewId: pendingAdminAction.reviewId,
                    adminAction: pendingAdminAction.adminAction,
                    adminActionReason,
                  },
                  { method: "post" },
                )}
              >
                {actionFetcher.state !== "idle"
                  ? "Đang lưu..."
                  : pendingAdminAction.adminAction === "PROCESSED"
                    ? "Xác nhận đã xử lý"
                    : "Xác nhận bỏ qua"}
              </Button>
            </div>
          </section>
        </Overlay>
      )}
    </AppShell>
  );
}
