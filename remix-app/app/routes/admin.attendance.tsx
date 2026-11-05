import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Prisma } from "@prisma/client";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Plus,
  Search,
  Trash2,
  Users,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { ConsecutiveAbsenceBadge, ConsecutiveAbsenceNotice } from "~/components/attendance/consecutive-absence-notice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getStudentsAbsentForThreeConsecutiveSessions } from "~/lib/attendance-streak";
import {
  excludeHandledAbsenceAlerts,
  handleConsecutiveAbsenceAlert,
  type ConsecutiveAbsenceAlert,
} from "~/lib/attendance-streak.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { toast } from "sonner";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";
type AbsenceReason = "EXCUSED" | "UNEXCUSED";
type StatusFilter = "ALL" | "UNMARKED" | AttendanceStatus;
type AttendanceTask = "recording" | "hanzi" | "duet" | "lessonLink";
type AttendanceStatusDraft = { status: string; absenceReason: string };
type AttendanceTaskDraft = { recordId: string; task: AttendanceTask; completed: boolean };
type AttendanceOverviewStatus = "ALL" | "NEEDS_ATTENTION" | "NO_SESSION" | "COMPLETE" | "NO_STUDENTS";

const MAX_BULK_UPDATES = 5000;

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

function isAttendanceTask(value: string): value is AttendanceTask {
  return value === "recording" || value === "hanzi" || value === "duet" || value === "lessonLink";
}

function isStatusFilter(value: string): value is StatusFilter {
  return value === "ALL" || value === "UNMARKED" || isAttendanceStatus(value);
}

function parseAttendanceDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function getTodayDateValue() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function isAttendanceOverviewStatus(value: string): value is AttendanceOverviewStatus {
  return value === "ALL"
    || value === "NEEDS_ATTENTION"
    || value === "NO_SESSION"
    || value === "COMPLETE"
    || value === "NO_STUDENTS";
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
  const requestedTeacherId = params.get("teacherId") ?? "";
  const classId = params.get("classId") ?? "";
  const requestedSessionId = params.get("sessionId") ?? "";
  const rawTab = params.get("tab") ?? "";
  const isTotalTab = rawTab === "total";
  const rawDate = params.get("date") ?? getTodayDateValue();
  const selectedDate = parseAttendanceDate(rawDate);
  const date = selectedDate ?? parseAttendanceDate(getTodayDateValue())!;
  const rawOverviewStatus = params.get("view") ?? "ALL";
  const overviewStatus: AttendanceOverviewStatus = isAttendanceOverviewStatus(rawOverviewStatus)
    ? rawOverviewStatus
    : "ALL";
  const rawStatus = params.get("status") ?? "ALL";
  const rawQuery = params.get("q") ?? "";
  const query = rawQuery.trim().slice(0, 100);
  let filterError = "";
  let invalidFilter = false;
  if (!selectedDate) {
    filterError = "Ngày điểm danh không hợp lệ. Hãy chọn lại ngày.";
    invalidFilter = true;
  }
  if (rawTab !== "" && rawTab !== "total") {
    filterError = "Chế độ xem điểm danh không hợp lệ. Hãy chọn lại tab.";
    invalidFilter = true;
  }
  if (isTotalTab && !classId) {
    filterError = "Hãy chọn một lớp để xem tổng hợp điểm danh.";
    invalidFilter = true;
  }
  if (!isAttendanceOverviewStatus(rawOverviewStatus)) {
    filterError = "Trạng thái tổng quan không hợp lệ. Hãy chọn lại bộ lọc.";
    invalidFilter = true;
  }

  const [teachers, classes] = await Promise.all([
    prisma.user.findMany({
      where: { role: "teacher" },
      select: {
        id: true,
        name: true,
        isActive: true,
        isActivated: true,
        deletedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      select: {
        id: true,
        name: true,
        teacherId: true,
        completedAt: true,
        course: { select: { title: true } },
        teacher: { select: { id: true, name: true } },
        _count: { select: { attendanceSessions: true } },
        attendanceSessions: {
          where: { date: { lte: date } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 3,
          select: {
            id: true,
            title: true,
            date: true,
            createdAt: true,
            records: {
              where: { status: "ABSENT" },
              select: { studentId: true, student: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ completedAt: "asc" }, { name: "asc" }],
    }),
  ]);

  const selectedClass = classes.find((classroom) => classroom.id === classId) ?? null;
  if (classId && !selectedClass) {
    filterError = "Lớp được chọn không còn tồn tại. Hãy chọn lại lớp.";
    invalidFilter = true;
  }

  const selectedTeacherId = requestedTeacherId
    || (selectedClass ? selectedClass.teacherId ?? "unassigned" : "");
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId) ?? null;
  if (selectedTeacherId && selectedTeacherId !== "unassigned" && !selectedTeacher) {
    filterError = "Không tìm thấy giáo viên được chọn. Hãy chọn lại giáo viên.";
    invalidFilter = true;
  }
  if (
    selectedClass
    && selectedTeacherId
    && (selectedTeacherId === "unassigned"
      ? selectedClass.teacherId !== null
      : selectedClass.teacherId !== selectedTeacherId)
  ) {
    filterError = "Lớp này không thuộc giáo viên được chọn. Hãy chọn lại lớp.";
    invalidFilter = true;
  }
  const canLoadClassSummary = Boolean(
    isTotalTab
    && selectedClass
    && (!selectedTeacherId
      || (selectedTeacherId === "unassigned"
        ? selectedClass.teacherId === null
        : selectedClass.teacherId === selectedTeacherId && selectedTeacher)),
  );

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

  const teacherClasses = classes.filter((classroom) => (
    selectedTeacherId === "unassigned"
      ? classroom.teacherId === null
      : classroom.teacherId === selectedTeacherId
  ));
  const visibleClasses = selectedClass
    ? [selectedClass]
    : selectedTeacherId
      ? teacherClasses
      : classes;
  const sessionClassIds = visibleClasses.map((classroom) => classroom.id);
  const sessions = invalidFilter || sessionClassIds.length === 0
    ? []
    : await prisma.attendanceSession.findMany({
        where: { classId: { in: sessionClassIds }, date },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          classId: true,
          title: true,
          lesson: true,
          date: true,
          class: { select: { name: true } },
          _count: { select: { records: true } },
        },
      });

  const sessionAttendanceStats = sessions.length > 0
    ? await prisma.attendanceRecord.groupBy({
        by: ["sessionId", "status"],
        where: { sessionId: { in: sessions.map((session) => session.id) } },
        _count: { _all: true },
      })
    : [];
  const statsBySessionId = new Map<string, {
    present: number;
    late: number;
    absent: number;
    unmarked: number;
  }>();
  for (const { sessionId, status: recordStatus, _count } of sessionAttendanceStats) {
    const stats = statsBySessionId.get(sessionId) ?? { present: 0, late: 0, absent: 0, unmarked: 0 };
    if (recordStatus === "PRESENT") stats.present += _count._all;
    else if (recordStatus === "LATE") stats.late += _count._all;
    else if (recordStatus === "ABSENT") stats.absent += _count._all;
    else stats.unmarked += _count._all;
    statsBySessionId.set(sessionId, stats);
  }

  const selectedSession = requestedSessionId && sessionClassIds.length > 0 && !invalidFilter
    ? await prisma.attendanceSession.findFirst({
        where: { id: requestedSessionId, classId: { in: sessionClassIds }, date },
        select: {
          id: true,
          classId: true,
          title: true,
          lesson: true,
          date: true,
          createdAt: true,
          class: {
            select: {
              name: true,
              completedAt: true,
              course: { select: { title: true } },
              teacher: { select: { id: true, name: true } },
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
              student: { select: { id: true, name: true, email: true } },
            },
          },
        },
      })
    : null;

  const selectedAbsenceSessionsDescending = selectedSession
    ? await prisma.attendanceSession.findMany({
        where: {
          classId: selectedSession.classId,
          OR: [
            { date: { lt: selectedSession.date } },
            { date: selectedSession.date, createdAt: { lte: selectedSession.createdAt } },
          ],
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 3,
        select: {
          id: true,
          title: true,
          date: true,
          createdAt: true,
          records: { select: { studentId: true, status: true, student: { select: { name: true } } } },
        },
      })
    : [];
  const selectedAbsenceSessions = [...selectedAbsenceSessionsDescending].reverse();
  const selectedCandidateStudentIds = selectedSession
    ? getStudentsAbsentForThreeConsecutiveSessions(selectedAbsenceSessions, selectedSession.id)
    : new Set<string>();
  const selectedAbsenceAlerts = await excludeHandledAbsenceAlerts(
    selectedSession
      ? [...selectedCandidateStudentIds].flatMap((studentId): ConsecutiveAbsenceAlert[] => {
          const student = selectedAbsenceSessions.at(-1)?.records.find((record) => record.studentId === studentId)?.student;
          if (!student) return [];
          return [{
            classId: selectedSession.classId,
            className: selectedSession.class.name,
            studentId,
            studentName: student.name,
            sessionId: selectedSession.id,
            sessionDate: selectedSession.date,
            sessionCreatedAt: selectedSession.createdAt,
            sessions: selectedAbsenceSessions.map((session) => ({
              id: session.id,
              title: session.title,
              date: session.date.toISOString().slice(0, 10),
            })),
          }];
        })
      : [],
  );
  const selectedAbsenceStudentIds = new Set(selectedAbsenceAlerts.map(({ studentId }) => studentId));
  const selectedAbsenceNames = selectedAbsenceAlerts.map(({ studentName }) => studentName);
  const matchingRecords = selectedSession?.records
    .map(({ student, ...record }) => ({
      ...record,
      consecutiveAbsence: selectedAbsenceStudentIds.has(student.id),
      student: { name: student.name, email: student.email },
    }));

  const classAttendanceSummary = canLoadClassSummary && selectedClass
    ? await (async () => {
        const [enrollments, groupedRecords, recentSessionsDescending] = await Promise.all([
          prisma.enrollment.findMany({
            where: { classId: selectedClass.id },
            select: { user: { select: { id: true, name: true, email: true } } },
          }),
          prisma.attendanceRecord.groupBy({
            by: ["studentId", "status", "recording", "hanzi", "duet", "lessonLink"],
            where: { session: { is: { classId: selectedClass.id } } },
            _count: { _all: true },
          }),
          prisma.attendanceSession.findMany({
            where: { classId: selectedClass.id },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 3,
            select: {
              id: true,
              title: true,
              date: true,
              createdAt: true,
              records: { select: { studentId: true, status: true, student: { select: { name: true } } } },
            },
          }),
        ]);
        const recentSessions = [...recentSessionsDescending].reverse();
        const latestSession = recentSessions[recentSessions.length - 1];
        const candidateAbsenceStudentIds = latestSession
          ? getStudentsAbsentForThreeConsecutiveSessions(recentSessions, latestSession.id)
          : new Set<string>();
        const summaryAbsenceAlerts = await excludeHandledAbsenceAlerts(
          latestSession
            ? [...candidateAbsenceStudentIds].flatMap((studentId): ConsecutiveAbsenceAlert[] => {
                const student = latestSession.records.find((record) => record.studentId === studentId)?.student;
                if (!student) return [];
                return [{
                  classId: selectedClass.id,
                  className: selectedClass.name,
                  studentId,
                  studentName: student.name,
                  sessionId: latestSession.id,
                  sessionDate: latestSession.date,
                  sessionCreatedAt: latestSession.createdAt,
                  sessions: recentSessions.map((session) => ({
                    id: session.id,
                    title: session.title,
                    date: session.date.toISOString().slice(0, 10),
                  })),
                }];
              })
            : [],
        );
        const consecutiveAbsenceStudentIds = new Set(summaryAbsenceAlerts.map(({ studentId }) => studentId));
        const recordStudentIds = Array.from(new Set(groupedRecords.map(({ studentId }) => studentId)));
        const recordStudents = recordStudentIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: recordStudentIds } },
              select: { id: true, name: true, email: true },
            })
          : [];
        const studentsById = new Map(
          [...enrollments.map(({ user }) => user), ...recordStudents].map((student) => [student.id, student]),
        );
        const studentSummaries = new Map<string, {
          id: string;
          name: string;
          email: string;
          recordCount: number;
          present: number;
          late: number;
          absent: number;
          recording: { completed: number; total: number };
          hanzi: { completed: number; total: number };
          duet: { completed: number; total: number };
          lessonLink: { completed: number; total: number };
        }>();
        const getStudentSummary = (studentId: string) => {
          const student = studentsById.get(studentId);
          if (!student) throw new Error("Không tìm thấy học viên trong dữ liệu tổng hợp điểm danh.");
          const existingSummary = studentSummaries.get(studentId);
          if (existingSummary) return existingSummary;
          const summary = {
            id: student.id,
            name: student.name,
            email: student.email,
            recordCount: 0,
            present: 0,
            late: 0,
            absent: 0,
            recording: { completed: 0, total: 0 },
            hanzi: { completed: 0, total: 0 },
            duet: { completed: 0, total: 0 },
            lessonLink: { completed: 0, total: 0 },
          };
          studentSummaries.set(studentId, summary);
          return summary;
        };

        for (const { user } of enrollments) getStudentSummary(user.id);
        for (const group of groupedRecords) {
          const count = group._count._all;
          const summary = getStudentSummary(group.studentId);
          summary.recordCount += count;
          if (group.status === "PRESENT") summary.present += count;
          else if (group.status === "LATE") summary.late += count;
          else if (group.status === "ABSENT") summary.absent += count;
          for (const task of ["recording", "hanzi", "duet", "lessonLink"] as const) {
            summary[task].total += count;
            if (group[task]) summary[task].completed += count;
          }
        }

        const students = Array.from(studentSummaries.values())
          .sort((left, right) => left.name.localeCompare(right.name, "vi"))
          .map((student) => ({
            ...student,
            hasConsecutiveAbsence: consecutiveAbsenceStudentIds.has(student.id),
          }));
        return {
          sessionCount: selectedClass._count.attendanceSessions,
          studentCount: students.length,
          recordCount: students.reduce((total, student) => total + student.recordCount, 0),
          present: students.reduce((total, student) => total + student.present, 0),
          late: students.reduce((total, student) => total + student.late, 0),
          absent: students.reduce((total, student) => total + student.absent, 0),
          consecutiveAbsenceNames: students
            .filter((student) => student.hasConsecutiveAbsence)
            .map((student) => student.name),
          consecutiveAbsenceAlerts: summaryAbsenceAlerts,
          students,
        };
      })()
    : null;

  const summarizeSessions = (includedSessions: typeof sessions) => includedSessions.reduce(
    (summary, session) => {
      const attendance = statsBySessionId.get(session.id) ?? { present: 0, late: 0, absent: 0, unmarked: 0 };
      summary.sessionCount += 1;
      summary.classIds.add(session.classId);
      summary.recordCount += session._count.records;
      summary.present += attendance.present;
      summary.late += attendance.late;
      summary.absent += attendance.absent;
      summary.unmarked += attendance.unmarked;
      if (attendance.unmarked > 0) summary.sessionsNeedingAttention += 1;
      else if (session._count.records > 0) summary.completedSessions += 1;
      else summary.sessionsWithoutStudents += 1;
      return summary;
    },
    {
      sessionCount: 0,
      classIds: new Set<string>(),
      recordCount: 0,
      present: 0,
      late: 0,
      absent: 0,
      unmarked: 0,
      sessionsNeedingAttention: 0,
      completedSessions: 0,
      sessionsWithoutStudents: 0,
    },
  );
  const attendanceSummary = summarizeSessions(sessions);
  const markedRecordCount = attendanceSummary.present + attendanceSummary.late + attendanceSummary.absent;
  const attendanceRate = markedRecordCount > 0
    ? Math.round((attendanceSummary.present / markedRecordCount) * 100)
    : 0;
  const classById = new Map(classes.map((classroom) => [classroom.id, classroom]));
  const consecutiveAbsenceAlerts = classes.flatMap((classroom) => {
    const recentSessions = [...classroom.attendanceSessions].reverse();
    const latestSession = recentSessions[recentSessions.length - 1];
    if (!latestSession) return [];

    const studentIds = getStudentsAbsentForThreeConsecutiveSessions(
      recentSessions.map((session) => ({
        id: session.id,
        records: session.records.map(({ studentId }) => ({ studentId, status: "ABSENT" })),
      })),
      latestSession.id,
    );
    const students = latestSession.records
      .filter(({ studentId }) => studentIds.has(studentId))
      .map(({ studentId, student }) => ({ studentId, studentName: student.name }));
    return students.map(({ studentId, studentName }): ConsecutiveAbsenceAlert => ({
      classId: classroom.id,
      className: classroom.name,
      studentId,
      studentName,
      sessionId: latestSession.id,
      sessionDate: latestSession.date,
      sessionCreatedAt: latestSession.createdAt,
      sessions: recentSessions.map((session) => ({
        id: session.id,
        title: session.title,
        date: session.date.toISOString().slice(0, 10),
      })),
    }));
  });
  const visibleConsecutiveAbsenceAlerts = await excludeHandledAbsenceAlerts(consecutiveAbsenceAlerts);
  const alertsByClassId = new Map<string, ConsecutiveAbsenceAlert[]>();
  for (const alert of visibleConsecutiveAbsenceAlerts) {
    const classAlerts = alertsByClassId.get(alert.classId) ?? [];
    classAlerts.push(alert);
    alertsByClassId.set(alert.classId, classAlerts);
  }
  const getConsecutiveAbsenceClasses = (includedClasses: typeof classes) => includedClasses.flatMap((classroom) => {
    const alerts = alertsByClassId.get(classroom.id) ?? [];
    return alerts.length > 0
      ? [{
          classId: classroom.id,
          className: classroom.name,
          studentNames: alerts.map(({ studentName }) => studentName),
          alerts,
        }]
      : [];
  });
  const unassignedConsecutiveAbsenceClasses = getConsecutiveAbsenceClasses(
    classes.filter((classroom) => classroom.teacherId === null),
  );
  const consecutiveAbsenceByClassId = new Map(
    getConsecutiveAbsenceClasses(classes).map((classroom) => [classroom.classId, classroom]),
  );
  const unassignedAttendance = summarizeSessions(
    sessions.filter((session) => classById.get(session.classId)?.teacherId === null),
  );
  const unassignedMarkedRecordCount = unassignedAttendance.present
    + unassignedAttendance.late
    + unassignedAttendance.absent;

  const teacherSummaries = teachers.map((teacher) => {
    const assignedClasses = classes.filter((classroom) => classroom.teacherId === teacher.id);
    const consecutiveAbsenceClasses = getConsecutiveAbsenceClasses(assignedClasses);
    const teacherSessions = sessions.filter((session) => classById.get(session.classId)?.teacherId === teacher.id);
    const teacherAttendance = summarizeSessions(teacherSessions);
    const teacherMarkedRecords = teacherAttendance.present + teacherAttendance.late + teacherAttendance.absent;
    return {
      id: teacher.id,
      name: teacher.name,
      isActive: teacher.isActive,
      isActivated: teacher.isActivated,
      isDeleted: teacher.deletedAt !== null,
      activeClassCount: assignedClasses.filter((classroom) => !classroom.completedAt).length,
      sessionCount: assignedClasses.reduce((total, classroom) => total + classroom._count.attendanceSessions, 0),
      dailySessionCount: teacherAttendance.sessionCount,
      dailyRecordCount: teacherAttendance.recordCount,
      dailyPresent: teacherAttendance.present,
      dailyLate: teacherAttendance.late,
      dailyAbsent: teacherAttendance.absent,
      consecutiveAbsenceClasses,
      dailyUnmarked: teacherAttendance.unmarked,
      dailyMarkedRecordCount: teacherMarkedRecords,
      dailyIncompleteSessionCount: teacherAttendance.sessionsNeedingAttention,
      dailyCompletedSessionCount: teacherAttendance.completedSessions,
      dailyEmptySessionCount: teacherAttendance.sessionsWithoutStudents,
      dailyAttendanceRate: teacherMarkedRecords > 0
        ? Math.round((teacherAttendance.present / teacherMarkedRecords) * 100)
        : null,
    };
  });

  return {
    user,
    attendanceSummary: {
      sessionCount: attendanceSummary.sessionCount,
      classCount: attendanceSummary.classIds.size,
      recordCount: attendanceSummary.recordCount,
      present: attendanceSummary.present,
      late: attendanceSummary.late,
      absent: attendanceSummary.absent,
      unmarked: attendanceSummary.unmarked,
      sessionsNeedingAttention: attendanceSummary.sessionsNeedingAttention,
      completedSessions: attendanceSummary.completedSessions,
      attendanceRate,
    },
    unassignedAttendanceSummary: {
      sessionCount: unassignedAttendance.sessionCount,
      recordCount: unassignedAttendance.recordCount,
      present: unassignedAttendance.present,
      late: unassignedAttendance.late,
      absent: unassignedAttendance.absent,
      unmarked: unassignedAttendance.unmarked,
      completedSessionCount: unassignedAttendance.completedSessions,
      incompleteSessionCount: unassignedAttendance.sessionsNeedingAttention,
      emptySessionCount: unassignedAttendance.sessionsWithoutStudents,
      consecutiveAbsenceClasses: unassignedConsecutiveAbsenceClasses,
      attendanceRate: unassignedMarkedRecordCount > 0
        ? Math.round((unassignedAttendance.present / unassignedMarkedRecordCount) * 100)
        : null,
    },
    teachers: teacherSummaries,
    selectedTeacherId,
    classes: classes.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      course: classroom.course.title,
      teacherId: classroom.teacherId,
      teacher: classroom.teacher?.name ?? "Chưa phân công",
      isCompleted: Boolean(classroom.completedAt),
      sessionCount: classroom._count.attendanceSessions,
      consecutiveAbsentStudentNames: consecutiveAbsenceByClassId.get(classroom.id)?.studentNames ?? [],
      consecutiveAbsenceAlerts: consecutiveAbsenceByClassId.get(classroom.id)?.alerts ?? [],
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
      classId: session.classId,
      className: session.class.name,
      title: session.title,
      lesson: session.lesson,
      date: session.date.toISOString().slice(0, 10),
      recordCount: session._count.records,
      ...(statsBySessionId.get(session.id) ?? { present: 0, late: 0, absent: 0, unmarked: 0 }),
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
            teacherId: selectedSession.class.teacher?.id ?? "unassigned",
            teacher: selectedSession.class.teacher?.name ?? "Chưa phân công",
            isCompleted: Boolean(selectedSession.class.completedAt),
          },
          recordCount: selectedSession._count.records,
          records: matchingRecords ?? [],
          consecutiveAbsenceNames: selectedAbsenceNames,
          consecutiveAbsenceAlerts: selectedAbsenceAlerts,
        }
      : null,
    classAttendanceSummary,
    filters: {
      teacherId: selectedTeacherId,
      classId,
      sessionId: requestedSessionId,
      tab: isTotalTab ? "total" as const : "sessions" as const,
      date: date.toISOString().slice(0, 10),
      overviewStatus,
      status,
      query,
    },
    totalSessions: sessions.length,
    filterError,
    today: getTodayDateValue(),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "dismiss-absence-alert") {
    const classId = String(form.get("classId") ?? "");
    const studentId = String(form.get("studentId") ?? "");
    const sessionId = String(form.get("sessionId") ?? "");
    if (!classId || !studentId || !sessionId) {
      return { success: false as const, intent, studentId, error: "Thông tin cảnh báo không đầy đủ. Hãy tải lại trang." };
    }

    const handled = await handleConsecutiveAbsenceAlert({ classId, studentId, sessionId, handledById: user.id });
    if (!handled) {
      return { success: false as const, intent, studentId, error: "Cảnh báo này không còn hợp lệ. Hãy tải lại trang." };
    }
    return { success: true as const, intent, studentId };
  }

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
      select: { id: true, teacherId: true },
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

    return {
      success: true as const,
      intent,
      classId,
      teacherId: classroom.teacherId ?? "unassigned",
      sessionId: session.id,
      date: date.toISOString().slice(0, 10),
    };
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

    const rawRecords = String(form.get("records") ?? "[]");
    let parsedRecords: unknown;
    try {
      parsedRecords = JSON.parse(rawRecords);
    } catch {
      return { success: false as const, intent, error: "Danh sách điểm danh cần lưu không hợp lệ." };
    }
    if (!Array.isArray(parsedRecords) || parsedRecords.length > MAX_BULK_UPDATES) {
      return { success: false as const, intent, error: "Danh sách điểm danh cần lưu không hợp lệ." };
    }

    const recordUpdates: { recordId: string; status: AttendanceStatus | null; absenceReason: AbsenceReason | null }[] = [];
    const seenRecordIds = new Set<string>();
    for (const value of parsedRecords) {
      if (!value || typeof value !== "object") {
        return { success: false as const, intent, error: "Thông tin điểm danh không hợp lệ." };
      }
      const update = value as Record<string, unknown>;
      const recordId = typeof update.recordId === "string" ? update.recordId : "";
      const rawStatus = typeof update.status === "string" ? update.status : "";
      const rawReason = typeof update.absenceReason === "string" ? update.absenceReason : "";
      const status = rawStatus === "" ? null : isAttendanceStatus(rawStatus) ? rawStatus : undefined;
      const absenceReason = rawReason === "" ? null : isAbsenceReason(rawReason) ? rawReason : undefined;
      if (
        !recordId
        || seenRecordIds.has(recordId)
        || status === undefined
        || absenceReason === undefined
        || (status === "ABSENT" && absenceReason === null)
      ) {
        return { success: false as const, intent, error: "Thông tin điểm danh không hợp lệ hoặc thiếu lý do vắng." };
      }
      seenRecordIds.add(recordId);
      recordUpdates.push({
        recordId,
        status,
        absenceReason: status === "ABSENT" ? absenceReason : null,
      });
    }

    const rawTasks = String(form.get("tasks") ?? "[]");
    let parsedTasks: unknown;
    try {
      parsedTasks = JSON.parse(rawTasks);
    } catch {
      return { success: false as const, intent, error: "Danh sách nhiệm vụ cần lưu không hợp lệ." };
    }
    if (!Array.isArray(parsedTasks) || parsedTasks.length > MAX_BULK_UPDATES) {
      return { success: false as const, intent, error: "Danh sách nhiệm vụ cần lưu không hợp lệ." };
    }

    const taskUpdates: AttendanceTaskDraft[] = [];
    const seenTaskKeys = new Set<string>();
    for (const value of parsedTasks) {
      if (!value || typeof value !== "object") {
        return { success: false as const, intent, error: "Thông tin nhiệm vụ không hợp lệ." };
      }
      const update = value as Record<string, unknown>;
      const recordId = typeof update.recordId === "string" ? update.recordId : "";
      const task = typeof update.task === "string" ? update.task : "";
      if (!recordId || !isAttendanceTask(task) || typeof update.completed !== "boolean") {
        return { success: false as const, intent, error: "Thông tin nhiệm vụ không hợp lệ." };
      }
      const taskKey = `${recordId}:${task}`;
      if (seenTaskKeys.has(taskKey)) {
        return { success: false as const, intent, error: "Danh sách nhiệm vụ bị trùng." };
      }
      seenTaskKeys.add(taskKey);
      taskUpdates.push({ recordId, task, completed: update.completed });
    }

    const updatedRecordIds = new Set([
      ...recordUpdates.map(({ recordId }) => recordId),
      ...taskUpdates.map(({ recordId }) => recordId),
    ]);
    if (updatedRecordIds.size > 0) {
      const matchingRecords = await prisma.attendanceRecord.findMany({
        where: { id: { in: [...updatedRecordIds] }, sessionId: session.id },
        select: { id: true },
      });
      if (matchingRecords.length !== updatedRecordIds.size) {
        return { success: false as const, intent, error: "Không tìm thấy một số dòng điểm danh. Hãy tải lại trang." };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: { title, lesson, date },
      });
      for (const update of recordUpdates) {
        await tx.attendanceRecord.update({
          where: { id: update.recordId },
          data: { status: update.status, absenceReason: update.absenceReason },
        });
      }
      for (const update of taskUpdates) {
        await tx.attendanceRecord.update({
          where: { id: update.recordId },
          data: {
            recording: update.task === "recording" ? update.completed : undefined,
            hanzi: update.task === "hanzi" ? update.completed : undefined,
            duet: update.task === "duet" ? update.completed : undefined,
            lessonLink: update.task === "lessonLink" ? update.completed : undefined,
          },
        });
      }
    });
    return {
      success: true as const,
      intent,
      sessionId,
      date: date.toISOString().slice(0, 10),
    };
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

  if (intent === "update-task") {
    const recordId = String(form.get("recordId") ?? "");
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { id: true },
    });
    if (!record) {
      return { success: false as const, intent, error: "Không tìm thấy dòng điểm danh. Hãy tải lại trang." };
    }

    const task = String(form.get("task") ?? "");
    const completedValue = String(form.get("completed") ?? "");
    if (!isAttendanceTask(task) || (completedValue !== "true" && completedValue !== "false")) {
      return { success: false as const, intent, error: "Thông tin nhiệm vụ không hợp lệ." };
    }

    const completed = completedValue === "true";
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        recording: task === "recording" ? completed : undefined,
        hanzi: task === "hanzi" ? completed : undefined,
        duet: task === "duet" ? completed : undefined,
        lessonLink: task === "lessonLink" ? completed : undefined,
      },
    });
    return { success: true as const, intent, recordId, task, completed };
  }

  return { success: false as const, intent, error: "Thao tác điểm danh không hợp lệ." };
}

type AttendanceData = Awaited<ReturnType<typeof loader>>;
type AttendanceSessionSummary = AttendanceData["sessions"][number];
type AttendanceSession = NonNullable<AttendanceData["selectedSession"]>;
type AttendanceRow = AttendanceSession["records"][number];
type AttendanceClassSummary = NonNullable<AttendanceData["classAttendanceSummary"]>;

function AttendanceClassTotalSummary({
  classId,
  className,
  summary,
}: {
  classId: string;
  className: string;
  summary: AttendanceClassSummary;
}) {
  const [query, setQuery] = useState("");
  const visibleStudents = summary.students.filter(({ name, email }) =>
    normalizeSearchText(`${name} ${email}`).includes(normalizeSearchText(query)),
  );
  const metrics = [
    { label: "Sĩ số", value: summary.studentCount, className: "text-foreground" },
    { label: "Có mặt", value: summary.present, className: "text-success" },
    { label: "Đi muộn", value: summary.late, className: "text-warning" },
    { label: "Vắng mặt", value: summary.absent, className: "text-destructive" },
  ];

  return (
    <section aria-labelledby={`attendance-class-total-heading-${classId}`} className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`attendance-class-total-heading-${classId}`} className="text-lg font-semibold">
          Tổng hợp điểm danh · {className}
        </h2>
        <p className="text-sm text-muted-foreground">
          Toàn bộ {summary.sessionCount} buổi điểm danh của lớp
        </p>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-4">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={`p-4 ${index < 2 ? "border-b" : ""} ${index % 2 === 0 ? "border-r" : ""} ${
              index === 0 ? "sm:border-b-0 sm:border-r" : index === 1 ? "sm:border-b-0 sm:border-r" : index === 2 ? "sm:border-r" : ""
            }`}
          >
            <p className="text-sm text-muted-foreground">{metric.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${metric.className}`}>
              {metric.value.toLocaleString("vi-VN")}
            </p>
          </div>
        ))}
      </div>

      <ConsecutiveAbsenceNotice alerts={summary.consecutiveAbsenceAlerts} />

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h3 className="font-semibold">Tổng hợp theo học viên</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Số lần ghi nhận trên {summary.sessionCount} buổi
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Label htmlFor={`attendance-class-total-search-${classId}`} className="sr-only">
              Tìm học viên trong tổng hợp
            </Label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={`attendance-class-total-search-${classId}`}
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Tìm học viên..."
              className="pl-9"
            />
          </div>
        </div>

        {visibleStudents.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            {summary.students.length === 0
              ? "Chưa có học viên trong danh sách tổng hợp của lớp."
              : "Không tìm thấy học viên phù hợp."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">Tổng hợp trạng thái và bài tập theo học viên của lớp {className}</caption>
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-16 px-4 py-3 text-center font-medium">STT</th>
                  <th scope="col" className="min-w-52 px-4 py-3 font-medium">Học viên</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Có mặt</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Đi muộn</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Vắng mặt</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Ghi âm</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Chữ Hán</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Duet</th>
                  <th scope="col" className="w-24 px-3 py-3 text-center font-medium">Bài link</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleStudents.map((student, index) => (
                  <tr
                    key={student.id}
                    className={student.hasConsecutiveAbsence ? "bg-destructive/5" : undefined}
                  >
                    <td className="px-4 py-4 text-center text-muted-foreground tabular-nums">{index + 1}</td>
                    <th scope="row" className="px-4 py-4 font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {student.name}
                        {student.hasConsecutiveAbsence && <ConsecutiveAbsenceBadge />}
                      </span>
                    </th>
                    <td className="px-3 py-4 text-center font-medium text-success tabular-nums">{student.present}</td>
                    <td className="px-3 py-4 text-center font-medium text-warning tabular-nums">{student.late}</td>
                    <td className="px-3 py-4 text-center font-medium text-destructive tabular-nums">{student.absent}</td>
                    {(["recording", "hanzi", "duet", "lessonLink"] as const).map((task) => (
                      <td key={task} className="px-3 py-4 text-center text-muted-foreground tabular-nums">
                        {student[task].completed}/{student[task].total}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

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
  record,
  isEditing,
  onDraftChange,
}: {
  record: AttendanceRow;
  isEditing: boolean;
  onDraftChange: (recordId: string, draft: AttendanceStatusDraft) => void;
}) {
  const [status, setStatus] = useState<string>(record.status ?? "");
  const [absenceReason, setAbsenceReason] = useState<string>(record.absenceReason ?? "");

  if (!isEditing) {
    return (
      <div>
        <AttendanceStatusBadge status={record.status} />
        {record.status === "ABSENT" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {record.absenceReason === "EXCUSED" ? "Có phép" : record.absenceReason === "UNEXCUSED" ? "Không phép" : "Chưa ghi nhận lý do"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-[19rem] flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`attendance-status-${record.id}`}>Trạng thái điểm danh</label>
      <select
        id={`attendance-status-${record.id}`}
        value={status}
        onChange={(event) => {
          const nextStatus = event.currentTarget.value;
          const nextReason = nextStatus === "ABSENT" ? absenceReason : "";
          setStatus(nextStatus);
          setAbsenceReason(nextReason);
          onDraftChange(record.id, { status: nextStatus, absenceReason: nextReason });
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
            value={absenceReason}
            onChange={(event) => {
              const nextReason = event.currentTarget.value;
              setAbsenceReason(nextReason);
              onDraftChange(record.id, { status, absenceReason: nextReason });
            }}
            required
            className="h-9 min-w-36 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Chọn lý do vắng</option>
            <option value="EXCUSED">Có phép</option>
            <option value="UNEXCUSED">Không phép</option>
          </select>
        </>
      )}
    </div>
  );
}

function AttendanceTaskCheckbox({
  recordId,
  studentName,
  task,
  label,
  checked,
  isEditing,
  onDraftChange,
}: {
  recordId: string;
  studentName: string;
  task: AttendanceTask;
  label: string;
  checked: boolean;
  isEditing: boolean;
  onDraftChange: (recordId: string, task: AttendanceTask, completed: boolean) => void;
}) {
  return (
    <div className="flex justify-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={!isEditing}
        aria-label={`${label} của ${studentName}`}
        onChange={(event) => {
          onDraftChange(recordId, task, event.currentTarget.checked);
        }}
        className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}

function SessionActions({ session }: { session: AttendanceSession }) {
  const deleteFetcher = useFetcher<typeof action>();

  return (
    <div>
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

function SessionMetadataEditor({
  session,
  records,
  tasks,
  onDirtyChange,
  onSavingChange,
  onSaved,
}: {
  session: AttendanceSession;
  records: string;
  tasks: string;
  onDirtyChange: (isDirty: boolean) => void;
  onSavingChange: (isSaving: boolean) => void;
  onSaved: (date: string) => void;
}) {
  const editFetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [lesson, setLesson] = useState(session.lesson);
  const [date, setDate] = useState(session.date);
  const isDirty = title !== session.title || lesson !== session.lesson || date !== session.date;
  const isSaving = editFetcher.state !== "idle";

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange(isSaving);
  }, [isSaving, onSavingChange]);

  useEffect(() => {
    const result = editFetcher.data;
    if (
      result?.intent === "update-session"
      && result.success
      && "date" in result
      && typeof result.date === "string"
    ) {
      toast.success("Đã lưu thay đổi điểm danh thành công.");
      onSaved(result.date);
    }
  }, [editFetcher.data, onSaved]);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <editFetcher.Form
        ref={formRef}
        id={`session-metadata-${session.id}`}
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          setIsConfirmOpen(true);
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input type="hidden" name="intent" value="update-session" />
        <input type="hidden" name="sessionId" value={session.id} />
        <input type="hidden" name="records" value={records} />
        <input type="hidden" name="tasks" value={tasks} />
        <div className="space-y-1.5">
          <Label htmlFor={`session-title-${session.id}`}>Tên buổi</Label>
          <Input id={`session-title-${session.id}`} name="title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={80} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`session-lesson-${session.id}`}>Bài học</Label>
          <Input id={`session-lesson-${session.id}`} name="lesson" value={lesson} onChange={(event) => setLesson(event.currentTarget.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`session-date-${session.id}`}>Ngày học</Label>
          <Input id={`session-date-${session.id}`} name="date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} required />
        </div>
        {editFetcher.data?.success === false && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{editFetcher.data.error}</p>
        )}
      </editFetcher.Form>
      {isConfirmOpen && createPortal(
        <Overlay onClose={() => setIsConfirmOpen(false)} className="max-w-md">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`confirm-attendance-save-title-${session.id}`}
            aria-describedby={`confirm-attendance-save-description-${session.id}`}
            className="space-y-5"
          >
            <div className="space-y-2">
              <h2 id={`confirm-attendance-save-title-${session.id}`} className="text-lg font-semibold">
                Lưu thay đổi?
              </h2>
              <p id={`confirm-attendance-save-description-${session.id}`} className="text-sm leading-relaxed text-muted-foreground">
                Các cập nhật điểm danh và thông tin buổi học sẽ được áp dụng.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsConfirmOpen(false)}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                Để sau
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const form = formRef.current;
                  if (!form) return;
                  setIsConfirmOpen(false);
                  editFetcher.submit(new FormData(form), { method: "post" });
                }}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                Xác nhận lưu
              </Button>
            </div>
          </section>
        </Overlay>,
        document.body,
      )}
    </div>
  );
}

function AttendanceSessionTab({
  session,
  classId,
  teacherId,
  date,
  isSelected,
}: {
  session: AttendanceSessionSummary;
  classId: string;
  teacherId: string;
  date: string;
  isSelected: boolean;
}) {
  const search = new URLSearchParams({ teacherId, classId, sessionId: session.id, date });
  const label = session.lesson.trim() ? `${session.title} - ${session.lesson.trim()}` : session.title;
  const markedCount = session.present + session.late + session.absent;
  const needsAttention = session.unmarked > 0;

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
      <span>{label}</span>
      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
        isSelected ? "bg-background/15 text-background" : needsAttention ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
      }`}>
        {session.recordCount === 0
          ? "Chưa có học viên"
          : needsAttention
            ? `${session.unmarked} chưa điểm danh`
            : `${markedCount}/${session.recordCount} đã điểm danh`}
      </span>
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
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [isMetadataDirty, setIsMetadataDirty] = useState(false);
  const [isMetadataSaving, setIsMetadataSaving] = useState(false);
  const [recordDrafts, setRecordDrafts] = useState<Record<string, AttendanceStatusDraft>>({});
  const [taskDrafts, setTaskDrafts] = useState<Record<string, Partial<Record<AttendanceTask, boolean>>>>({});
  const [searchQuery, setSearchQuery] = useState(query);
  useEffect(() => {
    setSearchQuery(query);
  }, [query]);
  const filteredRecords = session.records.filter(({ student }) =>
    !searchQuery
    || normalizeSearchText(`${student.name} ${student.email}`).includes(normalizeSearchText(searchQuery)),
  );
  const recordUpdates = Object.entries(recordDrafts).map(([recordId, draft]) => ({
    recordId,
    ...draft,
  }));
  const serializedRecordUpdates = JSON.stringify(recordUpdates);
  const taskUpdates = Object.entries(taskDrafts).flatMap(([recordId, drafts]) =>
    Object.entries(drafts).flatMap(([task, completed]) =>
      isAttendanceTask(task) && typeof completed === "boolean"
        ? [{ recordId, task, completed }]
        : [],
    ),
  );
  const serializedTaskUpdates = JSON.stringify(taskUpdates);
  const isDirty = isMetadataDirty || recordUpdates.length > 0 || taskUpdates.length > 0;
  const handleSaved = useCallback((date: string) => {
    setIsEditing(false);
    setIsMetadataDirty(false);
    setIsMetadataSaving(false);
    setRecordDrafts({});
    setTaskDrafts({});
    const params = new URLSearchParams({
      teacherId: session.classroom.teacherId,
      classId: session.classId,
      sessionId: session.id,
      date,
    });
    navigate(`/admin/attendance?${params.toString()}`);
  }, [navigate, session.classId, session.classroom.teacherId, session.id]);
  const counts = filteredRecords.reduce(
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
      <div className="space-y-4 border-b p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
              <Badge variant="outline">{filteredRecords.length} học viên trong kết quả</Badge>
              <Badge variant="outline" className="border-success/30 text-success">{counts.present} có mặt</Badge>
              <Badge variant="outline" className="border-warning/30 text-warning">{counts.late} đi muộn</Badge>
              <Badge variant="outline" className="border-destructive/30 text-destructive">{counts.absent} vắng</Badge>
              {counts.unmarked > 0 && (
                <Badge variant="outline" className="text-muted-foreground">{counts.unmarked} chưa điểm danh</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Button
              type={isDirty ? "submit" : "button"}
              form={isDirty ? `session-metadata-${session.id}` : undefined}
              variant={isEditing && !isDirty ? "default" : "outline"}
              aria-pressed={isEditing}
              disabled={isMetadataSaving}
              onClick={() => {
                if (!isDirty) {
                  setIsEditing((current) => !current);
                  setIsMetadataDirty(false);
                }
              }}
            >
              {isMetadataSaving
                ? "Đang lưu..."
                : isDirty
                  ? "Lưu"
                  : isEditing
                    ? "Xong chỉnh sửa"
                    : "Chỉnh sửa buổi"}
            </Button>
            <SessionActions session={session} />
          </div>
        </div>
        {isEditing && (
          <SessionMetadataEditor
            key={session.id}
            session={session}
            records={serializedRecordUpdates}
            tasks={serializedTaskUpdates}
            onDirtyChange={setIsMetadataDirty}
            onSavingChange={setIsMetadataSaving}
            onSaved={handleSaved}
          />
        )}
      </div>

      <CardContent className="p-0">
        {session.consecutiveAbsenceAlerts.length > 0 && (
          <div className="p-4 sm:px-5">
            <ConsecutiveAbsenceNotice alerts={session.consecutiveAbsenceAlerts} />
          </div>
        )}
        <div className="border-b p-4 sm:p-5">
          <Form method="get" className="grid gap-3 sm:grid-cols-[1fr_1.5fr] sm:items-end">
            <input type="hidden" name="date" value={session.date} />
            <input type="hidden" name="classId" value={session.classId} />
            <input type="hidden" name="sessionId" value={session.id} />
            <input type="hidden" name="q" value={searchQuery} />
            <div className="space-y-1.5">
              <Label htmlFor={`record-status-${session.id}`}>Trạng thái</Label>
              <select
                id={`record-status-${session.id}`}
                name="status"
                value={status}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
                className={SELECT_CLASS}
              >
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
                  value={searchQuery}
                  maxLength={100}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="Tên hoặc email"
                  className="pl-9"
                />
              </div>
            </div>
          </Form>
        </div>
        {filteredRecords.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Buổi này chưa có học viên khớp với bộ lọc.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Học viên</th>
                  <th scope="col" className="w-[240px] px-4 py-3 font-medium">Trạng thái điểm danh</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center font-medium">Ghi âm</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center font-medium">Chữ Hán</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center font-medium">Duet</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center font-medium">Bài link</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    className={`align-top ${record.consecutiveAbsence ? "bg-destructive/5" : ""}`}
                  >
                    <th scope="row" className="px-4 py-4 font-medium sm:px-5">
                      <span className="flex flex-wrap items-center gap-2">
                        {record.student.name}
                        {record.consecutiveAbsence && <ConsecutiveAbsenceBadge />}
                      </span>
                    </th>
                    <td className="px-4 py-3">
                      <AttendanceRecordEditor
                        key={`${record.id}:${record.status ?? ""}:${record.absenceReason ?? ""}`}
                        record={record}
                        isEditing={isEditing}
                        onDraftChange={(recordId, draft) => {
                          const existingRecord = session.records.find(({ id }) => id === recordId);
                          if (!existingRecord) return;
                          const savedStatus = existingRecord.status ?? "";
                          const savedReason = existingRecord.absenceReason ?? "";
                          const isReverted = draft.status === savedStatus
                            && (draft.status !== "ABSENT" || draft.absenceReason === savedReason);
                          setRecordDrafts((current) => {
                            if (isReverted) {
                              const { [recordId]: _discarded, ...remaining } = current;
                              return remaining;
                            }
                            return { ...current, [recordId]: draft };
                          });
                        }}
                      />
                    </td>
                    {[
                      ["Ghi âm", record.recording, "recording"] as const,
                      ["Chữ Hán", record.hanzi, "hanzi"] as const,
                      ["Duet", record.duet, "duet"] as const,
                      ["Bài link", record.lessonLink, "lessonLink"] as const,
                    ].map(([label, completed, task]) => (
                      <td key={label} className="px-3 py-3.5 text-center">
                        <AttendanceTaskCheckbox
                          recordId={record.id}
                          studentName={record.student.name}
                          task={task}
                          label={label}
                          checked={taskDrafts[record.id]?.[task] ?? completed}
                          isEditing={isEditing}
                          onDraftChange={(recordId, changedTask, nextValue) => {
                            const savedRecord = session.records.find(({ id }) => id === recordId);
                            if (!savedRecord) return;
                            const isReverted = savedRecord[changedTask] === nextValue;
                            setTaskDrafts((current) => {
                              const recordTasks = { ...(current[recordId] ?? {}) };
                              if (isReverted) delete recordTasks[changedTask];
                              else recordTasks[changedTask] = nextValue;
                              if (Object.keys(recordTasks).length === 0) {
                                const { [recordId]: _discarded, ...remaining } = current;
                                return remaining;
                              }
                              return { ...current, [recordId]: recordTasks };
                            });
                          }}
                        />
                      </td>
                    ))}
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
    attendanceSummary,
    unassignedAttendanceSummary,
    teachers,
    selectedTeacherId,
    classes,
    activeClasses,
    sessions,
    selectedSession,
    classAttendanceSummary,
    filters,
    totalSessions,
    filterError,
    today,
  } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState("");
  const selectedClass = classes.find((classroom) => classroom.id === filters.classId) ?? null;
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId) ?? null;
  const teacherClasses = classes.filter((classroom) => (
    selectedTeacherId === "unassigned"
      ? classroom.teacherId === null
      : classroom.teacherId === selectedTeacherId
  ));
  const activeTeacherClasses = teacherClasses.filter((classroom) => !classroom.isCompleted);
  const visibleClasses = selectedClass ? [selectedClass] : teacherClasses;
  const isTeacherOverview = !selectedTeacherId || (!selectedTeacher && selectedTeacherId !== "unassigned");
  const navigate = useNavigate();
  const getAttendanceHref = useCallback((next: Partial<{
    teacherId: string;
    classId: string;
    sessionId: string;
    date: string;
    overviewStatus: AttendanceOverviewStatus;
    tab: "sessions" | "total";
  }> = {}) => {
    const params = new URLSearchParams();
    const teacherId = next.teacherId ?? filters.teacherId;
    const classId = next.classId ?? "";
    const sessionId = next.sessionId ?? "";
    const date = next.date ?? filters.date;
    const overviewStatus = next.overviewStatus ?? filters.overviewStatus;
    const tab = next.tab ?? "sessions";
    if (teacherId) params.set("teacherId", teacherId);
    if (classId) params.set("classId", classId);
    if (sessionId) params.set("sessionId", sessionId);
    params.set("date", date);
    if (overviewStatus !== "ALL") params.set("view", overviewStatus);
    if (tab === "total") params.set("tab", tab);
    return `/admin/attendance?${params.toString()}`;
  }, [filters.date, filters.overviewStatus, filters.teacherId]);

  useEffect(() => {
    const result = createFetcher.data;
    if (
      createFetcher.state === "idle"
      && result?.success
      && result.intent === "create-session"
      && "classId" in result
      && "teacherId" in result
      && "sessionId" in result
      && "date" in result
      && typeof result.classId === "string"
      && typeof result.teacherId === "string"
      && typeof result.sessionId === "string"
      && typeof result.date === "string"
    ) {
      setShowCreateForm(false);
      if (filters.sessionId !== result.sessionId) {
        navigate(getAttendanceHref({
          teacherId: result.teacherId,
          classId: result.classId,
          sessionId: result.sessionId,
          date: result.date,
        }));
      }
    }
  }, [createFetcher.data, createFetcher.state, filters.sessionId, getAttendanceHref, navigate]);

  const matchesOverviewStatus = (
    sessionCount: number,
    completedSessionCount: number,
    emptySessionCount: number,
  ) => {
    if (filters.overviewStatus === "NO_SESSION") return sessionCount === 0;
    if (filters.overviewStatus === "NO_STUDENTS") return emptySessionCount > 0;
    if (filters.overviewStatus === "NEEDS_ATTENTION") {
      return sessionCount > 0 && completedSessionCount + emptySessionCount < sessionCount;
    }
    if (filters.overviewStatus === "COMPLETE") {
      return sessionCount > 0 && completedSessionCount === sessionCount;
    }
    return true;
  };
  const visibleTeachers = teachers
    .filter((teacher) =>
      normalizeSearchText(teacher.name).includes(normalizeSearchText(teacherSearch))
      && matchesOverviewStatus(
        teacher.dailySessionCount,
        teacher.dailyCompletedSessionCount,
        teacher.dailyEmptySessionCount,
      ),
    )
    .sort((left, right) =>
      right.activeClassCount - left.activeClassCount
      || left.name.localeCompare(right.name, "vi"),
    );
  const filteredVisibleClasses = visibleClasses.filter((classroom) => {
    if (classroom.isCompleted) return false;
    const classSessions = sessions.filter((session) => session.classId === classroom.id);
    if (filters.overviewStatus === "NO_SESSION") return classSessions.length === 0;
    if (filters.overviewStatus === "NEEDS_ATTENTION") {
      return classSessions.some((session) => session.recordCount > 0 && session.unmarked > 0);
    }
    if (filters.overviewStatus === "COMPLETE") {
      return classSessions.length > 0 && classSessions.every((session) => (
        session.recordCount > 0 && session.unmarked === 0
      ));
    }
    if (filters.overviewStatus === "NO_STUDENTS") {
      return classSessions.some((session) => session.recordCount === 0);
    }
    return true;
  });
  const unassignedClasses = classes.filter((classroom) => classroom.teacherId === null);
  const activeUnassignedClasses = unassignedClasses.filter((classroom) => !classroom.isCompleted);
  const showUnassignedClasses = activeUnassignedClasses.length > 0
    && matchesOverviewStatus(
      unassignedAttendanceSummary.sessionCount,
      unassignedAttendanceSummary.completedSessionCount,
      unassignedAttendanceSummary.emptySessionCount,
    )
    && (!teacherSearch.trim()
      || normalizeSearchText("Chưa phân công giáo viên").includes(normalizeSearchText(teacherSearch)));
  const activeClassCount = classes.filter((classroom) => !classroom.isCompleted).length;
  const markedRecordCount = attendanceSummary.present + attendanceSummary.late + attendanceSummary.absent;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Điểm danh</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Theo dõi điểm danh theo ngày, xem tình hình từng giáo viên và xử lý các buổi còn thiếu.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="attendance-dashboard-date">Ngày điểm danh</Label>
              <Input
                id="attendance-dashboard-date"
                type="date"
                value={filters.date}
                onChange={(event) => {
                  const nextDate = event.currentTarget.value;
                  if (parseAttendanceDate(nextDate)) {
                    navigate(getAttendanceHref({ date: nextDate, classId: "", sessionId: "" }));
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(getAttendanceHref({ date: today, classId: "", sessionId: "" }))}
              disabled={filters.date === today}
            >
              Hôm nay
            </Button>
            <Button
              type="button"
              onClick={() => setShowCreateForm((open) => !open)}
              disabled={activeClasses.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Tạo buổi điểm danh
            </Button>
          </div>
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
                    <Input id="new-session-date" name="date" type="date" defaultValue={filters.date} required />
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

        <section aria-label={`Tổng quan điểm danh ngày ${formatAttendanceDate(filters.date)}`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              Tổng quan · {selectedTeacher?.name ?? (selectedTeacherId === "unassigned" ? "Chưa phân công" : "Toàn bộ giáo viên")}
            </h2>
            <span className="text-sm text-muted-foreground">{formatAttendanceDate(filters.date)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Buổi có điểm danh
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{attendanceSummary.sessionCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tại {attendanceSummary.classCount} lớp
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden="true" />
                Lượt học viên
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{attendanceSummary.recordCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {markedRecordCount} đã ghi nhận · {attendanceSummary.unmarked} chưa điểm danh
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                Tỷ lệ có mặt
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {markedRecordCount > 0 ? `${attendanceSummary.attendanceRate}%` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {attendanceSummary.present} có mặt trên {markedRecordCount} lượt đã ghi nhận
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4 text-warning" aria-hidden="true" />
                Cần theo dõi
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {attendanceSummary.late + attendanceSummary.absent}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {attendanceSummary.late} đi muộn · {attendanceSummary.absent} vắng · {attendanceSummary.sessionsNeedingAttention} buổi chưa đủ
              </p>
            </div>
          </div>
        </section>

        {filterError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {filterError}
          </p>
        )}

        {isTeacherOverview ? (
          <section aria-labelledby="attendance-teachers-heading" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="attendance-teachers-heading" className="text-lg font-semibold">Toàn bộ giáo viên</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {visibleTeachers.length} / {teachers.length} giáo viên · {activeClassCount} lớp đang hoạt động
                </p>
              </div>
              <div className="grid w-full gap-3 sm:max-w-xl sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    aria-label="Tìm giáo viên"
                    placeholder="Tìm tên giáo viên..."
                    value={teacherSearch}
                    onChange={(event) => setTeacherSearch(event.currentTarget.value)}
                    className="pl-9"
                  />
                </div>
                <div className="space-y-1.5 sm:w-52">
                  <Label htmlFor="attendance-overview-status">Tình trạng điểm danh</Label>
                  <select
                    id="attendance-overview-status"
                    className={SELECT_CLASS}
                    value={filters.overviewStatus}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (isAttendanceOverviewStatus(value)) {
                        navigate(getAttendanceHref({ overviewStatus: value, sessionId: "" }));
                      }
                    }}
                  >
                    <option value="ALL">Tất cả tình trạng</option>
                    <option value="NEEDS_ATTENTION">Còn lượt chưa ghi nhận</option>
                    <option value="COMPLETE">Đã ghi nhận đầy đủ</option>
                    <option value="NO_SESSION">Chưa có buổi trong ngày</option>
                    <option value="NO_STUDENTS">Buổi chưa có học viên</option>
                  </select>
                </div>
              </div>
            </div>

            {visibleTeachers.length > 0 || showUnassignedClasses ? (
              <div className="overflow-hidden rounded-xl border bg-card">
                {visibleTeachers.map((teacher) => (
                  <div key={teacher.id} className="border-b last:border-b-0">
                  <Link
                    to={getAttendanceHref({ teacherId: teacher.id })}
                    className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {teacher.name}
                        {!teacher.isActive && <Badge variant="outline">Đã tạm khóa</Badge>}
                        {teacher.isActive && !teacher.isActivated && <Badge variant="outline">Chưa kích hoạt</Badge>}
                        {teacher.isDeleted && <Badge variant="outline">Đã xóa</Badge>}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {teacher.activeClassCount} lớp đang hoạt động · {teacher.dailySessionCount} buổi ngày {formatAttendanceDate(filters.date)}
                      </span>
                      {teacher.dailySessionCount > 0 && (
                        <span className="mt-2 block max-w-sm">
                          <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>
                              {teacher.dailyCompletedSessionCount}/{teacher.dailySessionCount} buổi đủ lượt
                              {teacher.dailyUnmarked > 0 ? ` · ${teacher.dailyUnmarked} chưa ghi nhận` : ""}
                              {teacher.dailyEmptySessionCount > 0 ? ` · ${teacher.dailyEmptySessionCount} buổi chưa có học viên` : ""}
                            </span>
                            <span className="tabular-nums">
                              {teacher.dailyAttendanceRate === null ? "—" : `${teacher.dailyAttendanceRate}% có mặt`}
                            </span>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-success transition-[width]"
                              style={{ width: `${teacher.dailyAttendanceRate ?? 0}%` }}
                            />
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-3 text-sm text-muted-foreground sm:justify-end">
                      <span>{teacher.sessionCount} buổi tổng cộng</span>
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </span>
                  </Link>
                  {teacher.consecutiveAbsenceClasses.length > 0 && (
                    <div className="px-4 pb-4 sm:px-5">
                      <ConsecutiveAbsenceNotice
                        alerts={teacher.consecutiveAbsenceClasses.flatMap(({ alerts }) => alerts)}
                      />
                    </div>
                  )}
                  </div>
                ))}
                {showUnassignedClasses && (
                  <div>
                  <Link
                    to={getAttendanceHref({ teacherId: "unassigned" })}
                    className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">Chưa phân công giáo viên</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {activeUnassignedClasses.length} lớp đang hoạt động · {unassignedAttendanceSummary.sessionCount} buổi ngày {formatAttendanceDate(filters.date)}
                      </span>
                      {unassignedAttendanceSummary.sessionCount > 0 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {unassignedAttendanceSummary.completedSessionCount}/{unassignedAttendanceSummary.sessionCount} buổi đủ lượt
                          {" · "}{unassignedAttendanceSummary.attendanceRate === null
                            ? "Chưa có lượt đã ghi nhận"
                            : `${unassignedAttendanceSummary.attendanceRate}% có mặt`}
                          {unassignedAttendanceSummary.emptySessionCount > 0
                            ? ` · ${unassignedAttendanceSummary.emptySessionCount} buổi chưa có học viên`
                            : ""}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-4 text-sm text-muted-foreground sm:justify-end">
                      <span>{unassignedClasses.reduce((total, classroom) => total + classroom.sessionCount, 0)} buổi điểm danh</span>
                      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </span>
                  </Link>
                  {unassignedAttendanceSummary.consecutiveAbsenceClasses.length > 0 && (
                    <div className="px-4 pb-4 sm:px-5">
                      <ConsecutiveAbsenceNotice
                        alerts={unassignedAttendanceSummary.consecutiveAbsenceClasses.flatMap(({ alerts }) => alerts)}
                      />
                    </div>
                  )}
                  </div>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="px-5 py-10 text-center">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">Không có giáo viên khớp bộ lọc</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Thử đổi tên tìm kiếm hoặc tình trạng điểm danh.</p>
                </CardContent>
              </Card>
            )}
          </section>
        ) : (
          <section aria-labelledby="attendance-teacher-heading" className="space-y-4">
            <div className="space-y-3">
              <Button variant="ghost" size="sm" asChild className="-ml-2">
                <Link to={getAttendanceHref({ teacherId: "", classId: "", sessionId: "" })}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Tất cả giáo viên
                </Link>
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="attendance-teacher-heading" className="text-xl font-semibold">
                    {selectedTeacher?.name ?? "Chưa phân công giáo viên"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeTeacherClasses.length} lớp đang hoạt động · {sessions.length} buổi ngày {formatAttendanceDate(filters.date)}
                  </p>
                </div>
                {selectedTeacher && (!selectedTeacher.isActive || !selectedTeacher.isActivated || selectedTeacher.isDeleted) && (
                  <div className="flex flex-wrap gap-2">
                    {!selectedTeacher.isActive && <Badge variant="outline">Đã tạm khóa</Badge>}
                    {selectedTeacher.isActive && !selectedTeacher.isActivated && <Badge variant="outline">Chưa kích hoạt</Badge>}
                    {selectedTeacher.isDeleted && <Badge variant="outline">Đã xóa</Badge>}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {activeTeacherClasses.length > 1 && (
                <div className="w-full sm:max-w-xs">
                  <SearchableClassSelect
                    classes={activeTeacherClasses}
                    selectedClassId={filters.classId}
                    onSelect={(classId) => navigate(getAttendanceHref({ classId }))}
                  />
                </div>
              )}
              {selectedClass && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={getAttendanceHref({ classId: "", sessionId: "" })}>
                    Tất cả lớp
                  </Link>
                </Button>
              )}
              <div className="space-y-1.5 sm:w-56">
                <Label htmlFor="attendance-detail-overview-status">Lọc theo tình trạng</Label>
                <select
                  id="attendance-detail-overview-status"
                  className={SELECT_CLASS}
                  value={filters.overviewStatus}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isAttendanceOverviewStatus(value)) {
                      navigate(getAttendanceHref({ overviewStatus: value, sessionId: "" }));
                    }
                  }}
                >
                  <option value="ALL">Tất cả tình trạng</option>
                  <option value="NEEDS_ATTENTION">Còn lượt chưa ghi nhận</option>
                  <option value="COMPLETE">Đã ghi nhận đầy đủ</option>
                  <option value="NO_SESSION">Chưa có buổi trong ngày</option>
                  <option value="NO_STUDENTS">Buổi chưa có học viên</option>
                </select>
              </div>
            </div>

            {filteredVisibleClasses.length === 0 ? (
              <Card>
                <CardContent className="px-5 py-10 text-center">
                  <p className="font-medium">
                    {selectedClass?.isCompleted
                      ? "Lớp này đã kết thúc"
                      : activeTeacherClasses.length === 0
                        ? teacherClasses.length === 0
                          ? "Giáo viên này chưa có lớp"
                          : "Không có lớp đang hoạt động"
                        : "Không có lớp khớp tình trạng"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedClass?.isCompleted
                      ? "Lớp kết thúc được ẩn khỏi danh sách; lịch sử đã lưu vẫn có thể xem ở bên dưới."
                      : activeTeacherClasses.length === 0 && teacherClasses.length === 0
                        ? "Các lớp được phân công sẽ xuất hiện tại đây."
                        : activeTeacherClasses.length === 0
                          ? "Các lớp đã kết thúc được ẩn khỏi danh sách điểm danh."
                          : "Thử đổi bộ lọc tình trạng hoặc ngày điểm danh."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredVisibleClasses.map((classroom) => {
                  const classSessions = sessions.filter((session) => session.classId === classroom.id);
                  return (
                    <Card key={classroom.id} className="overflow-hidden">
                      <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{classroom.name}</h3>
                            {classroom.isCompleted && <Badge variant="outline">Đã kết thúc</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{classroom.course}</p>
                        </div>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {classSessions.length} buổi trong ngày
                        </span>
                      </div>
                      {classroom.consecutiveAbsentStudentNames.length > 0 && (
                        <div className="border-b px-4 py-3 sm:px-5">
                          <ConsecutiveAbsenceNotice alerts={classroom.consecutiveAbsenceAlerts} />
                        </div>
                      )}
                      <div
                        role="tablist"
                        aria-label={`Nội dung điểm danh lớp ${classroom.name}`}
                        className="flex flex-wrap items-center gap-2 bg-muted/20 p-3 sm:p-4"
                      >
                        <Link
                          to={getAttendanceHref({ classId: classroom.id, sessionId: "", tab: "total" })}
                          role="tab"
                          aria-selected={filters.classId === classroom.id && filters.tab === "total"}
                          className={`inline-flex h-10 shrink-0 items-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            filters.classId === classroom.id && filters.tab === "total"
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-background text-foreground hover:bg-muted"
                          }`}
                        >
                          Tổng
                        </Link>
                        {classSessions.map((session) => (
                          <AttendanceSessionTab
                            key={session.id}
                            session={session}
                            classId={classroom.id}
                            teacherId={selectedTeacherId}
                            date={filters.date}
                            isSelected={session.id === filters.sessionId}
                          />
                        ))}
                      </div>
                      {classSessions.length === 0 && (
                        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
                          {classroom.isCompleted
                            ? `Lớp đã kết thúc và chưa có buổi điểm danh ngày ${formatAttendanceDate(filters.date)}.`
                            : `Chưa có buổi điểm danh cho ngày ${formatAttendanceDate(filters.date)}.`}
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {filters.tab === "total" && selectedClass && classAttendanceSummary ? (
              <AttendanceClassTotalSummary
                key={selectedClass.id}
                classId={selectedClass.id}
                className={selectedClass.name}
                summary={classAttendanceSummary}
              />
            ) : selectedSession ? (
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
                Buổi này không thuộc giáo viên hoặc lớp đã chọn, hoặc không còn tồn tại. Hãy chọn lại một buổi.
              </p>
            ) : totalSessions > 0 ? (
              <p className="text-sm text-muted-foreground">
                Chọn một buổi trong lớp để mở bảng điểm danh.
              </p>
            ) : null}
          </section>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          Lớp đã kết thúc vẫn xem và chỉnh sửa lịch sử được; không thể tạo buổi mới cho lớp đã kết thúc.
        </p>
      </div>
    </AppShell>
  );
}
