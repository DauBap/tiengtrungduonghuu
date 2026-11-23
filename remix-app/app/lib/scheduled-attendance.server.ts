import { Prisma } from "@prisma/client";
import {
  addDaysToDateString,
  getScheduledOccurrences,
  getVietnameseDateString,
} from "~/lib/schedule-utils";
import { prisma } from "~/lib/prisma.server";

const LOOKAHEAD_DAYS = 30;
const MAX_TRANSACTION_ATTEMPTS = 3;

type SyncResult = {
  classesProcessed: number;
  sessionsCreated: number;
  sessionsRemoved: number;
};

function laterDate(left: string, right: string) {
  return left > right ? left : right;
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function syncClassSessions(classId: string, now: Date): Promise<SyncResult> {
  const today = getVietnameseDateString(now);
  const lookaheadEnd = addDaysToDateString(today, LOOKAHEAD_DAYS);
  if (!lookaheadEnd) throw new Error("Could not calculate attendance session date range.");

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const classroom = await tx.class.findFirst({
          where: { id: classId, completedAt: null },
          select: {
            id: true,
            startDate: true,
            scheduleEffectiveFrom: true,
            schedule: true,
            midtermReviewSession: true,
            finalReviewSession: true,
          },
        });
        if (!classroom) {
          return { classesProcessed: 0, sessionsCreated: 0, sessionsRemoved: 0 };
        }

        const rangeStart = laterDate(
          getVietnameseDateString(classroom.startDate),
          getVietnameseDateString(classroom.scheduleEffectiveFrom),
        );
        const scheduledOccurrences = getScheduledOccurrences(classroom.schedule, rangeStart, lookaheadEnd);
        const scheduledOccurrenceKeys = new Set(scheduledOccurrences.map(
          ({ date, startTime, endTime }) => `${date}|${startTime}|${endTime}`,
        ));
        const [existingSessions, cancellations] = await Promise.all([
          tx.attendanceSession.findMany({
            where: { classId },
            orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              date: true,
              scheduleStartTime: true,
              scheduleEndTime: true,
              isScheduleGenerated: true,
              createdAt: true,
              _count: { select: { records: true } },
            },
          }),
          tx.classScheduleCancellation.findMany({
            where: { classId, date: { gte: new Date(`${rangeStart}T00:00:00.000Z`), lte: new Date(`${lookaheadEnd}T00:00:00.000Z`) } },
            select: { date: true, startTime: true, endTime: true },
          }),
        ]);
        const previousSessionIds = existingSessions.map(({ id }) => id);
        const cancelledDateSet = new Set(cancellations
          .filter(({ startTime, endTime }) => startTime === null && endTime === null)
          .map(({ date }) => date.toISOString().slice(0, 10)));
        const cancelledOccurrenceKeys = new Set(cancellations
          .filter(({ startTime, endTime }) => startTime !== null && endTime !== null)
          .map(({ date, startTime, endTime }) =>
            `${date.toISOString().slice(0, 10)}|${startTime}|${endTime}`,
          ));
        const approvedLeaveRequests = await tx.teacherLeaveRequest.findMany({
          where: {
            classId,
            status: "APPROVED",
            date: { gte: new Date(`${rangeStart}T00:00:00.000Z`), lte: new Date(`${lookaheadEnd}T00:00:00.000Z`) },
          },
          select: { date: true, startTime: true, endTime: true },
        });
        for (const leave of approvedLeaveRequests) {
          cancelledOccurrenceKeys.add(
            `${leave.date.toISOString().slice(0, 10)}|${leave.startTime}|${leave.endTime}`,
          );
        }
        const isOccurrenceCancelled = (occurrence: { date: string; startTime: string; endTime: string }) =>
          cancelledDateSet.has(occurrence.date)
          || cancelledOccurrenceKeys.has(`${occurrence.date}|${occurrence.startTime}|${occurrence.endTime}`);
        const occupiedOccurrenceKeys = new Set(existingSessions
          .filter(({ scheduleStartTime, scheduleEndTime }) =>
            scheduleStartTime !== null && scheduleEndTime !== null,
          )
          .map(({ date, scheduleStartTime, scheduleEndTime }) =>
            `${date.toISOString().slice(0, 10)}|${scheduleStartTime}|${scheduleEndTime}`,
          ));
        let legacySessionsUpdated = 0;
        const legacySessions = existingSessions
          .filter(({ scheduleStartTime, scheduleEndTime }) =>
            scheduleStartTime === null && scheduleEndTime === null,
          )
          .sort((left, right) =>
            left.date.getTime() - right.date.getTime()
            || left.createdAt.getTime() - right.createdAt.getTime(),
          );
        for (const session of legacySessions) {
          const date = session.date.toISOString().slice(0, 10);
          const occurrence = scheduledOccurrences.find((item) =>
            item.date === date
            && !occupiedOccurrenceKeys.has(`${item.date}|${item.startTime}|${item.endTime}`)
            && !isOccurrenceCancelled(item),
          );
          if (!occurrence) continue;
          await tx.attendanceSession.update({
            where: { id: session.id },
            data: {
              scheduleStartTime: occurrence.startTime,
              scheduleEndTime: occurrence.endTime,
              isScheduleGenerated: true,
            },
          });
          session.scheduleStartTime = occurrence.startTime;
          session.scheduleEndTime = occurrence.endTime;
          session.isScheduleGenerated = true;
          occupiedOccurrenceKeys.add(`${occurrence.date}|${occurrence.startTime}|${occurrence.endTime}`);
          legacySessionsUpdated += 1;
        }
        const removedSessions = existingSessions.filter((session) => {
          const date = session.date.toISOString().slice(0, 10);
          return session.isScheduleGenerated
            && date > today
            && (
              !scheduledOccurrenceKeys.has(`${date}|${session.scheduleStartTime}|${session.scheduleEndTime}`)
              || cancelledDateSet.has(date)
              || cancelledOccurrenceKeys.has(`${date}|${session.scheduleStartTime}|${session.scheduleEndTime}`)
            )
            && session._count.records === 0;
        });
        if (removedSessions.length > 0) {
          await tx.attendanceSession.deleteMany({
            where: { id: { in: removedSessions.map(({ id }) => id) } },
          });
        }

        const removedIds = new Set(removedSessions.map(({ id }) => id));
        const retainedSessions = existingSessions.filter(({ id }) => !removedIds.has(id));
        const existingOccurrenceKeys = new Set(retainedSessions
          .filter(({ scheduleStartTime, scheduleEndTime }) =>
            scheduleStartTime !== null && scheduleEndTime !== null,
          )
          .map(({ date, scheduleStartTime, scheduleEndTime }) =>
            `${date.toISOString().slice(0, 10)}|${scheduleStartTime}|${scheduleEndTime}`,
          ));
        const missingOccurrences = scheduledOccurrences.filter((occurrence) =>
          !existingOccurrenceKeys.has(`${occurrence.date}|${occurrence.startTime}|${occurrence.endTime}`)
          && !isOccurrenceCancelled(occurrence),
        );
        if (missingOccurrences.length > 0) {
          await tx.attendanceSession.createMany({
            data: missingOccurrences.map(({ date, startTime, endTime }) => ({
              classId,
              title: "",
              lesson: "",
              date: new Date(`${date}T00:00:00.000Z`),
              scheduleStartTime: startTime,
              scheduleEndTime: endTime,
              isScheduleGenerated: true,
            })),
          });
        }

        const sessionsChanged = missingOccurrences.length > 0
          || removedSessions.length > 0
          || legacySessionsUpdated > 0;
        if (!sessionsChanged) {
          return { classesProcessed: 1, sessionsCreated: 0, sessionsRemoved: 0 };
        }

        const sessions = await tx.attendanceSession.findMany({
          where: { classId },
          orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true },
        });
        const newSessionNumberById = new Map(sessions.map(({ id }, index) => [id, index + 1]));
        for (let index = 0; index < sessions.length; index += 1) {
          const title = `Buổi ${index + 1}`;
          if (sessions[index].title !== title) {
            await tx.attendanceSession.update({
              where: { id: sessions[index].id },
              data: { title },
            });
          }
        }

        const reviews = await tx.studentClassReview.findMany({
          where: { classId },
          select: { id: true, sessionNumber: true },
        });
        for (const review of reviews) {
          const oldSessionId = previousSessionIds[review.sessionNumber - 1];
          const nextSessionNumber = oldSessionId ? newSessionNumberById.get(oldSessionId) : undefined;
          if (nextSessionNumber !== undefined && nextSessionNumber !== review.sessionNumber) {
            await tx.studentClassReview.update({
              where: { id: review.id },
              data: { sessionNumber: nextSessionNumber },
            });
          }
        }

        const getUpdatedReviewNumber = (configuredNumber: number | null) => {
          if (configuredNumber === null) return null;
          const oldSessionId = previousSessionIds[configuredNumber - 1];
          return oldSessionId
            ? newSessionNumberById.get(oldSessionId) ?? configuredNumber
            : configuredNumber;
        };
        const midtermReviewSession = getUpdatedReviewNumber(classroom.midtermReviewSession);
        const finalReviewSession = getUpdatedReviewNumber(classroom.finalReviewSession);
        if (
          midtermReviewSession !== classroom.midtermReviewSession
          || finalReviewSession !== classroom.finalReviewSession
        ) {
          await tx.class.update({
            where: { id: classId },
            data: { midtermReviewSession, finalReviewSession },
          });
        }

        return {
          classesProcessed: 1,
          sessionsCreated: missingOccurrences.length,
          sessionsRemoved: removedSessions.length,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
    }
  }

  throw new Error(`Could not sync scheduled sessions for class ${classId}.`);
}

export async function syncScheduledAttendanceSessionsForClass(classId: string, now = new Date()) {
  return syncClassSessions(classId, now);
}

export async function syncScheduledAttendanceSessions(now = new Date()): Promise<SyncResult> {
  const classes = await prisma.class.findMany({
    where: { completedAt: null },
    select: { id: true },
  });
  const total: SyncResult = { classesProcessed: 0, sessionsCreated: 0, sessionsRemoved: 0 };
  for (const classroom of classes) {
    const result = await syncClassSessions(classroom.id, now);
    total.classesProcessed += result.classesProcessed;
    total.sessionsCreated += result.sessionsCreated;
    total.sessionsRemoved += result.sessionsRemoved;
  }
  return total;
}
