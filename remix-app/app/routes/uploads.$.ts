import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "~/lib/prisma.server";
import { serveStoredAsset } from "~/lib/storage.server";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const pathname = params["*"];
  if (!pathname) throw new Response("Không tìm thấy tệp", { status: 404 });
  const requestedPath = normalizePath(`/uploads/${pathname}`);
  const assessments = await prisma.pronunciationAssessment.findMany({
    where: { audioUrl: { not: null } },
    select: { audioUrl: true },
  });
  const isPrivateRecording = assessments.some(
    ({ audioUrl }) => audioUrl && normalizePath(audioUrl) === requestedPath,
  );
  if (isPrivateRecording) throw new Response("Không tìm thấy tệp", { status: 404 });

  const isPublicAsset = [
    "audio/",
    "images/",
    "mock-exams/",
  ].some((prefix) => requestedPath.slice("/uploads/".length).startsWith(prefix));
  if (!isPublicAsset) throw new Response("Không tìm thấy tệp", { status: 404 });
  return serveStoredAsset(request, requestedPath);
}

function normalizePath(value: string) {
  let pathname: string;
  try {
    pathname = new URL(value, "http://localhost").pathname;
    return pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw new Response("Đường dẫn tệp không hợp lệ", { status: 404 });
  }
}
