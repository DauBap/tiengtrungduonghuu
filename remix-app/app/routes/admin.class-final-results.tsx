import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { ChevronRight, Search, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type ClassFinalResultAdminAction = "PROCESSED" | "SKIPPED";
type ResultStatusTab = "pending" | "completed";

function isClassFinalResultAdminAction(value: string): value is ClassFinalResultAdminAction {
  return value === "PROCESSED" || value === "SKIPPED";
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
      finalResults: {
        orderBy: { student: { name: "asc" } },
        select: {
          score: true,
          comment: true,
          attendedSessions: true,
          totalSessions: true,
          decision: true,
          adminAction: true,
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
  if (
    !classId
    || classId.length > 100
    || !studentId
    || studentId.length > 100
    || !isClassFinalResultAdminAction(adminAction)
  ) {
    return { error: "Hành động không hợp lệ. Vui lòng tải lại trang và thử lại." };
  }

  const updated = await prisma.classFinalResult.updateMany({
    where: {
      classId,
      studentId,
      classroom: { completedAt: { not: null } },
    },
    data: { adminAction },
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
  const [selectedHsk, setSelectedHsk] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [statusTab, setStatusTab] = useState<ResultStatusTab>("pending");
  const [page, setPage] = useState(1);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const hskLevels = useMemo(
    () => [...new Set(classes.map(({ course }) => course.hskLevel))].sort((left, right) => left - right),
    [classes],
  );
  const teacherOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const classroom of classes) {
      if (selectedHsk && String(classroom.course.hskLevel) !== selectedHsk) continue;
      const teacherId = classroom.teacher?.id ?? "unassigned";
      const teacherName = classroom.teacher?.name ?? "Chưa phân công";
      const current = counts.get(teacherId) ?? { name: teacherName, count: 0 };
      current.count += 1;
      counts.set(teacherId, current);
    }
    return Array.from(counts.entries())
      .map(([id, teacher]) => ({ id, ...teacher }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "vi"));
  }, [classes, selectedHsk]);
  const filteredClasses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return classes.filter((classroom) => {
      const matchesHsk = !selectedHsk || String(classroom.course.hskLevel) === selectedHsk;
      const teacherId = classroom.teacher?.id ?? "unassigned";
      const matchesTeacher = !selectedTeacher || teacherId === selectedTeacher;
      const searchText = `${classroom.name} ${classroom.course.code} ${classroom.teacher?.name ?? ""}`.toLocaleLowerCase("vi");
      return matchesHsk && matchesTeacher && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [classes, query, selectedHsk, selectedTeacher]);
  const pendingClasses = useMemo(
    () => filteredClasses.filter((classroom) => classroom.finalResults.some((result) => result.adminAction === null)),
    [filteredClasses],
  );
  const completedClasses = useMemo(
    () => filteredClasses.filter((classroom) => classroom.finalResults.every((result) => result.adminAction !== null)),
    [filteredClasses],
  );
  const statusClasses = statusTab === "pending" ? pendingClasses : completedClasses;
  const hasActiveFilters = Boolean(query.trim() || selectedHsk || selectedTeacher);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(statusClasses.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageClasses = statusClasses.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedClass = classes.find(({ id }) => id === selectedClassId) ?? null;
  const selectedStudent = selectedClass?.finalResults.find(
    (result) => result.student.id === selectedStudentId,
  ) ?? null;
  const savingStudentId = actionFetcher.state !== "idle"
    ? String(actionFetcher.formData?.get("studentId") ?? "")
    : null;

  useEffect(() => {
    if (!selectedClassId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedStudentId) {
        setSelectedStudentId(null);
      } else {
        setSelectedClassId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedClassId, selectedStudentId]);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Kết quả cuối khóa</h1>
          <p className="mt-1 text-sm text-muted-foreground">Điểm, chuyên cần, nhận xét và kết quả do giáo viên ghi nhận.</p>
        </header>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="relative sm:w-64">
              <span className="sr-only">Tìm lớp hoặc giáo viên</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setPage(1);
                }}
                placeholder="Tìm lớp, giáo viên..."
                className="pl-9"
              />
            </label>
            <label>
              <span className="sr-only">Lọc theo HSK</span>
              <select
                value={selectedHsk}
                onChange={(event) => {
                  const nextHsk = event.currentTarget.value;
                  setSelectedHsk(nextHsk);
                  setPage(1);
                  if (selectedTeacher && !classes.some((classroom) => (
                    (!nextHsk || String(classroom.course.hskLevel) === nextHsk)
                    && (classroom.teacher?.id ?? "unassigned") === selectedTeacher
                  ))) {
                    setSelectedTeacher("");
                  }
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
              >
                <option value="">Tất cả HSK</option>
                {hskLevels.map((hsk) => <option key={hsk} value={hsk}>HSK {hsk}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Lọc theo giáo viên</span>
              <select
                value={selectedTeacher}
                onChange={(event) => {
                  setSelectedTeacher(event.currentTarget.value);
                  setPage(1);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52"
              >
                <option value="">Tất cả giáo viên</option>
                {teacherOptions.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name} ({teacher.count} lớp)</option>
                ))}
              </select>
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSelectedHsk("");
                  setSelectedTeacher("");
                  setPage(1);
                }}
                className="h-10 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {hasActiveFilters ? `${filteredClasses.length} / ${classes.length} lớp` : `${classes.length} lớp`}
        </p>
        <div className="flex flex-wrap gap-2 border-b" aria-label="Trạng thái xử lý kết quả">
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
            Đang chờ xử lý ({pendingClasses.length})
          </button>
          <button
            type="button"
            aria-pressed={statusTab === "completed"}
            onClick={() => {
              setStatusTab("completed");
              setPage(1);
            }}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              statusTab === "completed"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Đã xử lý xong ({completedClasses.length})
          </button>
        </div>
        {classes.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Chưa có lớp nào kết thúc với kết quả cuối khóa.
          </p>
        ) : filteredClasses.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Không có lớp nào khớp bộ lọc.
          </p>
        ) : statusClasses.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {statusTab === "pending"
              ? "Không còn lớp nào đang chờ xử lý."
              : "Chưa có lớp nào được xử lý xong."}
          </p>
        ) : (
          <>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {pageClasses.map((classroom) => {
                const processedCount = classroom.finalResults.filter(
                  (result) => result.adminAction !== null,
                ).length;
                return (
                <button
                  key={classroom.id}
                  type="button"
                  onClick={() => setSelectedClassId(classroom.id)}
                  aria-label={`Xem kết quả học viên lớp ${classroom.name}`}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{classroom.name}</span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      HSK {classroom.course.hskLevel} · {classroom.course.code}
                      {classroom.teacher && ` · ${classroom.teacher.name}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                        processedCount === classroom.finalResults.length
                          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      Đã xử lý {processedCount}/{classroom.finalResults.length}
                    </span>
                    {classroom.completedAt && (
                      <time className="hidden text-sm text-muted-foreground sm:block">
                        {classroom.completedAt.toLocaleDateString("vi-VN")}
                      </time>
                    )}
                    <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  </span>
                </button>
                );
              })}
            </div>
            {pageCount > 1 && (
              <nav aria-label="Phân trang kết quả cuối khóa" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  Hiển thị {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, statusClasses.length)} / {statusClasses.length} lớp
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
      {selectedClass && (
        <Overlay onClose={() => setSelectedClassId(null)} className="max-w-5xl">
          <section role="dialog" aria-modal="true" aria-labelledby="final-results-dialog-title" className="space-y-4">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="final-results-dialog-title" className="text-lg font-semibold">{selectedClass.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  HSK {selectedClass.course.hskLevel} · {selectedClass.course.code}
                  {selectedClass.teacher && ` · ${selectedClass.teacher.name}`}
                  {selectedClass.completedAt && ` · ${selectedClass.completedAt.toLocaleDateString("vi-VN")}`}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedClassId(null)}
                aria-label="Đóng chi tiết kết quả"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </header>
            <div className="max-h-[65vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[940px] border-collapse text-left">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Điểm</th>
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Chuyên cần</th>
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Kết quả</th>
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Nhận xét</th>
                    <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedClass.finalResults.map((result) => (
                    <tr key={result.student.id}>
                      <th scope="row" className="px-4 py-3 text-sm font-medium">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setSelectedStudentId(result.student.id)}
                          className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {result.student.name}
                        </button>
                      </th>
                      <td className="px-4 py-3 text-sm tabular-nums">{result.score}/10</td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {result.totalSessions > 0 ? Math.round((result.attendedSessions / result.totalSessions) * 100) : 0}%
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({result.attendedSessions}/{result.totalSessions})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          result.decision === "PROMOTE"
                            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                            : result.decision === "ELIGIBLE_NOT_ENROLLED"
                              ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                              : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                        }`}>
                          {result.decision === "PROMOTE"
                            ? "Học lên"
                            : result.decision === "ELIGIBLE_NOT_ENROLLED"
                              ? "Đủ điều kiện, chưa đăng ký"
                              : "Không đủ học lực"}
                        </span>
                      </td>
                      <td className="max-w-md whitespace-pre-wrap px-4 py-3 text-sm text-muted-foreground">{result.comment}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {([
                            { value: "PROCESSED", label: "Đã xử lý" },
                            { value: "SKIPPED", label: "Bỏ qua" },
                          ] as const).map(({ value, label }) => {
                            const isSelected = result.adminAction === value;
                            const isSaving = savingStudentId === result.student.id;
                            return (
                              <Button
                                key={value}
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-pressed={isSelected}
                                disabled={isSaving}
                                className={isSelected
                                  ? value === "PROCESSED"
                                    ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800 hover:text-white dark:border-emerald-600 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                                    : "border-slate-500 bg-slate-600 text-white hover:bg-slate-700 hover:text-white dark:border-slate-500 dark:bg-slate-600 dark:hover:bg-slate-500"
                                  : ""}
                                onClick={() => actionFetcher.submit(
                                  {
                                    intent: "save-admin-action",
                                    classId: selectedClass.id,
                                    studentId: result.student.id,
                                    adminAction: value,
                                  },
                                  { method: "post" },
                                )}
                              >
                                {isSaving && actionFetcher.formData?.get("adminAction") === value
                                  ? "Đang lưu..."
                                  : label}
                              </Button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {actionFetcher.data && "error" in actionFetcher.data && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {actionFetcher.data.error}
              </p>
            )}
            <div className="flex justify-end border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedStudentId(null);
                  setSelectedClassId(null);
                }}
              >
                Đóng
              </Button>
            </div>
          </section>
        </Overlay>
      )}
      {selectedClass && selectedStudent && (
        <Overlay className="max-w-md" onClose={() => setSelectedStudentId(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="student-details-title" className="space-y-5">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="student-details-title" className="text-lg font-semibold">{selectedStudent.student.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Thông tin học viên</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedStudentId(null)}
                aria-label="Đóng thông tin học viên"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </header>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Họ tên</dt>
                <dd className="mt-1 font-medium">{selectedStudent.student.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Lớp học</dt>
                <dd className="mt-1 font-medium">{selectedClass.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Giáo viên chủ nhiệm</dt>
                <dd className="mt-1 font-medium">{selectedClass.teacher?.name ?? "Chưa phân công"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Số điện thoại</dt>
                <dd className="mt-1 font-medium">{selectedStudent.student.phone || "Chưa cập nhật"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="mt-1 break-all font-medium">{selectedStudent.student.email || "Chưa cập nhật"}</dd>
              </div>
            </dl>
            <div className="flex justify-end border-t pt-3">
              <Button type="button" variant="outline" onClick={() => setSelectedStudentId(null)}>Đóng</Button>
            </div>
          </section>
        </Overlay>
      )}
    </AppShell>
  );
}
