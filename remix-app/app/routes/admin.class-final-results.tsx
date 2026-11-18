import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Check, Search, SkipForward, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { StudentInfoModal } from "~/components/common/student-info-modal";
import { normalizeFilterSearch, SearchableDropdown } from "~/components/common/searchable-dropdown";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { resolveFinalEvaluationStatus } from "~/lib/student-review-status";

type ClassFinalResultAdminAction = "PROCESSED" | "SKIPPED";
type ResultStatusTab = "pending" | "processed" | "skipped";
type StudentReviewStatus = "CAN_ADVANCE" | "CANNOT_ADVANCE" | "DROPPED_OUT";

function isClassFinalResultAdminAction(value: string): value is ClassFinalResultAdminAction {
  return value === "PROCESSED" || value === "SKIPPED";
}

function getStudentFinalReviewStatus(
  classroom: { studentClassReviews: { studentId: string; status: StudentReviewStatus }[] },
  studentId: string,
  legacyDecision: string | null,
) {
  return resolveFinalEvaluationStatus(
    classroom.studentClassReviews.find((review) => review.studentId === studentId)?.status,
    legacyDecision,
  );
}

function getStudentFinalReviewLabel(status: string | null) {
  if (status === "CAN_ADVANCE") return "Có khả năng học lên";
  if (status === "CANNOT_ADVANCE") return "Không có khả năng học lên";
  if (status === "DROPPED_OUT") return "Bỏ học";
  if (status === "PROMOTE") return "Học lên (trước đây)";
  if (status === "ELIGIBLE_NOT_ENROLLED") return "Đủ điều kiện, chưa đăng ký (trước đây)";
  if (status === "REPEAT") return "Không đủ học lực (trước đây)";
  return "Chưa có trạng thái";
}

function getStudentFinalReviewTone(status: string | null) {
  if (status === "CAN_ADVANCE" || status === "PROMOTE") {
    return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (status === "CANNOT_ADVANCE" || status === "ELIGIBLE_NOT_ENROLLED") {
    return "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  if (status === "DROPPED_OUT" || status === "REPEAT") {
    return "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200";
  }
  return "bg-muted text-muted-foreground";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const classes = await prisma.class.findMany({
    where: { completedAt: { not: null }, finalResults: { some: {} } },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      name: true,
      completedAt: true,
      course: { select: { hskLevel: true, code: true } },
      teacher: { select: { id: true, name: true } },
      studentClassReviews: {
        where: { sessionType: "FINAL" },
        select: { studentId: true, status: true },
      },
      finalResults: {
        orderBy: { student: { name: "asc" } },
        select: {
          createdAt: true,
          updatedAt: true,
          score: true,
          comment: true,
          attendedSessions: true,
          totalSessions: true,
          decision: true,
          adminAction: true,
          adminActionReason: true,
          student: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
    },
  });
  return { user, classes };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  if (form.get("intent") !== "save-admin-action") {
    return { error: "Thao tác không hợp lệ." };
  }

  const classId = String(form.get("classId") ?? "").trim();
  const studentId = String(form.get("studentId") ?? "").trim();
  const adminAction = String(form.get("adminAction") ?? "");
  const adminActionReason = String(form.get("adminActionReason") ?? "").trim();
  if (
    !classId
    || classId.length > 100
    || !studentId
    || studentId.length > 100
    || !isClassFinalResultAdminAction(adminAction)
    || adminActionReason.length > 2000
  ) {
    return { error: "Hành động không hợp lệ. Vui lòng tải lại trang và thử lại." };
  }

  const updated = await prisma.classFinalResult.updateMany({
    where: {
      classId,
      studentId,
      classroom: { completedAt: { not: null } },
    },
    data: { adminAction, adminActionReason: adminActionReason || null },
  });
  if (updated.count !== 1) {
    return { error: "Không tìm thấy kết quả học viên trong lớp đã kết thúc. Vui lòng tải lại trang." };
  }

  return { success: true as const, classId, studentId, adminAction };
}

export default function AdminClassFinalResults() {
  const { user, classes } = useLoaderData<typeof loader>();
  const actionFetcher = useFetcher<typeof action>();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [selectedHsk, setSelectedHsk] = useState("");
  const [selectedDecision, setSelectedDecision] = useState("");
  const [statusTab, setStatusTab] = useState<ResultStatusTab>("pending");
  const [page, setPage] = useState(1);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [pendingAdminAction, setPendingAdminAction] = useState<{
    classId: string;
    studentId: string;
    adminAction: ClassFinalResultAdminAction;
  } | null>(null);
  const [adminActionReason, setAdminActionReason] = useState("");

  const hskLevels = useMemo(
    () => [...new Set(classes.map(({ course }) => course.hskLevel))].sort((left, right) => left - right),
    [classes],
  );
  const classOptions = useMemo(
    () => [
      { value: "", label: "Tất cả lớp" },
      ...[...classes]
        .sort((left, right) => left.name.localeCompare(right.name, "vi"))
        .map((classroom) => ({ value: classroom.id, label: classroom.name })),
    ],
    [classes],
  );
  const teacherOptions = useMemo(() => {
    const teachers = new Map<string, string>();
    for (const classroom of classes) {
      teachers.set(classroom.teacher?.id ?? "unassigned", classroom.teacher?.name ?? "Chưa phân công");
    }
    return [
      { value: "", label: "Tất cả giáo viên" },
      ...[...teachers.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], "vi"))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [classes]);
  const filteredResults = useMemo(() => {
    const normalizedStudentQuery = normalizeFilterSearch(query);
    return classes
      .flatMap((classroom) => {
        const matchesClass = !classFilter || classroom.id === classFilter;
        const matchesHsk = !selectedHsk || String(classroom.course.hskLevel) === selectedHsk;
        const matchesTeacher = !teacherFilter || (classroom.teacher?.id ?? "unassigned") === teacherFilter;
        if (!matchesClass || !matchesHsk || !matchesTeacher) return [];
        return classroom.finalResults
          .filter((result) => {
            const studentSearchText = normalizeFilterSearch([
              result.student.name,
              result.student.phone ?? "",
              result.student.email ?? "",
            ].join(" "));
            return (!normalizedStudentQuery || studentSearchText.includes(normalizedStudentQuery))
              && (!selectedDecision || getStudentFinalReviewStatus(classroom, result.student.id, result.decision) === selectedDecision);
          })
          .map((result) => ({ classroom, result }));
      })
      .sort((left, right) =>
        right.result.updatedAt.getTime() - left.result.updatedAt.getTime()
        || right.result.createdAt.getTime() - left.result.createdAt.getTime()
        || left.result.student.name.localeCompare(right.result.student.name, "vi")
      );
  }, [classes, classFilter, query, selectedDecision, selectedHsk, teacherFilter]);
  const pendingResults = useMemo(
    () => filteredResults.filter(({ result }) => result.adminAction === null),
    [filteredResults],
  );
  const processedResults = useMemo(
    () => filteredResults.filter(({ result }) => result.adminAction === "PROCESSED"),
    [filteredResults],
  );
  const skippedResults = useMemo(
    () => filteredResults.filter(({ result }) => result.adminAction === "SKIPPED"),
    [filteredResults],
  );
  const statusResults = statusTab === "pending"
    ? pendingResults
    : statusTab === "processed"
      ? processedResults
      : skippedResults;
  const hasActiveFilters = Boolean(
    query.trim() || classFilter || teacherFilter || selectedHsk || selectedDecision,
  );
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(statusResults.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageResults = statusResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedClass = classes.find(({ id }) => id === selectedClassId) ?? null;
  const selectedStudent = selectedClass?.finalResults.find(
    (result) => result.student.id === selectedStudentId,
  ) ?? null;
  const pendingActionClass = classes.find(({ id }) => id === pendingAdminAction?.classId) ?? null;
  const pendingActionStudent = pendingActionClass?.finalResults.find(
    (result) => result.student.id === pendingAdminAction?.studentId,
  ) ?? null;
  const savingStudentId = actionFetcher.state !== "idle"
    ? String(actionFetcher.formData?.get("studentId") ?? "")
    : null;

  useEffect(() => {
    if (actionFetcher.data && "success" in actionFetcher.data && actionFetcher.data.success) {
      setStatusTab(actionFetcher.data.adminAction === "PROCESSED" ? "processed" : "skipped");
      setPage(1);
      setPendingAdminAction(null);
      setAdminActionReason("");
    }
  }, [actionFetcher.data]);

  useEffect(() => {
    if (!selectedClassId && !pendingAdminAction) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingAdminAction) {
        setPendingAdminAction(null);
        setAdminActionReason("");
        return;
      }
      if (selectedStudentId) {
        setSelectedStudentId(null);
        setSelectedClassId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingAdminAction, selectedClassId, selectedStudentId]);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Đánh giá cuối kỳ</h1>
          <p className="mt-1 text-sm text-muted-foreground">Điểm, chuyên cần, nhận xét và kết quả do giáo viên ghi nhận.</p>
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
            id="final-class-filter"
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
            id="final-teacher-filter"
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
              {hskLevels.map((hsk) => <option key={hsk} value={hsk}>HSK {hsk}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Lọc theo đánh giá của giáo viên</span>
            <select
              value={selectedDecision}
              onChange={(event) => {
                setSelectedDecision(event.currentTarget.value);
                setPage(1);
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả đánh giá</option>
              <optgroup label="Đánh giá hiện tại">
                <option value="CAN_ADVANCE">Có khả năng học lên</option>
                <option value="CANNOT_ADVANCE">Không có khả năng học lên</option>
                <option value="DROPPED_OUT">Bỏ học</option>
              </optgroup>
              <optgroup label="Dữ liệu lịch sử">
                <option value="PROMOTE">Học lên (trước đây)</option>
                <option value="ELIGIBLE_NOT_ENROLLED">Đủ điều kiện, chưa đăng ký (trước đây)</option>
                <option value="REPEAT">Không đủ học lực (trước đây)</option>
              </optgroup>
            </select>
          </label>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" onClick={() => {
              setQuery("");
              setClassFilter("");
              setTeacherFilter("");
              setSelectedHsk("");
              setSelectedDecision("");
              setPage(1);
            }} className="h-10 justify-start px-2">
              Xóa bộ lọc
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {hasActiveFilters ? `${filteredResults.length} / ${classes.reduce((total, classroom) => total + classroom.finalResults.length, 0)} học viên` : `${filteredResults.length} học viên`}
        </p>
        <div className="flex flex-wrap gap-2 border-b" aria-label="Trạng thái xử lý đánh giá">
          <button
            type="button"
            aria-pressed={statusTab === "pending"}
            onClick={() => {
              setStatusTab("pending");
              setPage(1);
            }}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              statusTab === "pending"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Đang chờ xử lý ({pendingResults.length})
          </button>
          {([
            { value: "processed", label: "Đã xử lý", count: processedResults.length },
            { value: "skipped", label: "Bỏ qua", count: skippedResults.length },
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
        {classes.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Chưa có lớp nào kết thúc với kết quả cuối khóa.
          </p>
        ) : filteredResults.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Không có học viên nào khớp bộ lọc.
          </p>
        ) : statusResults.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {statusTab === "pending"
              ? "Không còn học viên nào đang chờ xử lý."
              : statusTab === "processed"
                ? "Chưa có học viên nào được đánh dấu đã xử lý."
                : "Chưa có học viên nào được bỏ qua."}
          </p>
        ) : (
          <>
            {!pendingAdminAction && actionFetcher.data && "error" in actionFetcher.data && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {actionFetcher.data.error}
              </p>
            )}
            <div className="overflow-auto rounded-lg border bg-card">
              <table className="w-full min-w-[1280px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-muted/90">
                  <tr className="border-b">
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Lớp</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Giáo viên</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Khóa học</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Điểm</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Chuyên cần</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Đánh giá của giáo viên</th>
                    <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Nhận xét học sinh</th>
                    {statusTab !== "pending" && (
                      <th scope="col" className="whitespace-nowrap border-r px-3 py-2.5 text-xs font-semibold text-muted-foreground">Ghi chú admin</th>
                    )}
                    {statusTab === "pending" && (
                      <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground">Hành động</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageResults.map(({ classroom, result }) => {
                    const finalReviewStatus = getStudentFinalReviewStatus(classroom, result.student.id, result.decision);
                    return (
                    <tr key={`${classroom.id}:${result.student.id}`} className="hover:bg-muted/20">
                      <th scope="row" className="border-r px-3 py-3 text-sm font-medium">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => {
                            setSelectedClassId(classroom.id);
                            setSelectedStudentId(result.student.id);
                          }}
                          className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {result.student.name}
                        </button>
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {result.student.phone || result.student.email || "Chưa có thông tin liên hệ"}
                        </span>
                      </th>
                      <td className="whitespace-nowrap border-r px-3 py-3 text-sm">{classroom.name}</td>
                      <td className="whitespace-nowrap border-r px-3 py-3 text-sm">{classroom.teacher?.name ?? "Chưa phân công"}</td>
                      <td className="whitespace-nowrap border-r px-3 py-3 text-sm">HSK {classroom.course.hskLevel}</td>
                      <td className="whitespace-nowrap border-r px-3 py-3 text-sm tabular-nums">{result.score}/10</td>
                      <td className="whitespace-nowrap border-r px-3 py-3 text-sm tabular-nums">
                        {result.totalSessions > 0 ? Math.round((result.attendedSessions / result.totalSessions) * 100) : 0}%
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({result.attendedSessions}/{result.totalSessions})
                        </span>
                      </td>
                      <td className="border-r px-3 py-3 text-sm">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStudentFinalReviewTone(finalReviewStatus)}`}>
                          {getStudentFinalReviewLabel(finalReviewStatus)}
                        </span>
                      </td>
                      <td className="max-w-md border-r px-3 py-3 text-sm text-muted-foreground">
                        <p className="whitespace-pre-wrap">{result.comment}</p>
                      </td>
                      {statusTab !== "pending" && (
                        <td className="max-w-xs whitespace-pre-wrap border-r px-3 py-3 text-sm text-muted-foreground">
                          {result.adminActionReason || "—"}
                        </td>
                      )}
                      {statusTab === "pending" && (
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {([
                            { value: "PROCESSED", label: "Đã xử lý" },
                            { value: "SKIPPED", label: "Bỏ qua" },
                          ] as const).map(({ value, label }) => {
                            const isSaving = savingStudentId === result.student.id;
                            return (
                              <Button
                                key={value}
                                type="button"
                                variant={value === "PROCESSED" ? "default" : "outline"}
                                size="sm"
                                aria-haspopup="dialog"
                                disabled={isSaving}
                                className={value === "PROCESSED"
                                  ? "h-9 gap-1.5 rounded-lg border border-emerald-700 bg-emerald-700 px-3 text-white shadow-sm hover:border-emerald-800 hover:bg-emerald-800 dark:border-emerald-600 dark:bg-emerald-700 dark:text-white dark:hover:bg-emerald-600"
                                  : "h-9 gap-1.5 rounded-lg border-amber-300 bg-amber-50 px-3 text-amber-950 shadow-sm hover:border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"}
                                onClick={() => {
                                  setPendingAdminAction({
                                    classId: classroom.id,
                                    studentId: result.student.id,
                                    adminAction: value,
                                  });
                                  setAdminActionReason("");
                                }}
                              >
                                {isSaving && actionFetcher.formData?.get("adminAction") === value ? (
                                  "Đang lưu..."
                                ) : (
                                  <>
                                    {value === "PROCESSED"
                                      ? <Check aria-hidden="true" className="h-4 w-4" />
                                      : <SkipForward aria-hidden="true" className="h-4 w-4" />}
                                    {label}
                                  </>
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </td>
                      )}
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <nav aria-label="Phân trang kết quả cuối khóa" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  Hiển thị {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, statusResults.length)} / {statusResults.length} học viên
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                  >
                    Trang trước
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
                    Trang sau
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
      {pendingAdminAction && pendingActionClass && pendingActionStudent && (
        <Overlay
          className="max-w-lg"
          onClose={() => {
            if (actionFetcher.state === "idle") {
              setPendingAdminAction(null);
              setAdminActionReason("");
            }
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="admin-action-dialog-title" className="space-y-5">
            <header>
              <h2 id="admin-action-dialog-title" className="text-lg font-semibold">
                {pendingAdminAction.adminAction === "PROCESSED" ? "Đánh dấu đã xử lý" : "Bỏ qua đánh giá"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingActionStudent.student.name} · {pendingActionClass.name}
              </p>
            </header>
            <label htmlFor="admin-action-reason" className="block space-y-2 text-sm font-medium">
              Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <Textarea
                id="admin-action-reason"
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
                    classId: pendingAdminAction.classId,
                    studentId: pendingAdminAction.studentId,
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
      {selectedClass && selectedStudent && (
        <StudentInfoModal
          student={selectedStudent.student}
          classInfo={{
            name: selectedClass.name,
            teacherName: selectedClass.teacher?.name ?? null,
          }}
          onClose={() => {
            setSelectedStudentId(null);
            setSelectedClassId(null);
          }}
        />
      )}
    </AppShell>
  );
}
