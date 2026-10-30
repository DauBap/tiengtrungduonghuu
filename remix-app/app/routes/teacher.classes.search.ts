import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const url = new URL(request.url);
  const classId = url.searchParams.get("classId")?.trim() ?? "";
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!classId || query.length < 2) return { query, students: [] };
  if (query.length > 100) return { query, students: [] };

  const cls = await prisma.class.findFirst({
    where: { id: classId, teacherId: user.id },
    select: { courseId: true },
  });
  if (!cls) throw new Response("Không tìm thấy lớp hoặc bạn không được phân công lớp này.", { status: 404 });

  const students = await prisma.user.findMany({
    where: {
      role: "student",
      isActive: true,
      deletedAt: null,
      enrollments: { none: { courseId: cls.courseId } },
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 8,
  });

  return { query, students };
}
