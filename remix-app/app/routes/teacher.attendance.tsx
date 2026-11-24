import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { toast } from "sonner";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  Search,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { SearchableDropdown } from "~/components/common/searchable-dropdown";
import { ConsecutiveAbsenceBadge, ConsecutiveAbsenceNotice } from "~/components/attendance/consecutive-absence-notice";
import { Button } from "~/components/ui/button";
import { getStudentsAbsentForThreeConsecutiveSessions } from "~/lib/attendance-streak";
import {
  addDaysToDateString,
  getScheduledSlotsForDate,
  getVietnameseDateString,
} from "~/lib/schedule-utils";
import {
  getClassSessionOrderSnapshot,
  renumberClassAttendanceSessions,
} from "~/lib/attendance-session-order.server";
import {
  excludeHandledAbsenceAlerts,
  handleConsecutiveAbsenceAlert,
  type ConsecutiveAbsenceAlert,
} from "~/lib/attendance-streak.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type AttendanceStatus = "present" | "late" | "absent";
type AbsenceReason = "excused" | "unexcused";
type AttendanceFilter = "all" | AttendanceStatus;
type AttendanceTask = "recording" | "hanzi" | "duet" | "lessonLink";
type ReviewSessionType = "MIDTERM" | "FINAL";
type StudentReviewStatus = "CAN_ADVANCE" | "CANNOT_ADVANCE" | "DROPPED_OUT";

interface AttendanceStudent {
  id: string;
  name: string;
}

interface AttendanceRecord {
  status: AttendanceStatus | null;
  absenceReason: AbsenceReason | null;
  tasks: Record<AttendanceTask, boolean>;
}

interface AttendanceClass {
  id: string;
  name: string;
  course: string;
  midtermReviewSession: number | null;
  finalReviewSession: number | null;
  courseLessons: { id: string; order: number; title: string }[];
  approvedLeaveSlots: ApprovedLeaveSlot[];
  sessions: AttendanceSession[];
  students: AttendanceStudent[];
  consecutiveAbsenceAlerts: ConsecutiveAbsenceAlert[];
}

interface AttendanceSession {
  id: string;
  title: string;
  lessonId: string | null;
  lesson: string;
  recordingUrl: string | null;
  date: string;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  isScheduleGenerated: boolean;
  isMakeupSession: boolean;
  hasAttendanceRecords: boolean;
  records: Record<string, AttendanceRecord>;
}

interface ApprovedLeaveSlot {
  id: string;
  classId: string;
  className: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface ReviewPrompt {
  classId: string;
  sessionId: string;
  sessionNumber: number;
  sessionType: ReviewSessionType;
  sessionTitle: string;
  students: AttendanceStudent[];
  statuses: Record<string, StudentReviewStatus | "">;
}

const TOTAL_TAB_ID = "attendance-total";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; tone: string }[] = [
  { value: "present", label: "Có mặt", tone: "text-success" },
  { value: "late", label: "Đi muộn", tone: "text-warning" },
  { value: "absent", label: "Vắng mặt", tone: "text-destructive" },
];

const ATTENDANCE_CHOICES: {
  value: string;
  label: string;
  status: AttendanceStatus;
  absenceReason: AbsenceReason | null;
  activeClass: string;
}[] = [
  {
    value: "present",
    label: "Có mặt",
    status: "present",
    absenceReason: null,
    activeClass: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    value: "late",
    label: "Đi muộn",
    status: "late",
    absenceReason: null,
    activeClass: "border-amber-500 bg-amber-500 text-white",
  },
  {
    value: "excused",
    label: "Vắng (CP)",
    status: "absent",
    absenceReason: "excused",
    activeClass: "border-sky-700 bg-sky-700 text-white",
  },
  {
    value: "unexcused",
    label: "Vắng (KP)",
    status: "absent",
    absenceReason: "unexcused",
    activeClass: "border-rose-700 bg-rose-700 text-white",
  },
];

const FILTER_OPTIONS: { value: AttendanceFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "present", label: "Có mặt" },
  { value: "late", label: "Đi muộn" },
  { value: "absent", label: "Vắng mặt" },
];

const ATTENDANCE_TASKS: { key: AttendanceTask; label: string }[] = [
  { key: "recording", label: "Ghi âm" },
  { key: "hanzi", label: "Chữ Hán" },
  { key: "duet", label: "Duet" },
  { key: "lessonLink", label: "Bài link" },
];

function fromDatabaseStatus(status: string | null): AttendanceStatus | null {
  if (status === "PRESENT") return "present";
  if (status === "LATE") return "late";
  if (status === "ABSENT") return "absent";
  return null;
}

function toDatabaseStatus(status: AttendanceStatus | null) {
  if (status === "present") return "PRESENT";
  if (status === "late") return "LATE";
  if (status === "absent") return "ABSENT";
  return null;
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === "present" || value === "late" || value === "absent";
}

function fromDatabaseAbsenceReason(reason: string | null): AbsenceReason | null {
  if (reason === "EXCUSED") return "excused";
  if (reason === "UNEXCUSED") return "unexcused";
  return null;
}

function isAbsenceReason(value: unknown): value is AbsenceReason {
  return value === "excused" || value === "unexcused";
}

function toDatabaseAbsenceReason(reason: AbsenceReason | null) {
  if (reason === "excused") return "EXCUSED";
  if (reason === "unexcused") return "UNEXCUSED";
  return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttendanceTasks(value: unknown): value is Record<AttendanceTask, boolean> {
  return isRecord(value) && ATTENDANCE_TASKS.every(({ key }) => typeof value[key] === "boolean");
}

function createEmptyAttendanceRecord(): AttendanceRecord {
  return {
    status: "present",
    absenceReason: null,
    tasks: { recording: false, hanzi: false, duet: false, lessonLink: false },
  };
}

function formatAttendanceSessionDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function getAttendanceSessionNumber(
  sessions: { id: string; title: string }[],
  sessionId: string,
): number | null {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index < 0) return null;
  const number = Number(sessions[index].title.match(/\d+$/)?.[0] ?? 0);
  return Number.isSafeInteger(number) && number > 0 ? number : index + 1;
}

function isStudentReviewStatus(value: unknown): value is StudentReviewStatus {
  return value === "CAN_ADVANCE" || value === "CANNOT_ADVANCE" || value === "DROPPED_OUT";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const today = getVietnameseDateString();
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id, completedAt: null },
    select: {
      id: true,
      name: true,
      schedule: true,
      midtermReviewSession: true,
      finalReviewSession: true,
      course: {
        select: {
          title: true,
          lessons: { orderBy: { order: "asc" }, select: { id: true, order: true, title: true } },
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
          lessonId: true,
          lesson: true,
          recordingUrl: true,
          date: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
          isScheduleGenerated: true,
          makeupForLeaveRequestId: true,
          createdAt: true,
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
      teacherLeaveRequests: {
        where: { status: "APPROVED", makeupSession: null },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        select: { id: true, date: true, startTime: true, endTime: true },
      },
    },
    orderBy: { name: "asc" },
  });
  const alerts = classes.flatMap((classroom) => {
    const sessions = classroom.attendanceSessions.filter(({ date }) => date.toISOString().slice(0, 10) <= today);
    return sessions.flatMap((session, sessionIndex) => {
      if (sessionIndex < 2) return [];
      const recentSessions = sessions.slice(sessionIndex - 2, sessionIndex + 1);
      const absentStudentIds = getStudentsAbsentForThreeConsecutiveSessions(
        recentSessions.map((item) => ({
          id: item.id,
          records: item.records.map(({ studentId, status }) => ({ studentId, status })),
        })),
        session.id,
      );
      return [...absentStudentIds].flatMap((studentId) => {
        const student = classroom.enrollments.find(({ user: enrolled }) => enrolled.id === studentId)?.user;
        if (!student) return [];
        return [{
          classId: classroom.id,
          className: classroom.name,
          studentId,
          studentName: student.name,
          sessionId: session.id,
          sessionDate: session.date,
          sessionCreatedAt: session.createdAt,
          sessions: recentSessions.map((item) => ({
            id: item.id,
            title: item.title,
            date: item.date.toISOString().slice(0, 10),
          })),
        }];
      });
    });
  });
  const visibleAlerts = await excludeHandledAbsenceAlerts(alerts);
  const alertsByClass = new Map<string, ConsecutiveAbsenceAlert[]>();
  for (const alert of visibleAlerts) {
    const classAlerts = alertsByClass.get(alert.classId) ?? [];
    classAlerts.push(alert);
    alertsByClass.set(alert.classId, classAlerts);
  }
  return {
    user,
    today,
    classes: classes.map((classroom): AttendanceClass => ({
      id: classroom.id,
      name: classroom.name,
      course: classroom.course.title,
      midtermReviewSession: classroom.midtermReviewSession,
      finalReviewSession: classroom.finalReviewSession,
      courseLessons: classroom.course.lessons,
      students: classroom.enrollments.map(({ user: student }) => ({ id: student.id, name: student.name })),
      approvedLeaveSlots: classroom.teacherLeaveRequests.map((leave): ApprovedLeaveSlot => ({
        id: leave.id,
        classId: classroom.id,
        className: classroom.name,
        date: leave.date.toISOString().slice(0, 10),
        startTime: leave.startTime,
        endTime: leave.endTime,
      })),
      sessions: classroom.attendanceSessions.map((session) => ({
        id: session.id,
        title: session.title,
        lessonId: session.lessonId,
        lesson: session.lesson,
        recordingUrl: session.recordingUrl,
        date: session.date.toISOString().slice(0, 10),
        scheduleStartTime: session.scheduleStartTime,
        scheduleEndTime: session.scheduleEndTime,
        isScheduleGenerated: session.isScheduleGenerated,
        isMakeupSession: session.makeupForLeaveRequestId !== null,
        hasAttendanceRecords: session.records.length > 0,
        records: Object.fromEntries(session.records.map((record) => [record.studentId, {
          status: fromDatabaseStatus(record.status),
          absenceReason: fromDatabaseAbsenceReason(record.absenceReason),
          tasks: {
            recording: record.recording,
            hanzi: record.hanzi,
            duet: record.duet,
            lessonLink: record.lessonLink,
          },
        }])),
      })),
      consecutiveAbsenceAlerts: alertsByClass.get(classroom.id) ?? [],
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create-session" || intent === "cancel-scheduled-date") {
    return {
      success: false as const,
      intent,
      error: "Buổi học được tạo tự động theo lịch của lớp; giáo viên không cần thêm buổi thủ công.",
    };
  }

  if (intent === "create-makeup-session") {
    const leaveRequestId = String(form.get("leaveRequestId") ?? "");
    const dateValue = String(form.get("date") ?? "");
    const date = parseAttendanceDate(dateValue);
    const lessonId = String(form.get("lessonId") ?? "").trim() || null;
    const rawRecordingUrl = String(form.get("recordingUrl") ?? "").trim();
    const firstAllowedDate = addDaysToDateString(getVietnameseDateString(), 1);
    if (!leaveRequestId) {
      return { success: false as const, intent, error: "Chọn buổi nghỉ cần học bù." };
    }
    if (!date || !firstAllowedDate || dateValue < firstAllowedDate) {
      return { success: false as const, intent, error: "Chọn ngày học bù từ ngày mai trở đi." };
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
            classroom: { is: { teacherId: user.id, completedAt: null } },
          },
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            classId: true,
            classroom: { select: { schedule: true, courseId: true } },
          },
        });
        if (!leaveRequest) {
          return {
            success: false as const,
            error: "Buổi nghỉ không còn khả dụng hoặc không thuộc lớp bạn phụ trách. Tải lại trang để chọn lại.",
          };
        }
        if (dateValue <= leaveRequest.date.toISOString().slice(0, 10)) {
          return { success: false as const, error: "Ngày học bù phải sau ngày nghỉ đã được duyệt." };
        }
        const courseLesson = lessonId
          ? await tx.lesson.findFirst({
              where: { id: lessonId, courseId: leaveRequest.classroom.courseId },
              select: { id: true, title: true },
            })
          : null;
        if (lessonId && !courseLesson) {
          return { success: false as const, error: "Bài học không thuộc khóa học của lớp này. Hãy chọn lại bài học." };
        }
        if ((courseLesson?.title.length ?? 0) > 120) {
          return { success: false as const, error: "Tên bài học trong khóa học vượt quá 120 ký tự." };
        }
        const lesson = courseLesson?.title ?? "";

        const toMinutes = (time: string) => {
          const [hours, minutes] = time.split(":").map(Number);
          return hours * 60 + minutes;
        };
        const targetSlotOverlaps = (startTime: string, endTime: string) =>
          toMinutes(leaveRequest.startTime) < toMinutes(endTime)
          && toMinutes(leaveRequest.endTime) > toMinutes(startTime);
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
            lessonId: courseLesson?.id ?? null,
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
        const renumberedSessions = await renumberClassAttendanceSessions(tx, leaveRequest.classId, previousOrder);
        return {
          success: true as const,
          classId: leaveRequest.classId,
          sessionId: session.id,
          title: renumberedSessions.find(({ id }) => id === session.id)?.title ?? "",
          date: dateValue,
          lessonId: courseLesson?.id ?? null,
          lesson,
          recordingUrl,
          scheduleStartTime: leaveRequest.startTime,
          scheduleEndTime: leaveRequest.endTime,
          renumberedSessions,
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

  if (intent === "dismiss-absence-alert") {
    const classId = String(form.get("classId") ?? "");
    const studentId = String(form.get("studentId") ?? "");
    const sessionId = String(form.get("sessionId") ?? "");
    const classroom = await prisma.class.findFirst({
      where: { id: classId, teacherId: user.id, completedAt: null },
      select: { id: true },
    });
    if (!classroom || !studentId || !sessionId) {
      return { success: false as const, intent, studentId, error: "Không tìm thấy cảnh báo hoặc bạn không có quyền xử lý cảnh báo này." };
    }

    const handled = await handleConsecutiveAbsenceAlert({ classId, studentId, sessionId, handledById: user.id });
    if (!handled) {
      return { success: false as const, intent, studentId, error: "Cảnh báo này không còn hợp lệ. Hãy tải lại trang." };
    }
    return { success: true as const, intent, studentId };
  }

  const sessionId = String(form.get("sessionId") ?? "");
  const session = sessionId
    ? await prisma.attendanceSession.findFirst({
        where: { id: sessionId, class: { is: { teacherId: user.id, completedAt: null } } },
        select: {
          id: true,
          classId: true,
          title: true,
          date: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
          isScheduleGenerated: true,
          makeupForLeaveRequestId: true,
          class: {
            select: {
              courseId: true,
              midtermReviewSession: true,
              finalReviewSession: true,
              attendanceSessions: {
                orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
                select: { id: true, title: true },
              },
            },
          },
        },
      })
    : null;
  if (!session) return { success: false as const, error: "Không tìm thấy buổi học hoặc bạn không có quyền sửa buổi này." };
  if (intent === "save-attendance" && session.date.toISOString().slice(0, 10) > getVietnameseDateString()) {
    return { success: false as const, error: "Chưa đến ngày học theo lịch của buổi này." };
  }
  if (
    intent === "save-attendance"
    && session.isScheduleGenerated
    && session.scheduleStartTime
    && session.scheduleEndTime
  ) {
    const leaveRequest = await prisma.teacherLeaveRequest.findFirst({
      where: {
        classId: session.classId,
        date: session.date,
        startTime: session.scheduleStartTime,
        endTime: session.scheduleEndTime,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { status: true },
    });
    if (leaveRequest) {
      return {
        success: false as const,
        error: leaveRequest.status === "APPROVED"
          ? "Ca này đã được duyệt nghỉ nên không thể điểm danh."
          : "Ca này đang chờ admin duyệt nghỉ nên chưa thể điểm danh.",
      };
    }
  }

  if (intent === "save-session-review") {
    const sessionType = String(form.get("sessionType") ?? "");
    if (sessionType !== "MIDTERM" && sessionType !== "FINAL") {
      return { success: false as const, error: "Loại đánh giá không hợp lệ." };
    }
    const sessionNumber = getAttendanceSessionNumber(session.class.attendanceSessions, session.id);
    const configuredSessionNumber = sessionType === "MIDTERM"
      ? session.class.midtermReviewSession
      : session.class.finalReviewSession;
    if (sessionNumber === null || configuredSessionNumber !== sessionNumber) {
      return { success: false as const, error: "Buổi này không còn là mốc đánh giá đã cấu hình. Hãy tải lại trang." };
    }

    let parsedReviews: unknown;
    try {
      parsedReviews = JSON.parse(String(form.get("reviews") ?? ""));
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { success: false as const, error: "Danh sách đánh giá không hợp lệ." };
      }
      throw error;
    }
    if (!Array.isArray(parsedReviews)) {
      return { success: false as const, error: "Danh sách đánh giá không hợp lệ." };
    }
    const reviews: { studentId: string; status: StudentReviewStatus }[] = [];
    for (const value of parsedReviews) {
      if (!isRecord(value) || typeof value.studentId !== "string" || !value.studentId || !isStudentReviewStatus(value.status)) {
        return { success: false as const, error: "Mỗi học viên cần có một trạng thái đánh giá." };
      }
      reviews.push({ studentId: value.studentId, status: value.status });
    }
    if (new Set(reviews.map(({ studentId }) => studentId)).size !== reviews.length) {
      return { success: false as const, error: "Danh sách đánh giá có học viên bị trùng." };
    }

    const savedReview = await prisma.$transaction(async (tx) => {
      const currentSession = await tx.attendanceSession.findFirst({
        where: { id: session.id, class: { is: { teacherId: user.id, completedAt: null } } },
        select: {
          id: true,
          classId: true,
          title: true,
          class: {
            select: {
              midtermReviewSession: true,
              finalReviewSession: true,
              attendanceSessions: {
                orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
                select: { id: true, title: true },
              },
            },
          },
        },
      });
      if (!currentSession) {
        return { success: false as const, error: "Không tìm thấy buổi học hoặc lớp đã kết thúc." };
      }
      const currentNumber = getAttendanceSessionNumber(currentSession.class.attendanceSessions, currentSession.id);
      const expectedNumber = sessionType === "MIDTERM"
        ? currentSession.class.midtermReviewSession
        : currentSession.class.finalReviewSession;
      if (currentNumber !== expectedNumber) {
        return { success: false as const, error: "Mốc đánh giá của lớp vừa thay đổi. Hãy tải lại trang." };
      }
      if (currentNumber === null) {
        return { success: false as const, error: "Không xác định được số buổi đánh giá. Hãy tải lại trang." };
      }

      const enrolledStudents = await tx.enrollment.findMany({
        where: {
          classId: currentSession.classId,
          user: { is: { role: "student", isActive: true, deletedAt: null } },
        },
        select: { userId: true },
      });
      const enrolledIds = new Set(enrolledStudents.map(({ userId }) => userId));
      if (
        reviews.length !== enrolledIds.size
        || reviews.some(({ studentId }) => !enrolledIds.has(studentId))
      ) {
        return { success: false as const, error: "Danh sách đánh giá không khớp với học viên hiện tại của lớp. Hãy tải lại trang." };
      }

      await Promise.all(reviews.map(({ studentId, status }) =>
        tx.studentClassReview.upsert({
          where: {
            classId_studentId_sessionType: {
              classId: currentSession.classId,
              studentId,
              sessionType,
            },
          },
          create: {
            classId: currentSession.classId,
            studentId,
            sessionType,
            sessionNumber: currentNumber,
            status,
            teacherId: user.id,
          },
          update: {
            sessionNumber: currentNumber,
            status,
            teacherId: user.id,
            adminAction: null,
            adminActionReason: null,
          },
        })
      ));
      return { success: true as const };
    });
    if (!savedReview.success) return { ...savedReview, classId: session.classId };
    return {
      success: true as const,
      intent,
      classId: session.classId,
      sessionId: session.id,
      sessionType,
    };
  }

  if (intent === "delete-session") {
    const sessionNumber = getAttendanceSessionNumber(session.class.attendanceSessions, session.id);
    if (sessionNumber === null) {
      return { success: false as const, error: "Không xác định được số buổi. Hãy tải lại trang." };
    }
    const reviewExists = await prisma.studentClassReview.findFirst({
      where: { classId: session.classId, sessionNumber },
      select: { id: true },
    });
    if (reviewExists) {
      return { success: false as const, error: "Không thể xóa buổi đã có đánh giá giữa kỳ hoặc cuối kỳ." };
    }

    const deletedDate = session.date.toISOString().slice(0, 10);
    const shouldCancelSchedule = session.isScheduleGenerated;
    const update = await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.delete({ where: { id: session.id } });
      let hasCancellation = false;
      if (shouldCancelSchedule) {
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
        hasCancellation = true;
      }
      const remainingSessions = await tx.attendanceSession.findMany({
        where: { classId: session.classId },
        orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true },
      });
      const renumberedSessions = remainingSessions.map((item, index) => ({
        id: item.id,
        title: `Buổi ${index + 1}`,
      }));
      for (let index = 0; index < renumberedSessions.length; index += 1) {
        if (remainingSessions[index].title === renumberedSessions[index].title) continue;
        await tx.attendanceSession.update({
          where: { id: renumberedSessions[index].id },
          data: { title: renumberedSessions[index].title },
        });
      }

      await tx.studentClassReview.updateMany({
        where: { classId: session.classId, sessionNumber: { gt: sessionNumber } },
        data: { sessionNumber: { decrement: 1 } },
      });
      await tx.class.update({
        where: { id: session.classId },
        data: {
          midtermReviewSession: session.class.midtermReviewSession !== null
            && session.class.midtermReviewSession > sessionNumber
            ? { decrement: 1 }
            : undefined,
          finalReviewSession: session.class.finalReviewSession !== null
            && session.class.finalReviewSession > sessionNumber
            ? { decrement: 1 }
            : undefined,
        },
      });
      return { renumberedSessions, hasCancellation };
    });
    return {
      success: true as const,
      intent,
      sessionId,
      classId: session.classId,
      deletedDate,
      hasCancellation: update.hasCancellation,
      renumberedSessions: update.renumberedSessions,
    };
  }

  if (intent === "save-attendance") {
    const lesson = String(form.get("lesson") ?? "").trim();
    const rawLessonId = String(form.get("lessonId") ?? "").trim();
    const lessonId = rawLessonId || null;
    const rawRecordingUrl = String(form.get("recordingUrl") ?? "").trim();
    let recordingUrl: string | null = null;
    if (rawRecordingUrl) {
      try {
        const parsedUrl = new URL(rawRecordingUrl);
        if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") || rawRecordingUrl.length > 2048) {
          return { success: false as const, error: "Link bản ghi cần là URL HTTP hoặc HTTPS và tối đa 2048 ký tự." };
        }
        recordingUrl = parsedUrl.toString();
      } catch {
        return { success: false as const, error: "Vui lòng nhập URL bản ghi hợp lệ." };
      }
    }
    const date = parseAttendanceDate(String(form.get("date") ?? ""));
    if (lesson.length > 120) return { success: false as const, error: "Tên bài học không được vượt quá 120 ký tự." };
    if (lessonId) {
      const courseLesson = await prisma.lesson.findFirst({
        where: { id: lessonId, courseId: session.class.courseId },
        select: { id: true },
      });
      if (!courseLesson) return { success: false as const, error: "Bài học không thuộc khóa học của lớp này." };
    }
    if (!date) {
      return { success: false as const, error: "Vui lòng chọn ngày học hợp lệ." };
    }
    if (date.toISOString().slice(0, 10) !== session.date.toISOString().slice(0, 10)) {
      return { success: false as const, error: "Ngày buổi học được tự động lấy theo lịch và không thể thay đổi." };
    }
    const rawRecords = String(form.get("records") ?? "");
    let parsedRecords: unknown;
    try {
      parsedRecords = JSON.parse(rawRecords);
    } catch {
      return { success: false as const, error: "Dữ liệu điểm danh không hợp lệ. Hãy thử lưu lại." };
    }
    if (!Array.isArray(parsedRecords)) return { success: false as const, error: "Danh sách điểm danh không hợp lệ." };
    const records: (AttendanceRecord & { studentId: string })[] = [];
    for (const value of parsedRecords) {
      if (!isRecord(value)) {
        return { success: false as const, error: "Có dòng điểm danh không hợp lệ." };
      }
      const record = value;
      const status = record.status;
      const absenceReason = record.absenceReason;
      const tasks = record.tasks;
      if (
        typeof record.studentId !== "string"
        || (status !== null && !isAttendanceStatus(status))
        || (absenceReason !== null && !isAbsenceReason(absenceReason))
        || (status === "absent" ? absenceReason === null : absenceReason !== null)
        || !isAttendanceTasks(tasks)
      ) {
        return { success: false as const, error: "Dữ liệu điểm danh hoặc lý do vắng chưa đầy đủ." };
      }
      records.push({
        studentId: record.studentId,
        status,
        absenceReason,
        tasks: {
          recording: tasks.recording,
          hanzi: tasks.hanzi,
          duet: tasks.duet,
          lessonLink: tasks.lessonLink,
        },
      });
    }
    if (new Set(records.map((record) => record.studentId)).size !== records.length) {
      return { success: false as const, error: "Danh sách có học viên bị trùng." };
    }
    const enrolledStudents = await prisma.enrollment.findMany({
      where: {
        classId: session.classId,
        user: { is: { role: "student", isActive: true, deletedAt: null } },
      },
      select: { userId: true, user: { select: { name: true } } },
    });
    const submittedStudentIds = new Set(records.map((record) => record.studentId));
    if (
      enrolledStudents.length !== records.length
      || enrolledStudents.some(({ userId }) => !submittedStudentIds.has(userId))
    ) {
      return { success: false as const, error: "Danh sách có học viên không thuộc lớp này. Hãy tải lại trang." };
    }
    await prisma.$transaction([
      prisma.attendanceSession.update({
        where: { id: session.id },
        data: { lesson, lessonId, date, recordingUrl },
      }),
      ...records.map((record) => prisma.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: session.id, studentId: record.studentId } },
        create: {
          sessionId: session.id,
          studentId: record.studentId,
          status: toDatabaseStatus(record.status),
          absenceReason: toDatabaseAbsenceReason(record.absenceReason),
          ...record.tasks,
        },
        update: {
          status: toDatabaseStatus(record.status),
          absenceReason: toDatabaseAbsenceReason(record.absenceReason),
          ...record.tasks,
        },
      })),
    ]);
    const sessionNumber = getAttendanceSessionNumber(session.class.attendanceSessions, session.id);
    const reviewSessionType: ReviewSessionType | null = sessionNumber === session.class.midtermReviewSession
      ? "MIDTERM"
      : sessionNumber === session.class.finalReviewSession
        ? "FINAL"
        : null;
    let reviewPrompt: ReviewPrompt | null = null;
    if (reviewSessionType && sessionNumber !== null) {
      const existingReviews = await prisma.studentClassReview.findMany({
        where: { classId: session.classId, sessionType: reviewSessionType },
        select: { studentId: true, status: true },
      });
      const existingStatuses = new Map(existingReviews.map(({ studentId, status }) => [studentId, status]));
      if (enrolledStudents.some(({ userId }) => !existingStatuses.has(userId))) {
        reviewPrompt = {
          classId: session.classId,
          sessionId: session.id,
          sessionNumber,
          sessionType: reviewSessionType,
          sessionTitle: session.title,
          students: enrolledStudents.map(({ userId, user: student }) => ({ id: userId, name: student.name })),
          statuses: Object.fromEntries(enrolledStudents.map(({ userId }) => [
            userId,
            existingStatuses.get(userId) ?? "",
          ])),
        };
      }
    }
    return { success: true as const, intent, sessionId, classId: session.classId, reviewPrompt };
  }

  return { success: false as const, error: "Thao tác điểm danh không hợp lệ." };
}

export default function TeacherAttendance() {
  const { user, classes } = useLoaderData<typeof loader>();
  const saveAttendanceFetcher = useFetcher<typeof action>();
  const reviewFetcher = useFetcher<typeof action>();
  const makeupFetcher = useFetcher<typeof action>();
  const firstClassId = classes[0]?.id ?? "";
  const [classId, setClassId] = useState(firstClassId);
  const [sessionsByClass, setSessionsByClass] = useState<Record<string, AttendanceSession[]>>(() =>
    Object.fromEntries(classes.map((classroom) => [classroom.id, classroom.sessions]))
  );
  const [attendanceBySession, setAttendanceBySession] = useState<Record<string, Record<string, AttendanceRecord>>>(() =>
    Object.fromEntries(classes.flatMap((classroom) => classroom.sessions.map((session) => [
      `${classroom.id}:${session.id}`,
      session.records,
    ])))
  );
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const today = getVietnameseDateString(currentTime);
  const lastDisplayedDate = useRef(today);
  const [activeTabId, setActiveTabId] = useState(
    classes[0]?.sessions.find((session) => session.date === today)?.id
      ?? classes[0]?.sessions.find((session) => session.date <= today)?.id
      ?? TOTAL_TAB_ID,
  );
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [dirtySessionKeys, setDirtySessionKeys] = useState<Set<string>>(() => new Set());
  const [isSessionDetailsExpanded, setIsSessionDetailsExpanded] = useState(true);
  const [pendingReview, setPendingReview] = useState<ReviewPrompt | null>(null);
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, StudentReviewStatus | "">>({});
  const [showMakeupModal, setShowMakeupModal] = useState(false);
  const [makeupLeaveRequestId, setMakeupLeaveRequestId] = useState("");
  const [makeupDate, setMakeupDate] = useState(getMinimumMakeupDate(getVietnameseDateString()));
  const [makeupLessonId, setMakeupLessonId] = useState("");
  const selectedClass = classes.find((item) => item.id === classId) ?? classes[0] ?? null;
  const approvedMakeupLeaveSlots = classes.flatMap((classroom) => classroom.approvedLeaveSlots);
  const selectedMakeupLeaveSlot = approvedMakeupLeaveSlots.find(({ id }) => id === makeupLeaveRequestId);
  const makeupCourseLessons = classes.find(({ id }) => id === selectedMakeupLeaveSlot?.classId)?.courseLessons ?? [];
  const allClassSessions = selectedClass ? sessionsByClass[selectedClass.id] ?? selectedClass.sessions : [];
  const attendanceSessions = allClassSessions.filter((session) => session.date <= today);
  const attendanceOptions = [
    ...attendanceSessions.map((session) => ({
      type: "session" as const,
      date: session.date,
      startTime: session.scheduleStartTime ?? "",
      session,
    })),
    ...(selectedClass?.approvedLeaveSlots ?? []).map((leave) => ({
      type: "approved-leave" as const,
      date: leave.date,
      startTime: leave.startTime,
      leave,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const isTotalView = activeTabId === TOTAL_TAB_ID || attendanceSessions.length === 0;
  const selectedAttendanceSession = attendanceSessions.find((session) => session.id === activeTabId) ?? null;
  const sessionKey = selectedClass && selectedAttendanceSession ? `${selectedClass.id}:${selectedAttendanceSession.id}` : "";
  const hasUnsavedChanges = selectedClass
    ? [...dirtySessionKeys].some((key) => key.startsWith(`${selectedClass.id}:`))
    : false;
  const persistedRecords = selectedClass && selectedAttendanceSession
    ? attendanceBySession[sessionKey] ?? selectedAttendanceSession.records
    : {};
  const attendance = Object.fromEntries((selectedClass?.students ?? []).map((student) => [
    student.id,
    persistedRecords[student.id] ?? createEmptyAttendanceRecord(),
  ]));
  const markedCount = (selectedClass?.students ?? []).filter((student) => {
    const record = attendance[student.id];
    if (!record) return false;
    return record.status !== null && (record.status !== "absent" || record.absenceReason !== null);
  }).length;
  const aggregate = (selectedClass?.students ?? []).map((student) => {
    const records = attendanceSessions.map((session) =>
      attendanceBySession[`${classId}:${session.id}`]?.[student.id]
      ?? session.records[student.id]
    ).filter((record): record is AttendanceRecord => record !== undefined);
    return {
      student,
      present: records.filter((record) => record.status === "present").length,
      late: records.filter((record) => record.status === "late").length,
      absent: records.filter((record) => record.status === "absent").length,
      excused: records.filter((record) => record.status === "absent" && record.absenceReason === "excused").length,
      unexcused: records.filter((record) => record.status === "absent" && record.absenceReason === "unexcused").length,
      recording: records.filter((record) => record.tasks.recording).length,
      hanzi: records.filter((record) => record.tasks.hanzi).length,
      duet: records.filter((record) => record.tasks.duet).length,
      lessonLink: records.filter((record) => record.tasks.lessonLink).length,
    };
  });
  const chronologicalSessions = [...attendanceSessions].sort((left, right) =>
    left.date.localeCompare(right.date)
    || attendanceSessions.indexOf(left) - attendanceSessions.indexOf(right),
  );
  const absenceTargetSession = isTotalView
    ? chronologicalSessions[chronologicalSessions.length - 1]
    : selectedAttendanceSession;
  const consecutiveAbsenceAlerts = (selectedClass?.consecutiveAbsenceAlerts ?? [])
    .filter((alert) => alert.sessionId === absenceTargetSession?.id);
  const consecutiveAbsenceStudentIds = new Set(consecutiveAbsenceAlerts.map(({ studentId }) => studentId));
  const aggregateWithAbsence = aggregate.map((item) => ({
    ...item,
    hasConsecutiveAbsence: consecutiveAbsenceStudentIds.has(item.student.id),
  }));
  const counts = isTotalView
    ? {
        total: selectedClass?.students.length ?? 0,
        present: aggregate.reduce((sum, item) => sum + item.present, 0),
        late: aggregate.reduce((sum, item) => sum + item.late, 0),
        absent: aggregate.reduce((sum, item) => sum + item.absent, 0),
        excused: aggregate.reduce((sum, item) => sum + item.excused, 0),
        unexcused: aggregate.reduce((sum, item) => sum + item.unexcused, 0),
      }
    : {
        total: selectedClass?.students.length ?? 0,
        present: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "present").length,
        late: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "late").length,
        absent: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "absent").length,
        excused: (selectedClass?.students ?? []).filter((student) =>
          attendance[student.id]?.status === "absent" && attendance[student.id]?.absenceReason === "excused"
        ).length,
        unexcused: (selectedClass?.students ?? []).filter((student) =>
          attendance[student.id]?.status === "absent" && attendance[student.id]?.absenceReason === "unexcused"
        ).length,
      };
  const visibleStudents = (selectedClass?.students ?? []).filter((student) => {
    const matchesSearch = student.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
    const status = attendance[student.id]?.status ?? null;
    const matchesFilter = filter === "all" || status === filter;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (lastDisplayedDate.current === today) return;
    lastDisplayedDate.current = today;
    const todaySession = attendanceSessions.find((session) => session.date === today);
    if (todaySession) setActiveTabId(todaySession.id);
  }, [today, attendanceSessions]);

  useEffect(() => {
    const result = makeupFetcher.data;
    if (
      makeupFetcher.state !== "idle"
      || !result
      || !result.success
      || result.intent !== "create-makeup-session"
      || !("classId" in result)
      || typeof result.classId !== "string"
      || !("sessionId" in result)
      || typeof result.sessionId !== "string"
      || !("renumberedSessions" in result)
      || !Array.isArray(result.renumberedSessions)
      || !("title" in result)
      || typeof result.title !== "string"
      || !("lesson" in result)
      || typeof result.lesson !== "string"
      || !("lessonId" in result)
      || !(typeof result.lessonId === "string" || result.lessonId === null)
      || !("date" in result)
      || typeof result.date !== "string"
      || !("scheduleStartTime" in result)
      || typeof result.scheduleStartTime !== "string"
      || !("scheduleEndTime" in result)
      || typeof result.scheduleEndTime !== "string"
      || !("recordingUrl" in result)
    ) {
      if (makeupFetcher.state === "idle" && result && !result.success) {
        setFeedback(result.error);
        toast.error(result.error);
      }
      return;
    }

    const classId = result.classId;
    const sessionId = result.sessionId;
    setSessionsByClass((current) => {
      const titleById = new Map(result.renumberedSessions.map((session) => [session.id, session.title]));
      const currentSessions = (current[classId] ?? [])
        .map((session) => ({ ...session, title: titleById.get(session.id) ?? session.title }))
        .filter((session) => session.id !== sessionId);
      return {
        ...current,
        [classId]: [
          ...currentSessions,
          {
            id: sessionId,
            title: result.title,
            lessonId: result.lessonId,
            lesson: result.lesson,
            recordingUrl: result.recordingUrl,
            date: result.date,
            scheduleStartTime: result.scheduleStartTime,
            scheduleEndTime: result.scheduleEndTime,
            isScheduleGenerated: false,
            isMakeupSession: true,
            hasAttendanceRecords: true,
            records: {},
          },
        ].sort((left, right) =>
          left.date.localeCompare(right.date)
          || (left.scheduleStartTime ?? "").localeCompare(right.scheduleStartTime ?? ""),
        ),
      };
    });
    setClassId(classId);
    setActiveTabId(TOTAL_TAB_ID);
    setShowMakeupModal(false);
    setMakeupLeaveRequestId("");
    setFeedback("Đã tạo buổi bù. Buổi học sẽ xuất hiện khi đến ngày học.");
    toast.success("Đã tạo buổi bù thành công.");
    makeupFetcher.reset();
  }, [makeupFetcher.data, makeupFetcher.state]);

  useEffect(() => {
    const result = saveAttendanceFetcher.data;
    if (
      result?.success
      && result.intent === "save-attendance"
      && "classId" in result
      && "sessionId" in result
      && result.classId === selectedClass?.id
      && result.sessionId === selectedAttendanceSession?.id
    ) {
      if (selectedClass && selectedAttendanceSession) {
        setSessionsByClass((current) => ({
          ...current,
          [selectedClass.id]: (current[selectedClass.id] ?? selectedClass.sessions).map((session) =>
            session.id === selectedAttendanceSession.id
              ? { ...session, hasAttendanceRecords: true }
              : session
          ),
        }));
      }
      setFeedback("Đã lưu điểm danh, bài tập và thông tin buổi học.");
      setDirtySessionKeys((current) => {
        const next = new Set(current);
        next.delete(`${result.classId}:${result.sessionId}`);
        return next;
      });
      toast.success("Đã lưu điểm danh thành công.");
      if (result.reviewPrompt) {
        setPendingReview(result.reviewPrompt);
        setReviewStatuses(result.reviewPrompt.statuses);
      }
    } else if (saveAttendanceFetcher.data && !saveAttendanceFetcher.data.success) {
      setFeedback(saveAttendanceFetcher.data.error);
      toast.error(saveAttendanceFetcher.data.error);
    }
  }, [saveAttendanceFetcher.data, selectedClass?.id, selectedAttendanceSession?.id]);

  useEffect(() => {
    const result = reviewFetcher.data;
    if (reviewFetcher.state !== "idle" || !result) return;
    if (!result.success) {
      setFeedback(result.error);
      return;
    }
    const currentReview = pendingReview;
    if (
      result.intent === "save-session-review"
      && currentReview
      && currentReview.classId === result.classId
      && currentReview.sessionId === result.sessionId
      && currentReview.sessionType === result.sessionType
    ) {
      setPendingReview(null);
      const feedback = currentReview.sessionType === "MIDTERM"
        ? "Đã gửi đánh giá giữa kỳ cho quản trị viên."
        : "Đã lưu đánh giá học viên.";
      setFeedback(feedback);
      toast.success(feedback);
      reviewFetcher.reset();
    }
  }, [reviewFetcher.data, reviewFetcher.state, pendingReview]);

  function changeClass(nextClassId: string) {
    const nextClass = classes.find((item) => item.id === nextClassId);
    if (!nextClass) return;
    setClassId(nextClass.id);
    setPendingReview(null);
    const nextSessions = (sessionsByClass[nextClass.id] ?? nextClass.sessions)
      .filter((session) => session.date <= today);
    if (!sessionsByClass[nextClass.id]) {
      setSessionsByClass((current) => ({ ...current, [nextClass.id]: nextClass.sessions }));
    }
    setActiveTabId(
      nextSessions.find((session) => session.date === today)?.id
        ?? nextSessions[0]?.id
        ?? TOTAL_TAB_ID,
    );
    setFilter("all");
    setSearch("");
    setFeedback("");
  }

  function updateAttendanceSession(field: "lesson" | "lessonId" | "recordingUrl", value: string) {
    if (!selectedClass || !selectedAttendanceSession) return;
    setSessionsByClass((current) => ({
      ...current,
      [selectedClass.id]: (current[selectedClass.id] ?? selectedClass.sessions).map((session) =>
        session.id === selectedAttendanceSession.id ? { ...session, [field]: value } : session
      ),
    }));
    markSessionDirty(sessionKey);
  }

  function markSessionDirty(key = sessionKey) {
    if (!key) return;
    setDirtySessionKeys((current) => new Set(current).add(key));
    setFeedback("Có thay đổi chưa lưu.");
  }

  function changeStatus(studentId: string, value: string) {
    if (!selectedClass || !sessionKey) return;
    const nextStatus: AttendanceStatus | null = value === ""
      ? null
      : STATUS_OPTIONS.find((option) => option.value === value)?.value ?? null;
    if (value !== "" && nextStatus === null) return;
    setAttendanceBySession((current) => {
      const currentSession = current[sessionKey] ?? selectedAttendanceSession?.records ?? {};
      const existingRecord = currentSession[studentId] ?? createEmptyAttendanceRecord();
      return {
        ...current,
        [sessionKey]: {
          ...currentSession,
          [studentId]: {
            ...existingRecord,
            status: nextStatus,
            absenceReason: nextStatus === "absent" && existingRecord.status === "absent"
              ? existingRecord.absenceReason
              : null,
          },
        },
      };
    });
    markSessionDirty();
  }

  function changeAbsenceReason(studentId: string, value: string) {
    if (!selectedClass || !sessionKey) return;
    const reason = value === "excused" || value === "unexcused" ? value : null;
    setAttendanceBySession((current) => ({
      ...current,
      [sessionKey]: {
        ...(current[sessionKey] ?? selectedAttendanceSession?.records ?? {}),
        [studentId]: {
          ...(current[sessionKey] ?? selectedAttendanceSession?.records ?? {})[studentId]
            ?? createEmptyAttendanceRecord(),
          status: "absent",
          absenceReason: reason,
        },
      },
    }));
    markSessionDirty();
  }

  function changeTask(studentId: string, task: AttendanceTask, checked: boolean) {
    if (!selectedClass || !sessionKey) return;
    setAttendanceBySession((current) => {
      const currentSession = current[sessionKey] ?? selectedAttendanceSession?.records ?? {};
      const currentRecord = currentSession[studentId] ?? createEmptyAttendanceRecord();
      return {
        ...current,
        [sessionKey]: {
          ...currentSession,
          [studentId]: {
            ...currentRecord,
            tasks: { ...currentRecord.tasks, [task]: checked },
          },
        },
      };
    });
    markSessionDirty();
  }

  function changeAttendanceChoice(studentId: string, choice: (typeof ATTENDANCE_CHOICES)[number]) {
    const record = attendance[studentId];
    if (!record) return;
    const isActive = record.status === choice.status
      && (choice.status !== "absent" || record.absenceReason === choice.absenceReason);
    if (isActive) {
      changeStatus(studentId, "");
      return;
    }
    changeStatus(studentId, choice.status);
    if (choice.absenceReason) changeAbsenceReason(studentId, choice.absenceReason);
  }

  function changeAllTasks(task: AttendanceTask, checked: boolean) {
    if (!selectedClass || !selectedAttendanceSession || !sessionKey) return;
    setAttendanceBySession((current) => {
      const currentSession = current[sessionKey] ?? selectedAttendanceSession.records;
      return {
        ...current,
        [sessionKey]: Object.fromEntries(selectedClass.students.map((student) => {
          const record = currentSession[student.id] ?? createEmptyAttendanceRecord();
          return [student.id, { ...record, tasks: { ...record.tasks, [task]: checked } }];
        })),
      };
    });
    markSessionDirty();
  }

  const reviewReady = Boolean(pendingReview?.students.length)
    && Boolean(pendingReview?.students.every((student) => isStudentReviewStatus(reviewStatuses[student.id])));
  const isSavingReview = reviewFetcher.state !== "idle";

  function saveSessionReview() {
    if (!pendingReview || !reviewReady) return;
    reviewFetcher.submit(
      {
        intent: "save-session-review",
        sessionId: pendingReview.sessionId,
        sessionType: pendingReview.sessionType,
        reviews: JSON.stringify(pendingReview.students.map((student) => ({
          studentId: student.id,
          status: reviewStatuses[student.id],
        }))),
      },
      { method: "post" },
    );
  }

  function saveAttendance() {
    if (!selectedClass || !selectedAttendanceSession) return;
    const studentMissingAbsenceReason = selectedClass.students.find((student) => {
      const record = attendance[student.id] ?? selectedAttendanceSession.records[student.id];
      return record?.status === "absent" && !record.absenceReason;
    });
    if (studentMissingAbsenceReason) {
      setFilter("absent");
      setSearch("");
      const error = `Vui lòng chọn loại vắng cho ${studentMissingAbsenceReason.name} trước khi lưu.`;
      setFeedback(error);
      toast.error(error);
      window.requestAnimationFrame(() => {
        document.getElementById(`attendance-choice-${studentMissingAbsenceReason.id}-excused`)?.focus();
      });
      return;
    }

    const records = selectedClass.students.map((student) => ({
      studentId: student.id,
      ...(attendance[student.id] ?? createEmptyAttendanceRecord()),
    }));
    saveAttendanceFetcher.submit(
      {
        intent: "save-attendance",
        sessionId: selectedAttendanceSession.id,
        lessonId: selectedAttendanceSession.lessonId ?? "",
        lesson: selectedAttendanceSession.lesson,
        recordingUrl: selectedAttendanceSession.recordingUrl ?? "",
        date: selectedAttendanceSession.date,
        records: JSON.stringify(records),
      },
      { method: "post" },
    );
  }

  if (!selectedClass) {
    return (
      <AppShell user={user}>
        <div className="mx-auto max-w-6xl space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Điểm danh</h1>
          <p className="text-sm text-muted-foreground">
            Bạn hiện không có lớp học nào đang hoạt động để điểm danh.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="-mx-4 -mt-2 flex flex-col gap-4 border-b border-border/80 bg-background px-4 py-4 shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">Điểm danh</h1>
                <span
                  role="status"
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    hasUnsavedChanges
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${hasUnsavedChanges ? "animate-pulse bg-amber-500" : "bg-emerald-600"}`} />
                  {hasUnsavedChanges ? "Chưa lưu thay đổi" : "Đã lưu dữ liệu"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Ghi nhận tình hình tham gia và bài tập theo từng buổi học.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="h-10 w-36 justify-center gap-2 px-3"
                disabled={saveAttendanceFetcher.state !== "idle"}
                onClick={() => {
                  const firstLeave = approvedMakeupLeaveSlots[0];
                  setMakeupLeaveRequestId(firstLeave?.id ?? "");
                  setMakeupDate(getMinimumMakeupDate(today, firstLeave?.date));
                  setMakeupLessonId("");
                  setShowMakeupModal(true);
                }}
              >
                <CalendarDays aria-hidden="true" className="h-4 w-4" />
                Tạo buổi bù
              </Button>
              <Button
                type="button"
                className="h-10 w-36 justify-center gap-2 px-3"
                disabled={
                  !selectedAttendanceSession
                  || saveAttendanceFetcher.state !== "idle"
                }
                onClick={saveAttendance}
              >
                <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
                {saveAttendanceFetcher.state !== "idle" ? "Đang lưu..." : "Lưu điểm danh"}
              </Button>
            </div>
          </div>
        </header>

        <section aria-label="Chọn lớp và buổi học" className="overflow-visible rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3 lg:w-[22rem] lg:shrink-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                <BookOpen aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <label htmlFor="attendance-class" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lớp học</label>
                  <span className="max-w-40 truncate rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {selectedClass.course}
                  </span>
                </div>
                <SearchableDropdown
                  id="attendance-class"
                  label="Chọn lớp học"
                  placeholder="Chọn lớp học"
                  searchPlaceholder="Tìm lớp học..."
                  options={classes.map((item) => ({ value: item.id, label: item.name }))}
                  value={selectedClass.id}
                  onChange={changeClass}
                  className="mt-1 min-w-0 flex-1"
                  triggerClassName="rounded-lg border-transparent bg-muted/50 text-sm font-semibold shadow-none transition-colors hover:bg-muted"
                  contentClassName="min-w-0 rounded-xl border-border/80 p-1.5 shadow-lg"
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
              <nav aria-label="Buổi học" className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
                <button
                  type="button"
                  aria-pressed={isTotalView}
                  disabled={saveAttendanceFetcher.state !== "idle"}
                  onClick={() => {
                    setActiveTabId(TOTAL_TAB_ID);
                    setFilter("all");
                    setSearch("");
                    setFeedback("");
                  }}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isTotalView
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-muted/40 text-foreground hover:bg-muted"
                  }`}
                >
                  <Users aria-hidden="true" className="h-4 w-4" />
                  Tổng hợp
                </button>
                {attendanceOptions.map((option) => option.type === "approved-leave" ? (
                  <button
                    key={`leave-${option.leave.id}`}
                    type="button"
                    disabled
                    title={`${option.leave.className} · ${option.leave.startTime}–${option.leave.endTime} · ${formatAttendanceSessionDate(option.leave.date)} · Giáo viên nghỉ đã duyệt`}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3 text-xs font-medium text-muted-foreground"
                  >
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                    <span>Ca nghỉ · {option.leave.startTime}</span>
                  </button>
                ) : (
                  <button
                    key={option.session.id}
                    type="button"
                    aria-pressed={activeTabId === option.session.id}
                    disabled={saveAttendanceFetcher.state !== "idle"}
                    onClick={() => {
                      setActiveTabId(option.session.id);
                      setFilter("all");
                      setSearch("");
                      setFeedback("");
                    }}
                    title={`${option.session.title}${option.session.isMakeupSession ? " · Buổi bù" : ""} · ${formatAttendanceSessionDate(option.session.date)}${option.session.scheduleStartTime && option.session.scheduleEndTime ? ` · ${option.session.scheduleStartTime}–${option.session.scheduleEndTime}` : ""}`}
                    className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      activeTabId === option.session.id
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-muted/40 text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${
                      dirtySessionKeys.has(`${selectedClass.id}:${option.session.id}`)
                        ? "bg-amber-400"
                        : option.session.hasAttendanceRecords
                          ? activeTabId === option.session.id ? "bg-emerald-200" : "bg-emerald-600"
                          : activeTabId === option.session.id ? "bg-white/70" : "bg-muted-foreground/40"
                    }`} />
                    <span>{option.session.title}</span>
                    <span className={`font-normal ${activeTabId === option.session.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      {formatAttendanceSessionDate(option.session.date)}
                    </span>
                    {option.session.isMakeupSession && (
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${activeTabId === option.session.id ? "bg-white/15" : "bg-primary/10 text-primary"}`}>
                        Bù
                      </span>
                    )}
                  </button>
                ))}
              </nav>

            </div>
          </div>
        </section>

        <section aria-labelledby="attendance-session-details-heading" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 id="attendance-session-details-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Thông tin buổi học
              </h2>
              {!isSessionDetailsExpanded && selectedAttendanceSession && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {formatAttendanceSessionDate(selectedAttendanceSession.date)} · {selectedAttendanceSession.lesson || "Chưa đặt tên bài học"}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={isSessionDetailsExpanded}
              aria-controls="attendance-session-details"
              onClick={() => setIsSessionDetailsExpanded((expanded) => !expanded)}
              className="shrink-0 gap-1.5 text-primary"
            >
              {isSessionDetailsExpanded ? "Thu gọn" : "Mở rộng"}
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${isSessionDetailsExpanded ? "rotate-180" : ""}`} />
            </Button>
          </div>

          <div
            id="attendance-session-details"
            className={`grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4 ${isSessionDetailsExpanded ? "" : "hidden"}`}
          >
              {selectedAttendanceSession ? (
                <>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="attendance-lesson" className="block text-xs font-medium text-foreground">
                      Bài học <span className="font-normal text-muted-foreground">(Tự nhập)</span>
                    </label>
                    <input
                      id="attendance-lesson"
                      type="text"
                      value={selectedAttendanceSession.lesson}
                      onChange={(event) => updateAttendanceSession("lesson", event.currentTarget.value)}
                      maxLength={120}
                      disabled={saveAttendanceFetcher.state !== "idle"}
                      className="block h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="attendance-course-lesson" className="block text-xs font-medium text-foreground">
                      Bài học trong buổi <span className="font-normal text-muted-foreground">(Giáo trình)</span>
                    </label>
                    <select
                      id="attendance-course-lesson"
                      value={selectedAttendanceSession.lessonId ?? ""}
                      onChange={(event) => updateAttendanceSession("lessonId", event.currentTarget.value)}
                      disabled={saveAttendanceFetcher.state !== "idle"}
                      className="block h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <option value="">Không gắn bài học</option>
                      {selectedClass.courseLessons.map((lesson, index) => (
                        <option key={lesson.id} value={lesson.id}>Bài {index + 1} · {lesson.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <span className="block text-xs font-medium text-foreground">Ngày diễn ra</span>
                    <p className="flex h-10 w-full items-center rounded-xl border border-input bg-muted/40 px-3.5 text-sm">
                      {new Date(`${selectedAttendanceSession.date}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
                        timeZone: "UTC",
                        dateStyle: "long",
                      })}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="attendance-recording-url" className="block text-xs font-medium text-foreground">
                      Link bản ghi buổi học
                    </label>
                    <input
                      id="attendance-recording-url"
                      type="url"
                      inputMode="url"
                      value={selectedAttendanceSession.recordingUrl ?? ""}
                      onChange={(event) => updateAttendanceSession("recordingUrl", event.currentTarget.value)}
                      maxLength={2048}
                      placeholder="https://..."
                      disabled={saveAttendanceFetcher.state !== "idle"}
                      className="block h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                  Chọn một buổi học để xem thông tin bài học và bản ghi.
                </p>
              )}
          </div>
        </section>

        <section aria-labelledby="student-roster-heading" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="space-y-4 border-b p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="student-roster-heading" className="text-base font-semibold">
                  {isTotalView ? "Tổng hợp theo học viên" : "Danh sách học viên"}
                </h2>
                <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {isTotalView
                    ? `${attendanceSessions.length} buổi đã học`
                    : `Đã điểm danh ${markedCount}/${counts.total}`}
                </span>
              </div>
              {!isTotalView && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-lg border bg-muted/40 px-2.5 py-1.5 text-muted-foreground">
                    Sĩ số <strong className="ml-1 text-sm tabular-nums text-foreground">{counts.total}</strong>
                  </span>
                  <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-900">
                    Có mặt <strong className="ml-1 text-sm tabular-nums">{counts.present}</strong>
                  </span>
                  <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                    Đi muộn <strong className="ml-1 text-sm tabular-nums">{counts.late}</strong>
                  </span>
                  <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-sky-900">
                    Vắng (CP) <strong className="ml-1 text-sm tabular-nums">{counts.excused}</strong>
                  </span>
                  <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-900">
                    Vắng (KP) <strong className="ml-1 text-sm tabular-nums">{counts.unexcused}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className={`flex gap-3 ${isTotalView ? "flex-col sm:flex-row sm:items-center sm:justify-end" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}>
              {!isTotalView && (
                <div role="group" aria-label="Lọc theo trạng thái" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1">
                    {FILTER_OPTIONS.map((option) => {
                      const count = option.value === "all" ? counts.total
                        : option.value === "absent" ? counts.absent
                          : counts[option.value];
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={filter === option.value}
                          onClick={() => setFilter(option.value)}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            filter === option.value
                              ? "border-foreground bg-foreground font-semibold text-background"
                              : "border-transparent bg-muted/70 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {option.label}
                          <span className={`tabular-nums ${filter === option.value ? "text-background/80" : "text-muted-foreground"}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}

              <div className="relative w-full shrink-0 sm:w-56">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Tìm tên học viên..."
                  aria-label="Tìm học viên"
                  className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          {consecutiveAbsenceAlerts.length > 0 && (
            <div className="px-4 pb-4 sm:px-5">
              <ConsecutiveAbsenceNotice alerts={consecutiveAbsenceAlerts} />
            </div>
          )}

          <div className="overflow-x-auto">
            {isTotalView ? (
              <table className="w-full min-w-[1116px] border-collapse text-left">
                <caption className="sr-only">Tổng hợp điểm danh và bài tập theo học viên qua tất cả các buổi</caption>
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th scope="col" className="w-[56px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">STT</th>
                    <th scope="col" className="w-[230px] px-5 py-3 text-xs font-semibold text-muted-foreground">Học viên</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Có mặt</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Đi muộn</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Vắng mặt</th>
                    {ATTENDANCE_TASKS.map(({ key, label }) => (
                      <th key={key} scope="col" className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {aggregateWithAbsence
                    .filter(({ student }) => student.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))
                    .map((item, index) => {
                      const doneByTask: Record<AttendanceTask, number> = {
                        recording: item.recording,
                        hanzi: item.hanzi,
                        duet: item.duet,
                        lessonLink: item.lessonLink,
                      };
                      const initials = item.student.name.split(" ").slice(-2).map((part) => part[0]).join("");
                      return (
                        <tr
                          key={item.student.id}
                          className={`transition-colors hover:bg-muted/30 ${item.hasConsecutiveAbsence ? "bg-destructive/5" : ""}`}
                        >
                          <td className="px-3 py-3.5 text-center text-sm tabular-nums text-muted-foreground">{index + 1}</td>
                          <th scope="row" className="px-5 py-3.5 text-left">
                            <span className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">{initials}</span>
                              <span>
                                <span className="block text-sm font-medium text-foreground">{item.student.name}</span>
                                {item.hasConsecutiveAbsence && <ConsecutiveAbsenceBadge />}
                              </span>
                            </span>
                          </th>
                          <td className="px-3 py-3.5 text-center text-sm font-medium tabular-nums text-success">{item.present}</td>
                          <td className="px-3 py-3.5 text-center text-sm font-medium tabular-nums text-warning">{item.late}</td>
                          <td className="px-3 py-3.5 text-center text-sm font-medium tabular-nums text-destructive">{item.absent}</td>
                          {ATTENDANCE_TASKS.map(({ key, label }) => (
                            <td key={key} className="px-3 py-3.5 text-center text-sm tabular-nums text-muted-foreground" aria-label={`${label}: ${doneByTask[key]} trên ${attendanceSessions.length} buổi`}>
                              {doneByTask[key]}/{attendanceSessions.length}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  {aggregateWithAbsence.filter(({ student }) => student.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"))).length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center">
                        <p className="text-sm font-medium">
                          {selectedClass.students.length === 0 ? "Lớp chưa có học viên" : "Không tìm thấy học viên phù hợp"}
                        </p>
                        {selectedClass.students.length > 0 && (
                          <p className="mt-1 text-sm text-muted-foreground">Thử đổi từ khóa tìm kiếm.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <caption className="sr-only">Điểm danh và tình trạng bài tập của học viên</caption>
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th scope="col" className="w-[56px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">STT</th>
                  <th scope="col" className="w-[230px] px-5 py-3 text-xs font-semibold text-muted-foreground">Học viên</th>
                  <th scope="col" className="w-[420px] px-4 py-3 text-xs font-semibold text-muted-foreground">Trạng thái điểm danh</th>
                  {ATTENDANCE_TASKS.map(({ key, label }) => {
                    const checkedCount = selectedClass.students.filter((student) => attendance[student.id]?.tasks[key]).length;
                    const allChecked = selectedClass.students.length > 0 && checkedCount === selectedClass.students.length;
                    return (
                      <th key={key} scope="col" className="w-[100px] px-2 py-3 text-center">
                        <label className="inline-flex cursor-pointer flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(element) => {
                              if (element) element.indeterminate = checkedCount > 0 && !allChecked;
                            }}
                            onChange={(event) => changeAllTasks(key, event.currentTarget.checked)}
                            disabled={saveAttendanceFetcher.state !== "idle"}
                            aria-label={`Đánh dấu tất cả ${label}`}
                            className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          />
                        </label>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleStudents.map((student, index) => {
                  const record = attendance[student.id];
                  const initials = student.name.split(" ").slice(-2).map((part) => part[0]).join("");
                  const isAbsent = record.status === "absent";
                  const hasConsecutiveAbsence = consecutiveAbsenceStudentIds.has(student.id);

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors ${
                        isAbsent
                          ? "bg-rose-50 hover:bg-rose-100"
                          : hasConsecutiveAbsence
                            ? "bg-destructive/5 hover:bg-destructive/10"
                            : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-3 py-3.5 text-center text-sm tabular-nums text-muted-foreground">{index + 1}</td>
                      <th scope="row" className="px-5 py-3.5 text-left">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">
                            {initials}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{student.name}</span>
                            {hasConsecutiveAbsence && <ConsecutiveAbsenceBadge />}
                          </span>
                        </div>
                      </th>
                      <td className="px-4 py-3.5">
                        <div
                          role="group"
                          id={`attendance-status-${student.id}`}
                          aria-label={`Trạng thái điểm danh của ${student.name}`}
                          aria-describedby={
                            record.status === "absent" && !record.absenceReason
                              ? `absence-reason-error-${student.id}`
                              : undefined
                          }
                          className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border/70 bg-muted/70 p-1"
                        >
                          {ATTENDANCE_CHOICES.map((choice) => {
                            const isActive = record.status === choice.status
                              && (choice.status !== "absent" || record.absenceReason === choice.absenceReason);
                            return (
                              <button
                                key={choice.value}
                                type="button"
                                id={`attendance-choice-${student.id}-${choice.value}`}
                                aria-pressed={isActive}
                                onClick={() => changeAttendanceChoice(student.id, choice)}
                                disabled={saveAttendanceFetcher.state !== "idle"}
                                className={`inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:px-2.5 sm:text-xs ${
                                  isActive
                                    ? `${choice.activeClass} font-semibold shadow-sm`
                                    : "border-transparent bg-background text-muted-foreground hover:border-border hover:text-foreground"
                                }`}
                              >
                                {isActive && <Check aria-hidden="true" className="h-3 w-3" />}
                                {choice.label}
                              </button>
                            );
                          })}
                        </div>
                        {record.status === "absent" && !record.absenceReason && (
                          <p id={`absence-reason-error-${student.id}`} role="alert" className="mt-1 text-xs text-destructive">
                            Chọn vắng có phép hoặc không phép.
                          </p>
                        )}
                      </td>
                      {ATTENDANCE_TASKS.map(({ key, label }) => (
                        <td key={key} className="px-3 py-3.5 text-center">
                          <label className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
                            <span className="sr-only">{label} của {student.name}</span>
                            <input
                              type="checkbox"
                              checked={record.tasks[key]}
                              onChange={(event) => changeTask(student.id, key, event.currentTarget.checked)}
                              disabled={saveAttendanceFetcher.state !== "idle"}
                              aria-label={`${label} của ${student.name}`}
                              className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {visibleStudents.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-sm font-medium">
                        {selectedClass.students.length === 0 ? "Lớp chưa có học viên" : "Không tìm thấy học viên phù hợp"}
                      </p>
                      {selectedClass.students.length > 0 && (
                        <p className="mt-1 text-sm text-muted-foreground">Thử đổi từ khóa hoặc bộ lọc trạng thái.</p>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            )}
          </div>

          <footer className="flex flex-col gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {feedback || (selectedAttendanceSession
                ? "Thay đổi sẽ được lưu vào hệ thống khi bạn chọn Lưu điểm danh."
                : "Buổi học theo lịch sẽ xuất hiện khi đến ngày học.")}
            </p>
            {selectedAttendanceSession && (
              <Button
                type="button"
                className="w-full gap-2 sm:w-auto"
                disabled={saveAttendanceFetcher.state !== "idle"}
                onClick={saveAttendance}
              >
                <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
                {saveAttendanceFetcher.state !== "idle" ? "Đang lưu..." : "Lưu điểm danh"}
              </Button>
            )}
          </footer>
        </section>

        {showMakeupModal && (
          <Overlay
            onClose={() => {
              if (makeupFetcher.state === "idle") setShowMakeupModal(false);
            }}
            className="max-w-xl"
            closeOnEscape={makeupFetcher.state === "idle"}
            closeOnBackdrop={makeupFetcher.state === "idle"}
          >
            <section role="dialog" aria-modal="true" aria-labelledby="teacher-makeup-heading" className="space-y-5">
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="teacher-makeup-heading" className="text-lg font-semibold">Tạo buổi bù</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chọn ca nghỉ đã được duyệt. Buổi bù dùng khung giờ của ca nghỉ.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng"
                  disabled={makeupFetcher.state !== "idle"}
                  onClick={() => setShowMakeupModal(false)}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>

              {approvedMakeupLeaveSlots.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Chưa có ca nghỉ nào được duyệt và chưa xếp buổi bù.
                </p>
              ) : (
                <makeupFetcher.Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="create-makeup-session" />
                  <div className="space-y-1.5">
                    <label htmlFor="teacher-makeup-leave" className="text-sm font-medium">Học bù cho buổi nghỉ</label>
                    <select
                      id="teacher-makeup-leave"
                      name="leaveRequestId"
                      value={makeupLeaveRequestId}
                      required
                      disabled={makeupFetcher.state !== "idle"}
                      onChange={(event) => {
                        const nextId = event.currentTarget.value;
                        const leave = approvedMakeupLeaveSlots.find(({ id }) => id === nextId);
                        setMakeupLeaveRequestId(nextId);
                        setMakeupDate(getMinimumMakeupDate(today, leave?.date));
                        setMakeupLessonId("");
                      }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {approvedMakeupLeaveSlots.map((leave) => (
                        <option key={leave.id} value={leave.id}>
                          {leave.className} · {formatAttendanceSessionDate(leave.date)} · {leave.startTime}–{leave.endTime}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="teacher-makeup-date" className="text-sm font-medium">Ngày học</label>
                    <input
                      id="teacher-makeup-date"
                      name="date"
                      type="date"
                      min={getMinimumMakeupDate(today, selectedMakeupLeaveSlot?.date)}
                      required
                      value={makeupDate}
                      onChange={(event) => setMakeupDate(event.currentTarget.value)}
                      disabled={makeupFetcher.state !== "idle"}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="teacher-makeup-lesson" className="text-sm font-medium">Bài học trong buổi</label>
                    <select
                      id="teacher-makeup-lesson"
                      name="lessonId"
                      value={makeupLessonId}
                      onChange={(event) => setMakeupLessonId(event.currentTarget.value)}
                      disabled={makeupFetcher.state !== "idle"}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Không gắn bài học</option>
                      {makeupCourseLessons.map((lesson, index) => (
                        <option key={lesson.id} value={lesson.id}>
                          Bài {index + 1} · {lesson.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="teacher-makeup-recording" className="text-sm font-medium">Link ghi hình / bản ghi</label>
                    <input
                      id="teacher-makeup-recording"
                      name="recordingUrl"
                      type="url"
                      maxLength={2048}
                      disabled={makeupFetcher.state !== "idle"}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  {makeupFetcher.data && !makeupFetcher.data.success
                    && makeupFetcher.data.intent === "create-makeup-session" && (
                    <p role="alert" className="text-sm text-destructive">{makeupFetcher.data.error}</p>
                  )}
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={makeupFetcher.state !== "idle"}
                      onClick={() => setShowMakeupModal(false)}
                    >
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

        {pendingReview && (
          <Overlay
            onClose={() => {
              if (!isSavingReview) setPendingReview(null);
            }}
            className="max-w-3xl"
          >
            <section aria-labelledby="student-review-title" className="space-y-5">
              <header className="space-y-1">
                <h2 id="student-review-title" className="text-xl font-semibold">
                  Đánh giá {pendingReview.sessionType === "MIDTERM" ? "giữa kỳ" : "cuối kỳ"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedClass?.name} · {pendingReview.sessionTitle} · buổi {pendingReview.sessionNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  Chọn trạng thái cho tất cả {pendingReview.students.length} học viên
                  {pendingReview.sessionType === "MIDTERM"
                    ? " để gửi đánh giá cho quản trị viên."
                    : " để lưu đánh giá."}
                </p>
              </header>

              {reviewFetcher.data && !reviewFetcher.data.success && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {reviewFetcher.data.error}
                </p>
              )}

              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {pendingReview.students.map((student) => (
                  <fieldset key={student.id} className="space-y-2 rounded-lg border p-3 sm:p-4">
                    <legend className="px-1 text-sm font-semibold">{student.name}</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {([
                        ["CAN_ADVANCE", "Có khả năng học lên"],
                        ["CANNOT_ADVANCE", "Không có khả năng học lên"],
                        ["DROPPED_OUT", "Bỏ học"],
                      ] as const).map(([status, label]) => (
                        <label
                          key={status}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                            reviewStatuses[student.id] === status ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`student-review-${student.id}`}
                            value={status}
                            checked={reviewStatuses[student.id] === status}
                            onChange={() => setReviewStatuses((current) => ({ ...current, [student.id]: status }))}
                            disabled={isSavingReview}
                            className="accent-primary"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              <footer className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingReview(null)}
                  disabled={isSavingReview}
                  className="w-full sm:w-auto"
                >
                  Để sau
                </Button>
                <Button
                  type="button"
                  onClick={saveSessionReview}
                  disabled={!reviewReady || isSavingReview}
                  className="w-full sm:w-auto"
                >
                  {isSavingReview
                    ? pendingReview.sessionType === "MIDTERM" ? "Đang gửi đánh giá..." : "Đang lưu đánh giá..."
                    : pendingReview.sessionType === "MIDTERM" ? "Gửi đánh giá cho quản trị viên" : "Lưu đánh giá"}
                </Button>
              </footer>
            </section>
          </Overlay>
        )}

      </div>
    </AppShell>
  );
}
