import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const [result] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "LessonTabAttempt"
    WHERE "userId" = ${user.id}
      AND "tab" IN ('GRAMMAR', 'WORKBOOK')
      AND "details"->>'reviewPending' = 'true'
      AND "details"->'teacherGrading'->>'gradedAt' IS NULL
  `;

  return { count: result.count };
}
