import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    throw new Response("Phương thức không được hỗ trợ", { status: 405 });
  }

  const user = await requireRole(request, ["teacher", "student"]);
  const result = await prisma.user.updateMany({
    where: {
      id: user.id,
      role: user.role,
      isActive: true,
      isActivated: true,
      deletedAt: null,
    },
    data: { lastSeenAt: new Date() },
  });
  if (result.count !== 1) throw new Response("Không thể cập nhật trạng thái online", { status: 409 });

  return Response.json({ ok: true });
}
