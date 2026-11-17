import type { LoaderFunctionArgs } from "react-router";
import { isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { serveStoredAsset } from "~/lib/storage.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin", "student"]);
  const courseId = params.courseId!;
  if (user.role === "student" && !(await isEnrolled(user.id, courseId))) {
    throw new Response("Không tìm thấy tài liệu", { status: 404 });
  }

  const document = await prisma.courseDocument.findFirst({
    where: { id: params.documentId!, courseId },
    select: { fileUrl: true, fileName: true, mimeType: true },
  });
  if (!document) throw new Response("Không tìm thấy tài liệu", { status: 404 });

  const response = await serveStoredAsset(request, document.fileUrl, {
    cacheControl: "private, no-store",
    contentType: document.mimeType,
  });
  const disposition = document.mimeType === "application/pdf" || document.mimeType.startsWith("image/")
    ? "inline"
    : "attachment";
  const encodedFileName = encodeURIComponent(document.fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  response.headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodedFileName}`);
  return response;
}
