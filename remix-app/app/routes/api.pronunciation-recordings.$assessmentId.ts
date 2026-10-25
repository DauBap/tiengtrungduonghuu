import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { serveStoredAsset } from "~/lib/storage.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const assessment = await prisma.pronunciationAssessment.findFirst({
    where: { id: params.assessmentId, userId: user.id },
    select: { audioUrl: true },
  });
  if (!assessment?.audioUrl) throw new Response("Không tìm thấy bản ghi", { status: 404 });

  const response = await serveStoredAsset(request, assessment.audioUrl);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}