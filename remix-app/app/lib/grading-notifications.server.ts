import { prisma } from "~/lib/prisma.server";

export async function notifyAssignedTeacherOfPendingWork(input: {
  studentId: string;
  courseId: string;
  attemptId: string;
  lessonId: string;
  kind: "GRAMMAR_GRADING_REQUEST" | "WORKBOOK_GRADING_REQUEST";
  studentName: string;
  sectionTitle: string;
  targetUrl: string;
}) {
  const [enrollment, lesson] = await Promise.all([
    prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: input.studentId, courseId: input.courseId } },
      select: { class: { select: { teacherId: true } } },
    }),
    prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { title: true } }),
  ]);
  const teacherId = enrollment?.class?.teacherId;
  if (!teacherId) return;
  if (!lesson) throw new Error("Cannot notify about a missing lesson");

  await prisma.userNotification.create({
    data: {
      recipientId: teacherId,
      actorId: input.studentId,
      kind: input.kind,
      entityId: input.attemptId,
      title: "Bài làm cần chấm",
      message: `${input.studentName} vừa nộp bài “${lesson.title} · ${input.sectionTitle}”. Bạn hãy chấm bài cho học sinh nhé.`,
      targetUrl: input.targetUrl,
    },
  });
}
