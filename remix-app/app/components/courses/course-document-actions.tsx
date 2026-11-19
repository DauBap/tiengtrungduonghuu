import { Download, Eye } from "lucide-react";
import { Button } from "~/components/ui/button";

function isPowerPointDocument(mimeType: string) {
  return mimeType === "application/vnd.ms-powerpoint"
    || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function getPreviewHref(
  courseId: string,
  document: { id: string; mimeType: string; officeViewerUrl: string | null },
) {
  if (isPowerPointDocument(document.mimeType)) {
    return document.officeViewerUrl;
  }

  const documentHref = `/student/courses/${courseId}/documents/${document.id}`;
  if (document.mimeType === "application/pdf" || document.mimeType.startsWith("image/")) {
    return documentHref;
  }
  return null;
}

export function CourseDocumentActions({
  courseId,
  document,
}: {
  courseId: string;
  document: { id: string; mimeType: string; officeViewerUrl: string | null };
}) {
  const previewHref = getPreviewHref(courseId, document);
  const downloadHref = `/student/courses/${courseId}/documents/${document.id}?download=1`;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {previewHref ? (
        <Button asChild variant="outline" size="sm">
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy={document.officeViewerUrl === previewHref ? "no-referrer" : undefined}
          >
            <Eye aria-hidden="true" className="mr-1.5 h-4 w-4" />
            Xem
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={isPowerPointDocument(document.mimeType)
            ? "Microsoft Office chỉ xem được khi website được triển khai bằng HTTPS công khai."
            : "Chưa hỗ trợ xem trước định dạng này"}
          aria-label={isPowerPointDocument(document.mimeType)
            ? "Microsoft Office chỉ xem được khi website được triển khai bằng HTTPS công khai."
            : "Chưa hỗ trợ xem trước định dạng này"}
        >
          <Eye aria-hidden="true" className="mr-1.5 h-4 w-4" />
          Xem
        </Button>
      )}
      <Button asChild variant="outline" size="sm">
        <a href={downloadHref}>
          <Download aria-hidden="true" className="mr-1.5 h-4 w-4" />
          Tải xuống
        </a>
      </Button>
    </div>
  );
}
