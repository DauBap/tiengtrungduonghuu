import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    throw new Response("Phương thức không được hỗ trợ", { status: 405 });
  }

  const user = await requireRole(request, ["teacher", "student"]);
  const updatedCount = await prisma.$executeRaw`
    UPDATE "User"
    SET "lastSeenAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${user.id}
      AND "isActive" = TRUE
      AND "isActivated" = TRUE
      AND "deletedAt" IS NULL
  `;
  if (updatedCount !== 1) throw new Response("Không thể cập nhật trạng thái online", { status: 409 });

  return Response.json({ ok: true });
}
