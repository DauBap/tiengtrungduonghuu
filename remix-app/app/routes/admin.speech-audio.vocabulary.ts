import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);

  try {
    const vocabularyItems = await prisma.vocabItem.findMany({
      where: { chinese: { not: "" } },
      orderBy: { chinese: "asc" },
      select: { chinese: true },
    });
    const vocabulary = [...new Set(
      vocabularyItems
        .map(({ chinese }) => chinese.trim())
        .filter(Boolean),
    )];

    return Response.json(
      { vocabulary },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load vocabulary for Edge TTS cache generation:", error);
    return Response.json(
      { error: "Không thể tải danh sách từ vựng. Vui lòng thử lại." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
