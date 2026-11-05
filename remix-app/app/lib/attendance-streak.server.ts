import { prisma } from "~/lib/prisma.server";
import { getStudentsAbsentForThreeConsecutiveSessions } from "~/lib/attendance-streak";

export interface ConsecutiveAbsenceAlert {
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  sessionId: string;
  sessionDate: Date;
  sessionCreatedAt: Date;
  sessions: { id: string; title: string; date: string }[];
}

export async function excludeHandledAbsenceAlerts(alerts: ConsecutiveAbsenceAlert[]) {
  if (alerts.length === 0) return alerts;

  const dismissalDelegate = Reflect.get(
    prisma as object,
    "attendanceAbsenceDismissal",
  ) as {
    findMany: (args: unknown) => Promise<Array<{
      classId: string;
      studentId: string;
      handledSession: { id: string; date: Date; createdAt: Date };
    }>>;
  } | undefined;
  if (!dismissalDelegate?.findMany) return alerts;

  let dismissals;
  try {
    dismissals = await dismissalDelegate.findMany({
      where: {
        OR: alerts.map(({ classId, studentId }) => ({ classId, studentId })),
      },
      select: {
        classId: true,
        studentId: true,
        handledSession: { select: { id: true, date: true, createdAt: true } },
      },
    });
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "P2021"
    ) {
      return alerts;
    }
    throw error;
  }
  if (dismissals.length === 0) return alerts;

  const alertsByClass = new Map<string, ConsecutiveAbsenceAlert[]>();
  for (const alert of alerts) {
    const classAlerts = alertsByClass.get(alert.classId) ?? [];
    classAlerts.push(alert);
    alertsByClass.set(alert.classId, classAlerts);
  }
  const sessionsByClass = new Map<string, {
    id: string;
    date: Date;
    createdAt: Date;
    records: { studentId: string; status: string | null }[];
  }[]>();

  for (const [classId, classAlerts] of alertsByClass) {
    const classDismissals = dismissals.filter((dismissal) => dismissal.classId === classId);
    if (classDismissals.length === 0) continue;
    const earliestDate = classDismissals.reduce(
      (earliest, dismissal) => dismissal.handledSession.date < earliest ? dismissal.handledSession.date : earliest,
      classDismissals[0]!.handledSession.date,
    );
    const latestDate = classAlerts.reduce(
      (latest, alert) => alert.sessionDate > latest ? alert.sessionDate : latest,
      classAlerts[0]!.sessionDate,
    );
    if (earliestDate > latestDate) continue;

    const classSessions = await prisma.attendanceSession.findMany({
      where: {
        classId,
        date: { gte: earliestDate, lte: latestDate },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        createdAt: true,
        records: {
          where: { studentId: { in: classAlerts.map(({ studentId }) => studentId) } },
          select: { studentId: true, status: true },
        },
      },
    });
    sessionsByClass.set(classId, classSessions);
  }

  const dismissalByStudent = new Map(
    dismissals.map((dismissal) => [`${dismissal.classId}:${dismissal.studentId}`, dismissal]),
  );
  return alerts.filter((alert) => {
    const dismissal = dismissalByStudent.get(`${alert.classId}:${alert.studentId}`);
    if (!dismissal) return true;

    const sessions = sessionsByClass.get(alert.classId) ?? [];
    const handledIndex = sessions.findIndex((session) => session.id === dismissal.handledSession.id);
    const currentIndex = sessions.findIndex((session) => session.id === alert.sessionId);
    if (currentIndex <= handledIndex) return false;

    for (const session of sessions.slice(handledIndex + 1, currentIndex + 1)) {
      const record = session.records.find(({ studentId }) => studentId === alert.studentId);
      if (record?.status !== "ABSENT") return true;
    }
    return false;
  });
}

export async function handleConsecutiveAbsenceAlert({
  classId,
  studentId,
  sessionId,
  handledById,
}: {
  classId: string;
  studentId: string;
  sessionId: string;
  handledById: string;
}) {
  const targetSession = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, classId },
    select: { id: true, date: true, createdAt: true },
  });
  if (!targetSession) return false;

  const sessionsDescending = await prisma.attendanceSession.findMany({
    where: {
      classId,
      OR: [
        { date: { lt: targetSession.date } },
        { date: targetSession.date, createdAt: { lte: targetSession.createdAt } },
      ],
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 3,
    select: {
      id: true,
      records: {
        where: { studentId },
        select: { studentId: true, status: true },
      },
    },
  });
  const sessions = [...sessionsDescending].reverse();
  if (!getStudentsAbsentForThreeConsecutiveSessions(sessions, sessionId).has(studentId)) return false;

  const dismissalDelegate = Reflect.get(
    prisma as object,
    "attendanceAbsenceDismissal",
  ) as {
    upsert: (args: unknown) => Promise<unknown>;
  } | undefined;
  if (!dismissalDelegate?.upsert) return false;

  try {
    await dismissalDelegate.upsert({
      where: { classId_studentId: { classId, studentId } },
      create: { classId, studentId, handledSessionId: sessionId, handledById },
      update: { handledSessionId: sessionId, handledById, handledAt: new Date() },
    });
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "P2021"
    ) {
      return false;
    }
    throw error;
  }
  return true;
}
