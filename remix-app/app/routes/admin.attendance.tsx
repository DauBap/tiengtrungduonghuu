import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import type { Prisma } from "@prisma/client";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Plus,
  Search,
  Trash2,
  Users,
  ArrowLeft,
  ArrowRight,
  X,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { useModalScrollLock } from "~/components/common/use-modal-scroll-lock";
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
import {
  addDaysToDateString,
  getScheduledSlotsForDate,
  getVietnameseDateString,
} from "~/lib/schedule-utils";
import {
  getClassSessionOrderSnapshot,
  renumberClassAttendanceSessions,
} from "~/lib/attendance-session-order.server";
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

function getMinimumMakeupDate(today: string, leaveDate?: string) {
  const tomorrow = addDaysToDateString(today, 1) ?? today;
  const dayAfterLeave = leaveDate ? addDaysToDateString(leaveDate, 1) : null;
  return dayAfterLeave && dayAfterLeave > tomorrow ? dayAfterLeave : tomorrow;
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

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const attendanceThroughDate = parseAttendanceDate(getVietnameseDateString())!;
  const url = new URL(request.url);
  const params = url.searchParams;
  const requestedTeacherId = params.get("teacherId") ?? "";
  const requestedClassId = params.get("classId") ?? "";
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
  if (isTotalTab && !requestedClassId) {
    filterError = "Hãy chọn một lớp để xem tổng hợp điểm danh.";
    invalidFilter = true;
  }
  if (!isAttendanceOverviewStatus(rawOverviewStatus)) {
    filterError = "Trạng thái tổng quan không hợp lệ. Hãy chọn lại bộ lọc.";
    invalidFilter = true;
  }

  const [teachers, classes, makeupLeaveRequests] = await Promise.all([
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
        _count: {
          select: {
            attendanceSessions: { where: { date: { lte: attendanceThroughDate } } },
          },
        },
        attendanceSessions: {
          where: { date: { lte: attendanceThroughDate } },
          orderBy: [{ date: "desc" }, { scheduleStartTime: "desc" }, { createdAt: "desc" }],
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
    prisma.teacherLeaveRequest.findMany({
      where: {
        status: "APPROVED",
        makeupSession: null,
        classroom: { is: { completedAt: null } },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        classroom: {
          select: {
            id: true,
            name: true,
            teacher: { select: { name: true } },
          },
        },
      },
    }),
  ]);
  const availableMakeupLeaveRequests = makeupLeaveRequests.map((leaveRequest) => ({
    id: leaveRequest.id,
    date: leaveRequest.date.toISOString().slice(0, 10),
    startTime: leaveRequest.startTime,
    endTime: leaveRequest.endTime,
    classId: leaveRequest.classroom.id,
    className: leaveRequest.classroom.name,
    teacher: leaveRequest.classroom.teacher?.name ?? "Chưa phân công",
  }));

  const belongsToRequestedTeacher = (classroom: typeof classes[number]) =>
    requestedTeacherId === "unassigned"
      ? classroom.teacherId === null
      : classroom.teacherId === requestedTeacherId;
  const defaultClass = requestedTeacherId
    ? classes.find((classroom) => !classroom.completedAt && belongsToRequestedTeacher(classroom))
      ?? classes.find(belongsToRequestedTeacher)
    : classes.find((classroom) => !classroom.completedAt) ?? classes[0];
  const classId = requestedClassId || defaultClass?.id || "";
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
    selectedClass
    && !invalidFilter
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
        orderBy: [{ date: "desc" }, { scheduleStartTime: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          classId: true,
          title: true,
          lesson: true,
          date: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
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

  const classSessionHistoryRaw = selectedClass && !invalidFilter
    ? await prisma.attendanceSession.findMany({
        where: { classId: selectedClass.id },
        orderBy: [{ date: "desc" }, { scheduleStartTime: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          lesson: true,
          date: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
          _count: { select: { records: true } },
        },
      })
    : [];
  const classSessionStats = classSessionHistoryRaw.length > 0
    ? await prisma.attendanceRecord.groupBy({
        by: ["sessionId", "status"],
        where: { sessionId: { in: classSessionHistoryRaw.map(({ id }) => id) } },
        _count: { _all: true },
      })
    : [];
  const classStatsBySessionId = new Map<string, {
    present: number;
    late: number;
    absent: number;
    unmarked: number;
  }>();
  for (const { sessionId, status: recordStatus, _count } of classSessionStats) {
    const stats = classStatsBySessionId.get(sessionId) ?? { present: 0, late: 0, absent: 0, unmarked: 0 };
    if (recordStatus === "PRESENT") stats.present += _count._all;
    else if (recordStatus === "LATE") stats.late += _count._all;
    else if (recordStatus === "ABSENT") stats.absent += _count._all;
    else stats.unmarked += _count._all;
    classStatsBySessionId.set(sessionId, stats);
  }
  const classSessionHistory = classSessionHistoryRaw.map((session) => ({
    id: session.id,
    title: session.title,
    lesson: session.lesson,
    date: session.date.toISOString().slice(0, 10),
    scheduleStartTime: session.scheduleStartTime,
    scheduleEndTime: session.scheduleEndTime,
    recordCount: session._count.records,
    ...(classStatsBySessionId.get(session.id) ?? { present: 0, late: 0, absent: 0, unmarked: 0 }),
  }));

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
          scheduleStartTime: true,
          scheduleEndTime: true,
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
            { date: selectedSession.date, scheduleStartTime: { lt: selectedSession.scheduleStartTime ?? "" } },
            {
              date: selectedSession.date,
              scheduleStartTime: selectedSession.scheduleStartTime,
              createdAt: { lte: selectedSession.createdAt },
            },
          ],
        },
        orderBy: [{ date: "desc" }, { scheduleStartTime: "desc" }, { createdAt: "desc" }],
        take: 3,
        select: {
          id: true,
          title: true,
          date: true,
          scheduleStartTime: true,
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
            orderBy: [{ date: "desc" }, { scheduleStartTime: "desc" }, { createdAt: "desc" }],
            take: 3,
            select: {
              id: true,
              title: true,
              date: true,
              scheduleStartTime: true,
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
    makeupLeaveRequests: availableMakeupLeaveRequests,
    sessions: sessions.map((session) => ({
      id: session.id,
      classId: session.classId,
      className: session.class.name,
      title: session.title,
      lesson: session.lesson,
      date: session.date.toISOString().slice(0, 10),
      scheduleStartTime: session.scheduleStartTime,
      scheduleEndTime: session.scheduleEndTime,
      recordCount: session._count.records,
      ...(statsBySessionId.get(session.id) ?? { present: 0, late: 0, absent: 0, unmarked: 0 }),
    })),
    classSessionHistory,
    selectedSession: selectedSession
      ? {
          id: selectedSession.id,
          classId: selectedSession.classId,
          title: selectedSession.title,
          lesson: selectedSession.lesson,
          date: selectedSession.date.toISOString().slice(0, 10),
          scheduleStartTime: selectedSession.scheduleStartTime,
          scheduleEndTime: selectedSession.scheduleEndTime,
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
    const existingSession = await prisma.attendanceSession.findFirst({
      where: { classId, date, scheduleStartTime: null, scheduleEndTime: null },
      select: { id: true },
    });
    if (existingSession) {
      return {
        success: false as const,
        intent,
        error: "Ngày này đã có buổi học. Hãy chỉnh sửa buổi hiện có để tránh tạo trùng.",
      };
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

  if (intent === "create-makeup-session") {
    const leaveRequestId = String(form.get("leaveRequestId") ?? "");
    const dateValue = String(form.get("date") ?? "");
    const date = parseAttendanceDate(dateValue);
    const lesson = String(form.get("lesson") ?? "").trim();
    const rawRecordingUrl = String(form.get("recordingUrl") ?? "").trim();
    const firstAllowedDate = addDaysToDateString(getVietnameseDateString(), 1);
    if (!leaveRequestId) {
      return { success: false as const, intent, error: "Chọn buổi nghỉ cần học bù." };
    }
    if (!date || !firstAllowedDate || dateValue < firstAllowedDate) {
      return { success: false as const, intent, error: "Chọn ngày học bù từ ngày mai trở đi." };
    }
    if (lesson.length > 120) {
      return { success: false as const, intent, error: "Tên bài học không được vượt quá 120 ký tự." };
    }
    let recordingUrl: string | null = null;
    if (rawRecordingUrl) {
      try {
        const parsedUrl = new URL(rawRecordingUrl);
        if (
          (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")
          || rawRecordingUrl.length > 2048
        ) {
          return {
            success: false as const,
            intent,
            error: "Link bản ghi cần là URL HTTP hoặc HTTPS và tối đa 2048 ký tự.",
          };
        }
        recordingUrl = parsedUrl.toString();
      } catch {
        return { success: false as const, intent, error: "Vui lòng nhập URL bản ghi hợp lệ." };
      }
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const leaveRequest = await tx.teacherLeaveRequest.findFirst({
          where: {
            id: leaveRequestId,
            status: "APPROVED",
            makeupSession: null,
            classroom: { is: { completedAt: null } },
          },
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            classId: true,
            classroom: { select: { schedule: true, teacherId: true } },
          },
        });
        if (!leaveRequest) {
          return {
            success: false as const,
            error: "Buổi nghỉ không còn khả dụng hoặc lớp đã kết thúc. Tải lại trang để chọn lại.",
          };
        }
        if (dateValue <= leaveRequest.date.toISOString().slice(0, 10)) {
          return { success: false as const, error: "Ngày học bù phải sau ngày nghỉ đã được duyệt." };
        }

        const targetSlotOverlaps = (
          startTime: string,
          endTime: string,
        ) => {
          const toMinutes = (time: string) => {
            const [hours, minutes] = time.split(":").map(Number);
            return hours * 60 + minutes;
          };
          return toMinutes(leaveRequest.startTime) < toMinutes(endTime)
            && toMinutes(leaveRequest.endTime) > toMinutes(startTime);
        };
        const scheduledOverlap = getScheduledSlotsForDate(leaveRequest.classroom.schedule, dateValue)
          .some(({ startTime, endTime }) => targetSlotOverlaps(startTime, endTime));
        if (scheduledOverlap) {
          return {
            success: false as const,
            error: "Ngày đã chọn trùng ca học theo lịch của lớp. Hãy chọn ngày khác.",
          };
        }

        const existingSessions = await tx.attendanceSession.findMany({
          where: { classId: leaveRequest.classId, date },
          select: { scheduleStartTime: true, scheduleEndTime: true },
        });
        const sessionOverlap = existingSessions.some((session) =>
          session.scheduleStartTime === null
          || session.scheduleEndTime === null
          || targetSlotOverlaps(session.scheduleStartTime, session.scheduleEndTime),
        );
        if (sessionOverlap) {
          return {
            success: false as const,
            error: "Ngày đã chọn trùng buổi học khác của lớp. Hãy chọn ngày khác.",
          };
        }

        const previousOrder = await getClassSessionOrderSnapshot(tx, leaveRequest.classId);
        const session = await tx.attendanceSession.create({
          data: {
            classId: leaveRequest.classId,
            title: "",
            lesson,
            date,
            scheduleStartTime: leaveRequest.startTime,
            scheduleEndTime: leaveRequest.endTime,
            recordingUrl,
            makeupForLeaveRequestId: leaveRequest.id,
          },
          select: { id: true },
        });
        const enrollments = await tx.enrollment.findMany({
          where: {
            classId: leaveRequest.classId,
            user: { is: { role: "student", isActive: true, deletedAt: null } },
          },
          select: { userId: true },
        });
        if (enrollments.length > 0) {
          await tx.attendanceRecord.createMany({
            data: enrollments.map(({ userId }) => ({
              sessionId: session.id,
              studentId: userId,
              status: null,
            })),
          });
        }
        await renumberClassAttendanceSessions(tx, leaveRequest.classId, previousOrder);
        return {
          success: true as const,
          classId: leaveRequest.classId,
          teacherId: leaveRequest.classroom.teacherId ?? "unassigned",
          sessionId: session.id,
          date: dateValue,
        };
      }, { isolationLevel: "Serializable" });
      return { ...result, intent };
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error.code === "P2034" || error.code === "P2002")
      ) {
        return {
          success: false as const,
          intent,
          error: "Buổi nghỉ vừa được xếp hoặc ca học đã có buổi. Tải lại trang rồi thử lại.",
        };
      }
      throw error;
    }
  }

  if (intent === "update-session" || intent === "delete-session") {
    const sessionId = String(form.get("sessionId") ?? "");
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        classId: true,
        date: true,
        scheduleStartTime: true,
        scheduleEndTime: true,
        isScheduleGenerated: true,
      },
    });
    if (!session) {
      return { success: false as const, intent, error: "Không tìm thấy buổi điểm danh. Hãy tải lại trang." };
    }

    if (intent === "delete-session") {
      const deleted = await prisma.$transaction(async (tx) => {
        const previousOrder = await getClassSessionOrderSnapshot(tx, session.classId);
        const sessionNumber = previousOrder.sessions.findIndex(({ id }) => id === session.id) + 1;
        if (sessionNumber === 0) {
          return { success: false as const, error: "Không xác định được số buổi. Hãy tải lại trang." };
        }
        const savedReview = await tx.studentClassReview.findFirst({
          where: { classId: session.classId, sessionNumber },
          select: { id: true },
        });
        if (
          savedReview
          || previousOrder.midtermReviewSession === sessionNumber
          || previousOrder.finalReviewSession === sessionNumber
        ) {
          return { success: false as const, error: "Không thể xóa buổi đã có đánh giá hoặc đang được đặt làm mốc đánh giá." };
        }

        await tx.attendanceSession.delete({ where: { id: session.id } });
        if (session.isScheduleGenerated) {
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
        await renumberClassAttendanceSessions(tx, session.classId, previousOrder);
        return { success: true as const };
      });
      if (!deleted.success) return { success: false as const, intent, error: deleted.error };
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

    const isDateChanged = session.date.toISOString().slice(0, 10) !== date.toISOString().slice(0, 10);
    try {
      await prisma.$transaction(async (tx) => {
        const previousOrder = isDateChanged
          ? await getClassSessionOrderSnapshot(tx, session.classId)
          : null;
        if (session.isScheduleGenerated && isDateChanged) {
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
        await tx.attendanceSession.update({
          where: { id: session.id },
          data: {
            title,
            lesson,
            date,
            isScheduleGenerated: session.isScheduleGenerated && isDateChanged ? false : undefined,
          },
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
        if (previousOrder) {
          await renumberClassAttendanceSessions(tx, session.classId, previousOrder);
        }
      });
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && error.code === "P2002"
      ) {
        return { success: false as const, intent, error: "Lớp đã có buổi học trong ngày và khung giờ này. Hãy chọn ngày khác." };
      }
      throw error;
    }
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
  const sessionTitle = session.scheduleStartTime && session.scheduleEndTime
    ? `${session.title} · ${session.scheduleStartTime}–${session.scheduleEndTime}`
    : session.title;
  const label = session.lesson.trim() ? `${sessionTitle} - ${session.lesson.trim()}` : sessionTitle;
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

function LegacyAdminAttendance() {
  const {
    user,
    attendanceSummary,
    unassignedAttendanceSummary,
    teachers,
    selectedTeacherId,
    classes,
    activeClasses,
    makeupLeaveRequests,
    sessions,
    selectedSession,
    classAttendanceSummary,
    filters,
    totalSessions,
    filterError,
    today,
  } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const makeupFetcher = useFetcher<typeof action>();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showMakeupModal, setShowMakeupModal] = useState(false);
  const [makeupLeaveRequestId, setMakeupLeaveRequestId] = useState("");
  const [makeupDate, setMakeupDate] = useState(getMinimumMakeupDate(today));
  const [teacherSearch, setTeacherSearch] = useState("");
  const [attendancePage, setAttendancePage] = useState(1);
  const [teacherListFilter, setTeacherListFilter] = useState<"priority" | "absent3" | "has_today" | "all">("priority");
  const [detailOverviewStatus, setDetailOverviewStatus] = useState<AttendanceOverviewStatus>("ALL");
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
  const isTeacherDetailDrilldown = Boolean(filters.sessionId || (filters.tab === "total" && selectedClass));
  useModalScrollLock(!isTeacherOverview);
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
    if (isTeacherOverview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape"
        && document.querySelectorAll('[role="dialog"][aria-modal="true"]').length === 1
      ) {
        navigate(getAttendanceHref({ teacherId: "", classId: "", sessionId: "" }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [getAttendanceHref, isTeacherOverview, navigate]);

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

  useEffect(() => {
    const result = makeupFetcher.data;
    if (
      makeupFetcher.state === "idle"
      && result?.success
      && result.intent === "create-makeup-session"
      && "classId" in result
      && "teacherId" in result
      && "sessionId" in result
      && "date" in result
      && typeof result.classId === "string"
      && typeof result.teacherId === "string"
      && typeof result.sessionId === "string"
      && typeof result.date === "string"
    ) {
      toast.success("Đã tạo buổi học bù.");
      setShowMakeupModal(false);
      setMakeupLeaveRequestId("");
      navigate(getAttendanceHref({
        teacherId: result.teacherId,
        classId: result.classId,
        sessionId: result.sessionId,
        date: result.date,
      }));
    }
  }, [getAttendanceHref, makeupFetcher.data, makeupFetcher.state, navigate]);

  const matchesDetailOverviewStatus = (
    sessionCount: number,
    completedSessionCount: number,
    emptySessionCount: number,
  ) => {
    if (detailOverviewStatus === "NO_SESSION") return sessionCount === 0;
    if (detailOverviewStatus === "NO_STUDENTS") return emptySessionCount > 0;
    if (detailOverviewStatus === "NEEDS_ATTENTION") {
      return sessionCount > 0 && completedSessionCount + emptySessionCount < sessionCount;
    }
    if (detailOverviewStatus === "COMPLETE") {
      return sessionCount > 0 && completedSessionCount === sessionCount;
    }
    return true;
  };
  const activeClassIds = new Set(classes.filter((classroom) => !classroom.isCompleted).map(({ id }) => id));
  const teachersWithActiveAlerts = teachers.filter((teacher) =>
    teacher.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId)),
  );
  const teachersWithSessions = teachers.filter((teacher) => teacher.dailySessionCount > 0);
  const teachersNeedingPriority = teachers.filter((teacher) =>
    teacher.dailySessionCount > 0
    || teacher.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId)),
  );
  const activeUnassignedAlerts = unassignedAttendanceSummary.consecutiveAbsenceClasses
    .filter(({ classId }) => activeClassIds.has(classId));
  const detailAbsenceAlerts = selectedTeacher
    ? selectedTeacher.consecutiveAbsenceClasses
      .filter(({ classId }) => activeClassIds.has(classId))
      .flatMap(({ alerts }) => alerts)
    : selectedTeacherId === "unassigned"
      ? activeUnassignedAlerts.flatMap(({ alerts }) => alerts)
      : [];
  const detailAbsenceStudentCount = new Set(detailAbsenceAlerts.map(({ studentId }) => studentId)).size;
  const activeAlertStudentCount = new Set([
    ...teachersWithActiveAlerts.flatMap((teacher) => teacher.consecutiveAbsenceClasses)
      .filter(({ classId }) => activeClassIds.has(classId))
      .flatMap(({ studentNames }) => studentNames),
    ...activeUnassignedAlerts.flatMap(({ studentNames }) => studentNames),
  ]).size;
  const visibleTeachers = teachers
    .filter((teacher) => {
      const hasAlert = teacher.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId));
      if (teacherListFilter === "absent3") return hasAlert;
      if (teacherListFilter === "has_today") return teacher.dailySessionCount > 0;
      if (teacherListFilter === "priority") return teacher.dailySessionCount > 0 || hasAlert;
      return true;
    })
    .filter((teacher) =>
      normalizeSearchText(teacher.name).includes(normalizeSearchText(teacherSearch))
    )
    .sort((left, right) =>
      Number(right.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId)))
        - Number(left.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId)))
      || right.activeClassCount - left.activeClassCount
      || left.name.localeCompare(right.name, "vi"),
    );
  const filteredVisibleClasses = visibleClasses.filter((classroom) => {
    if (classroom.isCompleted) return false;
    const classSessions = sessions.filter((session) => session.classId === classroom.id);
    if (detailOverviewStatus === "NO_SESSION") return classSessions.length === 0;
    if (detailOverviewStatus === "NEEDS_ATTENTION") {
      return classSessions.some((session) => session.recordCount > 0 && session.unmarked > 0);
    }
    if (detailOverviewStatus === "COMPLETE") {
      return classSessions.length > 0 && classSessions.every((session) => (
        session.recordCount > 0 && session.unmarked === 0
      ));
    }
    if (detailOverviewStatus === "NO_STUDENTS") {
      return classSessions.some((session) => session.recordCount === 0);
    }
    return true;
  });
  const unassignedClasses = classes.filter((classroom) => classroom.teacherId === null);
  const activeUnassignedClasses = unassignedClasses.filter((classroom) => !classroom.isCompleted);
  const showUnassignedClasses = activeUnassignedClasses.length > 0
    && (
      teacherListFilter === "all"
      || (teacherListFilter === "priority"
        && (unassignedAttendanceSummary.sessionCount > 0 || activeUnassignedAlerts.length > 0))
      || (teacherListFilter === "has_today" && unassignedAttendanceSummary.sessionCount > 0)
      || (teacherListFilter === "absent3" && activeUnassignedAlerts.length > 0)
    )
    && (!teacherSearch.trim()
      || normalizeSearchText("Chưa phân công giáo viên").includes(normalizeSearchText(teacherSearch)));
  const attendanceOverviewRows = [
    ...visibleTeachers.map((teacher) => ({ kind: "teacher" as const, teacher })),
    ...(showUnassignedClasses ? [{ kind: "unassigned" as const }] : []),
  ];
  const attendancePageCount = Math.max(1, Math.ceil(attendanceOverviewRows.length / 10));
  const currentAttendancePage = Math.min(attendancePage, attendancePageCount);
  const attendancePageRows = attendanceOverviewRows.slice(
    (currentAttendancePage - 1) * 10,
    currentAttendancePage * 10,
  );
  const activeClassCount = classes.filter((classroom) => !classroom.isCompleted).length;
  const markedRecordCount = attendanceSummary.present + attendanceSummary.late + attendanceSummary.absent;
  const selectedMakeupLeaveRequest = makeupLeaveRequests.find(({ id }) => id === makeupLeaveRequestId);
  const minimumMakeupDate = getMinimumMakeupDate(today, selectedMakeupLeaveRequest?.date);

  useEffect(() => {
    setAttendancePage(1);
  }, [teacherSearch, teacherListFilter, filters.date]);

  useEffect(() => {
    setDetailOverviewStatus("ALL");
  }, [selectedTeacherId]);

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-[1280px] space-y-5">
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 border-b pb-3">
          <nav aria-label="Đường dẫn" className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Quản lý lớp học</span>
            <span aria-hidden="true">/</span>
            <span className="font-semibold text-foreground">Điểm danh</span>
          </nav>
          {activeAlertStudentCount > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTeacherListFilter("absent3");
                document.getElementById("attendance-teachers-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="h-9 border-destructive/20 bg-destructive/5 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              <span aria-hidden="true" className="mr-2 h-2 w-2 animate-pulse rounded-full bg-destructive" />
              {activeAlertStudentCount} học sinh vắng 3 buổi liên tiếp
            </Button>
          )}
        </div>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-foreground">Điểm danh</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Theo dõi điểm danh theo ngày, xem tình hình từng giáo viên và xử lý các buổi còn thiếu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-[38px] items-center overflow-hidden rounded-lg border border-border bg-card">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Ngày trước"
                  onClick={() => {
                    const previousDate = addDaysToDateString(filters.date, -1);
                    if (previousDate) navigate(getAttendanceHref({ date: previousDate, classId: "", sessionId: "" }));
                  }}
                  className="h-full w-9 rounded-none border-r border-border text-muted-foreground hover:bg-muted"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Label htmlFor="attendance-dashboard-date" className="sr-only">Ngày điểm danh</Label>
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
                  className="h-full w-40 rounded-none border-0 bg-transparent text-[13px] font-semibold shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Ngày sau"
                  onClick={() => {
                    const nextDate = addDaysToDateString(filters.date, 1);
                    if (nextDate) navigate(getAttendanceHref({ date: nextDate, classId: "", sessionId: "" }));
                  }}
                  className="h-full w-9 rounded-none border-l border-border text-muted-foreground hover:bg-muted"
                >
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-[38px] border-border bg-card px-3.5 text-[13px] font-medium"
                onClick={() => navigate(getAttendanceHref({ date: today, classId: "", sessionId: "" }))}
                disabled={filters.date === today}
              >
                Hôm nay
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

        {showMakeupModal && (
          <Overlay
            onClose={() => setShowMakeupModal(false)}
            closeOnEscape
            closeOnBackdrop
            className="max-w-xl"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-makeup-heading"
              className="space-y-5"
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="create-makeup-heading" className="text-lg font-semibold">Tạo buổi bù</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chọn ca nghỉ đã được duyệt và ngày học bù. Buổi bù dùng khung giờ của ca nghỉ.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng"
                  autoFocus
                  onClick={() => setShowMakeupModal(false)}
                  className="-mr-2 -mt-2 shrink-0"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>

              {makeupLeaveRequests.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Không có ca nghỉ nào đã được duyệt và chưa xếp buổi bù.
                </p>
              ) : (
                <makeupFetcher.Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="create-makeup-session" />
                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-leave-request">Học bù cho buổi</Label>
                    <select
                      id="makeup-leave-request"
                      name="leaveRequestId"
                      value={makeupLeaveRequestId}
                      required
                      disabled={makeupFetcher.state !== "idle"}
                      onChange={(event) => {
                        const nextId = event.currentTarget.value;
                        setMakeupLeaveRequestId(nextId);
                        const leaveRequest = makeupLeaveRequests.find(({ id }) => id === nextId);
                        setMakeupDate(getMinimumMakeupDate(today, leaveRequest?.date));
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="" disabled>Chọn buổi nghỉ đã duyệt</option>
                      {makeupLeaveRequests.map((leaveRequest) => (
                        <option key={leaveRequest.id} value={leaveRequest.id}>
                          {leaveRequest.className} · {formatAttendanceDate(leaveRequest.date)} · {leaveRequest.startTime}–{leaveRequest.endTime} · {leaveRequest.teacher}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedMakeupLeaveRequest && (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                      Lớp {selectedMakeupLeaveRequest.className} · ca {selectedMakeupLeaveRequest.startTime}–{selectedMakeupLeaveRequest.endTime}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-date">Ngày học</Label>
                    <Input
                      id="makeup-session-date"
                      name="date"
                      type="date"
                      min={minimumMakeupDate}
                      value={makeupDate}
                      onChange={(event) => setMakeupDate(event.currentTarget.value)}
                      required
                      disabled={makeupFetcher.state !== "idle"}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-lesson">Bài học trong buổi</Label>
                    <Input
                      id="makeup-session-lesson"
                      name="lesson"
                      maxLength={120}
                      placeholder="Tên bài hoặc nội dung học"
                      disabled={makeupFetcher.state !== "idle"}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-recording">Link ghi hình / bản ghi</Label>
                    <Input
                      id="makeup-session-recording"
                      name="recordingUrl"
                      type="url"
                      inputMode="url"
                      maxLength={2048}
                      placeholder="https://..."
                      disabled={makeupFetcher.state !== "idle"}
                    />
                  </div>

                  {makeupFetcher.data?.success === false
                    && makeupFetcher.data.intent === "create-makeup-session"
                    && (
                      <p role="alert" className="text-sm text-destructive">{makeupFetcher.data.error}</p>
                    )}
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => setShowMakeupModal(false)}>
                      Hủy
                    </Button>
                    <Button
                      type="submit"
                      disabled={!makeupLeaveRequestId || makeupFetcher.state !== "idle"}
                    >
                      {makeupFetcher.state !== "idle" ? "Đang tạo..." : "Tạo buổi bù"}
                    </Button>
                  </div>
                </makeupFetcher.Form>
              )}
            </section>
          </Overlay>
        )}

        <section aria-label={`Tổng quan điểm danh ngày ${formatAttendanceDate(filters.date)}`} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-muted-foreground">
              Tổng quan · {selectedTeacher?.name ?? (selectedTeacherId === "unassigned" ? "Chưa phân công" : "Toàn bộ giáo viên")}
            </h2>
            <span className="text-xs font-medium text-muted-foreground">{formatAttendanceDate(filters.date)}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              disabled={!isTeacherOverview}
              onClick={() => setTeacherListFilter("has_today")}
              aria-pressed={isTeacherOverview ? teacherListFilter === "has_today" : undefined}
              className={`rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border ${teacherListFilter === "has_today" ? "ring-1 ring-primary/20" : ""}`}
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Buổi có điểm danh
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{attendanceSummary.sessionCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tại {attendanceSummary.classCount} lớp
              </p>
            </button>
            <button
              type="button"
              disabled={!isTeacherOverview}
              onClick={() => setTeacherListFilter("priority")}
              aria-pressed={isTeacherOverview ? teacherListFilter === "priority" : undefined}
              className={`rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border ${teacherListFilter === "priority" ? "ring-1 ring-primary/20" : ""}`}
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden="true" />
                Lượt học viên
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{attendanceSummary.recordCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {markedRecordCount} đã ghi nhận · {attendanceSummary.unmarked} chưa điểm danh
              </p>
            </button>
            <button
              type="button"
              disabled={!isTeacherOverview}
              onClick={() => setTeacherListFilter("all")}
              aria-pressed={isTeacherOverview ? teacherListFilter === "all" : undefined}
              className={`rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border ${teacherListFilter === "all" ? "ring-1 ring-primary/20" : ""}`}
            >
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
            </button>
            <button
              type="button"
              disabled={!isTeacherOverview}
              onClick={() => setTeacherListFilter("absent3")}
              aria-pressed={isTeacherOverview ? teacherListFilter === "absent3" : undefined}
              className={`rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border ${teacherListFilter === "absent3" ? "ring-1 ring-primary/20" : ""}`}
            >
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
            </button>
          </div>
        </section>

        {filterError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {filterError}
          </p>
        )}

        <section aria-labelledby="attendance-teachers-heading" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 border-b border-border/70 pb-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 id="attendance-teachers-heading" className="text-base font-bold text-foreground">Danh sách giáo viên</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {teachers.length} giáo viên · {activeClassCount} lớp hoạt động
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ưu tiên giáo viên có cảnh báo vắng liên tiếp và có lịch dạy trong ngày.
                </p>
              </div>
              <div className="w-full sm:max-w-[270px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    aria-label="Tìm giáo viên"
                    placeholder="Tìm tên giáo viên..."
                    value={teacherSearch}
                    onChange={(event) => setTeacherSearch(event.currentTarget.value)}
                    className="h-[38px] rounded-lg pl-9 text-[13px]"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3" aria-label="Lọc giáo viên">
              {([
                { value: "priority", label: "Ưu tiên hôm nay & Cảnh báo", count: teachersNeedingPriority.length },
                { value: "absent3", label: "Vắng 3 buổi liên tiếp", count: teachersWithActiveAlerts.length },
                { value: "has_today", label: "Có buổi trong ngày", count: teachersWithSessions.length },
                { value: "all", label: "Tất cả giáo viên", count: teachers.length },
              ] as const).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={teacherListFilter === filter.value}
                  onClick={() => setTeacherListFilter(filter.value)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    teacherListFilter === filter.value
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {filter.label}
                  <span className="tabular-nums opacity-80">({filter.count})</span>
                </button>
              ))}
            </div>

            {visibleTeachers.length > 0 || showUnassignedClasses ? (
              <>
                <div className="space-y-3">
                  {attendancePageRows.map((row) => row.kind === "teacher" ? (
                    <div
                      key={row.teacher.id}
                      className={`overflow-hidden rounded-xl border bg-background transition-all hover:border-muted-foreground/30 hover:shadow-sm ${
                        row.teacher.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId))
                          ? "border-destructive/30"
                          : ""
                      }`}
                    >
                      <Link
                        to={getAttendanceHref({ teacherId: row.teacher.id })}
                        aria-label={`Mở điểm danh của ${row.teacher.name}`}
                        className="group flex flex-col gap-4 p-4 transition-colors hover:bg-muted/20 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex-row md:items-center md:justify-between"
                      >
                        <span className="min-w-0 flex-1 space-y-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-foreground transition-colors group-hover:text-primary">{row.teacher.name}</span>
                            {!row.teacher.isActive && <Badge variant="outline">Đã tạm khóa</Badge>}
                            {row.teacher.isActive && !row.teacher.isActivated && <Badge variant="outline">Chưa kích hoạt</Badge>}
                            {row.teacher.isDeleted && <Badge variant="outline">Đã xóa</Badge>}
                            {row.teacher.dailySessionCount > 0 ? (
                              <Badge variant="outline" className="border-success/30 bg-success/5 text-success">
                                {row.teacher.dailySessionCount} buổi ngày {formatAttendanceDate(filters.date)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="font-medium">Không có lịch hôm nay</Badge>
                            )}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {row.teacher.activeClassCount} lớp đang hoạt động · {row.teacher.dailyCompletedSessionCount}/{row.teacher.dailySessionCount} buổi đủ lượt
                            {row.teacher.dailyEmptySessionCount > 0 ? ` · ${row.teacher.dailyEmptySessionCount} buổi chưa có học viên` : ""}
                            {row.teacher.dailyUnmarked > 0 ? ` · ${row.teacher.dailyUnmarked} lượt chưa điểm danh` : ""}
                          </span>
                          <span className="flex max-w-md items-center gap-3">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-success transition-[width]"
                                style={{ width: `${row.teacher.dailyAttendanceRate ?? 0}%` }}
                              />
                            </span>
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">
                              {row.teacher.dailyAttendanceRate === null ? "—" : `${row.teacher.dailyAttendanceRate}% có mặt`}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center justify-between gap-3 md:justify-end">
                          <span className="text-xs font-medium text-muted-foreground">{row.teacher.sessionCount} buổi tổng cộng</span>
                          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-muted/40 px-3 text-xs font-semibold text-foreground transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                            Chi tiết
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        </span>
                      </Link>
                      {row.teacher.consecutiveAbsenceClasses.some(({ classId }) => activeClassIds.has(classId)) && (
                        <div className="border-t bg-destructive/5 px-4 py-3 sm:px-5">
                          <ConsecutiveAbsenceNotice
                            alerts={row.teacher.consecutiveAbsenceClasses
                              .filter(({ classId }) => activeClassIds.has(classId))
                              .flatMap(({ alerts }) => alerts)}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div key="unassigned" className="overflow-hidden rounded-xl border bg-background">
                      <Link
                        to={getAttendanceHref({ teacherId: "unassigned" })}
                        aria-label="Mở điểm danh các lớp chưa phân công giáo viên"
                        className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:px-5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold transition-colors group-hover:text-primary">Chưa phân công giáo viên</span>
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
                      {activeUnassignedAlerts.length > 0 && (
                        <div className="border-t bg-destructive/5 px-4 py-3 sm:px-5">
                          <ConsecutiveAbsenceNotice
                            alerts={activeUnassignedAlerts.flatMap(({ alerts }) => alerts)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {attendancePageCount > 1 && (
                  <nav aria-label="Phân trang danh sách điểm danh" className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                      Hiển thị {(currentAttendancePage - 1) * 10 + 1}–
                      {Math.min(currentAttendancePage * 10, attendanceOverviewRows.length)} / {attendanceOverviewRows.length} kết quả
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttendancePage((page) => Math.max(1, page - 1))}
                        disabled={currentAttendancePage === 1}
                      >
                        Trang trước
                      </Button>
                      <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
                        {currentAttendancePage} / {attendancePageCount}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttendancePage((page) => Math.min(attendancePageCount, page + 1))}
                        disabled={currentAttendancePage === attendancePageCount}
                      >
                        Trang sau
                      </Button>
                    </div>
                  </nav>
                )}
              </>
            ) : (
              <div className="pt-8">
                <Card>
                  <CardContent className="px-5 py-10 text-center">
                    <Users className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold">Không có giáo viên khớp bộ lọc</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Thử đổi tên tìm kiếm hoặc tình trạng điểm danh.</p>
                  </CardContent>
                </Card>
              </div>
            )}
        </section>

        {!isTeacherOverview && (
          <div className="fixed inset-0 z-50 !mt-0" role="presentation">
            <button
              type="button"
              aria-label="Đóng chi tiết giáo viên"
              className="absolute inset-0 bg-black/45"
              onClick={() => navigate(getAttendanceHref({ teacherId: "", classId: "", sessionId: "" }))}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="attendance-teacher-heading"
              className="absolute inset-y-0 right-0 flex h-dvh w-full max-w-4xl flex-col border-l bg-background shadow-2xl"
            >
              <header className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-4 sm:px-6">
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to={getAttendanceHref({
                    teacherId: isTeacherDetailDrilldown ? selectedTeacherId : "",
                    classId: "",
                    sessionId: "",
                    tab: "sessions",
                  })}>
                    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                    {isTeacherDetailDrilldown ? "Danh sách lớp" : "Tất cả giáo viên"}
                  </Link>
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 id="attendance-teacher-heading" className="truncate text-lg font-bold">
                    {selectedTeacher?.name ?? "Chưa phân công giáo viên"}
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {activeTeacherClasses.length} lớp đang hoạt động · {sessions.length} buổi ngày {formatAttendanceDate(filters.date)}
                  </p>
                </div>
                {selectedTeacher && (!selectedTeacher.isActive || !selectedTeacher.isActivated || selectedTeacher.isDeleted) && (
                  <div className="hidden shrink-0 gap-1.5 sm:flex">
                    {!selectedTeacher.isActive && <Badge variant="outline">Đã tạm khóa</Badge>}
                    {selectedTeacher.isActive && !selectedTeacher.isActivated && <Badge variant="outline">Chưa kích hoạt</Badge>}
                    {selectedTeacher.isDeleted && <Badge variant="outline">Đã xóa</Badge>}
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng chi tiết giáo viên"
                  onClick={() => navigate(getAttendanceHref({ teacherId: "", classId: "", sessionId: "" }))}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </header>
              <section className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto bg-muted/20 p-4 sm:p-6">
            <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
              <Label htmlFor="attendance-detail-date" className="text-sm font-medium">
                Ngày điểm danh
              </Label>
              <Input
                id="attendance-detail-date"
                type="date"
                value={filters.date}
                onChange={(event) => {
                  const nextDate = event.currentTarget.value;
                  if (parseAttendanceDate(nextDate)) {
                    navigate(getAttendanceHref({
                      date: nextDate,
                      classId: "",
                      sessionId: "",
                      tab: "sessions",
                    }));
                  }
                }}
                className="h-9 w-full sm:w-44"
              />
            </div>
            {!isTeacherDetailDrilldown && (
              <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-[13px] font-semibold text-foreground">
                Danh sách lớp phụ trách ({filteredVisibleClasses.length})
              </h3>
              {detailAbsenceStudentCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.querySelector<HTMLButtonElement>("[data-attendance-detail-alert] button")?.click()}
                  className="h-9 justify-start border-destructive/20 bg-destructive/5 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 sm:justify-center"
                >
                  <AlertTriangle className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  Xử lý {detailAbsenceStudentCount} học sinh vắng 3 buổi liên tiếp
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:w-64">
                <Label htmlFor="attendance-detail-overview-status">Lọc theo tình trạng</Label>
                <select
                  id="attendance-detail-overview-status"
                  className={SELECT_CLASS}
                  value={detailOverviewStatus}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isAttendanceOverviewStatus(value)) {
                      setDetailOverviewStatus(value);
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
              <div className="space-y-3.5">
                {filteredVisibleClasses.map((classroom) => {
                  const classSessions = sessions.filter((session) => session.classId === classroom.id);
                  return (
                    <Card key={classroom.id} className="space-y-3 rounded-xl border-border bg-card p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-[15px] font-bold">{classroom.name}</h4>
                            {classroom.isCompleted && <Badge variant="outline">Đã kết thúc</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{classroom.course}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {classSessions.length} buổi trong ngày
                        </span>
                      </div>
                      {classroom.consecutiveAbsentStudentNames.length > 0 && (
                        <div data-attendance-detail-alert>
                          <ConsecutiveAbsenceNotice alerts={classroom.consecutiveAbsenceAlerts} />
                        </div>
                      )}
                      <div
                        role="tablist"
                        aria-label={`Nội dung điểm danh lớp ${classroom.name}`}
                        className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2.5"
                      >
                        <Link
                          to={getAttendanceHref({ classId: classroom.id, sessionId: "", tab: "total" })}
                          role="tab"
                          aria-selected={filters.classId === classroom.id && filters.tab === "total"}
                          className={`inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            filters.classId === classroom.id && filters.tab === "total"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-muted/40 text-foreground hover:bg-muted"
                          }`}
                        >
                          <Users className="h-4 w-4" aria-hidden="true" />
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
                        <p className="text-[13px] text-muted-foreground">
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
              </>
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
                <h2 id="attendance-session-detail-heading" className="sr-only">
                  Bảng điểm danh · {selectedSession.title}
                  {selectedSession.scheduleStartTime && selectedSession.scheduleEndTime
                    ? ` · ${selectedSession.scheduleStartTime}–${selectedSession.scheduleEndTime}`
                    : ""}
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
            </aside>
          </div>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          Lớp đã kết thúc vẫn xem và chỉnh sửa lịch sử được; không thể tạo buổi mới cho lớp đã kết thúc.
        </p>
      </div>
    </AppShell>
  );
}

function AdminAttendanceDashboard() {
  const {
    user,
    teachers,
    selectedTeacherId,
    classes,
    activeClasses,
    makeupLeaveRequests,
    classSessionHistory,
    selectedSession,
    classAttendanceSummary,
    filters,
    filterError,
    today,
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const createFetcher = useFetcher<typeof action>();
  const makeupFetcher = useFetcher<typeof action>();
  const [sessionSearch, setSessionSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showMakeupModal, setShowMakeupModal] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [makeupLeaveRequestId, setMakeupLeaveRequestId] = useState("");
  const [makeupDate, setMakeupDate] = useState(getMinimumMakeupDate(today));
  const selectedClass = classes.find((classroom) => classroom.id === filters.classId) ?? null;
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId) ?? null;
  const teacherClasses = classes.filter((classroom) => (
    selectedTeacherId === "unassigned"
      ? classroom.teacherId === null
      : selectedTeacherId
        ? classroom.teacherId === selectedTeacherId
        : true
  ));
  const selectedMakeupLeaveRequest = makeupLeaveRequests.find(({ id }) => id === makeupLeaveRequestId);
  const minimumMakeupDate = getMinimumMakeupDate(today, selectedMakeupLeaveRequest?.date);

  const getDashboardHref = useCallback((next: Partial<{
    teacherId: string;
    classId: string;
    sessionId: string;
    date: string;
  }> = {}) => {
    const params = new URLSearchParams();
    const teacherId = next.teacherId ?? filters.teacherId;
    const classId = next.classId ?? filters.classId;
    const sessionId = next.sessionId ?? "";
    const date = next.date ?? filters.date;
    if (teacherId) params.set("teacherId", teacherId);
    if (classId) params.set("classId", classId);
    if (sessionId) params.set("sessionId", sessionId);
    params.set("date", date);
    return `/admin/attendance?${params.toString()}`;
  }, [filters.classId, filters.date, filters.teacherId]);

  useModalScrollLock(Boolean(selectedSession));
  useEffect(() => {
    if (!selectedSession) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") navigate(getDashboardHref({ sessionId: "" }));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [getDashboardHref, navigate, selectedSession]);

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
      navigate(getDashboardHref({
        teacherId: result.teacherId,
        classId: result.classId,
        sessionId: result.sessionId,
        date: result.date,
      }));
    }
  }, [createFetcher.data, createFetcher.state, getDashboardHref, navigate]);

  useEffect(() => {
    const result = makeupFetcher.data;
    if (
      makeupFetcher.state === "idle"
      && result?.success
      && result.intent === "create-makeup-session"
      && "classId" in result
      && "teacherId" in result
      && "sessionId" in result
      && "date" in result
      && typeof result.classId === "string"
      && typeof result.teacherId === "string"
      && typeof result.sessionId === "string"
      && typeof result.date === "string"
    ) {
      toast.success("Đã tạo buổi học bù.");
      setShowMakeupModal(false);
      setMakeupLeaveRequestId("");
      navigate(getDashboardHref({
        teacherId: result.teacherId,
        classId: result.classId,
        sessionId: result.sessionId,
        date: result.date,
      }));
    }
  }, [getDashboardHref, makeupFetcher.data, makeupFetcher.state, navigate]);

  const attendanceRateDenominator = classAttendanceSummary
    ? classAttendanceSummary.present + classAttendanceSummary.late + classAttendanceSummary.absent
    : 0;
  const attendanceRate = attendanceRateDenominator > 0 && classAttendanceSummary
    ? Math.round(((classAttendanceSummary.present + classAttendanceSummary.late) / attendanceRateDenominator) * 100)
    : null;
  const visibleSessions = classSessionHistory.filter((session) => (
    normalizeSearchText([
      session.title,
      session.lesson,
      formatAttendanceDate(session.date),
      session.scheduleStartTime ?? "",
      session.scheduleEndTime ?? "",
    ].join(" ")).includes(normalizeSearchText(sessionSearch))
  ));

  const closeSessionDetails = () => navigate(getDashboardHref({ sessionId: "" }));

  return (
    <AppShell user={user} attendanceLayout>
      <div className="min-h-screen bg-background text-foreground animate-fade-in">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-4 px-4 pr-14 sm:px-6 sm:pr-16">
            <nav aria-label="Đường dẫn" className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <span className="hidden sm:inline">Trang quản trị</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="hidden md:inline">Quản lý lớp học</span>
              <span className="hidden md:inline" aria-hidden="true">/</span>
              <span className="truncate font-semibold text-foreground">Buổi học &amp; Điểm danh lớp</span>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-foreground">Buổi học &amp; Điểm danh lớp</h1>
            <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">
              Chọn giáo viên và lớp để quản lý toàn bộ buổi học (thêm, sửa, xóa buổi) và chấm điểm danh từng buổi.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              className="h-[38px] rounded-lg bg-card px-3.5 text-[13px] font-medium"
              onClick={() => setShowSummary(true)}
              disabled={!selectedClass || !classAttendanceSummary}
            >
              <Users aria-hidden="true" className="mr-2 h-4 w-4 text-muted-foreground" />
              Tổng chuyên cần lớp
            </Button>
            {makeupLeaveRequests.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="h-[38px] rounded-lg bg-card px-3.5 text-[13px] font-medium"
                onClick={() => setShowMakeupModal(true)}
              >
                <CalendarDays aria-hidden="true" className="mr-2 h-4 w-4" />
                Tạo buổi bù
              </Button>
            )}
            <Button
              type="button"
              className="h-[38px] rounded-lg px-4 text-[13px] font-medium"
              onClick={() => setShowCreateForm(true)}
              disabled={!selectedClass || selectedClass.isCompleted}
            >
              <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
              Thêm buổi học
            </Button>
          </div>
        </header>

        <section aria-label="Chỉ số chuyên cần của lớp" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">Tổng buổi của lớp</div>
            <p className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{classSessionHistory.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">Sĩ số lớp</div>
            <p className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{classAttendanceSummary?.studentCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">Tỷ lệ chuyên cần lớp</div>
            <p className="mt-1 text-[22px] font-bold tabular-nums text-success">
              {attendanceRate === null ? "—" : `${attendanceRate}%`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById("class-attendance-alerts")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            disabled={!selectedClass?.consecutiveAbsenceAlerts.length}
            className="group rounded-xl border border-border bg-card p-4 text-left transition hover:border-destructive/40 disabled:cursor-default"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground transition group-hover:text-destructive">Vắng 3 buổi liên tiếp</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${selectedClass?.consecutiveAbsenceAlerts.length ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                {selectedClass?.consecutiveAbsenceAlerts.length ? "Cảnh báo" : "Theo dõi"}
              </span>
            </span>
            <p className={`mt-1 text-[22px] font-bold tabular-nums ${selectedClass?.consecutiveAbsenceAlerts.length ? "text-destructive" : "text-foreground"}`}>
              {selectedClass?.consecutiveAbsenceAlerts.length ?? 0}
            </p>
          </button>
        </section>

        <section aria-label="Bộ lọc giáo viên và lớp học" className="rounded-xl border border-border bg-card p-4">
          <div className="grid items-end gap-3.5 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label htmlFor="attendance-teacher-select" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                1. Chọn giáo viên
              </Label>
              <select
                id="attendance-teacher-select"
                value={selectedTeacherId}
                onChange={(event) => {
                  const teacherId = event.currentTarget.value;
                  const matchingClasses = classes.filter((classroom) => (
                    teacherId === "unassigned"
                      ? classroom.teacherId === null
                      : classroom.teacherId === teacherId
                  ));
                  const nextClass = matchingClasses.find((classroom) => !classroom.isCompleted) ?? matchingClasses[0];
                  navigate(getDashboardHref({
                    teacherId,
                    classId: nextClass?.id ?? "",
                    sessionId: "",
                  }));
                }}
                className="h-[38px] w-full rounded-lg border border-input bg-background px-3 text-[13px] font-semibold text-foreground shadow-none outline-none transition focus-visible:border-ring focus-visible:ring-0"
              >
                {!selectedTeacherId && <option value="">Tất cả giáo viên</option>}
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name} ({classes.filter((classroom) => classroom.teacherId === teacher.id).length} lớp)
                  </option>
                ))}
                {classes.some((classroom) => classroom.teacherId === null) && (
                  <option value="unassigned">
                    Chưa phân công ({classes.filter((classroom) => classroom.teacherId === null).length} lớp)
                  </option>
                )}
              </select>
            </div>

            <div className="md:col-span-5">
              <Label htmlFor="attendance-class-select" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                2. Chọn lớp thuộc giáo viên
              </Label>
              <select
                id="attendance-class-select"
                value={selectedClass?.id ?? ""}
                onChange={(event) => {
                  const classroom = classes.find(({ id }) => id === event.currentTarget.value);
                  navigate(getDashboardHref({
                    teacherId: classroom?.teacherId ?? "unassigned",
                    classId: classroom?.id ?? "",
                    sessionId: "",
                  }));
                }}
                className="h-[38px] w-full rounded-lg border border-input bg-background px-3 text-[13px] font-semibold text-foreground shadow-none outline-none transition focus-visible:border-ring focus-visible:ring-0"
                disabled={teacherClasses.length === 0}
              >
                <option value="" disabled>{teacherClasses.length ? "Chọn lớp" : "Giáo viên chưa có lớp"}</option>
                {teacherClasses.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}{classroom.isCompleted ? " · Đã kết thúc" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <Label htmlFor="attendance-session-search" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tìm kiếm buổi học
              </Label>
              <Input
                id="attendance-session-search"
                value={sessionSearch}
                maxLength={100}
                onChange={(event) => setSessionSearch(event.currentTarget.value)}
                placeholder="Tìm buổi, ngày hoặc bài..."
                className="h-[38px] rounded-lg border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"
              />
            </div>
          </div>
          {selectedClass && (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
              <p>
                <strong className="font-semibold text-foreground">{selectedClass.name}</strong>
                <span className="mx-2" aria-hidden="true">·</span>
                Trình độ: <strong className="font-medium text-foreground">{selectedClass.course}</strong>
                <span className="mx-2" aria-hidden="true">·</span>
                Giáo viên: <strong className="font-medium text-foreground">{selectedTeacher?.name ?? "Chưa phân công"}</strong>
              </p>
              <p>
                {classAttendanceSummary?.studentCount ?? 0} học viên
                <span className="mx-2" aria-hidden="true">·</span>
                {classSessionHistory.length} buổi học
                {selectedClass.isCompleted && <Badge className="ml-2" variant="outline">Đã kết thúc</Badge>}
              </p>
            </div>
          )}
        </section>

        {filterError && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {filterError}
          </p>
        )}

        {selectedClass?.consecutiveAbsenceAlerts.length ? (
          <section id="class-attendance-alerts" aria-label="Cảnh báo vắng liên tiếp">
            <ConsecutiveAbsenceNotice
              alerts={selectedClass.consecutiveAbsenceAlerts}
              dashboard
              onOpenLatestSession={(alert) => {
                const alertSessionDate = alert.sessions.find(({ id }) => id === alert.sessionId)?.date;
                navigate(getDashboardHref({
                  teacherId: selectedClass.teacherId ?? "unassigned",
                  classId: selectedClass.id,
                  sessionId: alert.sessionId,
                  date: alertSessionDate ?? filters.date,
                }));
              }}
            />
          </section>
        ) : null}

        <section aria-label="Danh sách buổi học của lớp" className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-base font-bold text-foreground">Danh sách buổi học của lớp</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Bấm "Điểm danh" trên từng buổi để chấm/sửa chuyên cần, hoặc "Sửa buổi / Xóa" để quản lý buổi học.
              </p>
            </div>
            {selectedClass && (
              <Button
                type="button"
                variant="outline"
                className="h-[34px] rounded-lg border-primary bg-card px-3 text-xs font-semibold text-primary hover:bg-primary/5"
                onClick={() => setShowCreateForm(true)}
                disabled={selectedClass.isCompleted}
              >
                + Thêm buổi học mới
              </Button>
            )}
          </div>

          {!selectedClass ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Chọn giáo viên có lớp để xem dữ liệu điểm danh.</p>
          ) : classSessionHistory.length === 0 ? (
            <div className="p-8 text-center">
              <CalendarDays aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">Lớp chưa có buổi học</p>
              <p className="mt-1 text-sm text-muted-foreground">Tạo buổi học mới để bắt đầu theo dõi điểm danh.</p>
            </div>
          ) : visibleSessions.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Không có buổi học nào khớp với từ khóa tìm kiếm.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {visibleSessions.map((session) => {
                const markedCount = session.present + session.late + session.absent;
                const statusLabel = session.recordCount === 0
                  ? "Chưa có học viên"
                  : session.unmarked === 0
                    ? "Đã ghi nhận"
                    : markedCount === 0
                      ? "Chưa điểm danh"
                      : "Còn lượt chưa chấm";
                const statusClassName = session.recordCount === 0
                  ? "border-border bg-muted/40 text-muted-foreground"
                  : session.unmarked > 0
                    ? "border-warning/30 bg-warning/10 text-warning"
                    : "border-success/30 bg-success/10 text-success";
                const detailHref = getDashboardHref({
                  teacherId: selectedClass.teacherId ?? "unassigned",
                  classId: selectedClass.id,
                  sessionId: session.id,
                  date: session.date,
                });
                return (
                  <article key={session.id} className="flex flex-col gap-4 p-4 transition-colors hover:bg-muted/20 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-foreground">{session.title}</h3>
                        <span className="text-xs font-medium text-muted-foreground">
                          • {formatAttendanceDate(session.date)}
                          {(session.scheduleStartTime || session.scheduleEndTime) && (
                            <> ({session.scheduleStartTime ?? "—"} - {session.scheduleEndTime ?? "—"})</>
                          )}
                        </span>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusClassName}`}>{statusLabel}</span>
                      </div>
                      <p className="text-[13px] font-medium text-foreground">
                        {session.lesson || "Chưa gắn bài học"}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
                        <span>Có mặt: <strong className="font-semibold text-success">{session.present}</strong></span>
                        <span>Đi muộn: <strong className="font-semibold text-warning">{session.late}</strong></span>
                        <span>Vắng: <strong className="font-semibold text-destructive">{session.absent}</strong></span>
                        {session.unmarked > 0 && (
                          <span>Chưa điểm danh: <strong className="font-semibold text-foreground">{session.unmarked}</strong></span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button asChild size="sm" className="h-8 rounded-lg px-3 text-xs font-medium">
                        <Link to={detailHref}>
                          Điểm danh
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-lg bg-card px-3 text-xs font-medium">
                        <Link to={detailHref}>Sửa buổi</Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {showCreateForm && selectedClass && (
          <Overlay onClose={() => setShowCreateForm(false)} closeOnEscape closeOnBackdrop className="max-w-[540px]">
            <section role="dialog" aria-modal="true" aria-labelledby="create-attendance-session-title" className="space-y-5">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="create-attendance-session-title" className="text-lg font-bold">Thêm buổi học mới</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Tạo buổi học cho {selectedClass.name}.</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Đóng" onClick={() => setShowCreateForm(false)}>
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
              <createFetcher.Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="create-session" />
                <input type="hidden" name="classId" value={selectedClass.id} />
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">Lớp học: </span>
                  <strong className="font-semibold">{selectedClass.name}</strong>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-session-title">Tên buổi</Label>
                  <Input id="new-session-title" name="title" maxLength={80} placeholder="Ví dụ: Buổi 5" required disabled={createFetcher.state !== "idle"} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-session-lesson">Bài học liên kết</Label>
                  <Input id="new-session-lesson" name="lesson" maxLength={120} placeholder="Tên bài hoặc nội dung học" disabled={createFetcher.state !== "idle"} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-session-date">Ngày học</Label>
                  <Input id="new-session-date" name="date" type="date" defaultValue={filters.date} required disabled={createFetcher.state !== "idle"} />
                </div>
                {createFetcher.data?.success === false && createFetcher.data.intent === "create-session" && (
                  <p role="alert" className="text-sm text-destructive">{createFetcher.data.error}</p>
                )}
                <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>Hủy</Button>
                  <Button type="submit" disabled={createFetcher.state !== "idle"}>
                    {createFetcher.state !== "idle" ? "Đang tạo..." : "Lưu buổi học"}
                  </Button>
                </div>
              </createFetcher.Form>
            </section>
          </Overlay>
        )}

        {showMakeupModal && (
          <Overlay onClose={() => setShowMakeupModal(false)} closeOnEscape closeOnBackdrop className="max-w-xl">
            <section role="dialog" aria-modal="true" aria-labelledby="create-makeup-heading" className="space-y-5">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="create-makeup-heading" className="text-lg font-semibold">Tạo buổi bù</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chọn ca nghỉ đã được duyệt và ngày học bù. Buổi bù dùng khung giờ của ca nghỉ.
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Đóng" onClick={() => setShowMakeupModal(false)}>
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
              {makeupLeaveRequests.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Không có ca nghỉ nào đã được duyệt và chưa xếp buổi bù.
                </p>
              ) : (
                <makeupFetcher.Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="create-makeup-session" />
                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-leave-request">Học bù cho buổi</Label>
                    <select
                      id="makeup-leave-request"
                      name="leaveRequestId"
                      value={makeupLeaveRequestId}
                      required
                      disabled={makeupFetcher.state !== "idle"}
                      onChange={(event) => {
                        const nextId = event.currentTarget.value;
                        setMakeupLeaveRequestId(nextId);
                        const leaveRequest = makeupLeaveRequests.find(({ id }) => id === nextId);
                        setMakeupDate(getMinimumMakeupDate(today, leaveRequest?.date));
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="" disabled>Chọn buổi nghỉ đã duyệt</option>
                      {makeupLeaveRequests.map((leaveRequest) => (
                        <option key={leaveRequest.id} value={leaveRequest.id}>
                          {leaveRequest.className} · {formatAttendanceDate(leaveRequest.date)} · {leaveRequest.startTime}–{leaveRequest.endTime} · {leaveRequest.teacher}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedMakeupLeaveRequest && (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                      Lớp {selectedMakeupLeaveRequest.className} · ca {selectedMakeupLeaveRequest.startTime}–{selectedMakeupLeaveRequest.endTime}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-date">Ngày học</Label>
                    <Input
                      id="makeup-session-date"
                      name="date"
                      type="date"
                      min={minimumMakeupDate}
                      value={makeupDate}
                      onChange={(event) => setMakeupDate(event.currentTarget.value)}
                      required
                      disabled={makeupFetcher.state !== "idle"}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-lesson">Bài học trong buổi</Label>
                    <Input id="makeup-session-lesson" name="lesson" maxLength={120} placeholder="Tên bài hoặc nội dung học" disabled={makeupFetcher.state !== "idle"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="makeup-session-recording">Link ghi hình / bản ghi</Label>
                    <Input id="makeup-session-recording" name="recordingUrl" type="url" inputMode="url" maxLength={2048} placeholder="https://..." disabled={makeupFetcher.state !== "idle"} />
                  </div>
                  {makeupFetcher.data?.success === false && makeupFetcher.data.intent === "create-makeup-session" && (
                    <p role="alert" className="text-sm text-destructive">{makeupFetcher.data.error}</p>
                  )}
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => setShowMakeupModal(false)}>Hủy</Button>
                    <Button type="submit" disabled={!makeupLeaveRequestId || makeupFetcher.state !== "idle"}>
                      {makeupFetcher.state !== "idle" ? "Đang tạo..." : "Tạo buổi bù"}
                    </Button>
                  </div>
                </makeupFetcher.Form>
              )}
            </section>
          </Overlay>
        )}

        {showSummary && selectedClass && classAttendanceSummary && (
          <Overlay onClose={() => setShowSummary(false)} closeOnEscape closeOnBackdrop className="max-w-6xl">
            <section role="dialog" aria-modal="true" aria-labelledby="attendance-summary-dialog-title">
              <header className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 id="attendance-summary-dialog-title" className="text-lg font-bold">Tổng chuyên cần lớp</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedClass.name} · {selectedClass.course}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Đóng tổng hợp chuyên cần" onClick={() => setShowSummary(false)}>
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
              <AttendanceClassTotalSummary
                key={selectedClass.id}
                classId={selectedClass.id}
                className={selectedClass.name}
                summary={classAttendanceSummary}
              />
            </section>
          </Overlay>
        )}

        {selectedSession && (
          <div className="fixed inset-0 !mt-0 z-50" role="presentation">
            <button
              type="button"
              aria-label="Đóng điểm danh buổi học"
              className="absolute inset-0 bg-black/45"
              onClick={closeSessionDetails}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="attendance-session-drawer-title"
              className="absolute inset-y-0 right-0 flex h-dvh w-full max-w-5xl flex-col border-l bg-background shadow-2xl"
            >
              <header className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-4 sm:px-6">
                <Button type="button" variant="outline" size="sm" onClick={closeSessionDetails} className="shrink-0">
                  <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
                  Danh sách buổi
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 id="attendance-session-drawer-title" className="truncate text-base font-bold">
                    {selectedSession.title} · {formatAttendanceDate(selectedSession.date)}
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedSession.classroom.name} · {selectedSession.classroom.teacher}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Đóng cửa sổ điểm danh" onClick={closeSessionDetails}>
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
              <section className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3 sm:p-5">
                <AttendanceSessionDetails
                  session={selectedSession}
                  status={filters.status}
                  query={filters.query}
                />
              </section>
            </aside>
          </div>
        )}
        </main>
      </div>
    </AppShell>
  );
}

export default function AdminAttendance() {
  const location = useLocation();
  const isLegacyView = new URLSearchParams(location.search).get("legacy") === "1";
  return isLegacyView ? <LegacyAdminAttendance /> : <AdminAttendanceDashboard />;
}
