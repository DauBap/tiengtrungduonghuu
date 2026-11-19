import type { LoaderFunctionArgs } from "react-router";
import { isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { serveStoredAsset } from "~/lib/storage.server";
import { isValidCourseDocumentShare } from "~/lib/course-document-office-viewer.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId!;
  const url = new URL(request.url);
  const hasShareParams = url.searchParams.has("shareExpires") || url.searchParams.has("shareSignature");
  const isSharedOfficeViewerRequest = hasShareParams
    && isValidCourseDocumentShare(
      request.url,
      courseId,
      params.documentId!,
      params.fileName ?? "",
    );

  if (hasShareParams && !isSharedOfficeViewerRequest) {
    throw new Response("Liên kết xem tài liệu không hợp lệ hoặc đã hết hạn.", { status: 403 });
  }

  if (!isSharedOfficeViewerRequest) {
    const user = await requireRole(request, ["admin", "student"]);
    if (user.role === "student" && !(await isEnrolled(user.id, courseId))) {
      throw new Response("Không tìm thấy tài liệu", { status: 404 });
    }
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
  if (isSharedOfficeViewerRequest) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
    response.headers.set("Vary", "Origin");
  }
  const isDownload = url.searchParams.get("download") === "1";
  const canDisplayInline = document.mimeType === "application/pdf" || document.mimeType.startsWith("image/");
  const disposition = !isDownload && canDisplayInline ? "inline" : "attachment";
  const encodedFileName = encodeURIComponent(document.fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  response.headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodedFileName}`);
  return response;
}
