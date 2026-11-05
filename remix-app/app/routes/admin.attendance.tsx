import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Prisma } from "@prisma/client";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";
type AbsenceReason = "EXCUSED" | "UNEXCUSED";
type StatusFilter = "ALL" | "UNMARKED" | AttendanceStatus;

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "PRESENT", label: "Có mặt" },
  { value: "LATE", label: "Đi muộn" },
  { value: "ABSENT", label: "Vắng mặt" },
];

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function isAttendanceStatus(value: string): value is AttendanceStatus {
  return value === "PRESENT" || value === "LATE" || value === "ABSENT";
}

function isAbsenceReason(value: string): value is AbsenceReason {
  return value === "EXCUSED" || value === "UNEXCUSED";
}

function isStatusFilter(value: string): value is StatusFilter {
  return value === "ALL" || value === "UNMARKED" || isAttendanceStatus(value);
}

function parseAttendanceDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function formatAttendanceDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .trim();
}

function SearchableClassSelect({
  classes,
  selectedClassId,
  onSelect,
}: {
  classes: AttendanceData["classes"];
  selectedClassId: string;
  onSelect: (classId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedClass = classes.find((classroom) => classroom.id === selectedClassId);
  const selectedLabel = selectedClass?.name ?? "";
  const [inputValue, setInputValue] = useState(selectedLabel);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = "attendance-class-options";
  const filteredClasses = classes.filter((classroom) =>
    normalizeSearchText(`${classroom.name} ${classroom.course} ${classroom.teacher}`)
      .includes(normalizeSearchText(query)),
  );

  useEffect(() => {
    setInputValue(selectedLabel);
    setQuery("");
    setIsOpen(false);
  }, [selectedClassId, selectedLabel]);

  return (
    <div
      ref={containerRef}
      className="relative w-full sm:max-w-xs"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
          setQuery("");
          setInputValue(selectedLabel);
        }
      }}
    >
      <Label htmlFor="filter-class">Lớp học</Label>
      <div className="relative mt-1.5">
        <Input
          id="filter-class"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && filteredClasses[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder="Tìm tên lớp..."
          className="pr-10"
          value={inputValue}
          onFocus={(event) => {
            event.currentTarget.select();
            setQuery("");
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onChange={(event) => {
            setInputValue(event.currentTarget.value);
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((index) => Math.min(index + 1, filteredClasses.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && isOpen && filteredClasses[activeIndex]) {
              event.preventDefault();
              onSelect(filteredClasses[activeIndex].id);
            } else if (event.key === "Escape") {
              setIsOpen(false);
              setQuery("");
              setInputValue(selectedLabel);
            }
          }}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Kết quả tìm lớp"
          className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filteredClasses.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy lớp phù hợp.</p>
          ) : filteredClasses.map((classroom, index) => {
            return (
              <button
                key={classroom.id}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={classroom.id === selectedClassId}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(classroom.id)}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="min-w-0 truncate">
                  {classroom.name}
                  {classroom.isCompleted && <span className="ml-1 text-muted-foreground">· Đã kết thúc</span>}
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{classroom.course}</span>
                </span>
                {classroom.id === selectedClassId && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const params = url.searchParams;
  const classId = params.get("classId") ?? "";
  const requestedSessionId = params.get("sessionId") ?? "";
  const rawStatus = params.get("status") ?? "ALL";
  const rawQuery = params.get("q") ?? "";
  const query = rawQuery.trim().slice(0, 100);
  const parsedPage = Number.parseInt(params.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  let filterError = "";
  let invalidFilter = false;

  const classes = await prisma.class.findMany({
    select: {
      id: true,
      name: true,
      completedAt: true,
      course: { select: { title: true } },
      teacher: { select: { name: true } },
    },
    orderBy: [{ completedAt: "asc" }, { name: "asc" }],
  });

  const selectedClass = classes.find((classroom) => classroom.id === classId) ?? null;
  if (classId && !selectedClass) {
    filterError = "Lớp được chọn không còn tồn tại. Hãy chọn lại lớp.";
    invalidFilter = true;
  }
  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : "ALL";
  if (!isStatusFilter(rawStatus)) {
    filterError = "Trạng thái lọc không hợp lệ. Hãy chọn lại trạng thái.";
    invalidFilter = true;
  }
  if (rawQuery.trim().length > 100) {
    filterError = "Từ khóa tìm kiếm tối đa 100 ký tự.";
    invalidFilter = true;
  }

  const recordWhere: Prisma.AttendanceRecordWhereInput = {};
  if (status === "UNMARKED") recordWhere.status = null;
  else if (isAttendanceStatus(status)) recordWhere.status = status;
  if (query) {
    recordWhere.student = {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    };
  }

  const totalSessions = !classId || invalidFilter
    ? 0
    : await prisma.attendanceSession.count({ where: { classId } });
  const pageCount = Math.max(1, Math.ceil(totalSessions / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const sessions = !classId || invalidFilter
    ? []
    : await prisma.attendanceSession.findMany({
        where: { classId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          classId: true,
          title: true,
          lesson: true,
          date: true,
          class: {
            select: {
              name: true,
              completedAt: true,
              course: { select: { title: true } },
              teacher: { select: { name: true } },
            },
          },
          _count: { select: { records: true } },
        },
      });

  const selectedSession = requestedSessionId && selectedClass && !invalidFilter
    ? await prisma.attendanceSession.findFirst({
        where: { id: requestedSessionId, classId: selectedClass.id },
        select: {
          id: true,
          classId: true,
          title: true,
          lesson: true,
          date: true,
          class: {
            select: {
              name: true,
              completedAt: true,
              course: { select: { title: true } },
              teacher: { select: { name: true } },
            },
          },
          _count: { select: { records: true } },
          records: {
            ...(Object.keys(recordWhere).length > 0 ? { where: recordWhere } : {}),
            orderBy: { student: { name: "asc" } },
            select: {
              id: true,
              status: true,
              absenceReason: true,
              recording: true,
              hanzi: true,
              duet: true,
              lessonLink: true,
              student: { select: { name: true } },
            },
          },
        },
      })
    : null;

  return {
    user,
    classes: classes.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      course: classroom.course.title,
      teacher: classroom.teacher?.name ?? "Chưa phân công",
      isCompleted: Boolean(classroom.completedAt),
    })),
    activeClasses: classes
      .filter((classroom) => !classroom.completedAt)
      .map((classroom) => ({
        id: classroom.id,
        name: classroom.name,
        course: classroom.course.title,
      })),
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      lesson: session.lesson,
      date: session.date.toISOString().slice(0, 10),
      recordCount: session._count.records,
    })),
    selectedSession: selectedSession
      ? {
          id: selectedSession.id,
          classId: selectedSession.classId,
          title: selectedSession.title,
          lesson: selectedSession.lesson,
          date: selectedSession.date.toISOString().slice(0, 10),
          classroom: {
            name: selectedSession.class.name,
            course: selectedSession.class.course.title,
            teacher: selectedSession.class.teacher?.name ?? "Chưa phân công",
            isCompleted: Boolean(selectedSession.class.completedAt),
          },
          recordCount: selectedSession._count.records,
          records: selectedSession.records,
        }
      : null,
    filters: { classId, sessionId: selectedSession?.id ?? "", status, query },
    totalSessions,
    page,
    pageCount,
    filterError,
    today: new Date().toISOString().slice(0, 10),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create-session") {
    const classId = String(form.get("classId") ?? "");
    const title = String(form.get("title") ?? "").trim();
    const lesson = String(form.get("lesson") ?? "").trim();
    const dateValue = String(form.get("date") ?? "");
    const date = parseAttendanceDate(dateValue);
    if (!classId) return { success: false as const, intent, error: "Vui lòng chọn lớp." };
    if (!title || title.length > 80) {
      return { success: false as const, intent, error: "Tên buổi học phải có từ 1 đến 80 ký tự." };
    }
    if (lesson.length > 120) {
      return { success: false as const, intent, error: "Tên bài học không được vượt quá 120 ký tự." };
    }
    if (!date) return { success: false as const, intent, error: "Vui lòng chọn ngày học hợp lệ." };

    const classroom = await prisma.class.findFirst({
      where: { id: classId, completedAt: null },
      select: { id: true },
    });
    if (!classroom) {
      return { success: false as const, intent, error: "Không tìm thấy lớp đang hoạt động để tạo buổi học." };
    }

    const session = await prisma.$transaction(async (tx) => {
      const createdSession = await tx.attendanceSession.create({
        data: { classId, title, lesson, date },
        select: { id: true },
      });
      const enrollments = await tx.enrollment.findMany({
        where: {
          classId,
          user: { is: { role: "student", isActive: true, deletedAt: null } },
        },
        select: { userId: true },
      });
      if (enrollments.length > 0) {
        await tx.attendanceRecord.createMany({
          data: enrollments.map(({ userId }) => ({
            sessionId: createdSession.id,
            studentId: userId,
            status: null,
          })),
        });
      }
      return createdSession;
    });

    return { success: true as const, intent, classId, sessionId: session.id };
  }

  if (intent === "update-session" || intent === "delete-session") {
    const sessionId = String(form.get("sessionId") ?? "");
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      return { success: false as const, intent, error: "Không tìm thấy buổi điểm danh. Hãy tải lại trang." };
    }

    if (intent === "delete-session") {
      await prisma.attendanceSession.delete({ where: { id: session.id } });
      return { success: true as const, intent, sessionId };
    }

    const title = String(form.get("title") ?? "").trim();
    const lesson = String(form.get("lesson") ?? "").trim();
    const date = parseAttendanceDate(String(form.get("date") ?? ""));
    if (!title || title.length > 80) {
      return { success: false as const, intent, error: "Tên buổi học phải có từ 1 đến 80 ký tự." };
    }
    if (lesson.length > 120) {
      return { success: false as const, intent, error: "Tên bài học không được vượt quá 120 ký tự." };
    }
    if (!date) return { success: false as const, intent, error: "Vui lòng chọn ngày học hợp lệ." };

    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { title, lesson, date },
    });
    return { success: true as const, intent, sessionId };
  }

  if (intent === "update-record") {
    const recordId = String(form.get("recordId") ?? "");
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { id: true },
    });
    if (!record) {
      return { success: false as const, intent, error: "Không tìm thấy dòng điểm danh. Hãy tải lại trang." };
    }

    const rawStatus = String(form.get("status") ?? "");
    const status = rawStatus === "" ? null : isAttendanceStatus(rawStatus) ? rawStatus : undefined;
    if (status === undefined) {
      return { success: false as const, intent, error: "Trạng thái điểm danh không hợp lệ." };
    }
    const rawReason = String(form.get("absenceReason") ?? "");
    const absenceReason = rawReason === "" ? null : isAbsenceReason(rawReason) ? rawReason : undefined;
    if (absenceReason === undefined || (status === "ABSENT" && absenceReason === null)) {
      return { success: false as const, intent, error: "Vui lòng chọn lý do khi đánh dấu vắng mặt." };
    }

    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status,
        absenceReason: status === "ABSENT" ? absenceReason : null,
      },
    });
    return { success: true as const, intent, recordId };
  }

  return { success: false as const, intent, error: "Thao tác điểm danh không hợp lệ." };
}

type AttendanceData = Awaited<ReturnType<typeof loader>>;
type AttendanceSessionSummary = AttendanceData["sessions"][number];
type AttendanceSession = NonNullable<AttendanceData["selectedSession"]>;
type AttendanceRow = AttendanceSession["records"][number];

function AttendanceStatusBadge({ status }: { status: AttendanceStatus | null }) {
  if (status === "PRESENT") {
    return <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Có mặt</Badge>;
  }
  if (status === "LATE") {
    return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Đi muộn</Badge>;
  }
  if (status === "ABSENT") {
    return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Vắng mặt</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground">Chưa điểm danh</Badge>;
}

function AttendanceRecordEditor({
  sessionId,
  record,
}: {
  sessionId: string;
  record: AttendanceRow;
}) {
  const fetcher = useFetcher<typeof action>();
  const [status, setStatus] = useState<string>(record.status ?? "");
  const [absenceReason, setAbsenceReason] = useState<string>(record.absenceReason ?? "");
  const savedStatus = record.status ?? "";
  const savedReason = record.absenceReason ?? "";
  const isDirty = status !== savedStatus || (status === "ABSENT" && absenceReason !== savedReason);
  const isSaving = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" className="flex min-w-[19rem] flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="update-record" />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="recordId" value={record.id} />
      <label className="sr-only" htmlFor={`attendance-status-${record.id}`}>Trạng thái điểm danh</label>
      <select
        id={`attendance-status-${record.id}`}
        name="status"
        value={status}
        onChange={(event) => {
          setStatus(event.currentTarget.value);
          if (event.currentTarget.value !== "ABSENT") setAbsenceReason("");
        }}
        className="h-9 min-w-36 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Chưa điểm danh</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {status === "ABSENT" && (
        <>
          <label className="sr-only" htmlFor={`absence-reason-${record.id}`}>Lý do vắng</label>
          <select
            id={`absence-reason-${record.id}`}
            name="absenceReason"
            value={absenceReason}
            onChange={(event) => setAbsenceReason(event.currentTarget.value)}
            required
            className="h-9 min-w-36 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Chọn lý do vắng</option>
            <option value="EXCUSED">Có phép</option>
            <option value="UNEXCUSED">Không phép</option>
          </select>
        </>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={!isDirty || isSaving}>
        <Check className="mr-1.5 h-4 w-4" />
        {isSaving ? "Đang lưu" : "Lưu"}
      </Button>
      {fetcher.data?.success === false && (
        <span role="alert" className="w-full text-xs text-destructive">{fetcher.data.error}</span>
      )}
    </fetcher.Form>
  );
}

function SessionActions({ session }: { session: AttendanceSession }) {
  const editFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <details className="group">
        <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Chỉnh sửa buổi
        </summary>
        <div className="mt-3 rounded-lg border bg-muted/30 p-4">
          <editFetcher.Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="intent" value="update-session" />
            <input type="hidden" name="sessionId" value={session.id} />
            <div className="space-y-1.5">
              <Label htmlFor={`session-title-${session.id}`}>Tên buổi</Label>
              <Input id={`session-title-${session.id}`} name="title" defaultValue={session.title} maxLength={80} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`session-lesson-${session.id}`}>Bài học</Label>
              <Input id={`session-lesson-${session.id}`} name="lesson" defaultValue={session.lesson} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`session-date-${session.id}`}>Ngày học</Label>
              <Input id={`session-date-${session.id}`} name="date" type="date" defaultValue={session.date} required />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="outline" className="w-full" disabled={editFetcher.state !== "idle"}>
                {editFetcher.state !== "idle" ? "Đang lưu..." : "Lưu thông tin buổi"}
              </Button>
            </div>
            {editFetcher.data?.success === false && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-4">{editFetcher.data.error}</p>
            )}
          </editFetcher.Form>
        </div>
      </details>

      <deleteFetcher.Form
        method="post"
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `Xóa "${session.title}" của lớp ${session.classroom.name}? Thao tác này sẽ xóa ${session.recordCount} dòng điểm danh và không thể hoàn tác.`,
          );
          if (!confirmed) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete-session" />
        <input type="hidden" name="sessionId" value={session.id} />
        <Button type="submit" variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deleteFetcher.state !== "idle"}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          Xóa buổi
        </Button>
        {deleteFetcher.data?.success === false && (
          <p role="alert" className="mt-2 text-sm text-destructive">{deleteFetcher.data.error}</p>
        )}
      </deleteFetcher.Form>
    </div>
  );
}

function AttendanceSessionTab({
  session,
  classId,
  isSelected,
}: {
  session: AttendanceSessionSummary;
  classId: string;
  isSelected: boolean;
}) {
  const search = new URLSearchParams({ classId, sessionId: session.id });
  const label = session.lesson.trim() ? `${session.title} - ${session.lesson.trim()}` : session.title;

  return (
    <Link
      to={`/admin/attendance?${search.toString()}`}
      role="tab"
      aria-selected={isSelected}
      title={`${label} · ${formatAttendanceDate(session.date)}`}
      className={`inline-flex h-10 shrink-0 items-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        isSelected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}

function AttendanceSessionDetails({
  session,
  status,
  query,
}: {
  session: AttendanceSession;
  status: StatusFilter;
  query: string;
}) {
  const counts = session.records.reduce(
    (result, record) => {
      if (record.status === "PRESENT") result.present += 1;
      else if (record.status === "LATE") result.late += 1;
      else if (record.status === "ABSENT") result.absent += 1;
      else result.unmarked += 1;
      return result;
    },
    { present: 0, late: 0, absent: 0, unmarked: 0 },
  );

  return (
    <Card>
      <div className="flex flex-col gap-4 border-b p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-tight">{session.classroom.name}</h2>
            {session.classroom.isCompleted && (
              <Badge variant="outline" className="text-muted-foreground">Đã kết thúc</Badge>
            )}
            <span className="text-sm text-muted-foreground">{session.classroom.course}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{session.title}</span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {formatAttendanceDate(session.date)}
            </span>
            {session.lesson && <span>Bài: {session.lesson}</span>}
            <span>GV: {session.classroom.teacher}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{session.records.length} học viên trong kết quả</Badge>
            <Badge variant="outline" className="border-success/30 text-success">{counts.present} có mặt</Badge>
            <Badge variant="outline" className="border-warning/30 text-warning">{counts.late} đi muộn</Badge>
            <Badge variant="outline" className="border-destructive/30 text-destructive">{counts.absent} vắng</Badge>
            {counts.unmarked > 0 && (
              <Badge variant="outline" className="text-muted-foreground">{counts.unmarked} chưa điểm danh</Badge>
            )}
          </div>
        </div>
        <SessionActions session={session} />
      </div>

      <CardContent className="p-0">
        <div className="border-b p-4 sm:p-5">
          <Form method="get" className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-end">
            <input type="hidden" name="classId" value={session.classId} />
            <input type="hidden" name="sessionId" value={session.id} />
            <div className="space-y-1.5">
              <Label htmlFor={`record-status-${session.id}`}>Trạng thái</Label>
              <select id={`record-status-${session.id}`} name="status" defaultValue={status} className={SELECT_CLASS}>
                <option value="ALL">Tất cả</option>
                <option value="UNMARKED">Chưa điểm danh</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`record-search-${session.id}`}>Tìm học viên</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={`record-search-${session.id}`}
                  name="q"
                  defaultValue={query}
                  placeholder="Tên hoặc email"
                  className="pl-9"
                />
              </div>
            </div>
            <Button type="submit" variant="outline">
              <Search className="mr-2 h-4 w-4" />
              Lọc học viên
            </Button>
            <Button asChild type="button" variant="ghost">
              <Link to={`/admin/attendance?classId=${encodeURIComponent(session.classId)}&sessionId=${encodeURIComponent(session.id)}`}>
                Đặt lại
              </Link>
            </Button>
          </Form>
        </div>
        {session.records.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Buổi này chưa có học viên khớp với bộ lọc.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Học viên</th>
                  <th scope="col" className="px-4 py-3 font-medium">Trạng thái điểm danh</th>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Nhiệm vụ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {session.records.map((record) => (
                  <tr key={record.id} className="align-top">
                    <th scope="row" className="px-4 py-4 font-medium sm:px-5">
                      <span className="block">{record.student.name}</span>
                      <span className="mt-1 block">
                        <AttendanceStatusBadge status={record.status} />
                      </span>
                    </th>
                    <td className="px-4 py-3">
                      <AttendanceRecordEditor
                        key={`${record.id}:${record.status ?? ""}:${record.absenceReason ?? ""}`}
                        sessionId={session.id}
                        record={record}
                      />
                      {record.status === "ABSENT" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Lý do hiện tại: {record.absenceReason === "EXCUSED" ? "Có phép" : record.absenceReason === "UNEXCUSED" ? "Không phép" : "Chưa ghi nhận"}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground sm:px-5">
                      {[
                        ["Ghi âm", record.recording],
                        ["Chữ Hán", record.hanzi],
                        ["Duet", record.duet],
                        ["Bài link", record.lessonLink],
                      ]
                        .filter(([, completed]) => completed)
                        .map(([label]) => label)
                        .join(" · ") || "Chưa hoàn thành"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminAttendance() {
  const {
    user,
    classes,
    activeClasses,
    sessions,
    selectedSession,
    filters,
    totalSessions,
    page,
    pageCount,
    filterError,
    today,
  } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const selectedClass = classes.find((classroom) => classroom.id === filters.classId) ?? null;
  const navigate = useNavigate();

  useEffect(() => {
    const result = createFetcher.data;
    if (
      createFetcher.state === "idle"
      && result?.success
      && result.intent === "create-session"
      && "classId" in result
      && "sessionId" in result
      && typeof result.classId === "string"
      && typeof result.sessionId === "string"
    ) {
      setShowCreateForm(false);
      if (filters.sessionId !== result.sessionId) {
        navigate(`/admin/attendance?classId=${encodeURIComponent(result.classId)}&sessionId=${encodeURIComponent(result.sessionId)}`);
      }
    }
  }, [createFetcher.data, createFetcher.state, filters.sessionId, navigate]);

  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (filters.classId) params.set("classId", filters.classId);
    params.set("page", String(nextPage));
    return `/admin/attendance?${params.toString()}`;
  };

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Điểm danh</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Chọn lớp, mở buổi học rồi xem hoặc cập nhật điểm danh của học viên.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setShowCreateForm((open) => !open)}
            disabled={activeClasses.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Tạo buổi điểm danh
          </Button>
        </header>

        {showCreateForm && (
          <Card>
            <CardContent className="space-y-4 p-4 sm:p-6">
              <div>
                <h2 className="font-semibold">Tạo buổi điểm danh mới</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Học viên được thêm vào với trạng thái “Chưa điểm danh”; buổi mới chỉ tạo cho lớp đang hoạt động.
                </p>
              </div>
              {activeClasses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Hiện không có lớp đang hoạt động.</p>
              ) : (
                <createFetcher.Form method="post" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="intent" value="create-session" />
                  <div className="space-y-1.5">
                    <Label htmlFor="new-session-class">Lớp học</Label>
                    <select
                      id="new-session-class"
                      name="classId"
                      className={SELECT_CLASS}
                      required
                      defaultValue={filters.classId}
                    >
                      <option value="" disabled>Chọn lớp</option>
                      {activeClasses.map((classroom) => (
                        <option key={classroom.id} value={classroom.id}>
                          {classroom.name} · {classroom.course}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-session-title">Tên buổi</Label>
                    <Input id="new-session-title" name="title" maxLength={80} placeholder="Ví dụ: Buổi 5" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-session-lesson">Bài học</Label>
                    <Input id="new-session-lesson" name="lesson" maxLength={120} placeholder="Tên bài hoặc nội dung học" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-session-date">Ngày học</Label>
                    <Input id="new-session-date" name="date" type="date" defaultValue={today} required />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" disabled={createFetcher.state !== "idle"}>
                      {createFetcher.state !== "idle" ? "Đang tạo..." : "Tạo buổi"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                      Hủy
                    </Button>
                    {createFetcher.data?.success === false && (
                      <p role="alert" className="text-sm text-destructive">{createFetcher.data.error}</p>
                    )}
                  </div>
                </createFetcher.Form>
              )}
            </CardContent>
          </Card>
        )}

        <section aria-label="Chọn lớp">
          <div className="w-full sm:max-w-xs">
            <SearchableClassSelect
              classes={classes}
              selectedClassId={filters.classId}
              onSelect={(classId) => navigate(`/admin/attendance?classId=${encodeURIComponent(classId)}`)}
            />
            {selectedClass && (
              <p className="mt-1.5 truncate text-xs text-muted-foreground">
                {selectedClass.course}{selectedClass.isCompleted ? " · Đã kết thúc" : ""}
              </p>
            )}
          </div>
        </section>

        {filterError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {filterError}
          </p>
        )}

        {!selectedClass ? (
          <Card>
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="mt-4 font-semibold">Chọn lớp để xem danh sách buổi học</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Sau khi chọn lớp, các buổi điểm danh sẽ hiện ở đây. Chọn một buổi để mở bảng điểm danh.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <section aria-labelledby="attendance-sessions-heading" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="attendance-sessions-heading" className="text-lg font-semibold">
                    Các buổi · {selectedClass.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Giáo viên: {selectedClass.teacher}
                  </p>
                </div>
                {totalSessions > 0 && (
                  <span className="text-sm text-muted-foreground">{totalSessions} buổi</span>
                )}
              </div>

              {sessions.length > 0 ? (
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <div
                    role="tablist"
                    aria-label="Các buổi điểm danh"
                    className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3 sm:p-4"
                  >
                  {sessions.map((session) => (
                    <AttendanceSessionTab
                      key={session.id}
                      session={session}
                      classId={selectedClass.id}
                      isSelected={session.id === filters.sessionId}
                    />
                  ))}
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center px-6 pt-10 pb-10 text-center sm:pt-10 sm:pb-10">
                    <ClipboardCheck className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold">Chưa có buổi điểm danh</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedClass.isCompleted
                        ? "Lớp đã kết thúc và hiện chưa có buổi điểm danh."
                        : "Tạo buổi điểm danh mới cho lớp này để bắt đầu."}
                    </p>
                  </CardContent>
                </Card>
              )}
            </section>

            {pageCount > 1 && (
              <nav aria-label="Phân trang buổi điểm danh" className="flex items-center justify-between gap-3">
                {page <= 1 ? (
                  <Button type="button" variant="outline" disabled>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Trước
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link to={pageHref(page - 1)}>
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Trước
                    </Link>
                  </Button>
                )}
                <span className="text-sm text-muted-foreground">Trang {page} / {pageCount}</span>
                {page >= pageCount ? (
                  <Button type="button" variant="outline" disabled>
                    Sau
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link to={pageHref(page + 1)}>
                      Sau
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </nav>
            )}

            {selectedSession ? (
              <section aria-labelledby="attendance-session-detail-heading" className="space-y-3">
                <h2 id="attendance-session-detail-heading" className="text-lg font-semibold">
                  Bảng điểm danh · {selectedSession.title}
                </h2>
                <AttendanceSessionDetails
                  session={selectedSession}
                  status={filters.status}
                  query={filters.query}
                />
              </section>
            ) : filters.sessionId ? (
              <p role="status" className="text-sm text-muted-foreground">
                Buổi này không thuộc lớp đã chọn hoặc không còn tồn tại. Hãy chọn một buổi trong danh sách.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Chọn một buổi ở danh sách trên để xem thông tin điểm danh.
              </p>
            )}
          </>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          Lớp đã kết thúc vẫn xem và chỉnh sửa lịch sử được; không thể tạo buổi mới cho lớp đã kết thúc.
        </p>
      </div>
    </AppShell>
  );
}
