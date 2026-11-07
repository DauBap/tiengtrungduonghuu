import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { ClipboardCheck, Search, Users } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { ConsecutiveAbsenceBadge, ConsecutiveAbsenceNotice } from "~/components/attendance/consecutive-absence-notice";
import { Button } from "~/components/ui/button";
import { getStudentsAbsentForThreeConsecutiveSessions } from "~/lib/attendance-streak";
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
  courseLessons: { id: string; order: number; title: string }[];
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
  records: Record<string, AttendanceRecord>;
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

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id, completedAt: null },
    select: {
      id: true,
      name: true,
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
      courseLessons: classroom.course.lessons,
      students: classroom.enrollments.map(({ user: student }) => ({ id: student.id, name: student.name })),
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
    const classroom = await prisma.class.findFirst({
      where: { id: classId, teacherId: user.id, completedAt: null },
      select: { id: true },
    });
    if (!classroom) return { success: false as const, error: "Không tìm thấy lớp hoặc bạn không có quyền điểm danh lớp này." };
    const existing = await prisma.attendanceSession.findMany({
      where: { classId },
      select: { title: true },
    });
    const nextNumber = existing.reduce((highest, session) => {
      const number = Number(session.title.match(/\d+$/)?.[0] ?? 0);
      return Math.max(highest, number);
    }, 0) + 1;
    const enrolledStudents = await prisma.enrollment.findMany({
      where: {
        classId,
        user: { is: { role: "student", isActive: true, deletedAt: null } },
      },
      select: { userId: true },
    });
    const session = await prisma.$transaction(async (tx) => {
      const createdSession = await tx.attendanceSession.create({
        data: {
          classId,
          title: `Buổi ${nextNumber}`,
          lesson: "",
          date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
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
      return createdSession;
    });
    return {
      success: true as const,
      intent,
      classId,
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
  }

  const sessionId = String(form.get("sessionId") ?? "");
  const session = sessionId
    ? await prisma.attendanceSession.findFirst({
        where: { id: sessionId, class: { is: { teacherId: user.id, completedAt: null } } },
        select: { id: true, classId: true, class: { select: { courseId: true } } },
      })
    : null;
  if (!session) return { success: false as const, error: "Không tìm thấy buổi học hoặc bạn không có quyền sửa buổi này." };

  if (intent === "delete-session") {
    await prisma.attendanceSession.delete({ where: { id: session.id } });
    return { success: true as const, intent, sessionId, classId: session.classId };
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
      select: { userId: true },
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
    return { success: true as const, intent, sessionId, classId: session.classId };
  }

  return { success: false as const, error: "Thao tác điểm danh không hợp lệ." };
}

export default function TeacherAttendance() {
  const { user, classes } = useLoaderData<typeof loader>();
  const addSessionFetcher = useFetcher<typeof action>();
  const deleteSessionFetcher = useFetcher<typeof action>();
  const saveAttendanceFetcher = useFetcher<typeof action>();
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
  const [activeTabId, setActiveTabId] = useState(classes[0]?.sessions[0]?.id ?? TOTAL_TAB_ID);
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingDeleteSession, setPendingDeleteSession] = useState<AttendanceSession | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const selectedClass = classes.find((item) => item.id === classId) ?? classes[0] ?? null;
  const attendanceSessions = selectedClass ? sessionsByClass[selectedClass.id] ?? selectedClass.sessions : [];
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
    const result = addSessionFetcher.data;
    if (!result?.success || result.intent !== "create-session" || !("session" in result) || !result.session) return;
    const session = result.session;
    setSessionsByClass((current) => ({
      ...current,
      [result.classId]: (current[result.classId] ?? []).some((item) => item.id === session.id)
        ? current[result.classId]
        : [...(current[result.classId] ?? []), session],
    }));
    setAttendanceBySession((current) => ({ ...current, [`${result.classId}:${session.id}`]: {} }));
    if (result.classId === classId) setActiveTabId(session.id);
  }, [addSessionFetcher.data, classId]);

  useEffect(() => {
    if (addSessionFetcher.data && !addSessionFetcher.data.success) setFeedback(addSessionFetcher.data.error);
  }, [addSessionFetcher.data]);

  useEffect(() => {
    if (deleteSessionFetcher.data?.success && deleteSessionFetcher.data.intent === "delete-session" && "sessionId" in deleteSessionFetcher.data && "classId" in deleteSessionFetcher.data) {
      const deletedId = typeof deleteSessionFetcher.data.sessionId === "string" ? deleteSessionFetcher.data.sessionId : "";
      const deletedClassId = typeof deleteSessionFetcher.data.classId === "string" ? deleteSessionFetcher.data.classId : "";
      if (!deletedId || !deletedClassId) return;
      setSessionsByClass((current) => ({
        ...current,
        [deletedClassId]: (current[deletedClassId] ?? []).filter((session) => session.id !== deletedId),
      }));
      setAttendanceBySession((current) => {
        const next = { ...current };
        delete next[`${deletedClassId}:${deletedId}`];
        return next;
      });
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
    } else if (saveAttendanceFetcher.data && !saveAttendanceFetcher.data.success) {
      setFeedback(saveAttendanceFetcher.data.error);
    }
  }, [saveAttendanceFetcher.data, selectedClass?.id, selectedAttendanceSession?.id]);

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
    addSessionFetcher.submit(
      { intent: "create-session", classId: selectedClass.id },
      { method: "post" },
    );
    setFilter("all");
    setSearch("");
    setFeedback("");
  }

  function updateAttendanceSession(field: "lesson" | "lessonId" | "date" | "recordingUrl", value: string) {
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

  function saveAttendance() {
    if (!selectedClass || !selectedAttendanceSession) return;
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
                  <button
                    key={session.id}
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
                    className={`h-10 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      activeTabId === session.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:bg-muted"
                    }`}
                  >
                    {session.lesson.trim() ? `${session.title} - ${session.lesson.trim()}` : session.title}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={addAttendanceSession}
                disabled={addSessionFetcher.state !== "idle" || saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                className="h-10 rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {addSessionFetcher.state !== "idle" ? "Đang thêm..." : "Thêm buổi"}
              </button>
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
              <div id="attendance-session-panel" role="tabpanel" aria-labelledby={`attendance-tab-${selectedAttendanceSession.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:p-5">
                <div className="flex items-center gap-2">
                  <label htmlFor="attendance-lesson" className="shrink-0 text-sm text-muted-foreground">Bài học</label>
                  <input
                    id="attendance-lesson"
                    type="text"
                    value={selectedAttendanceSession.lesson}
                    onChange={(event) => updateAttendanceSession("lesson", event.currentTarget.value)}
                    maxLength={120}
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-36 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <label htmlFor="attendance-course-lesson" className="shrink-0 text-sm text-muted-foreground">Gắn với bài</label>
                  <select
                    id="attendance-course-lesson"
                    value={selectedAttendanceSession.lessonId ?? ""}
                    onChange={(event) => updateAttendanceSession("lessonId", event.currentTarget.value)}
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
                  >
                    <option value="">Không gắn bài học</option>
                    {selectedClass.courseLessons.map((lesson, index) => (
                      <option key={lesson.id} value={lesson.id}>Bài {index + 1} · {lesson.title}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="attendance-date" className="shrink-0 text-sm text-muted-foreground">Ngày</label>
                  <input
                    id="attendance-date"
                    type="date"
                    value={selectedAttendanceSession.date}
                    onChange={(event) => updateAttendanceSession("date", event.currentTarget.value)}
                    disabled={saveAttendanceFetcher.state !== "idle" || deleteSessionFetcher.state !== "idle"}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <label htmlFor="attendance-recording-url" className="shrink-0 text-sm text-muted-foreground">Link record</label>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={deleteAttendanceSession}
                  disabled={deleteSessionFetcher.state !== "idle" || saveAttendanceFetcher.state !== "idle"}
                  className="w-full sm:ml-auto sm:w-auto"
                >
                  {deleteSessionFetcher.state !== "idle" ? "Đang xóa..." : "Xóa buổi này"}
                </Button>
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
                                className={`h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                  absenceReason ? "text-foreground" : "text-muted-foreground"
                                }`}
                              >
                                <option value="">Chọn loại vắng</option>
                                <option value="excused">Có phép</option>
                                <option value="unexcused">Không phép</option>
                              </select>
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
