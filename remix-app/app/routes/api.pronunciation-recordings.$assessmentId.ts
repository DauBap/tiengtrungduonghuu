import type { LoaderFunctionArgs } from "react-router";
import { get } from "@vercel/blob";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const assessment = await prisma.pronunciationAssessment.findFirst({
    where: { id: params.assessmentId, userId: user.id },
    select: { audioUrl: true },
  });
  if (!assessment?.audioUrl) throw new Response("Không tìm thấy bản ghi", { status: 404 });

  const blob = await get(assessment.audioUrl, { access: "public" });
  if (!blob || blob.statusCode !== 200) throw new Response("Không tìm thấy bản ghi", { status: 404 });

  const headers = new Headers(blob.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(blob.stream, { status: 200, headers });
}