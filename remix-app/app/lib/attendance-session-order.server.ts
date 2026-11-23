import type { Prisma } from "@prisma/client";

type OrderedSession = { id: string; title: string };
type ClassSessionOrderSnapshot = {
  sessions: OrderedSession[];
  midtermReviewSession: number | null;
  finalReviewSession: number | null;
};

export async function getClassSessionOrderSnapshot(
  tx: Prisma.TransactionClient,
  classId: string,
): Promise<ClassSessionOrderSnapshot> {
  const [classroom, sessions] = await Promise.all([
    tx.class.findUnique({
      where: { id: classId },
      select: { midtermReviewSession: true, finalReviewSession: true },
    }),
    tx.attendanceSession.findMany({
      where: { classId },
      orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true },
    }),
  ]);
  if (!classroom) throw new Error(`Class ${classId} was not found while ordering attendance sessions.`);
  return { sessions, ...classroom };
}

export async function renumberClassAttendanceSessions(
  tx: Prisma.TransactionClient,
  classId: string,
  previous: ClassSessionOrderSnapshot,
) {
  const sessions = await tx.attendanceSession.findMany({
    where: { classId },
    orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });
  const nextNumberById = new Map(sessions.map(({ id }, index) => [id, index + 1]));
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
    const oldSession = previous.sessions[review.sessionNumber - 1];
    const nextNumber = oldSession ? nextNumberById.get(oldSession.id) : undefined;
    if (nextNumber !== undefined && nextNumber !== review.sessionNumber) {
      await tx.studentClassReview.update({
        where: { id: review.id },
        data: { sessionNumber: nextNumber },
      });
    }
  }

  const getNextReviewNumber = (configuredNumber: number | null) => {
    if (configuredNumber === null) return null;
    const oldSession = previous.sessions[configuredNumber - 1];
    return oldSession ? nextNumberById.get(oldSession.id) ?? configuredNumber : configuredNumber;
  };
  const midtermReviewSession = getNextReviewNumber(previous.midtermReviewSession);
  const finalReviewSession = getNextReviewNumber(previous.finalReviewSession);
  if (
    midtermReviewSession !== previous.midtermReviewSession
    || finalReviewSession !== previous.finalReviewSession
  ) {
    await tx.class.update({
      where: { id: classId },
      data: { midtermReviewSession, finalReviewSession },
    });
  }

  return sessions.map(({ id }, index) => ({ id, title: `Buổi ${index + 1}` }));
}
