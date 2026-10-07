import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const MAX_ACTIVE_SECONDS_PER_HEARTBEAT = 30;
const VISIT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId;
  if (!courseId || !await isEnrolled(user.id, courseId)) {
    throw new Response("Không có quyền truy cập khóa học này", { status: 403 });
  }

  const form = await request.formData();
  const event = form.get("event");
  const sessionId = String(form.get("sessionId") ?? "");
  if (sessionId.length > 100) {
    throw new Response("Mã phiên học không hợp lệ", { status: 400 });
  }

  if (event === "start") {
    const resume = form.get("resume") === "true";
    const previousSessionId = String(form.get("previousSessionId") ?? "") || (resume ? sessionId : "");

    if (resume && sessionId) {
      const previousSession = await prisma.courseStudySession.findUnique({ where: { id: sessionId } });
      if (
        previousSession
        && previousSession.userId === user.id
        && previousSession.courseId === courseId
        && Date.now() - previousSession.lastActiveAt.getTime() < VISIT_IDLE_TIMEOUT_MS
      ) {
        const session = await prisma.courseStudySession.update({
          where: { id: sessionId },
          data: { endedAt: null, lastActiveAt: new Date() },
          select: { id: true },
        });
        return Response.json({ sessionId: session.id });
      }
    }

    if (previousSessionId) {
      await prisma.courseStudySession.updateMany({
        where: { id: previousSessionId, userId: user.id, courseId, endedAt: null },
        data: { endedAt: new Date() },
      });
    }

    const session = await prisma.courseStudySession.create({
      data: { id: randomUUID(), userId: user.id, courseId },
      select: { id: true },
    });
    return Response.json({ sessionId: session.id });
  }

  if (event === "heartbeat") {
    const seconds = Number(form.get("seconds"));
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_ACTIVE_SECONDS_PER_HEARTBEAT) {
      throw new Response("Thời lượng phiên học không hợp lệ", { status: 400 });
    }

    const session = await prisma.courseStudySession.findFirst({
      where: { id: sessionId, userId: user.id, courseId },
    });
    if (!session) throw new Response("Không tìm thấy phiên học", { status: 404 });

    const now = new Date();
    if (session.endedAt || now.getTime() - session.lastActiveAt.getTime() >= VISIT_IDLE_TIMEOUT_MS) {
      const nextSession = await prisma.courseStudySession.create({
        data: { id: randomUUID(), userId: user.id, courseId },
        select: { id: true },
      });
      return Response.json({ sessionId: nextSession.id });
    }

    await prisma.courseStudySession.update({
      where: { id: session.id },
      data: {
        totalSeconds: { increment: seconds },
        lastActiveAt: now,
      },
    });
    return Response.json({ sessionId: session.id });
  }

  if (event === "end") {
    await prisma.courseStudySession.updateMany({
      where: { id: sessionId, userId: user.id, courseId, endedAt: null },
      data: { endedAt: new Date() },
    });
    return Response.json({ ok: true });
  }

  throw new Response("Loại sự kiện không hợp lệ", { status: 400 });
}
