import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowUpRight, CheckCircle2, ChevronDown, Circle, Clock3, Search, Video, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatSchedule, type ScheduleSlot } from "~/lib/schedule-utils";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const WEEKDAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const [classes, hskLevels] = await Promise.all([
    prisma.class.findMany({
      where: { completedAt: null },
      select: {
        id: true,
        name: true,
        schedule: true,
        course: {
          select: {
            id: true,
            hskLevel: true,
            code: true,
            title: true,
            lessons: {
              orderBy: { order: "asc" },
              select: { id: true, title: true, order: true },
            },
          },
        },
        teacher: { select: { id: true, name: true } },
        maxStudents: true,
        _count: {
          select: {
            enrollments: {
              where: { user: { is: { role: "student", deletedAt: null } } },
            },
          },
        },
        enrollments: {
          where: { user: { is: { role: "student", deletedAt: null } } },
          orderBy: { createdAt: "asc" },
          select: {
            user: {
              select: {
                id: true,
                name: true,
                isActive: true,
                isActivated: true,
                enrollments: {
                  where: { classId: { not: null } },
                  select: { course: { select: { hskLevel: true } } },
                },
              },
            },
          },
        },
        attendanceSessions: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            lessonId: true,
            title: true,
            lesson: true,
            date: true,
            createdAt: true,
            recordingUrl: true,
            courseLesson: { select: { order: true, title: true } },
            records: { select: { studentId: true, status: true } },
          },
        },
        studentScores: { select: { studentId: true, score: true, decision: true } },
      },
      orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
    }),
    prisma.course.findMany({
      distinct: ["hskLevel"],
      orderBy: { hskLevel: "asc" },
      select: { hskLevel: true },
    }),
  ]);
  const hskCounts = hskLevels.map(({ hskLevel }) => ({
    hskLevel,
    count: classes.filter(({ course }) => course.hskLevel === hskLevel).length,
  }));
  return { user, classes, hskCounts };
}

function getSafeRecordUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function getTrackedAttendanceSessionCount(
  sessions: Array<{ records: Array<{ status: string | null }> }>,
) {
  return sessions.filter((session) => session.records.some(({ status }) => status !== null)).length;
}

function getScheduleSlots(schedule: unknown): ScheduleSlot[] {
  if (!Array.isArray(schedule)) return [];
  return schedule.flatMap((slot): ScheduleSlot[] => {
    if (typeof slot !== "object" || slot === null || Array.isArray(slot)) return [];
    const record = slot as Record<string, unknown>;
    if (!Array.isArray(record.days) || typeof record.startTime !== "string" || typeof record.endTime !== "string") {
      return [];
    }
    return [{
      days: record.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6),
      startTime: record.startTime,
      endTime: record.endTime,
    }];
  });
}

function getTimeInMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export default function AdminClassOverview() {
  const { user, classes, hskCounts } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [selectedHsk, setSelectedHsk] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedRecordClassId, setSelectedRecordClassId] = useState<string | null>(null);
  const [showClassRecordings, setShowClassRecordings] = useState(false);
  const [classPage, setClassPage] = useState(1);
  const classesPerPage = 10;
  const teacherCounts = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const classroom of classes) {
      if (selectedHsk && String(classroom.course.hskLevel) !== selectedHsk) continue;
      const teacherId = classroom.teacher?.id ?? "unassigned";
      const teacherName = classroom.teacher?.name ?? "Chưa phân công";
      const current = counts.get(teacherId) ?? { id: teacherId, name: teacherName, count: 0 };
      current.count += 1;
      counts.set(teacherId, current);
    }
    return Array.from(counts.values())
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "vi"));
  }, [classes, selectedHsk]);
  const hasActiveFilters = Boolean(
    query.trim() || selectedHsk || selectedTeacher || selectedDays.length || startTime || endTime,
  );
  const startTimeMinutes = startTime ? getTimeInMinutes(startTime) : null;
  const endTimeMinutes = endTime ? getTimeInMinutes(endTime) : null;
  const hasInvalidTimeRange = startTimeMinutes != null
    && endTimeMinutes != null
    && endTimeMinutes < startTimeMinutes;
  function changeSelectedHsk(nextHsk: string) {
    setSelectedHsk(nextHsk);
    setClassPage(1);
    if (selectedTeacher && !classes.some((classroom) => (
      (!nextHsk || String(classroom.course.hskLevel) === nextHsk)
      && (classroom.teacher?.id ?? "unassigned") === selectedTeacher
    ))) {
      setSelectedTeacher("");
    }
  }

  const filteredClasses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return classes
      .filter((classroom) => {
        const matchesHsk = !selectedHsk || String(classroom.course.hskLevel) === selectedHsk;
        const matchesTeacher = !selectedTeacher || (classroom.teacher?.id ?? "unassigned") === selectedTeacher;
        const searchText = `${classroom.name} ${classroom.course.code} ${classroom.course.title} ${classroom.teacher?.name ?? ""}`.toLocaleLowerCase("vi");
        const hasScheduleFilter = selectedDays.length > 0 || Boolean(startTime || endTime);
        const matchesSchedule = !hasScheduleFilter || (!hasInvalidTimeRange && getScheduleSlots(classroom.schedule).some((slot) => {
          const slotStartMinutes = getTimeInMinutes(slot.startTime);
          const matchesDay = selectedDays.length === 0 || slot.days.some((day) => selectedDays.includes(day));
          const matchesStartTime = (!startTime || (slotStartMinutes != null && startTimeMinutes != null && slotStartMinutes >= startTimeMinutes))
            && (!endTime || (slotStartMinutes != null && endTimeMinutes != null && slotStartMinutes <= endTimeMinutes));
          return matchesDay && matchesStartTime;
        }));
        return matchesHsk
          && matchesTeacher
          && (!normalizedQuery || searchText.includes(normalizedQuery))
          && matchesSchedule;
      })
      .sort((left, right) => (
        getTrackedAttendanceSessionCount(right.attendanceSessions)
        - getTrackedAttendanceSessionCount(left.attendanceSessions)
      ));
  }, [classes, query, selectedHsk, selectedTeacher, selectedDays, startTime, endTime, hasInvalidTimeRange, startTimeMinutes, endTimeMinutes]);
  const classPageCount = Math.max(1, Math.ceil(filteredClasses.length / classesPerPage));
  const currentClassPage = Math.min(classPage, classPageCount);
  const pageClasses = filteredClasses.slice(
    (currentClassPage - 1) * classesPerPage,
    currentClassPage * classesPerPage,
  );
  const selectedRecordClass = classes.find(({ id }) => id === selectedRecordClassId) ?? null;
  const selectedClassRecordings = useMemo(
    () => [...(selectedRecordClass?.attendanceSessions ?? [])].sort(
      (left, right) => right.date.getTime() - left.date.getTime()
        || right.createdAt.getTime() - left.createdAt.getTime(),
    ),
    [selectedRecordClass?.attendanceSessions],
  );
  const selectedClassScoresByStudent = new Map(
    selectedRecordClass?.studentScores.map((score) => [score.studentId, score]) ?? [],
  );
  const selectedClassHigherHskStudents = new Set(
    selectedRecordClass?.enrollments
      .filter(({ user: student }) => student.enrollments.some(
        ({ course }) => course.hskLevel > (selectedRecordClass?.course.hskLevel ?? 0),
      ))
      .map(({ user: student }) => student.id) ?? [],
  );
  const selectedClassTrackedSessions = selectedRecordClass?.attendanceSessions.filter(
    (session) => session.records.some(({ status }) => status !== null),
  ) ?? [];
  const selectedClassHasFinalScores = selectedClassScoresByStudent.size > 0;
  const selectedClassHasOutcomeDecisions = selectedRecordClass?.studentScores.some(({ decision }) => decision !== null) ?? false;
  const selectedClassHasHigherHskRegistrations = selectedClassHigherHskStudents.size > 0;
  const selectedClassDynamicColumnCount = Number(selectedClassHasFinalScores)
    + Number(selectedClassHasOutcomeDecisions)
    + Number(selectedClassHasHigherHskRegistrations);
  const selectedClassLatestSession = selectedClassTrackedSessions[0]
    ?? selectedRecordClass?.attendanceSessions[0]
    ?? null;

  useEffect(() => {
    if (!selectedRecordClassId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showClassRecordings) {
        setShowClassRecordings(false);
      } else {
        setSelectedRecordClassId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedRecordClassId, showClassRecordings]);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tổng quan lớp học</h1>
            <p className="mt-1 text-sm text-muted-foreground">Theo dõi lớp đang học, giáo viên và video từng buổi.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin/teachers" className="text-sm font-medium text-primary hover:underline">Phân công giáo viên</Link>
            <Button asChild variant="outline">
              <Link to="/admin/classes">Quản lý lớp</Link>
            </Button>
          </div>
        </header>

        <section aria-labelledby="class-count-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="class-count-heading" className="text-base font-semibold">Lớp đang học theo HSK</h2>
            <span className="text-sm text-muted-foreground">{classes.length} lớp đang mở</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hskCounts.map(({ hskLevel, count }) => (
              <button
                key={hskLevel}
                type="button"
                onClick={() => changeSelectedHsk(selectedHsk === String(hskLevel) ? "" : String(hskLevel))}
                aria-pressed={selectedHsk === String(hskLevel)}
                className={`flex min-h-16 items-center justify-between rounded-lg border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedHsk === String(hskLevel)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted/40"
                }`}
              >
                <span className="text-sm font-medium">HSK {hskLevel}</span>
                <span className="text-xl font-semibold tabular-nums">
                  {count}
                  <span className={`ml-1 text-xs font-normal ${selectedHsk === String(hskLevel) ? "text-primary-foreground/75" : "text-muted-foreground"}`}>lớp</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="active-classes-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="active-classes-heading" className="text-base font-semibold">Lớp đang học</h2>
              <p className="mt-1 text-sm text-muted-foreground">Video chỉ hiển thị với học viên thuộc lớp đó.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
            <label className="relative min-w-[14rem] flex-1">
              <span className="sr-only">Tìm lớp, khóa học hoặc giáo viên</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setClassPage(1);
                }}
                placeholder="Tìm lớp, giáo viên..."
                className="pl-9"
              />
            </label>
            <label>
              <span className="sr-only">Lọc theo giáo viên</span>
              <select
                value={selectedTeacher}
                onChange={(event) => {
                  setSelectedTeacher(event.currentTarget.value);
                  setClassPage(1);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
              >
                <option value="">Tất cả giáo viên</option>
                {teacherCounts.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name} ({teacher.count} lớp)
                  </option>
                ))}
              </select>
            </label>
            <div className="flex h-10 items-center gap-1 rounded-md border border-input bg-background px-1.5" role="group" aria-label="Lọc lớp theo thứ trong tuần">
              <span className="px-1 text-xs text-muted-foreground">Thứ</span>
              {WEEKDAYS.map(({ value, label }) => {
                const selected = selectedDays.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Thứ ${label}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedDays((current) => selected
                        ? current.filter((day) => day !== value)
                        : [...current, value]);
                      setClassPage(1);
                    }}
                    className={`h-7 min-w-8 rounded px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <details className="group relative">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <span>
                  {startTime || endTime
                    ? `${startTime || "00:00"}–${endTime || "23:59"}`
                    : "Khung giờ"}
                </span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
                <p className="text-sm font-medium">Giờ bắt đầu của lớp</p>
                <p className="mt-1 text-xs text-muted-foreground">Lọc lớp có giờ bắt đầu trong khoảng này.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Từ</span>
                    <input
                      type="time"
                      value={startTime}
                      max={endTime || undefined}
                      onChange={(event) => {
                        setStartTime(event.currentTarget.value);
                        setClassPage(1);
                      }}
                      aria-label="Giờ bắt đầu từ"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Đến</span>
                    <input
                      type="time"
                      value={endTime}
                      min={startTime || undefined}
                      onChange={(event) => {
                        setEndTime(event.currentTarget.value);
                        setClassPage(1);
                      }}
                      aria-label="Giờ bắt đầu đến"
                      aria-invalid={hasInvalidTimeRange}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                </div>
                {hasInvalidTimeRange && (
                  <p role="alert" className="mt-2 text-xs text-destructive">Giờ kết thúc cần bằng hoặc sau giờ bắt đầu.</p>
                )}
              </div>
            </details>
            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={() => {
                setQuery("");
                setSelectedHsk("");
                setSelectedTeacher("");
                setSelectedDays([]);
                setStartTime("");
                setEndTime("");
                setClassPage(1);
              }}
              className="ml-auto whitespace-nowrap px-2 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Xóa bộ lọc
            </button>
          </div>
          <div className="flex min-h-6 items-center justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span>{filteredClasses.length} / {classes.length} lớp</span>
          </div>

          {filteredClasses.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {classes.length === 0 ? "Chưa có lớp đang học." : "Không có lớp nào khớp bộ lọc."}
            </p>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {pageClasses.map((classroom) => {
                const trackedSessions = getTrackedAttendanceSessionCount(classroom.attendanceSessions);
                return (
                  <button
                    key={classroom.id}
                    type="button"
                    onClick={() => setSelectedRecordClassId(classroom.id)}
                    aria-label={`Xem chi tiết lớp ${classroom.name}`}
                    className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
                  >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{classroom.name}</h3>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">HSK {classroom.course.hskLevel}</span>
                          <span className="text-xs text-muted-foreground">{classroom.course.code}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">Đang học</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatSchedule(classroom.schedule)} · {classroom.teacher?.name ?? "Chưa phân công"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="text-right text-sm tabular-nums">
                          <span className="block font-semibold">{classroom._count.enrollments}/{classroom.maxStudents}</span>
                          <span className="text-xs text-muted-foreground">học viên</span>
                        </span>
                        <span className="text-right text-sm tabular-nums">
                          <span className="block font-semibold">{trackedSessions}</span>
                          <span className="text-xs text-muted-foreground">buổi đã điểm danh</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                          Chi tiết <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                        </span>
                      </div>
                  </button>
                );
              })}
            </div>
          )}
          {classPageCount > 1 && (
            <nav aria-label="Phân trang danh sách lớp" className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground" aria-live="polite">
                Hiển thị {(currentClassPage - 1) * classesPerPage + 1}–
                {Math.min(currentClassPage * classesPerPage, filteredClasses.length)} / {filteredClasses.length} lớp
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setClassPage((page) => Math.max(1, page - 1))}
                  disabled={currentClassPage === 1}
                >
                  Trang trước
                </Button>
                <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
                  {currentClassPage} / {classPageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setClassPage((page) => Math.min(classPageCount, page + 1))}
                  disabled={currentClassPage === classPageCount}
                >
                  Trang sau
                </Button>
              </div>
            </nav>
          )}
        </section>

      </div>
      {selectedRecordClass && (
        <>
          <Overlay onClose={() => setSelectedRecordClassId(null)} className="max-w-5xl">
            <section role="dialog" aria-modal="true" aria-labelledby="class-details-dialog-title" className="space-y-5">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="class-details-dialog-title" className="text-lg font-semibold">{selectedRecordClass.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  HSK {selectedRecordClass.course.hskLevel} · {selectedRecordClass.course.code} · {selectedRecordClass.course.title}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedRecordClassId(null)}
                aria-label="Đóng chi tiết lớp học"
                className="shrink-0"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </header>

            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-3">
              <p><span className="text-muted-foreground">Lịch học: </span>{formatSchedule(selectedRecordClass.schedule)}</p>
              <p><span className="text-muted-foreground">Giáo viên: </span>{selectedRecordClass.teacher?.name ?? "Chưa phân công"}</p>
              <p><span className="text-muted-foreground">Học viên: </span>{selectedRecordClass._count.enrollments}/{selectedRecordClass.maxStudents}</p>
            </div>

            {selectedClassLatestSession ? (
              <div className="rounded-lg bg-muted/50 px-4 py-3">
                <p className="font-medium">Buổi gần nhất: {selectedClassLatestSession.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {selectedClassLatestSession.date.toLocaleDateString("vi-VN")} · {selectedClassLatestSession.records.filter(({ status }) => status !== null).length}/{selectedRecordClass.enrollments.length} học viên đã điểm danh
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Lớp chưa có buổi điểm danh.</p>
            )}

            <section aria-labelledby="class-detail-students-title" className="space-y-2">
              <h3 id="class-detail-students-title" className="text-sm font-semibold">Danh sách học viên</h3>
              {selectedRecordClass.enrollments.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Lớp chưa có học viên.</p>
              ) : (
                <div className="max-h-[35vh] overflow-auto rounded-lg border">
                  <table className={`w-full border-collapse text-left ${selectedClassDynamicColumnCount >= 3 ? "min-w-[860px]" : selectedClassDynamicColumnCount === 2 ? "min-w-[760px]" : selectedClassDynamicColumnCount === 1 ? "min-w-[650px]" : "min-w-[560px]"}`}>
                    <caption className="sr-only">Thông tin học viên lớp {selectedRecordClass.name}</caption>
                    <thead className="bg-muted/40">
                      <tr className="border-b">
                        <th scope="col" className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground">STT</th>
                        <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                        <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Vắng / tổng buổi</th>
                        {selectedClassHasFinalScores && <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Điểm cuối khóa</th>}
                        {selectedClassHasOutcomeDecisions && <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Kết quả dự kiến</th>}
                        {selectedClassHasHigherHskRegistrations && <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Đăng ký khóa sau</th>}
                        <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selectedRecordClass.enrollments.map(({ user: student }, index) => {
                        const absentCount = selectedClassTrackedSessions.reduce((count, session) => (
                          count + (session.records.find(({ studentId }) => studentId === student.id)?.status === "ABSENT" ? 1 : 0)
                        ), 0);
                        const isRegisteredForHigherHsk = selectedClassHigherHskStudents.has(student.id);
                        const savedScore = selectedClassScoresByStudent.get(student.id);
                        const status = !student.isActive
                          ? { label: "Đã khóa", className: "bg-muted text-muted-foreground" }
                          : !student.isActivated
                            ? { label: "Chưa kích hoạt", className: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" }
                            : { label: "Đang học", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" };
                        return (
                          <tr key={student.id}>
                            <td className="px-3 py-2.5 text-sm tabular-nums text-muted-foreground">{index + 1}</td>
                            <th scope="row" className="px-3 py-2.5 text-sm font-medium">{student.name}</th>
                            <td className="px-3 py-2.5 text-sm tabular-nums">{absentCount}/{selectedClassTrackedSessions.length} buổi</td>
                            {selectedClassHasFinalScores && (
                              <td className="px-3 py-2.5 text-sm tabular-nums">{savedScore ? `${savedScore.score}/10` : "—"}</td>
                            )}
                            {selectedClassHasOutcomeDecisions && (
                              <td className="px-3 py-2.5 text-sm">
                                {savedScore?.decision === "PROMOTE"
                                  ? "Học lên"
                                  : savedScore?.decision === "ELIGIBLE_NOT_ENROLLED"
                                    ? "Đủ điều kiện, chưa đăng ký"
                                    : savedScore?.decision === "REPEAT"
                                      ? "Không đủ học lực"
                                      : "—"}
                              </td>
                            )}
                            {selectedClassHasHigherHskRegistrations && (
                              <td className="px-3 py-2.5 text-sm">
                                <span className="inline-flex items-center gap-1.5">
                                  {isRegisteredForHigherHsk
                                    ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                                    : <Circle aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
                                  {isRegisteredForHigherHsk ? "Rồi" : "Chưa"}
                                </span>
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-sm">
                              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Button
              type="button"
              variant="outline"
              onClick={() => setShowClassRecordings(true)}
              aria-haspopup="dialog"
              className="w-full justify-between transition-colors hover:border-red-700 hover:bg-red-700 hover:text-white active:border-red-800 active:bg-red-800 sm:w-auto"
            >
              <span className="inline-flex items-center gap-2">
                <Video aria-hidden="true" className="h-4 w-4" />
                Bản ghi buổi học
              </span>
              <span className="ml-3 text-xs text-muted-foreground">
                {selectedRecordClass.attendanceSessions.filter(({ recordingUrl }) => getSafeRecordUrl(recordingUrl)).length}/{selectedRecordClass.attendanceSessions.length}
              </span>
            </Button>
            <div className="flex justify-end border-t pt-3">
              <Button type="button" variant="outline" onClick={() => setSelectedRecordClassId(null)}>Đóng</Button>
            </div>
            </section>
          </Overlay>
          {showClassRecordings && (
            <Overlay onClose={() => setShowClassRecordings(false)} className="max-w-2xl">
              <section role="dialog" aria-modal="true" aria-labelledby="class-recordings-dialog-title" className="space-y-4">
                <header className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="class-recordings-dialog-title" className="text-lg font-semibold">Bản ghi buổi học</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedRecordClass.name}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowClassRecordings(false)}
                    aria-label="Đóng bản ghi buổi học"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </header>
                <div className="max-h-[65vh] overflow-y-auto rounded-lg border">
                  {selectedClassRecordings.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">Lớp chưa có buổi học.</p>
                  ) : (
                    <ul className="divide-y">
                      {selectedClassRecordings.map((session) => {
                        const recordUrl = getSafeRecordUrl(session.recordingUrl);
                        return (
                          <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{session.title}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {session.date.toLocaleDateString("vi-VN")}
                                {session.courseLesson && ` · Bài ${session.courseLesson.order} · ${session.courseLesson.title}`}
                                {!session.courseLesson && session.lesson && ` · ${session.lesson}`}
                              </p>
                            </div>
                            {recordUrl ? (
                              <a
                                href={recordUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                Mở bản ghi<ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                              </a>
                            ) : (
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                                <Circle aria-hidden="true" className="h-3.5 w-3.5" />
                                Chưa có link
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex justify-end border-t pt-3">
                  <Button type="button" variant="outline" onClick={() => setShowClassRecordings(false)}>Đóng</Button>
                </div>
              </section>
            </Overlay>
          )}
        </>
      )}
    </AppShell>
  );
}
