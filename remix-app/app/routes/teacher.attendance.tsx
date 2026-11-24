import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { createPortal } from "react-dom";
import type { Prisma } from "@prisma/client";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Info,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatSchedule, getVietnameseDateString } from "~/lib/schedule-utils";
import {
  getClassSessionOrderSnapshot,
  renumberClassAttendanceSessions,
} from "~/lib/attendance-session-order.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { toast } from "sonner";

type AttendanceStatus = "present" | "late" | "excused" | "unexcused" | "absent" | null;
type AttendanceFilter = "all" | "present" | "late" | "absent";
type HomeworkKey = "recording" | "hanzi" | "duet" | "link";
type AttendanceChoice = Exclude<AttendanceStatus, null>;

interface AttendanceStudent {
  id: string;
  initials: string;
  name: string;
}

interface AttendanceRecord {
  status: AttendanceStatus;
  homework: Record<HomeworkKey, boolean>;
}

interface AttendanceSession {
  id: string;
  number: number;
  date: string;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  name: string;
  courseLessonId: string | null;
  lesson: string;
  lessonDisplay: string;
  courseLessonTitle: string | null;
  recordingUrl: string | null;
  isNew: boolean;
  pendingDelete: boolean;
  records: Record<string, AttendanceRecord>;
}

interface AttendanceCourseLesson {
  id: string;
  title: string;
}

interface AttendanceClass {
  id: string;
  name: string;
  level: string;
  schedule: string;
  students: AttendanceStudent[];
  lessons: AttendanceCourseLesson[];
  sessions: AttendanceSession[];
}

interface AttendanceSessionValidationErrors {
  date?: string;
  recordingUrl?: string;
}

type AttendanceValidationErrors = Record<
  string,
  Record<string, AttendanceSessionValidationErrors>
>;

type EditableSessionField = "name" | "date" | "courseLessonId" | "recordingUrl";

interface EditingSessionField {
  sessionId: string;
  field: EditableSessionField;
}

const HOMEWORK_FIELDS: { key: HomeworkKey; label: string }[] = [
  { key: "recording", label: "Ghi âm" },
  { key: "hanzi", label: "Chữ Hán" },
  { key: "duet", label: "Duet" },
  { key: "link", label: "Bài link" },
];

const ATTENDANCE_OPTIONS: {
  value: AttendanceChoice;
  label: string;
  selectedClass: string;
}[] = [
  { value: "present", label: "Có mặt", selectedClass: "border-emerald-600 bg-emerald-600 text-white" },
  { value: "late", label: "Đi muộn", selectedClass: "border-amber-500 bg-amber-500 text-white" },
  { value: "excused", label: "Vắng (CP)", selectedClass: "border-sky-700 bg-sky-700 text-white" },
  { value: "unexcused", label: "Vắng (KP)", selectedClass: "border-rose-700 bg-rose-700 text-white" },
];

const FILTER_OPTIONS: { value: AttendanceFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "present", label: "Có mặt" },
  { value: "late", label: "Đi muộn" },
  { value: "absent", label: "Vắng mặt" },
];

const EMPTY_ATTENDANCE_RECORD: AttendanceRecord = {
  status: null,
  homework: { recording: false, hanzi: false, duet: false, link: false },
};

interface ScheduleSlot {
  days: number[];
  startTime: string;
  endTime: string;
}

function isScheduleSlot(value: unknown): value is ScheduleSlot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const slot = value as Record<string, unknown>;
  return Array.isArray(slot.days)
    && slot.days.length > 0
    && slot.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && typeof slot.startTime === "string"
    && typeof slot.endTime === "string";
}

function formatClassSchedule(value: unknown) {
  const slots = Array.isArray(value)
    ? value.filter(isScheduleSlot).map((slot) => ({ ...slot, days: [...slot.days] }))
    : [];
  return formatSchedule(slots);
}

function getStudentInitials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0] ?? "").join("").toUpperCase() || "HV";
}

function mapAttendanceStatus(status: string | null, absenceReason: string | null): AttendanceStatus {
  if (status === "PRESENT") return "present";
  if (status === "LATE") return "late";
  if (status !== "ABSENT") return null;
  if (absenceReason === "EXCUSED") return "excused";
  if (absenceReason === "UNEXCUSED") return "unexcused";
  return "absent";
}

function getRecordingUrlValidation(value: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { url: null, error: null };
  if (trimmed.length > 2048) {
    return { url: null, error: "Link ghi hình không được vượt quá 2.048 ký tự." };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { url: null, error: "Link ghi hình phải bắt đầu bằng http:// hoặc https://." };
    }
    return { url: url.toString(), error: null };
  } catch {
    return { url: null, error: "Link ghi hình không hợp lệ." };
  }
}

function getSafeRecordingUrl(value: string | null) {
  return getRecordingUrlValidation(value).url;
}

function getAttendanceCounts(
  students: AttendanceStudent[],
  records: Record<string, AttendanceRecord>,
) {
  const statuses = students.map((student) => records[student.id]?.status ?? null);
  const present = statuses.filter((status) => status === "present").length;
  const late = statuses.filter((status) => status === "late").length;
  const excused = statuses.filter((status) => status === "excused").length;
  const unexcused = statuses.filter((status) => status === "unexcused").length;
  const unspecifiedAbsence = statuses.filter((status) => status === "absent").length;

  return {
    total: students.length,
    present,
    late,
    excused,
    unexcused,
    unspecifiedAbsence,
    absent: excused + unexcused + unspecifiedAbsence,
    marked: present + late + excused + unexcused + unspecifiedAbsence,
  };
}

function formatSessionDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getCalendarMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1 - mondayOffset + index)),
  );
}

function VietnameseDatePicker({
  value,
  maxDate,
  label,
  disabled,
  onSelect,
  error,
  errorId,
}: {
  value: string;
  maxDate: string;
  label: string;
  disabled: boolean;
  onSelect: (date: string) => void;
  error?: string;
  errorId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    getCalendarMonth(value && value <= maxDate ? value : maxDate),
  );
  const [focusedDate, setFocusedDate] = useState(value && value <= maxDate ? value : maxDate);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(288, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const height = 360;
      const top = rect.bottom + height + 8 <= window.innerHeight - 8
        ? rect.bottom + 8
        : Math.max(8, rect.top - height - 8);
      setPosition({ left, top, width });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node
        && (triggerRef.current?.contains(target) || calendarRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
      setPosition(null);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && position) {
      calendarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusedDate}"]`)
        ?.focus();
    }
  }, [focusedDate, isOpen, position]);

  const calendarDays = getCalendarDays(visibleMonth);
  const monthLabel = new Intl.DateTimeFormat("vi-VN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(visibleMonth);
  const maximumMonth = getCalendarMonth(maxDate);
  const canGoForward = visibleMonth < maximumMonth
    && (visibleMonth.getUTCFullYear() !== maximumMonth.getUTCFullYear()
      || visibleMonth.getUTCMonth() !== maximumMonth.getUTCMonth());

  function closeCalendar() {
    setIsOpen(false);
    setPosition(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectDate(date: string) {
    if (date > maxDate) return;
    onSelect(date);
    closeCalendar();
  }

  function moveMonth(amount: number) {
    setVisibleMonth((current) =>
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + amount, 1)),
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onClick={() => {
          if (isOpen) {
            closeCalendar();
            return;
          }
          const initialDate = value && value <= maxDate ? value : maxDate;
          setVisibleMonth(getCalendarMonth(initialDate));
          setFocusedDate(initialDate);
          setIsOpen(true);
        }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70 ${
          error ? "border border-rose-600 text-rose-800" : "text-foreground"
        }`}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {value ? formatSessionDate(value) : <span className="text-muted-foreground">Chọn ngày</span>}
      </button>
      {error && (
        <p id={errorId} role="alert" className="max-w-[200px] whitespace-normal text-xs font-medium text-rose-700">
          {error}
        </p>
      )}
      {isOpen && position && createPortal(
        <div
          ref={calendarRef}
          role="dialog"
          aria-label="Chọn ngày học"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeCalendar();
          }}
          className="fixed z-[100] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Tháng trước"
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <p className="text-sm font-semibold capitalize" aria-live="polite">{monthLabel}</p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Tháng sau"
              disabled={!canGoForward}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => (
              <span key={day} className="py-1">{day}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const date = day.toISOString().slice(0, 10);
              const isSelected = date === value;
              const isToday = date === maxDate;
              const isInMonth = day.getUTCMonth() === visibleMonth.getUTCMonth();
              const isFuture = date > maxDate;
              return (
                <button
                  key={date}
                  type="button"
                  data-calendar-date={date}
                  tabIndex={date === focusedDate ? 0 : -1}
                  disabled={isFuture}
                  aria-label={new Intl.DateTimeFormat("vi-VN", {
                    dateStyle: "full",
                    timeZone: "UTC",
                  }).format(day)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onFocus={() => setFocusedDate(date)}
                  onKeyDown={(event) => {
                    const offset = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -7,
                      ArrowDown: 7,
                    }[event.key];
                    if (offset === undefined) return;
                    event.preventDefault();
                    const nextDay = new Date(`${date}T00:00:00.000Z`);
                    nextDay.setUTCDate(nextDay.getUTCDate() + offset);
                    const nextDate = nextDay.toISOString().slice(0, 10);
                    if (nextDate <= maxDate) {
                      setFocusedDate(nextDate);
                      setVisibleMonth(getCalendarMonth(nextDate));
                    }
                  }}
                  onClick={() => selectDate(date)}
                  className={`h-8 rounded-md text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isSelected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : isFuture
                        ? "cursor-not-allowed text-muted-foreground/40"
                        : isInMonth
                          ? "text-foreground hover:bg-accent"
                          : "text-muted-foreground hover:bg-accent"
                  } ${isToday && !isSelected ? "ring-1 ring-primary/40" : ""}`}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => selectDate(maxDate)}>
              Hôm nay
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id, completedAt: null },
    select: {
      id: true,
      name: true,
      schedule: true,
      course: {
        select: {
          hskLevel: true,
          lessons: {
            orderBy: { order: "asc" },
            select: { id: true, title: true },
          },
        },
      },
      enrollments: {
        where: { user: { is: { role: "student", isActive: true, deletedAt: null } } },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, name: true } } },
      },
      attendanceSessions: {
        orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          lesson: true,
          recordingUrl: true,
          date: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
          lessonId: true,
          courseLesson: { select: { id: true, title: true } },
          records: {
            select: {
              studentId: true,
              status: true,
              absenceReason: true,
              recording: true,
              hanzi: true,
              duet: true,
              lessonLink: true,
            },
          },
        },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });

  return {
    user,
    classes: classes.map((classroom): AttendanceClass => ({
      id: classroom.id,
      name: classroom.name,
      level: `HSK ${classroom.course.hskLevel}`,
      schedule: formatClassSchedule(classroom.schedule),
      lessons: classroom.course.lessons,
      students: classroom.enrollments.map(({ user: student }) => ({
        id: student.id,
        name: student.name,
        initials: getStudentInitials(student.name),
      })),
      sessions: classroom.attendanceSessions.map((session, index) => ({
        id: session.id,
        number: index + 1,
        date: session.date.toISOString().slice(0, 10),
        scheduleStartTime: session.scheduleStartTime,
        scheduleEndTime: session.scheduleEndTime,
        name: session.title || `Buổi ${index + 1}`,
        courseLessonId: session.lessonId,
        lesson: session.lesson,
        lessonDisplay: session.courseLesson?.title || session.lesson || "Chưa gắn bài học",
        courseLessonTitle: session.courseLesson?.title ?? null,
        recordingUrl: session.recordingUrl,
        isNew: false,
        pendingDelete: false,
        records: Object.fromEntries(session.records.map((record) => [
          record.studentId,
          {
            status: mapAttendanceStatus(record.status, record.absenceReason),
            homework: {
              recording: record.recording,
              hanzi: record.hanzi,
              duet: record.duet,
              link: record.lessonLink,
            },
          },
        ])),
      })),
    })),
  };
}

interface AttendanceSaveRecord {
  studentId: string;
  status: AttendanceStatus;
  homework: Record<HomeworkKey, boolean>;
}

interface AttendanceSaveSession {
  id: string;
  isNew: boolean;
  pendingDelete: boolean;
  title: string;
  date: string;
  courseLessonId: string | null;
  lesson: string;
  recordingUrl: string | null;
  records: AttendanceSaveRecord[];
}

interface AttendanceSaveClass {
  classId: string;
  sessions: AttendanceSaveSession[];
}

interface AttendanceSavePayload {
  classes: AttendanceSaveClass[];
}

const MAX_SAVE_CLASSES = 100;
const MAX_SAVE_SESSIONS = 500;
const MAX_SAVE_RECORDS = 10_000;

class AttendanceSaveError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === null
    || value === "present"
    || value === "late"
    || value === "excused"
    || value === "unexcused"
    || value === "absent";
}

function parseAttendanceSavePayload(value: unknown): AttendanceSavePayload | null {
  if (!isObject(value) || !Array.isArray(value.classes) || value.classes.length > MAX_SAVE_CLASSES) {
    return null;
  }

  const seenClassIds = new Set<string>();
  const classes: AttendanceSaveClass[] = [];
  let sessionCount = 0;
  let recordCount = 0;

  for (const rawClass of value.classes) {
    if (!isObject(rawClass) || typeof rawClass.classId !== "string" || !rawClass.classId
      || !Array.isArray(rawClass.sessions)) {
      return null;
    }
    if (seenClassIds.has(rawClass.classId)) return null;
    seenClassIds.add(rawClass.classId);

    const seenSessionIds = new Set<string>();
    const sessions: AttendanceSaveSession[] = [];
    for (const rawSession of rawClass.sessions) {
      sessionCount += 1;
      if (sessionCount > MAX_SAVE_SESSIONS
        || !isObject(rawSession)
        || typeof rawSession.id !== "string"
        || !rawSession.id
        || typeof rawSession.isNew !== "boolean"
        || typeof rawSession.pendingDelete !== "boolean"
        || typeof rawSession.title !== "string"
        || (!rawSession.pendingDelete && !rawSession.title.trim())
        || rawSession.title.length > 80
        || typeof rawSession.date !== "string"
        || !(rawSession.courseLessonId === null
          || (typeof rawSession.courseLessonId === "string" && rawSession.courseLessonId.length > 0))
        || typeof rawSession.lesson !== "string"
        || rawSession.lesson.length > 120
        || !(rawSession.recordingUrl === null || typeof rawSession.recordingUrl === "string")
        || !Array.isArray(rawSession.records)) {
        return null;
      }
      if (seenSessionIds.has(rawSession.id)) return null;
      seenSessionIds.add(rawSession.id);

      const seenStudentIds = new Set<string>();
      const records: AttendanceSaveRecord[] = [];
      for (const rawRecord of rawSession.records) {
        recordCount += 1;
        if (recordCount > MAX_SAVE_RECORDS || !isObject(rawRecord)) return null;
        const homework = rawRecord.homework;
        if (
          typeof rawRecord.studentId !== "string"
          || !rawRecord.studentId
          || !isAttendanceStatus(rawRecord.status)
          || !isObject(homework)
          || typeof homework.recording !== "boolean"
          || typeof homework.hanzi !== "boolean"
          || typeof homework.duet !== "boolean"
          || typeof homework.link !== "boolean"
        ) {
          return null;
        }
        if (seenStudentIds.has(rawRecord.studentId)) return null;
        seenStudentIds.add(rawRecord.studentId);
        records.push({
          studentId: rawRecord.studentId,
          status: rawRecord.status,
          homework: {
            recording: homework.recording,
            hanzi: homework.hanzi,
            duet: homework.duet,
            link: homework.link,
          },
        });
      }
      sessions.push({
        id: rawSession.id,
        isNew: rawSession.isNew,
        pendingDelete: rawSession.pendingDelete,
        title: rawSession.title.trim(),
        date: rawSession.date,
        courseLessonId: rawSession.courseLessonId,
        lesson: rawSession.lesson,
        recordingUrl: rawSession.recordingUrl,
        records,
      });
    }
    classes.push({ classId: rawClass.classId, sessions });
  }

  return { classes };
}

function parseAttendanceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function validateRecordingUrl(value: string | null) {
  const validation = getRecordingUrlValidation(value);
  if (validation.error) throw new AttendanceSaveError(validation.error);
  return validation.url;
}

async function ensureScheduleCancellation(
  tx: Prisma.TransactionClient,
  session: {
    classId: string;
    date: Date;
    scheduleStartTime: string | null;
    scheduleEndTime: string | null;
  },
) {
  const existingCancellation = await tx.classScheduleCancellation.findFirst({
    where: {
      classId: session.classId,
      date: session.date,
      OR: [
        { startTime: null, endTime: null },
        { startTime: session.scheduleStartTime, endTime: session.scheduleEndTime },
      ],
    },
    select: { id: true },
  });
  if (!existingCancellation) {
    await tx.classScheduleCancellation.create({
      data: {
        classId: session.classId,
        date: session.date,
        startTime: session.scheduleStartTime,
        endTime: session.scheduleEndTime,
      },
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") {
    return { success: false as const, error: "Không nhận được dữ liệu cần lưu." };
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    return { success: false as const, error: "Dữ liệu cần lưu không hợp lệ. Hãy tải lại trang." };
  }
  const payload = parseAttendanceSavePayload(parsedPayload);
  if (!payload) {
    return { success: false as const, error: "Dữ liệu cần lưu không hợp lệ. Hãy tải lại trang." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const classChange of payload.classes) {
        if (classChange.sessions.length === 0) continue;

        const classroom = await tx.class.findFirst({
          where: { id: classChange.classId, teacherId: user.id, completedAt: null },
          select: { id: true, courseId: true },
        });
        if (!classroom) {
          throw new AttendanceSaveError("Bạn không còn được phân công lớp này hoặc lớp đã kết thúc. Hãy tải lại trang.");
        }

        const requestedLessonIds = [...new Set(classChange.sessions.flatMap((session) =>
          !session.pendingDelete && session.courseLessonId ? [session.courseLessonId] : [],
        ))];
        const courseLessons = await tx.lesson.findMany({
          where: { courseId: classroom.courseId, id: { in: requestedLessonIds } },
          select: { id: true, title: true },
        });
        const courseLessonsById = new Map(courseLessons.map((lesson) => [lesson.id, lesson]));
        if (courseLessonsById.size !== requestedLessonIds.length) {
          throw new AttendanceSaveError("Bài học đã chọn không thuộc khóa học của lớp.");
        }

        const currentSessions = await tx.attendanceSession.findMany({
          where: { classId: classroom.id },
          select: {
            id: true,
            date: true,
            recordingUrl: true,
            scheduleStartTime: true,
            scheduleEndTime: true,
            isScheduleGenerated: true,
          },
        });
        const currentById = new Map(currentSessions.map((session) => [session.id, session]));
        const pendingDeleteIds = new Set(
          classChange.sessions.filter((session) => !session.isNew && session.pendingDelete).map(({ id }) => id),
        );
        const parsedDates = new Map<string, Date>();
        const today = getVietnameseDateString();
        let needsRenumber = false;

        for (const sessionChange of classChange.sessions) {
          if (sessionChange.isNew && sessionChange.pendingDelete) continue;
          if (sessionChange.pendingDelete) {
            if (!currentById.has(sessionChange.id)) {
              throw new AttendanceSaveError("Một buổi học đã thay đổi hoặc bị xóa ở nơi khác. Hãy tải lại trang.");
            }
            needsRenumber = true;
            continue;
          }
          const date = parseAttendanceDate(sessionChange.date);
          if (!date) throw new AttendanceSaveError("Ngày buổi học không hợp lệ.");

          if (sessionChange.isNew) {
            if (sessionChange.date > today) {
              throw new AttendanceSaveError("Ngày học không được chọn trong tương lai.");
            }
            parsedDates.set(sessionChange.id, date);
            validateRecordingUrl(sessionChange.recordingUrl);
            needsRenumber = true;
            continue;
          }

          const currentSession = currentById.get(sessionChange.id);
          if (!currentSession) {
            throw new AttendanceSaveError("Một buổi học đã thay đổi hoặc bị xóa ở nơi khác. Hãy tải lại trang.");
          }
          const currentDate = currentSession.date.toISOString().slice(0, 10);
          if (sessionChange.date > today && sessionChange.date !== currentDate) {
            throw new AttendanceSaveError("Ngày học không được chọn trong tương lai.");
          }
          parsedDates.set(sessionChange.id, date);
          if (sessionChange.recordingUrl !== currentSession.recordingUrl) {
            validateRecordingUrl(sessionChange.recordingUrl);
          }
          if (sessionChange.pendingDelete || currentSession.date.toISOString().slice(0, 10) !== sessionChange.date) {
            needsRenumber = true;
          }
        }

        const enrollments = await tx.enrollment.findMany({
          where: {
            classId: classroom.id,
            user: { is: { role: "student", isActive: true, deletedAt: null } },
          },
          select: { userId: true },
        });
        const activeStudentIds = new Set(enrollments.map(({ userId }) => userId));
        for (const sessionChange of classChange.sessions) {
          if (sessionChange.pendingDelete) continue;
          if (sessionChange.records.some(({ studentId }) => !activeStudentIds.has(studentId))) {
            throw new AttendanceSaveError("Danh sách học viên đã thay đổi. Hãy tải lại trang trước khi lưu.");
          }
        }

        const pendingDates = new Set<string>();
        for (const sessionChange of classChange.sessions) {
          if (sessionChange.pendingDelete) continue;
          const date = sessionChange.date;
          const currentSession = currentById.get(sessionChange.id);
          if (!sessionChange.isNew && !currentSession) continue;
          const hasManualSlot = sessionChange.isNew
            || (currentSession?.scheduleStartTime === null && currentSession.scheduleEndTime === null);
          if (!hasManualSlot) continue;
          const hasExistingDuplicate = currentSessions.some((session) =>
            session.id !== sessionChange.id
            && !pendingDeleteIds.has(session.id)
            && session.scheduleStartTime === null
            && session.scheduleEndTime === null
            && session.date.toISOString().slice(0, 10) === date,
          );
          if (hasExistingDuplicate || pendingDates.has(date)) {
            throw new AttendanceSaveError("Ngày này đã có buổi học. Hãy chọn ngày khác hoặc xóa buổi trùng trước khi lưu.");
          }
          pendingDates.add(date);
        }

        const previousOrder = needsRenumber
          ? await getClassSessionOrderSnapshot(tx, classroom.id)
          : null;
        for (const sessionChange of classChange.sessions) {
          if (sessionChange.isNew && sessionChange.pendingDelete) continue;
          const currentSession = sessionChange.isNew ? null : currentById.get(sessionChange.id);
          if (!sessionChange.isNew && !currentSession) {
            throw new AttendanceSaveError("Không tìm thấy buổi học cần lưu. Hãy tải lại trang.");
          }

          if (sessionChange.pendingDelete) {
            if (!currentSession || !previousOrder) {
              throw new AttendanceSaveError("Không tìm thấy buổi học cần xóa. Hãy tải lại trang.");
            }
            const sessionNumber = previousOrder.sessions.findIndex(({ id }) => id === currentSession.id) + 1;
            if (sessionNumber === 0) {
              throw new AttendanceSaveError("Không xác định được số buổi. Hãy tải lại trang.");
            }
            const savedReview = await tx.studentClassReview.findFirst({
              where: { classId: classroom.id, sessionNumber },
              select: { id: true },
            });
            if (
              savedReview
              || previousOrder.midtermReviewSession === sessionNumber
              || previousOrder.finalReviewSession === sessionNumber
            ) {
              throw new AttendanceSaveError("Không thể xóa buổi đã có đánh giá hoặc đang được đặt làm mốc đánh giá.");
            }
            if (currentSession.isScheduleGenerated) {
              const scheduledSession = currentSessions.find(({ id }) => id === currentSession.id);
              if (scheduledSession) {
                await ensureScheduleCancellation(tx, {
                  classId: classroom.id,
                  date: currentSession.date,
                  scheduleStartTime: currentSession.scheduleStartTime,
                  scheduleEndTime: currentSession.scheduleEndTime,
                });
              }
            }
            await tx.attendanceSession.delete({ where: { id: currentSession.id } });
            continue;
          }

          const date = parsedDates.get(sessionChange.id);
          if (!date) throw new AttendanceSaveError("Ngày buổi học không hợp lệ.");
          const recordingUrl = sessionChange.isNew || sessionChange.recordingUrl !== currentSession?.recordingUrl
            ? validateRecordingUrl(sessionChange.recordingUrl)
            : undefined;
          const courseLesson = sessionChange.courseLessonId
            ? courseLessonsById.get(sessionChange.courseLessonId)
            : null;
          if (sessionChange.courseLessonId && !courseLesson) {
            throw new AttendanceSaveError("Bài học đã chọn không thuộc khóa học của lớp.");
          }
          const lessonTitle = courseLesson?.title ?? sessionChange.lesson;
          let sessionId = sessionChange.id;
          if (sessionChange.isNew) {
            const created = await tx.attendanceSession.create({
              data: {
                classId: classroom.id,
                title: sessionChange.title,
                lessonId: sessionChange.courseLessonId,
                lesson: lessonTitle,
                recordingUrl,
                date,
              },
              select: { id: true },
            });
            sessionId = created.id;
            if (activeStudentIds.size > 0) {
              await tx.attendanceRecord.createMany({
                data: [...activeStudentIds].map((studentId) => ({
                  sessionId,
                  studentId,
                  status: null,
                })),
              });
            }
          } else if (currentSession) {
            const dateChanged = currentSession.date.toISOString().slice(0, 10) !== sessionChange.date;
            if (currentSession.isScheduleGenerated && dateChanged) {
              await ensureScheduleCancellation(tx, {
                classId: classroom.id,
                date: currentSession.date,
                scheduleStartTime: currentSession.scheduleStartTime,
                scheduleEndTime: currentSession.scheduleEndTime,
              });
            }
            await tx.attendanceSession.update({
              where: { id: currentSession.id },
              data: {
                date,
                title: sessionChange.title,
                lessonId: sessionChange.courseLessonId,
                lesson: lessonTitle,
                recordingUrl,
                isScheduleGenerated: currentSession.isScheduleGenerated && dateChanged ? false : undefined,
              },
            });
          }

          for (const record of sessionChange.records) {
            const status = record.status === "present"
              ? "PRESENT"
              : record.status === "late"
                ? "LATE"
                : record.status === null
                  ? null
                  : "ABSENT";
            const absenceReason = record.status === "excused"
              ? "EXCUSED"
              : record.status === "unexcused"
                ? "UNEXCUSED"
                : null;
            await tx.attendanceRecord.upsert({
              where: { sessionId_studentId: { sessionId, studentId: record.studentId } },
              create: {
                sessionId,
                studentId: record.studentId,
                status,
                absenceReason,
                recording: record.homework.recording,
                hanzi: record.homework.hanzi,
                duet: record.homework.duet,
                lessonLink: record.homework.link,
              },
              update: {
                status,
                absenceReason,
                recording: record.homework.recording,
                hanzi: record.homework.hanzi,
                duet: record.homework.duet,
                lessonLink: record.homework.link,
              },
            });
          }
        }
        if (previousOrder) {
          await renumberClassAttendanceSessions(tx, classroom.id, previousOrder);
        }
      }
    }, { maxWait: 5_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof AttendanceSaveError) {
      return { success: false as const, error: error.message };
    }
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return { success: false as const, error: "Lớp đã có buổi học trong ngày hoặc khung giờ này. Hãy tải lại rồi thử lại." };
    }
    throw error;
  }

  return { success: true as const };
}

function buildAttendanceSavePayload(
  originalClasses: AttendanceClass[],
  draftClasses: AttendanceClass[],
): AttendanceSavePayload {
  const classes: AttendanceSaveClass[] = [];

  for (const draftClass of draftClasses) {
    const originalClass = originalClasses.find(({ id }) => id === draftClass.id);
    if (!originalClass) continue;

    const sessions: AttendanceSaveSession[] = [];
    for (const draftSession of draftClass.sessions) {
      if (draftSession.isNew && draftSession.pendingDelete) continue;
      const originalSession = originalClass.sessions.find(({ id }) => id === draftSession.id);
      const changedRecords = draftClass.students.flatMap((student) => {
        const draftRecord = draftSession.records[student.id] ?? EMPTY_ATTENDANCE_RECORD;
        const originalRecord = originalSession?.records[student.id] ?? EMPTY_ATTENDANCE_RECORD;
        const changed = draftRecord.status !== originalRecord.status
          || HOMEWORK_FIELDS.some(({ key }) => draftRecord.homework[key] !== originalRecord.homework[key]);
        if (!draftSession.isNew && !changed) return [];
        return [{
          studentId: student.id,
          status: draftRecord.status,
          homework: { ...draftRecord.homework },
        }];
      });
      const sessionChanged = draftSession.isNew
        || draftSession.pendingDelete
        || !originalSession
        || draftSession.name !== originalSession.name
        || draftSession.date !== originalSession.date
        || draftSession.courseLessonId !== originalSession.courseLessonId
        || draftSession.lesson !== originalSession.lesson
        || draftSession.recordingUrl !== originalSession.recordingUrl
        || changedRecords.length > 0;
      if (!sessionChanged) continue;

      sessions.push({
        id: draftSession.id,
        isNew: draftSession.isNew,
        pendingDelete: draftSession.pendingDelete,
        title: draftSession.name,
        date: draftSession.date,
        courseLessonId: draftSession.courseLessonId,
        lesson: draftSession.lesson,
        recordingUrl: draftSession.recordingUrl,
        records: draftSession.pendingDelete ? [] : changedRecords,
      });
    }

    if (sessions.length > 0) classes.push({ classId: draftClass.id, sessions });
  }
  return { classes };
}

function getAttendanceValidationErrors(
  originalClasses: AttendanceClass[],
  draftClasses: AttendanceClass[],
): AttendanceValidationErrors {
  const errors: AttendanceValidationErrors = {};

  for (const draftClass of draftClasses) {
    const originalClass = originalClasses.find(({ id }) => id === draftClass.id);
    for (const session of draftClass.sessions) {
      if (session.pendingDelete) continue;

      const originalSession = originalClass?.sessions.find(({ id }) => id === session.id);
      const sessionErrors: AttendanceSessionValidationErrors = {};
      const isManualSession = session.scheduleStartTime === null && session.scheduleEndTime === null;
      const dateChanged = session.isNew || !originalSession || session.date !== originalSession.date;

      if (
        session.date
        && dateChanged
        && isManualSession
        && draftClass.sessions.some((otherSession) =>
          otherSession.id !== session.id
          && !otherSession.pendingDelete
          && otherSession.scheduleStartTime === null
          && otherSession.scheduleEndTime === null
          && otherSession.date === session.date,
        )
      ) {
        sessionErrors.date = "Ngày này đã có buổi học khác. Hãy chọn ngày khác hoặc xóa buổi trùng.";
      }

      if (
        session.isNew
        || !originalSession
        || session.recordingUrl !== originalSession.recordingUrl
      ) {
        sessionErrors.recordingUrl = getRecordingUrlValidation(session.recordingUrl).error ?? undefined;
      }

      if (sessionErrors.date || sessionErrors.recordingUrl) {
        const classErrors = errors[draftClass.id] ?? {};
        classErrors[session.id] = sessionErrors;
        errors[draftClass.id] = classErrors;
      }
    }
  }

  return errors;
}

export default function TeacherAttendance() {
  const { user, classes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { revalidate } = useRevalidator();
  const [draftClasses, setDraftClasses] = useState(classes);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState<AttendanceFilter>("all");
  const [studentSearch, setStudentSearch] = useState("");
  const [editingSessionField, setEditingSessionField] = useState<EditingSessionField | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const modalTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setDraftClasses(classes);
  }, [classes]);

  const selectedClass = draftClasses.find((classItem) => classItem.id === selectedClassId) ?? draftClasses[0];
  const todayDate = getVietnameseDateString();
  const activeSession = selectedClass?.sessions.find((session) => session.id === activeSessionId);
  const savePayload = useMemo(
    () => buildAttendanceSavePayload(classes, draftClasses),
    [classes, draftClasses],
  );
  const attendanceValidationErrors = useMemo(
    () => getAttendanceValidationErrors(classes, draftClasses),
    [classes, draftClasses],
  );
  const hasValidationErrors = Object.values(attendanceValidationErrors).some((classErrors) =>
    Object.values(classErrors).some((sessionErrors) =>
      Boolean(sessionErrors.date || sessionErrors.recordingUrl),
    ),
  );
  const hasUnsavedChanges = savePayload.classes.length > 0;
  const hasIncompleteNewSession = draftClasses.some((classItem) =>
    classItem.sessions.some((session) =>
      session.isNew && !session.pendingDelete && (!session.name.trim() || !session.date),
    ),
  );
  const saveError = fetcher.data && !fetcher.data.success ? fetcher.data.error : null;
  const saveSuccess = fetcher.data?.success === true && fetcher.state === "idle" && !hasUnsavedChanges;

  // Revalidate loader ngay khi action trả về success — không phụ thuộc vào
  // hasUnsavedChanges vì draftClasses chưa được reset lúc này.
  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    if (prevFetcherState.current !== "idle" && fetcher.state === "idle" && fetcher.data?.success === true) {
      revalidate();
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (!saveSuccess) {
      setShowSaveSuccess(false);
      return;
    }

    setShowSaveSuccess(true);
    const timeoutId = window.setTimeout(() => setShowSaveSuccess(false), 3_000);
    return () => window.clearTimeout(timeoutId);
  }, [fetcher.data, saveSuccess]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLocaleLowerCase("vi");
    const newestFirst = [...(selectedClass?.sessions ?? [])].sort((a, b) => b.number - a.number);
    if (!query) return newestFirst;
    return newestFirst.filter((session) =>
      [
        session.name,
        session.lesson,
        `buổi ${session.number}`,
        session.date,
        ...(session.date ? [formatSessionDate(session.date)] : []),
      ]
        .some((value) => value.toLocaleLowerCase("vi").includes(query)),
    );
  }, [selectedClass, sessionSearch]);

  const modalCounts = activeSession && selectedClass
    ? getAttendanceCounts(selectedClass.students, activeSession.records)
    : null;

  const filteredStudents = activeSession && selectedClass
    ? selectedClass.students.filter((student) => {
      const status = activeSession.records[student.id]?.status ?? null;
      const query = studentSearch.trim().toLocaleLowerCase("vi");
      if (query && !student.name.toLocaleLowerCase("vi").includes(query)) return false;
      if (modalFilter === "present") return status === "present";
      if (modalFilter === "late") return status === "late";
      if (modalFilter === "absent") return status === "excused" || status === "unexcused" || status === "absent";
      return true;
    })
    : [];

  const closeAttendanceModal = useCallback(() => {
    setActiveSessionId(null);
    requestAnimationFrame(() => modalTriggerRef.current?.focus());
  }, []);

  function openAttendanceModal(session: AttendanceSession, trigger: HTMLButtonElement) {
    if (session.pendingDelete) return;
    const originalSession = selectedClass
      ? classes.find((classItem) => classItem.id === selectedClass.id)
        ?.sessions.find((savedSession) => savedSession.id === session.id)
      : undefined;
    const hasUnsavedSessionChanges = session.isNew
      || !originalSession
      || session.name !== originalSession.name
      || session.date !== originalSession.date
      || session.courseLessonId !== originalSession.courseLessonId
      || session.lesson !== originalSession.lesson
      || session.recordingUrl !== originalSession.recordingUrl;
    if (hasUnsavedSessionChanges) {
      toast.info("Vui lòng bấm “Lưu toàn bộ bảng” trước khi điểm danh buổi học này.");
      return;
    }

    modalTriggerRef.current = trigger;
    if (
      selectedClass
      && selectedClass.students.length > 0
      && selectedClass.students.every((student) => session.records[student.id]?.status == null)
    ) {
      updateDraftSession(selectedClass.id, session.id, (currentSession) => {
        const records = { ...currentSession.records };
        for (const student of selectedClass.students) {
          records[student.id] = {
            ...(records[student.id] ?? EMPTY_ATTENDANCE_RECORD),
            status: "present",
          };
        }
        return { ...currentSession, records };
      });
    }
    setActiveSessionId(session.id);
    setModalFilter("all");
    setStudentSearch("");
  }

  function updateDraftSession(
    classId: string,
    sessionId: string,
    update: (session: AttendanceSession) => AttendanceSession,
  ) {
    setDraftClasses((current) => current.map((classItem) => (
      classItem.id !== classId
        ? classItem
        : {
            ...classItem,
            sessions: classItem.sessions.map((session) => (
              session.id === sessionId ? update(session) : session
            )),
          }
    )));
  }

  function updateStudentStatus(studentId: string, status: AttendanceChoice) {
    if (!activeSession || !selectedClass) return;
    updateDraftSession(selectedClass.id, activeSession.id, (session) => {
      const current = session.records[studentId] ?? EMPTY_ATTENDANCE_RECORD;
      return {
        ...session,
        records: {
          ...session.records,
          [studentId]: {
            ...current,
            status: current.status === status ? null : status,
          },
        },
      };
    });
  }

  function updateStudentHomework(studentId: string, field: HomeworkKey, checked: boolean) {
    if (!activeSession || !selectedClass) return;
    updateDraftSession(selectedClass.id, activeSession.id, (session) => {
      const current = session.records[studentId] ?? EMPTY_ATTENDANCE_RECORD;
      return {
        ...session,
        records: {
          ...session.records,
          [studentId]: {
            ...current,
            homework: { ...current.homework, [field]: checked },
          },
        },
      };
    });
  }

  function updateAllHomework(field: HomeworkKey, checked: boolean) {
    if (!activeSession || !selectedClass) return;
    updateDraftSession(selectedClass.id, activeSession.id, (session) => ({
      ...session,
      records: Object.fromEntries(selectedClass.students.map((student) => {
        const current = session.records[student.id] ?? EMPTY_ATTENDANCE_RECORD;
        return [
          student.id,
          { ...current, homework: { ...current.homework, [field]: checked } },
        ];
      })),
    }));
  }

  function queueSessionDelete(session: AttendanceSession) {
    if (!selectedClass) return;
    if (session.isNew) {
      setDraftClasses((current) => current.map((classItem) => (
        classItem.id === selectedClass.id
          ? { ...classItem, sessions: classItem.sessions.filter(({ id }) => id !== session.id) }
          : classItem
      )));
    } else {
      updateDraftSession(selectedClass.id, session.id, (current) => ({ ...current, pendingDelete: true }));
    }
    if (activeSessionId === session.id) closeAttendanceModal();
  }

  function restoreSession(session: AttendanceSession) {
    if (!selectedClass) return;
    updateDraftSession(selectedClass.id, session.id, (current) => ({ ...current, pendingDelete: false }));
  }

  function updateSessionField(
    session: AttendanceSession,
    field: EditableSessionField,
    value: string,
  ) {
    if (!selectedClass || session.pendingDelete || fetcher.state !== "idle") return;
    if (field === "date" && ((!value && !session.isNew) || value > todayDate)) return;
    const courseLesson = field === "courseLessonId"
      ? selectedClass.lessons.find(({ id }) => id === value)
      : undefined;
    if (field === "courseLessonId" && value && !courseLesson) return;

    updateDraftSession(selectedClass.id, session.id, (current) => {
      switch (field) {
        case "name":
          return { ...current, name: value };
        case "date":
          return { ...current, date: value };
        case "courseLessonId":
          return {
            ...current,
            courseLessonId: courseLesson?.id ?? null,
            courseLessonTitle: courseLesson?.title ?? null,
            lesson: courseLesson?.title ?? "",
            lessonDisplay: courseLesson?.title ?? "Chưa gắn bài học",
          };
        case "recordingUrl":
          return { ...current, recordingUrl: value || null };
      }
    });
  }

  function addDraftSession() {
    if (!selectedClass) return;
    const id = `draft-${crypto.randomUUID()}`;
    const records = Object.fromEntries(selectedClass.students.map((student) => [
      student.id,
      { status: null, homework: { ...EMPTY_ATTENDANCE_RECORD.homework } },
    ]));
    setDraftClasses((current) => current.map((classItem) => {
      if (classItem.id !== selectedClass.id) return classItem;
      const nextNumber = classItem.sessions.reduce(
        (maximum, session) => Math.max(maximum, session.number),
        0,
      ) + 1;
      return {
        ...classItem,
        sessions: [
          ...classItem.sessions,
          {
            id,
            number: nextNumber,
            date: "",
            scheduleStartTime: null,
            scheduleEndTime: null,
            name: "",
            courseLessonId: null,
            lesson: "",
            lessonDisplay: "",
            courseLessonTitle: null,
            recordingUrl: null,
            isNew: true,
            pendingDelete: false,
            records,
          },
        ],
      };
    }));
  }

  function saveAllChanges() {
    if (!hasUnsavedChanges || hasIncompleteNewSession || hasValidationErrors || fetcher.state !== "idle") return;
    fetcher.submit({ payload: JSON.stringify(savePayload) }, { method: "post" });
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-[1320px] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span>Lớp học</span>
            <span aria-hidden="true">/</span>
            <span className="truncate font-semibold text-foreground">Điểm danh theo lớp</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            hasUnsavedChanges
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}>
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            {hasUnsavedChanges ? "Có thay đổi chưa lưu" : "Dữ liệu thật"}
          </span>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight">Điểm danh</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Xem các buổi học trong lớp và mở bảng điểm danh chi tiết cho từng buổi.
            </p>
          </div>
        </header>

        <section aria-label="Chọn lớp học" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-6">
              <label htmlFor="attendance-class" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Chọn lớp học cần quản lý điểm danh
              </label>
              <select
                id="attendance-class"
                value={selectedClass?.id ?? ""}
                disabled={classes.length === 0}
                onChange={(event) => {
                  setSelectedClassId(event.target.value);
                  setSessionSearch("");
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {classes.length === 0 && <option value="">Chưa có lớp được phân công</option>}
                {classes.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name} · {classItem.level}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label htmlFor="attendance-session-search" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Tìm trong danh sách buổi
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="attendance-session-search"
                  value={sessionSearch}
                  onChange={(event) => setSessionSearch(event.target.value)}
                  placeholder="Tên buổi, bài học..."
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm md:col-span-3">
              <span className="text-muted-foreground">Sĩ số hiện tại</span>
              <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                {selectedClass?.students.length ?? 0} học viên
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            {selectedClass ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Trình độ: <strong className="font-semibold text-foreground">{selectedClass.level}</strong></span>
                <span className="hidden text-border sm:inline" aria-hidden="true">•</span>
                <span>Lịch học: <strong className="font-semibold text-foreground">{selectedClass.schedule}</strong></span>
              </div>
            ) : (
              <span>Giáo viên chưa được phân công lớp học.</span>
            )}
            <span>
              Tổng số buổi: <strong className="font-semibold text-foreground">
                {selectedClass?.sessions.filter(({ pendingDelete }) => !pendingDelete).length ?? 0}
              </strong>
            </span>
          </div>
        </section>

        <section aria-label="Danh sách buổi học" className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2.5">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-bold">Danh sách buổi học</h2>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {filteredSessions.length} buổi
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={!selectedClass || fetcher.state !== "idle"}
                onClick={addDraftSession}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Thêm buổi mới
              </Button>
              <Button
                type="button"
                disabled={!hasUnsavedChanges || hasIncompleteNewSession || hasValidationErrors || fetcher.state !== "idle"}
                onClick={saveAllChanges}
                title={
                  hasValidationErrors
                    ? "Hãy sửa các trường đang báo lỗi trước khi lưu."
                    : !hasUnsavedChanges
                      ? "Chưa có thay đổi cần lưu"
                      : undefined
                }
              >
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {fetcher.state !== "idle" ? "Đang lưu..." : "Lưu toàn bộ bảng"}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto" tabIndex={0} aria-label="Bảng buổi học, có thể cuộn ngang">
            <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="w-24 py-3 pl-5 pr-2">Buổi số</th>
                  <th scope="col" className="min-w-[220px] px-3 py-3">Tên buổi</th>
                  <th scope="col" className="min-w-[140px] px-3 py-3">Ngày học</th>
                  <th scope="col" className="min-w-[220px] px-3 py-3">Bài học</th>
                  <th scope="col" className="min-w-[180px] px-3 py-3">Link ghi hình</th>
                  <th scope="col" className="min-w-[165px] px-3 py-3">Điểm danh</th>
                  <th scope="col" className="w-36 py-3 pl-3 pr-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {selectedClass && filteredSessions.map((session) => {
                  const counts = getAttendanceCounts(selectedClass.students, session.records);
                  const recordingUrl = getSafeRecordingUrl(session.recordingUrl);
                  const sessionValidationError = attendanceValidationErrors[selectedClass.id]?.[session.id];
                  const dateErrorId = `attendance-date-error-${session.id}`;
                  const recordingUrlErrorId = `attendance-recording-url-error-${session.id}`;
                  const courseLessonIndex = selectedClass.lessons.findIndex(({ id }) => id === session.courseLessonId);
                  const courseLesson = courseLessonIndex >= 0
                    ? selectedClass.lessons[courseLessonIndex]
                    : undefined;
                  const lessonLabel = courseLesson
                    ? `Bài ${courseLessonIndex + 1}: ${courseLesson.title}`
                    : session.lessonDisplay;
                  const legacyLessonValue = `legacy:${session.id}`;
                  const lessonSelectValue = courseLesson?.id ?? (session.lesson ? legacyLessonValue : "");
                  const editingField = editingSessionField?.sessionId === session.id
                    ? editingSessionField.field
                    : null;
                  return (
                    <tr key={session.id} className={`transition-colors hover:bg-muted/30 ${session.pendingDelete ? "bg-rose-50/70 opacity-75" : ""}`}>
                      <td className="py-3 pl-5 pr-2">
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5">
                          <span className="text-xs text-muted-foreground">Buổi</span>
                          <span className="text-sm font-bold tabular-nums">{session.number}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {editingField === "name" ? (
                            <Input
                              autoFocus
                              value={session.name}
                              onChange={(event) => updateSessionField(session, "name", event.target.value)}
                              onBlur={() => setEditingSessionField(null)}
                              maxLength={80}
                              disabled={session.pendingDelete || fetcher.state !== "idle"}
                              aria-label={`Tên buổi ${session.number}`}
                              className="h-8 min-w-[160px]"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingSessionField({ sessionId: session.id, field: "name" })}
                              disabled={session.pendingDelete || fetcher.state !== "idle"}
                              aria-label={`Sửa tên buổi ${session.number}`}
                              title="Bấm để sửa tên buổi"
                              className={`rounded-sm text-left font-medium leading-snug hover:text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70 ${session.pendingDelete ? "line-through" : ""}`}
                            >
                              {session.name || <span className="font-normal text-muted-foreground">Nhập tên buổi</span>}
                            </button>
                          )}
                          {session.pendingDelete && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                              Chờ xóa · lưu để xóa
                            </span>
                          )}
                          {session.isNew && (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                              Mới · chưa lưu
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        <VietnameseDatePicker
                          value={session.date}
                          maxDate={todayDate}
                          label={`Chọn ngày học buổi ${session.number}`}
                          disabled={session.pendingDelete || fetcher.state !== "idle"}
                          onSelect={(date) => updateSessionField(session, "date", date)}
                          error={sessionValidationError?.date}
                          errorId={dateErrorId}
                        />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {editingField === "courseLessonId" ? (
                          <Select
                            value={lessonSelectValue}
                            onValueChange={(value) => {
                              if (value.startsWith("legacy:")) return;
                              updateSessionField(
                                session,
                                "courseLessonId",
                                value === "__none__" ? "" : value,
                              );
                              setEditingSessionField(null);
                            }}
                            onOpenChange={(open) => {
                              if (!open) setEditingSessionField(null);
                            }}
                            disabled={session.pendingDelete || fetcher.state !== "idle"}
                          >
                            <SelectTrigger
                              autoFocus
                              aria-label={`Bài học buổi ${session.number}`}
                              className="h-8 min-w-[180px] px-2 py-1 text-xs"
                            >
                              <SelectValue placeholder="Chọn bài học" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72 w-[min(20rem,calc(100vw-2rem))]">
                              <SelectItem value="__none__">Bỏ chọn bài học</SelectItem>
                              {!courseLesson && session.lesson && (
                                <SelectItem value={legacyLessonValue} disabled>
                                {session.lessonDisplay} (bài học hiện tại)
                                </SelectItem>
                              )}
                              {selectedClass.lessons.map((lesson, index) => (
                                <SelectItem key={lesson.id} value={lesson.id}>
                                  Bài {index + 1}: {lesson.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingSessionField({ sessionId: session.id, field: "courseLessonId" })}
                            disabled={session.pendingDelete || fetcher.state !== "idle"}
                            aria-label={`Sửa bài học buổi ${session.number}`}
                            title="Bấm để sửa bài học"
                            className="rounded-sm text-left hover:text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70"
                          >
                            {lessonLabel || <span>Thêm bài học</span>}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-col items-start gap-1">
                          {editingField === "recordingUrl" ? (
                            <Input
                              autoFocus
                              type="url"
                              value={session.recordingUrl ?? ""}
                              onChange={(event) => updateSessionField(session, "recordingUrl", event.target.value)}
                              onBlur={() => setEditingSessionField(null)}
                              maxLength={2048}
                              placeholder="https://..."
                              disabled={session.pendingDelete || fetcher.state !== "idle"}
                              aria-label={`Link ghi hình buổi ${session.number}`}
                              aria-invalid={Boolean(sessionValidationError?.recordingUrl)}
                              aria-describedby={sessionValidationError?.recordingUrl ? recordingUrlErrorId : undefined}
                              className={`h-8 min-w-[160px] ${
                                sessionValidationError?.recordingUrl
                                  ? "border-rose-600 focus-visible:ring-rose-600"
                                  : ""
                              }`}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingSessionField({ sessionId: session.id, field: "recordingUrl" })}
                                disabled={session.pendingDelete || fetcher.state !== "idle"}
                                aria-label={`Sửa link ghi hình buổi ${session.number}`}
                                aria-invalid={Boolean(sessionValidationError?.recordingUrl)}
                                aria-describedby={sessionValidationError?.recordingUrl ? recordingUrlErrorId : undefined}
                                title="Bấm để sửa link ghi hình"
                                className={`max-w-[200px] truncate rounded-sm text-left text-xs font-medium hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70 ${
                                  sessionValidationError?.recordingUrl
                                    ? "border border-rose-600 bg-rose-50 px-2 py-1 text-rose-800"
                                    : session.recordingUrl && !recordingUrl
                                      ? "text-rose-700"
                                      : session.recordingUrl
                                        ? "text-primary"
                                        : "text-muted-foreground"
                                }`}
                              >
                                {session.recordingUrl || "Thêm link ghi hình"}
                              </button>
                              {recordingUrl && (
                                <a
                                  href={recordingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Mở link ghi hình buổi ${session.number}`}
                                  title="Mở link ghi hình"
                                  className="shrink-0 rounded-sm text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          )}
                          {sessionValidationError?.recordingUrl && (
                            <p id={recordingUrlErrorId} role="alert" className="max-w-[220px] whitespace-normal text-xs font-medium text-rose-700">
                              {sessionValidationError.recordingUrl}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {counts.marked === 0 ? (
                          <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            Chưa điểm danh
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                              Có mặt: {counts.present + counts.late}
                            </span>
                            <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                              Vắng: {counts.absent}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 pl-3 pr-5">
                        <div className="flex flex-nowrap justify-end gap-1">
                          {session.pendingDelete ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => restoreSession(session)}
                              disabled={fetcher.state !== "idle"}
                              className="h-8 w-8 text-rose-800"
                              aria-label={`Hoàn tác xóa buổi ${session.number}`}
                              title={`Hoàn tác xóa buổi ${session.number}`}
                            >
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="icon"
                                onClick={(event) => openAttendanceModal(session, event.currentTarget)}
                                disabled={fetcher.state !== "idle"}
                                className="h-8 w-8"
                                aria-label={`Mở bảng điểm danh buổi ${session.number}`}
                                title={`Điểm danh buổi ${session.number}`}
                              >
                                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => queueSessionDelete(session)}
                                disabled={fetcher.state !== "idle"}
                                className="h-8 w-8 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                aria-label={`Xóa buổi ${session.number}`}
                                title={`Xóa buổi ${session.number}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <p className="font-medium">
                        {!selectedClass
                          ? "Giáo viên chưa được phân công lớp học."
                          : sessionSearch
                            ? "Không tìm thấy buổi học phù hợp."
                            : "Lớp học chưa có buổi nào."}
                      </p>
                      {selectedClass && sessionSearch && (
                        <p className="mt-1 text-sm text-muted-foreground">Thử đổi từ khóa tìm kiếm.</p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="max-w-3xl text-xs text-muted-foreground">
              Chỉnh sửa và xóa chỉ nằm trên giao diện cho đến khi bạn chọn <strong>Lưu toàn bộ bảng</strong>.
              Buổi đang chờ xóa có thể hoàn tác trước khi lưu.
            </p>
          </div>
          {saveError && (
            <div role="alert" className="border-t border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">
              {saveError}
            </div>
          )}
          {showSaveSuccess && (
            <div role="status" className="border-t border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
              Đã lưu toàn bộ thay đổi.
            </div>
          )}
        </section>
      </div>

      {activeSession && selectedClass && modalCounts && (
        <Overlay
          onClose={closeAttendanceModal}
          closeOnEscape
          closeOnBackdrop
          className="max-w-[1040px] !max-h-[92vh] !overflow-hidden !p-0"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-title"
            className="flex max-h-[92vh] flex-col overflow-hidden"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                    Buổi {activeSession.number}
                  </span>
                  <span className="truncate text-xs font-medium text-muted-foreground">{selectedClass.name}</span>
                </div>
                <h2 id="attendance-title" className="mt-1 text-lg font-bold">
                  Điểm danh & kiểm tra bài tập
                </h2>
              </div>
              <button
                type="button"
                onClick={closeAttendanceModal}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Đóng bảng điểm danh"
                autoFocus
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="shrink-0 space-y-4 border-b px-4 py-4 sm:px-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">Danh sách học viên</h3>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    Đã điểm danh {modalCounts.marked}/{modalCounts.total}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatPill label="Sĩ số" value={modalCounts.total} />
                  <StatPill label="Có mặt" value={modalCounts.present} tone="emerald" />
                  <StatPill label="Đi muộn" value={modalCounts.late} tone="amber" />
                  <StatPill label="Vắng (CP)" value={modalCounts.excused} tone="sky" />
                  <StatPill label="Vắng (KP)" value={modalCounts.unexcused} tone="rose" />
                  {modalCounts.unspecifiedAbsence > 0 && (
                    <StatPill label="Vắng (chưa rõ lý do)" value={modalCounts.unspecifiedAbsence} tone="rose" />
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-1.5" aria-label="Lọc học viên theo trạng thái">
                  {FILTER_OPTIONS.map((option) => {
                    const count = option.value === "all"
                      ? modalCounts.total
                      : option.value === "present"
                        ? modalCounts.present
                        : option.value === "late"
                          ? modalCounts.late
                          : modalCounts.absent;
                    const active = modalFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setModalFilter(option.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        }`}
                      >
                        {option.label} <span className="ml-0.5 tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative sm:w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={studentSearch}
                      onChange={(event) => setStudentSearch(event.target.value)}
                      placeholder="Tìm tên học viên..."
                      aria-label="Tìm tên học viên"
                      className="h-9 pl-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 border-b bg-muted/95 text-[11px] font-semibold text-muted-foreground backdrop-blur">
                  <tr>
                    <th scope="col" className="w-14 py-3 pl-5 pr-2 text-center">STT</th>
                    <th scope="col" className="min-w-[200px] px-3 py-3">Học viên</th>
                    <th scope="col" className="min-w-[330px] px-3 py-3">Trạng thái điểm danh</th>
                    {HOMEWORK_FIELDS.map((field) => (
                      <th key={field.key} scope="col" className="w-24 px-2 py-3 text-center">
                        <div className="inline-flex flex-col items-center gap-1.5">
                          <span>{field.label}</span>
                          <input
                            type="checkbox"
                            checked={selectedClass.students.length > 0 && selectedClass.students.every((student) => activeSession.records[student.id]?.homework[field.key])}
                            disabled={fetcher.state !== "idle"}
                            onChange={(event) => updateAllHomework(field.key, event.target.checked)}
                            aria-label={`Trạng thái bài ${field.label} của cả lớp`}
                            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filteredStudents.map((student, index) => {
                    const record = activeSession.records[student.id] ?? EMPTY_ATTENDANCE_RECORD;
                    return (
                      <tr key={student.id} className="transition-colors hover:bg-muted/30">
                        <td className="py-3.5 pl-5 pr-2 text-center text-xs font-medium tabular-nums text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                              {student.initials}
                            </span>
                            <span className="font-medium">{student.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-1">
                            {ATTENDANCE_OPTIONS.map((option) => {
                              const active = record.status === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={active}
                                  disabled={fetcher.state !== "idle"}
                                  onClick={() => updateStudentStatus(student.id, option.value)}
                                  className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs ${
                                    active
                                      ? `${option.selectedClass} font-semibold`
                                      : "border-transparent bg-background text-muted-foreground hover:border-border hover:text-foreground"
                                  }`}
                                >
                                  {active && <Check className="mr-1 inline h-3 w-3" aria-hidden="true" />}
                                  {option.label}
                                </button>
                              );
                            })}
                            {record.status === "absent" && (
                              <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800">
                                Vắng (chưa rõ lý do)
                              </span>
                            )}
                            {record.status === null && (
                              <span className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
                                Chưa điểm danh
                              </span>
                            )}
                          </div>
                        </td>
                        {HOMEWORK_FIELDS.map((field) => (
                          <td key={field.key} className="px-2 py-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={record.homework[field.key]}
                              disabled={fetcher.state !== "idle"}
                              onChange={(event) => updateStudentHomework(student.id, field.key, event.target.checked)}
                              aria-label={`${field.label}: ${student.name}`}
                              className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        {selectedClass.students.length === 0
                          ? "Lớp chưa có học viên đang hoạt động."
                          : "Không có học viên nào khớp với bộ lọc hiện tại."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="max-w-2xl text-xs text-muted-foreground">
                Thay đổi sẽ được lưu cùng các chỉnh sửa khác khi bạn bấm “Lưu toàn bộ bảng”.
              </p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button type="button" variant="outline" onClick={closeAttendanceModal}>
                  Đóng
                </Button>
              </div>
            </footer>
          </section>
        </Overlay>
      )}

    </AppShell>
  );
}

function StatPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "emerald" | "amber" | "sky" | "rose";
}) {
  const toneClass = {
    neutral: "border-border bg-muted/40 text-muted-foreground",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-1.5 ${toneClass}`}>
      {label} <strong className="ml-1 tabular-nums">{value}</strong>
    </div>
  );
}
