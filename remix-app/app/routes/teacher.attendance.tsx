import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import { toast } from "sonner";
import { ClipboardCheck, LoaderCircle, Plus, Search, Trash2, Users } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { ConsecutiveAbsenceBadge, ConsecutiveAbsenceNotice } from "~/components/attendance/consecutive-absence-notice";
import { Button } from "~/components/ui/button";
import { getStudentsAbsentForThreeConsecutiveSessions } from "~/lib/attendance-streak";
import {
  getMissingScheduledDates,
  getScheduledDateAvailability,
  getScheduledSessionAvailability,
  getScheduledSessionNumber,
} from "~/lib/schedule-utils";
import {
  excludeHandledAbsenceAlerts,
  handleConsecutiveAbsenceAlert,
  type ConsecutiveAbsenceAlert,
} from "~/lib/attendance-streak.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type AttendanceStatus = "present" | "late" | "absent";
type AbsenceReason = "excused" | "unexcused";
type AttendanceFilter = "all" | "unmarked" | AttendanceStatus;
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
  startDate: string;
  schedule: unknown;
  midtermReviewSession: number | null;
  finalReviewSession: number | null;
  courseLessons: { id: string; order: number; title: string }[];
  sessions: AttendanceSession[];
  missedScheduleDates: string[];
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
  records: Record<string, AttendanceRecord>;
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

const FILTER_OPTIONS: { value: AttendanceFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "unmarked", label: "Chưa điểm danh" },
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
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id, completedAt: null },
    select: {
      id: true,
      name: true,
      startDate: true,
      schedule: true,
      scheduleCancellations: {
        orderBy: { date: "asc" },
        select: { date: true },
      },
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
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          lessonId: true,
          lesson: true,
          recordingUrl: true,
          date: true,
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
    },
    orderBy: { name: "asc" },
  });
  const alerts = classes.flatMap((classroom) => {
    const sessions = classroom.attendanceSessions;
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
    classes: classes.map((classroom): AttendanceClass => ({
      id: classroom.id,
      name: classroom.name,
      course: classroom.course.title,
      startDate: classroom.startDate.toISOString().slice(0, 10),
      schedule: classroom.schedule,
      midtermReviewSession: classroom.midtermReviewSession,
      finalReviewSession: classroom.finalReviewSession,
      courseLessons: classroom.course.lessons,
      students: classroom.enrollments.map(({ user: student }) => ({ id: student.id, name: student.name })),
      missedScheduleDates: getMissingScheduledDates(
        classroom.schedule,
        classroom.startDate,
        getScheduledSessionAvailability(classroom.schedule, classroom.startDate).date,
        classroom.attendanceSessions.map(({ date }) => date.toISOString().slice(0, 10)),
        classroom.scheduleCancellations.map(({ date }) => date.toISOString().slice(0, 10)),
      ),
      sessions: classroom.attendanceSessions.map((session) => ({
        id: session.id,
        title: session.title,
        lessonId: session.lessonId,
        lesson: session.lesson,
        recordingUrl: session.recordingUrl,
        date: session.date.toISOString().slice(0, 10),
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

  if (intent === "create-session") {
    const classId = String(form.get("classId") ?? "");
    try {
      const result = await prisma.$transaction(async (tx) => {
        const classroom = await tx.class.findFirst({
          where: { id: classId, teacherId: user.id, completedAt: null },
          select: {
            id: true,
            startDate: true,
            schedule: true,
            midtermReviewSession: true,
            finalReviewSession: true,
          },
        });
        if (!classroom) {
          return { success: false as const, error: "Không tìm thấy lớp hoặc bạn không có quyền điểm danh lớp này." };
        }

        const now = new Date();
        const today = getScheduledSessionAvailability(classroom.schedule, classroom.startDate, now).date;
        const requestedDate = String(form.get("date") ?? today);
        const availability = getScheduledDateAvailability(
          classroom.schedule,
          classroom.startDate,
          requestedDate,
          now,
        );
        if (!availability.allowed) {
          const messages = {
            "no-schedule": "Lớp chưa có lịch học hợp lệ nên chưa thể tạo buổi.",
            "before-start-date": "Chưa đến ngày bắt đầu của lớp.",
            "future-date": "Không thể tạo buổi cho ngày trong tương lai.",
            "wrong-day": "Ngày đã chọn không nằm trong lịch học của lớp.",
          } as const;
          return { success: false as const, error: messages[availability.reason] };
        }

        const sessionDate = parseAttendanceDate(availability.date);
        if (!sessionDate) {
          return { success: false as const, error: "Ngày học không hợp lệ. Hãy tải lại trang." };
        }
        const existingSession = await tx.attendanceSession.findFirst({
          where: { classId, date: sessionDate },
          select: { id: true },
        });
        if (existingSession) {
          return { success: false as const, error: "Buổi học của ngày này đã được tạo rồi." };
        }

        const [existingSessions, cancellations] = await Promise.all([
          tx.attendanceSession.findMany({
            where: { classId },
            orderBy: [{ date: "asc" }, { createdAt: "asc" }],
            select: { id: true, date: true, title: true },
          }),
          tx.classScheduleCancellation.findMany({
            where: { classId },
            select: { date: true },
          }),
        ]);
        if (cancellations.some(({ date }) => date.toISOString().slice(0, 10) === availability.date)) {
          return { success: false as const, error: "Ngày này đã được đánh dấu lớp nghỉ." };
        }

        const missingDates = getMissingScheduledDates(
          classroom.schedule,
          classroom.startDate,
          today,
          existingSessions.map(({ date }) => date.toISOString().slice(0, 10)),
          cancellations.map(({ date }) => date.toISOString().slice(0, 10)),
        );
        if (availability.date === today && missingDates.length > 0) {
          return {
            success: false as const,
            error: "Hãy xử lý các ngày học chưa ghi nhận trước khi tạo buổi hôm nay.",
            classId,
            missedScheduleDates: missingDates,
          };
        }

        const nextNumber = getScheduledSessionNumber(
          existingSessions.map(({ date }) => date.toISOString().slice(0, 10)),
          availability.date,
        );
        const insertionIndex = nextNumber - 1;
        const shiftedSessions = existingSessions.slice(insertionIndex);
        if (shiftedSessions.length > 0) {
          await tx.studentClassReview.updateMany({
            where: { classId, sessionNumber: { gte: nextNumber } },
            data: { sessionNumber: { increment: 1 } },
          });
          await tx.class.update({
            where: { id: classId },
            data: {
              midtermReviewSession: classroom.midtermReviewSession !== null
                && classroom.midtermReviewSession >= nextNumber
                ? { increment: 1 }
                : undefined,
              finalReviewSession: classroom.finalReviewSession !== null
                && classroom.finalReviewSession >= nextNumber
                ? { increment: 1 }
                : undefined,
            },
          });
        }

        const renumberedSessions = shiftedSessions.map((session, index) => ({
          id: session.id,
          title: `Buổi ${nextNumber + index}`,
        }));
        for (const session of renumberedSessions) {
          await tx.attendanceSession.update({
            where: { id: session.id },
            data: { title: session.title },
          });
        }
        const enrolledStudents = await tx.enrollment.findMany({
          where: {
            classId,
            user: { is: { role: "student", isActive: true, deletedAt: null } },
          },
          select: { userId: true },
        });
        const createdSession = await tx.attendanceSession.create({
          data: {
            classId,
            title: `Buổi ${nextNumber}`,
            lesson: "",
            date: sessionDate,
          },
          select: { id: true, title: true, lessonId: true, lesson: true, recordingUrl: true, date: true },
        });
        if (enrolledStudents.length > 0) {
          await tx.attendanceRecord.createMany({
            data: enrolledStudents.map(({ userId }) => ({
              sessionId: createdSession.id,
              studentId: userId,
              status: "PRESENT",
            })),
          });
        }
        return {
          success: true as const,
          classId,
          missedDate: availability.date,
          session: createdSession,
          enrolledStudents,
          renumberedSessions,
          reviewSessionConfig: {
            midtermReviewSession: classroom.midtermReviewSession === null
              ? null
              : classroom.midtermReviewSession >= nextNumber
                ? classroom.midtermReviewSession + 1
                : classroom.midtermReviewSession,
            finalReviewSession: classroom.finalReviewSession === null
              ? null
              : classroom.finalReviewSession >= nextNumber
                ? classroom.finalReviewSession + 1
                : classroom.finalReviewSession,
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!result.success) return { ...result, intent };
      const { classId: createdClassId, session, enrolledStudents } = result;
      return {
        success: true as const,
        intent,
        classId: createdClassId,
        missedDate: result.missedDate,
        renumberedSessions: result.renumberedSessions,
        reviewSessionConfig: result.reviewSessionConfig,
        session: {
          ...session,
          lessonId: session.lessonId,
          recordingUrl: session.recordingUrl,
          date: session.date.toISOString().slice(0, 10),
          records: Object.fromEntries(enrolledStudents.map(({ userId }) => [
            userId,
            {
              status: "present" as const,
              absenceReason: null,
              tasks: { recording: false, hanzi: false, duet: false, lessonLink: false },
            },
          ])),
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return { success: false as const, error: "Buổi học vừa được tạo hoặc ngày này vừa được xử lý. Hãy tải lại trang." };
      }
      throw error;
    }
  }

  if (intent === "cancel-scheduled-date") {
    const classId = String(form.get("classId") ?? "");
    const dateValue = String(form.get("date") ?? "");
    const date = parseAttendanceDate(dateValue);
    if (!date) return { success: false as const, intent, error: "Ngày học không hợp lệ." };

    try {
      const result = await prisma.$transaction(async (tx) => {
        const classroom = await tx.class.findFirst({
          where: { id: classId, teacherId: user.id, completedAt: null },
          select: { id: true, startDate: true, schedule: true },
        });
        if (!classroom) {
          return { success: false as const, error: "Không tìm thấy lớp hoặc bạn không có quyền xử lý lịch này." };
        }

        const availability = getScheduledDateAvailability(classroom.schedule, classroom.startDate, dateValue);
        if (!availability.allowed) {
          return { success: false as const, error: "Ngày này không nằm trong lịch học hợp lệ của lớp." };
        }
        const today = getScheduledSessionAvailability(classroom.schedule, classroom.startDate).date;
        if (dateValue >= today) {
          return { success: false as const, error: "Chỉ có thể đánh dấu nghỉ cho ngày học đã qua." };
        }
        const existingSession = await tx.attendanceSession.findFirst({
          where: { classId, date },
          select: { id: true },
        });
        if (existingSession) {
          return { success: false as const, error: "Ngày này đã có buổi điểm danh, không thể đánh dấu nghỉ." };
        }
        const existingCancellation = await tx.classScheduleCancellation.findUnique({
          where: { classId_date: { classId, date } },
          select: { id: true },
        });
        if (existingCancellation) {
          return { success: false as const, error: "Ngày này đã được đánh dấu lớp nghỉ." };
        }

        await tx.classScheduleCancellation.create({ data: { classId, date } });
        return { success: true as const, classId, date: dateValue };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return { ...result, intent };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return { success: false as const, intent, error: "Ngày học vừa được xử lý. Hãy tải lại trang." };
      }
      throw error;
    }
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
          class: {
            select: {
              courseId: true,
              startDate: true,
              schedule: true,
              midtermReviewSession: true,
              finalReviewSession: true,
              attendanceSessions: {
                orderBy: [{ date: "asc" }, { createdAt: "asc" }],
                select: { id: true, title: true },
              },
            },
          },
        },
      })
    : null;
  if (!session) return { success: false as const, error: "Không tìm thấy buổi học hoặc bạn không có quyền sửa buổi này." };

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
                orderBy: [{ date: "asc" }, { createdAt: "asc" }],
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
    const today = getScheduledSessionAvailability(session.class.schedule, session.class.startDate).date;
    const scheduledDate = getScheduledDateAvailability(
      session.class.schedule,
      session.class.startDate,
      deletedDate,
    );
    const update = await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.delete({ where: { id: session.id } });
      const remainingSessions = await tx.attendanceSession.findMany({
        where: { classId: session.classId },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
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
      const cancellation = await tx.classScheduleCancellation.findUnique({
        where: {
          classId_date: {
            classId: session.classId,
            date: session.date,
          },
        },
        select: { id: true },
      });
      return { renumberedSessions, hasCancellation: Boolean(cancellation) };
    });
    return {
      success: true as const,
      intent,
      sessionId,
      classId: session.classId,
      deletedDate,
      missedDate: scheduledDate.allowed && deletedDate < today && !update.hasCancellation
        ? deletedDate
        : null,
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
  const addSessionFetcher = useFetcher<typeof action>();
  const deleteSessionFetcher = useFetcher<typeof action>();
  const scheduleActionFetcher = useFetcher<typeof action>();
  const saveAttendanceFetcher = useFetcher<typeof action>();
  const reviewFetcher = useFetcher<typeof action>();
  const firstClassId = classes[0]?.id ?? "";
  const [classId, setClassId] = useState(firstClassId);
  const [sessionsByClass, setSessionsByClass] = useState<Record<string, AttendanceSession[]>>(() =>
    Object.fromEntries(classes.map((classroom) => [classroom.id, classroom.sessions]))
  );
  const [missedScheduleDatesByClass, setMissedScheduleDatesByClass] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(classes.map((classroom) => [classroom.id, classroom.missedScheduleDates]))
  );
  const [attendanceBySession, setAttendanceBySession] = useState<Record<string, Record<string, AttendanceRecord>>>(() =>
    Object.fromEntries(classes.flatMap((classroom) => classroom.sessions.map((session) => [
      `${classroom.id}:${session.id}`,
      session.records,
    ])))
  );
  const [activeTabId, setActiveTabId] = useState(classes[0]?.sessions[0]?.id ?? TOTAL_TAB_ID);
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingDeleteSession, setPendingDeleteSession] = useState<AttendanceSession | null>(null);
  const [isResolvingScheduleDates, setIsResolvingScheduleDates] = useState(false);
  const [pendingReview, setPendingReview] = useState<ReviewPrompt | null>(null);
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, StudentReviewStatus | "">>({});
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const selectedClass = classes.find((item) => item.id === classId) ?? classes[0] ?? null;
  const attendanceSessions = selectedClass ? sessionsByClass[selectedClass.id] ?? selectedClass.sessions : [];
  const sessionAvailability = selectedClass
    ? getScheduledSessionAvailability(selectedClass.schedule, selectedClass.startDate, currentTime)
    : null;
  const sessionAlreadyExistsToday = Boolean(
    sessionAvailability && attendanceSessions.some(({ date }) => date === sessionAvailability.date),
  );
  const canCreateSession = Boolean(sessionAvailability?.allowed && !sessionAlreadyExistsToday);
  const missedScheduleDates = selectedClass
    ? missedScheduleDatesByClass[selectedClass.id] ?? selectedClass.missedScheduleDates
    : [];
  const canStartSessionFlow = canCreateSession || missedScheduleDates.length > 0;
  const sessionCreationMessage = missedScheduleDates.length > 0
    ? `Còn ${missedScheduleDates.length} ngày học chưa được xử lý.`
    : sessionAlreadyExistsToday
      ? "Buổi học hôm nay đã được tạo rồi."
    : sessionAvailability && !sessionAvailability.allowed
      ? {
          "no-schedule": "Lớp chưa có lịch học hợp lệ.",
          "before-start-date": "Chưa đến ngày bắt đầu của lớp.",
          "future-date": "Không thể tạo buổi cho ngày trong tương lai.",
          "wrong-day": "Hôm nay không có buổi học theo lịch của lớp.",
        }[sessionAvailability.reason]
      : "Có thể tạo buổi học trong ngày học theo lịch.";
  const isTotalView = activeTabId === TOTAL_TAB_ID || attendanceSessions.length === 0;
  const selectedAttendanceSession = attendanceSessions.find((session) => session.id === activeTabId) ?? null;
  const sessionKey = selectedClass && selectedAttendanceSession ? `${selectedClass.id}:${selectedAttendanceSession.id}` : "";
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
      }
    : {
        total: selectedClass?.students.length ?? 0,
        present: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "present").length,
        late: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "late").length,
        absent: (selectedClass?.students ?? []).filter((student) => attendance[student.id]?.status === "absent").length,
      };
  const visibleStudents = (selectedClass?.students ?? []).filter((student) => {
    const matchesSearch = student.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
    const status = attendance[student.id]?.status ?? null;
    const matchesFilter = filter === "all"
      || (filter === "unmarked" ? status === null : status === filter);
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const result = addSessionFetcher.data;
    if (
      !result?.success
      || result.intent !== "create-session"
      || !("session" in result)
      || !result.session
      || !("renumberedSessions" in result)
    ) return;
    const session = result.session;
    setSessionsByClass((current) => {
      const titleById = new Map(result.renumberedSessions.map((item) => [item.id, item.title]));
      const currentSessions = current[result.classId]
        ?? classes.find((item) => item.id === result.classId)?.sessions
        ?? [];
      const nextSessions = currentSessions.map((item) => ({
        ...item,
        title: titleById.get(item.id) ?? item.title,
      }));
      if (!nextSessions.some((item) => item.id === session.id)) nextSessions.push(session);
      return {
        ...current,
        [result.classId]: nextSessions.sort((left, right) => left.date.localeCompare(right.date)),
      };
    });
    setAttendanceBySession((current) => ({ ...current, [`${result.classId}:${session.id}`]: {} }));
    setMissedScheduleDatesByClass((current) => ({
      ...current,
      [result.classId]: (current[result.classId]
        ?? classes.find((item) => item.id === result.classId)?.missedScheduleDates
        ?? []).filter((date) => date !== result.missedDate),
    }));
    if (result.classId === classId) setActiveTabId(session.id);
  }, [addSessionFetcher.data, classId, classes]);

  useEffect(() => {
    const result = addSessionFetcher.data;
    if (!result || result.success) return;
    setFeedback(result.error);
    if (
      "intent" in result
      && result.intent === "create-session"
      && "classId" in result
      && "missedScheduleDates" in result
      && typeof result.classId === "string"
      && Array.isArray(result.missedScheduleDates)
    ) {
      setMissedScheduleDatesByClass((current) => ({
        ...current,
        [result.classId]: result.missedScheduleDates,
      }));
      setIsResolvingScheduleDates(true);
    }
  }, [addSessionFetcher.data]);

  useEffect(() => {
    const result = scheduleActionFetcher.data;
    if (scheduleActionFetcher.state !== "idle" || !result) return;
    if (!result.success) {
      setFeedback(result.error);
      toast.error(result.error);
      return;
    }
    if (
      "intent" in result
      && result.intent === "cancel-scheduled-date"
      && "classId" in result
      && "date" in result
      && typeof result.classId === "string"
      && typeof result.date === "string"
    ) {
      setMissedScheduleDatesByClass((current) => ({
        ...current,
        [result.classId]: (current[result.classId]
          ?? classes.find((item) => item.id === result.classId)?.missedScheduleDates
          ?? []).filter((date) => date !== result.date),
      }));
      setFeedback("Đã ghi nhận lớp nghỉ vào ngày đã chọn.");
      toast.success("Đã ghi nhận lớp nghỉ.");
    }
  }, [scheduleActionFetcher.data, scheduleActionFetcher.state, classes]);

  useEffect(() => {
    if (
      deleteSessionFetcher.data?.success
      && deleteSessionFetcher.data.intent === "delete-session"
      && "sessionId" in deleteSessionFetcher.data
      && "classId" in deleteSessionFetcher.data
      && "renumberedSessions" in deleteSessionFetcher.data
    ) {
      const result = deleteSessionFetcher.data;
      const deletedId = typeof result.sessionId === "string" ? result.sessionId : "";
      const deletedClassId = typeof result.classId === "string" ? result.classId : "";
      const renumberedSessions = Array.isArray(result.renumberedSessions) ? result.renumberedSessions : [];
      const missedDate = typeof result.missedDate === "string" ? result.missedDate : null;
      if (!deletedId || !deletedClassId) return;
      setSessionsByClass((current) => {
        const titleById = new Map(renumberedSessions.map((item) => [item.id, item.title]));
        return {
          ...current,
          [deletedClassId]: (current[deletedClassId] ?? [])
            .filter((session) => session.id !== deletedId)
            .map((session) => ({ ...session, title: titleById.get(session.id) ?? session.title })),
        };
      });
      if (missedDate) {
        setMissedScheduleDatesByClass((current) => ({
          ...current,
          [deletedClassId]: [...new Set([
            ...(current[deletedClassId] ?? []),
            missedDate,
          ])].sort(),
        }));
      }
      setAttendanceBySession((current) => {
        const next = { ...current };
        delete next[`${deletedClassId}:${deletedId}`];
        return next;
      });
      setFeedback("Đã xóa buổi điểm danh và cập nhật lại thứ tự các buổi.");
      if (deletedClassId === classId) setActiveTabId(TOTAL_TAB_ID);
    } else if (deleteSessionFetcher.data && !deleteSessionFetcher.data.success) {
      setFeedback(deleteSessionFetcher.data.error);
    }
  }, [deleteSessionFetcher.data, classId]);

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
      setFeedback("Đã lưu điểm danh, bài tập và thông tin buổi học.");
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

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!pendingDeleteSession || !dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [pendingDeleteSession]);

  function changeClass(nextClassId: string) {
    const nextClass = classes.find((item) => item.id === nextClassId);
    if (!nextClass) return;
    setClassId(nextClass.id);
    setPendingReview(null);
    const nextSessions = sessionsByClass[nextClass.id] ?? nextClass.sessions;
    if (!sessionsByClass[nextClass.id]) {
      setSessionsByClass((current) => ({ ...current, [nextClass.id]: nextSessions }));
    }
    setActiveTabId(nextSessions[0]?.id ?? TOTAL_TAB_ID);
    setFilter("all");
    setSearch("");
    setFeedback("");
  }

  function addAttendanceSession() {
    if (!selectedClass) return;
    if (missedScheduleDates.length > 0) {
      setIsResolvingScheduleDates(true);
      return;
    }
    if (!sessionAvailability?.allowed || sessionAlreadyExistsToday) return;
    createAttendanceSession(sessionAvailability.date);
  }

  function createAttendanceSession(date: string) {
    if (!selectedClass) return;
    addSessionFetcher.submit(
      { intent: "create-session", classId: selectedClass.id, date },
      { method: "post" },
    );
    setFilter("all");
    setSearch("");
    setFeedback("");
  }

  function handleScheduleDate(date: string, intent: "create-session" | "cancel-scheduled-date") {
    if (!selectedClass) return;
    if (intent === "create-session") {
      createAttendanceSession(date);
      return;
    }
    scheduleActionFetcher.submit(
      { intent, classId: selectedClass.id, date },
      { method: "post" },
    );
  }

  function updateAttendanceSession(field: "lesson" | "lessonId" | "recordingUrl", value: string) {
    if (!selectedClass || !selectedAttendanceSession) return;
    setSessionsByClass((current) => ({
      ...current,
      [selectedClass.id]: (current[selectedClass.id] ?? selectedClass.sessions).map((session) =>
        session.id === selectedAttendanceSession.id ? { ...session, [field]: value } : session
      ),
    }));
    setFeedback("Có thay đổi chưa lưu.");
  }

  function deleteAttendanceSession() {
    if (!selectedAttendanceSession) return;
    setPendingDeleteSession(selectedAttendanceSession);
  }

  function confirmDeleteAttendanceSession() {
    if (!pendingDeleteSession) return;
    deleteSessionFetcher.submit(
      { intent: "delete-session", sessionId: pendingDeleteSession.id },
      { method: "post" },
    );
    setPendingDeleteSession(null);
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
    setFeedback("Có thay đổi chưa lưu.");
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
    setFeedback("Có thay đổi chưa lưu.");
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
    setFeedback("Có thay đổi chưa lưu.");
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
        document.getElementById(`absence-reason-${studentMissingAbsenceReason.id}`)?.focus();
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
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Điểm danh</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ghi nhận tình hình tham gia của học viên theo buổi học.</p>
          </div>
        </header>

        <section aria-label="Chọn lớp và buổi học" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <label htmlFor="attendance-class" className="mb-1.5 block text-sm font-medium">Lớp học</label>
              <select
                id="attendance-class"
                value={selectedClass.id}
                onChange={(event) => changeClass(event.currentTarget.value)}
                disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <p className="mt-1.5 truncate text-xs text-muted-foreground">{selectedClass.course}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3 sm:p-4">
              <div role="tablist" aria-label="Các buổi điểm danh" className="flex flex-wrap items-center gap-2">
                <button
                  id="attendance-tab-total"
                  type="button"
                  role="tab"
                  aria-selected={isTotalView}
                  aria-controls="attendance-session-panel"
                  disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                  onClick={() => {
                    setActiveTabId(TOTAL_TAB_ID);
                    setFilter("all");
                    setSearch("");
                    setFeedback("");
                  }}
                  className={`h-10 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isTotalView
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  Tổng
                </button>
                {attendanceSessions.map((session) => (
                  <div
                    key={session.id}
                    role="presentation"
                    className={`inline-flex items-center ${
                      selectedAttendanceSession?.id === session.id
                        ? "h-10 gap-1 rounded-md bg-primary px-1"
                        : ""
                    }`}
                  >
                    <button
                      id={`attendance-tab-${session.id}`}
                      type="button"
                      role="tab"
                      aria-selected={activeTabId === session.id}
                      aria-controls="attendance-session-panel"
                      disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                      onClick={() => {
                        setActiveTabId(session.id);
                        setFilter("all");
                        setSearch("");
                        setFeedback("");
                      }}
                      className={`border px-3 text-sm font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        activeTabId === session.id
                          ? selectedAttendanceSession?.id === session.id
                            ? "h-8 rounded-md border-transparent bg-transparent text-primary-foreground"
                            : "h-10 rounded-md border-primary bg-primary text-primary-foreground"
                          : "h-10 rounded-md border-border bg-background text-foreground hover:bg-muted"
                      }`}
                    >
                      {session.lesson.trim() ? `${session.title} - ${session.lesson.trim()}` : session.title}
                    </button>
                    {selectedAttendanceSession?.id === session.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={deleteAttendanceSession}
                        disabled={deleteSessionFetcher.state !== "idle" || saveAttendanceFetcher.state !== "idle"}
                        aria-label={`Xóa ${session.title}`}
                        title={`Xóa ${session.title}`}
                        className="h-8 w-8 shrink-0 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="default"
                size="icon"
                onClick={addAttendanceSession}
                disabled={!canStartSessionFlow || addSessionFetcher.state !== "idle" || scheduleActionFetcher.state !== "idle" || saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                aria-label={missedScheduleDates.length > 0 ? "Xử lý ngày học chưa ghi nhận" : addSessionFetcher.state !== "idle" ? "Đang thêm buổi học" : "Thêm buổi học theo lịch"}
                title={addSessionFetcher.state !== "idle" ? "Đang thêm buổi học" : sessionCreationMessage}
              >
                {addSessionFetcher.state !== "idle"
                  ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  : <Plus aria-hidden="true" className="h-4 w-4" />}
              </Button>
              <p className="basis-full px-1 text-xs text-muted-foreground" aria-live="polite">
                {sessionCreationMessage}
              </p>
            </div>

            {isTotalView ? (
              <div id="attendance-session-panel" role="tabpanel" aria-labelledby="attendance-tab-total" className="p-4 sm:p-5">
                <div>
                  <h2 className="text-sm font-semibold">Tổng hợp điểm danh</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tổng trạng thái và bài tập đã đánh dấu qua {attendanceSessions.length} buổi.
                  </p>
                </div>
              </div>
            ) : selectedAttendanceSession ? (
              <div id="attendance-session-panel" role="tabpanel" aria-labelledby={`attendance-tab-${selectedAttendanceSession.id}`} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-12">
                <div className="flex min-w-0 flex-col gap-1 xl:col-span-2">
                  <label htmlFor="attendance-lesson" className="text-sm text-muted-foreground">Bài học</label>
                  <input
                    id="attendance-lesson"
                    type="text"
                    value={selectedAttendanceSession.lesson}
                    onChange={(event) => updateAttendanceSession("lesson", event.currentTarget.value)}
                    maxLength={120}
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1 xl:col-span-3">
                  <label htmlFor="attendance-course-lesson" className="text-sm text-muted-foreground">Bài học trong buổi</label>
                  <select
                    id="attendance-course-lesson"
                    value={selectedAttendanceSession.lessonId ?? ""}
                    onChange={(event) => updateAttendanceSession("lessonId", event.currentTarget.value)}
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Không gắn bài học</option>
                    {selectedClass.courseLessons.map((lesson, index) => (
                      <option key={lesson.id} value={lesson.id}>Bài {index + 1} · {lesson.title}</option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-0 flex-col gap-1 xl:col-span-2">
                  <span className="text-sm text-muted-foreground">Ngày</span>
                  <p className="flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                    {new Date(`${selectedAttendanceSession.date}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
                      timeZone: "UTC",
                      dateStyle: "long",
                    })}
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 xl:col-span-3">
                  <label htmlFor="attendance-recording-url" className="text-sm text-muted-foreground">Link bản ghi buổi học</label>
                  <input
                    id="attendance-recording-url"
                    type="url"
                    inputMode="url"
                    value={selectedAttendanceSession.recordingUrl ?? ""}
                    onChange={(event) => updateAttendanceSession("recordingUrl", event.currentTarget.value)}
                    maxLength={2048}
                    placeholder="https://..."
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            ) : (
              <div id="attendance-session-panel" role="tabpanel" className="p-5 text-sm text-muted-foreground">
                Chưa có buổi học. Chọn “Thêm buổi” để tạo buổi điểm danh.
              </div>
            )}
          </div>
        </section>

        <section aria-label="Tổng hợp trạng thái" className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card sm:grid-cols-4">
          <div className="col-span-3 flex items-center gap-3 border-b p-4 sm:col-span-1 sm:border-b-0 sm:border-r">
            <Users aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Sĩ số</p>
              <p className="text-lg font-semibold tabular-nums">{counts.total}</p>
            </div>
          </div>
          <div className="border-r p-4 sm:border-r">
            <p className="text-xs text-muted-foreground">Có mặt</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-success">{counts.present}</p>
          </div>
          <div className="border-r p-4 sm:border-r">
            <p className="text-xs text-muted-foreground">Đi muộn</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning">{counts.late}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">Vắng mặt</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-destructive">{counts.absent}</p>
          </div>
        </section>

        <section aria-labelledby="student-roster-heading" className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="space-y-4 border-b p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="student-roster-heading" className="text-base font-semibold">
                  {isTotalView ? "Tổng hợp theo học viên" : "Danh sách học viên"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isTotalView
                    ? `Số lần ghi nhận trên ${attendanceSessions.length} buổi`
                    : <>Đã điểm danh <span className="font-medium tabular-nums text-foreground">{markedCount}/{counts.total}</span></>}
                </p>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Tìm học viên..."
                  aria-label="Tìm học viên"
                  className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            {!isTotalView && (
              <div role="group" aria-label="Lọc theo trạng thái" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    filter === option.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              </div>
            )}
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
            <table className="w-full min-w-[1036px] border-collapse text-left">
              <caption className="sr-only">Điểm danh và tình trạng bài tập của học viên</caption>
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th scope="col" className="w-[56px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">STT</th>
                  <th scope="col" className="w-[230px] px-5 py-3 text-xs font-semibold text-muted-foreground">Học viên</th>
                  <th scope="col" className="w-[340px] px-4 py-3 text-xs font-semibold text-muted-foreground">Điểm danh</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Ghi âm</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Chữ Hán</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Duet</th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-center text-xs font-semibold text-muted-foreground">Bài link</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleStudents.map((student, index) => {
                  const record = attendance[student.id];
                  const { status, absenceReason } = record;
                  const initials = student.name.split(" ").slice(-2).map((part) => part[0]).join("");

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors hover:bg-muted/30 ${consecutiveAbsenceStudentIds.has(student.id) ? "bg-destructive/5" : ""}`}
                    >
                      <td className="px-3 py-3.5 text-center text-sm tabular-nums text-muted-foreground">{index + 1}</td>
                      <th scope="row" className="px-5 py-3.5 text-left">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">
                            {initials}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{student.name}</span>
                            {consecutiveAbsenceStudentIds.has(student.id) && <ConsecutiveAbsenceBadge />}
                          </span>
                        </div>
                      </th>
                      <td className="px-4 py-3.5">
                        <div className={`grid gap-2 ${status === "absent" ? "grid-cols-2" : "grid-cols-1"}`}>
                          <label htmlFor={`status-${student.id}`} className="sr-only">Trạng thái điểm danh của {student.name}</label>
                          <select
                            id={`status-${student.id}`}
                            value={status ?? ""}
                            onChange={(event) => changeStatus(student.id, event.currentTarget.value)}
                            disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                            className={`h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              status ? STATUS_OPTIONS.find((option) => option.value === status)?.tone : "text-muted-foreground"
                            }`}
                          >
                            <option value="">Chưa điểm danh</option>
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          {status === "absent" && (
                            <>
                              <label htmlFor={`absence-reason-${student.id}`} className="sr-only">Loại vắng của {student.name}</label>
                              <select
                                id={`absence-reason-${student.id}`}
                                value={absenceReason ?? ""}
                                onChange={(event) => changeAbsenceReason(student.id, event.currentTarget.value)}
                                disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                                aria-invalid={!absenceReason}
                                aria-describedby={!absenceReason ? `absence-reason-error-${student.id}` : undefined}
                                className={`h-10 min-w-0 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                  absenceReason ? "border-input" : "border-destructive"
                                } ${
                                  absenceReason ? "text-foreground" : "text-muted-foreground"
                                }`}
                              >
                                <option value="">Chọn loại vắng</option>
                                <option value="excused">Có phép</option>
                                <option value="unexcused">Không phép</option>
                              </select>
                              {!absenceReason && (
                                <p
                                  id={`absence-reason-error-${student.id}`}
                                  role="alert"
                                  className="col-span-2 text-xs text-destructive"
                                >
                                  Vui lòng chọn loại vắng.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      {ATTENDANCE_TASKS.map(({ key, label }) => (
                        <td key={key} className="px-3 py-3.5 text-center">
                          <label className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
                            <span className="sr-only">{label} của {student.name}</span>
                            <input
                              type="checkbox"
                              checked={record.tasks[key]}
                              onChange={(event) => changeTask(student.id, key, event.currentTarget.checked)}
                              disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
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
                : "Chọn một buổi học hoặc thêm buổi mới để bắt đầu điểm danh.")}
            </p>
            {selectedAttendanceSession && (
              <Button
                type="button"
                className="w-full gap-2 sm:w-auto"
                disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                onClick={saveAttendance}
              >
                <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
                {saveAttendanceFetcher.state !== "idle" ? "Đang lưu..." : "Lưu điểm danh"}
              </Button>
            )}
          </footer>
        </section>

        {isResolvingScheduleDates && selectedClass && (
          <Overlay
            onClose={() => {
              if (addSessionFetcher.state === "idle" && scheduleActionFetcher.state === "idle") {
                setIsResolvingScheduleDates(false);
              }
            }}
            className="max-w-2xl"
          >
            <section aria-labelledby="missed-schedule-title" className="space-y-5">
              <header className="space-y-1">
                <h2 id="missed-schedule-title" className="text-xl font-semibold">Xử lý ngày học chưa ghi nhận</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedClass.name} có {missedScheduleDates.length} ngày theo lịch chưa có buổi điểm danh.
                  Với mỗi ngày, hãy tạo buổi bù hoặc xác nhận lớp nghỉ. Các buổi sẽ được đánh số theo ngày học.
                </p>
              </header>

              {((addSessionFetcher.data && !addSessionFetcher.data.success)
                || (scheduleActionFetcher.data && !scheduleActionFetcher.data.success)) && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {addSessionFetcher.data && !addSessionFetcher.data.success
                    ? addSessionFetcher.data.error
                    : scheduleActionFetcher.data && !scheduleActionFetcher.data.success
                      ? scheduleActionFetcher.data.error
                      : ""}
                </p>
              )}

              {missedScheduleDates.length > 0 ? (
                <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                  {missedScheduleDates.map((date) => (
                    <article key={date} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                      <p className="text-sm font-medium">
                        {new Date(`${date}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
                          timeZone: "UTC",
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleScheduleDate(date, "create-session")}
                          disabled={addSessionFetcher.state !== "idle" || scheduleActionFetcher.state !== "idle"}
                          className="w-full sm:w-auto"
                        >
                          {addSessionFetcher.state !== "idle" && addSessionFetcher.formData?.get("date") === date
                            ? "Đang tạo..."
                            : "Tạo buổi bù"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleScheduleDate(date, "cancel-scheduled-date")}
                          disabled={addSessionFetcher.state !== "idle" || scheduleActionFetcher.state !== "idle"}
                          className="w-full sm:w-auto"
                        >
                          {scheduleActionFetcher.state !== "idle" && scheduleActionFetcher.formData?.get("date") === date
                            ? "Đang lưu..."
                            : "Đánh dấu lớp nghỉ"}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-success/30 bg-success/5 p-4">
                  <p className="text-sm font-medium">Đã xử lý hết các ngày học còn thiếu.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {sessionAlreadyExistsToday
                      ? "Buổi học hôm nay đã được tạo."
                      : "Bạn có thể tạo buổi học hôm nay nếu lớp có lịch học."}
                  </p>
                </div>
              )}

              <footer className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsResolvingScheduleDates(false)}
                  disabled={addSessionFetcher.state !== "idle" || scheduleActionFetcher.state !== "idle"}
                  className="w-full sm:w-auto"
                >
                  Đóng
                </Button>
                {missedScheduleDates.length === 0 && sessionAvailability?.allowed && !sessionAlreadyExistsToday && (
                  <Button
                    type="button"
                    onClick={() => createAttendanceSession(sessionAvailability.date)}
                    disabled={addSessionFetcher.state !== "idle"}
                    className="w-full sm:w-auto"
                  >
                    {addSessionFetcher.state !== "idle" ? "Đang tạo..." : "Tạo buổi học hôm nay"}
                  </Button>
                )}
              </footer>
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

        <dialog
          ref={deleteDialogRef}
          aria-labelledby="delete-attendance-title"
          aria-describedby="delete-attendance-description"
          onCancel={(event) => {
            event.preventDefault();
            setPendingDeleteSession(null);
          }}
          className="fixed left-1/2 top-1/2 m-0 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-foreground/30 backdrop:backdrop-blur-[2px]"
        >
          <div className="space-y-3 p-6">
            <h2 id="delete-attendance-title" className="text-lg font-semibold">Xóa buổi điểm danh?</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {pendingDeleteSession && (
                <>Buổi <span className="font-medium text-foreground">{pendingDeleteSession.title}</span>
                  {pendingDeleteSession.lesson.trim() && <> – {pendingDeleteSession.lesson.trim()}</>}</>
              )}
            </p>
            <p id="delete-attendance-description" className="text-sm leading-6 text-muted-foreground">
              Buổi học cùng toàn bộ trạng thái điểm danh và bài tập đã ghi nhận sẽ bị xóa. Bạn không thể khôi phục dữ liệu này.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-muted/30 p-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              autoFocus
              disabled={deleteSessionFetcher.state !== "idle"}
              onClick={() => setPendingDeleteSession(null)}
            >
              Giữ lại
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteSessionFetcher.state !== "idle"}
              onClick={confirmDeleteAttendanceSession}
            >
              {deleteSessionFetcher.state !== "idle" ? "Đang xóa..." : "Xóa buổi điểm danh"}
            </Button>
          </div>
        </dialog>
      </div>
    </AppShell>
  );
}
