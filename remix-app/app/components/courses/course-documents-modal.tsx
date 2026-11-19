import { useEffect } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import { FileText, FolderOpen, Trash2, X } from "lucide-react";
import { Overlay } from "~/components/common/overlay";
import { CourseDocumentActions } from "~/components/courses/course-document-actions";
import { CourseDocumentUploadForm } from "~/components/courses/course-document-upload-form";
import { Button } from "~/components/ui/button";
import { formatCourseDocumentSize } from "~/lib/course-documents";

type CourseDocumentItem = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  officeViewerUrl: string | null;
  createdAt: Date | string;
};

export function CourseDocumentsModal({
  course,
  documents,
  onClose,
}: {
  course: { id: string; code: string; title: string };
  documents: CourseDocumentItem[];
  onClose: () => void;
}) {
  const deleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const isDeleting = deleteFetcher.state !== "idle";

  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    if (deleteFetcher.data.success) {
      toast.success("Đã xóa tài liệu.");
      deleteFetcher.reset();
      revalidator.revalidate();
    }
  }, [deleteFetcher.state, deleteFetcher.data, deleteFetcher, revalidator]);

  return (
    <Overlay onClose={onClose} closeOnEscape closeOnBackdrop className="max-w-3xl">
      <div role="dialog" aria-modal="true" aria-labelledby="course-documents-title" className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderOpen aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <h2 id="course-documents-title" className="text-xl font-semibold tracking-tight">Quản lý tài liệu</h2>
              <p className="text-sm text-muted-foreground">{course.code} · {course.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Học viên đã ghi danh vào các lớp thuộc khóa này sẽ xem được tài liệu.
        </p>

        <CourseDocumentUploadForm
          action={`/admin/courses/${course.id}/documents`}
          onSuccess={() => revalidator.revalidate()}
        />

        <section className="space-y-3 border-t pt-4" aria-labelledby="course-documents-list-title">
          <div className="flex items-center justify-between gap-3">
            <h3 id="course-documents-list-title" className="font-semibold">Tài liệu đã tải lên</h3>
            <span className="text-sm text-muted-foreground">{documents.length} tệp</span>
          </div>
          {deleteFetcher.data?.error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {deleteFetcher.data.error}
            </p>
          )}
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <FileText aria-hidden="true" className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Chưa có tài liệu</p>
              <p className="mt-1 text-sm text-muted-foreground">Tải tài liệu đầu tiên lên để học viên có thể truy cập.</p>
            </div>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium">{document.fileName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCourseDocumentSize(document.fileSize)} · {new Date(document.createdAt).toLocaleDateString("vi-VN")}
                    </p>
                  </div>
                  <CourseDocumentActions courseId={course.id} document={document} />
                  <deleteFetcher.Form
                    method="post"
                    action={`/admin/courses/${course.id}/documents?modal=1`}
                    onSubmit={(event) => {
                      if (!window.confirm(`Xóa tài liệu “${document.fileName}”?`)) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="documentId" value={document.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`Xóa ${document.fileName}`}
                      disabled={isDeleting}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </deleteFetcher.Form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex justify-end border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>Đóng</Button>
        </div>
      </div>
    </Overlay>
  );
}
