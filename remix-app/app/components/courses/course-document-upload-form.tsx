import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  COURSE_DOCUMENT_ACCEPT,
  formatCourseDocumentSize,
} from "~/lib/course-documents";

function parseUploadResponse(responseText: string) {
  let response: unknown;
  try {
    response = JSON.parse(responseText);
  } catch {
    return null;
  }
  if (!response || typeof response !== "object") return null;
  const data = response as Record<string, unknown>;
  return {
    success: data.success === true,
    hasSuccess: Object.hasOwn(data, "success"),
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export function CourseDocumentUploadForm({
  action,
  onSuccess,
}: {
  action: string;
  onSuccess: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => xhrRef.current?.abort(), []);

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || !file.name || file.size === 0) {
      setUploadError("Vui lòng chọn tệp tài liệu.");
      return;
    }

    setUploadError(null);
    setUploadSuccess(false);
    setIsUploading(true);
    setIsSaving(false);
    setUploadPercent(0);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", action);
    xhr.setRequestHeader("X-Course-Document-Upload", "1");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.addEventListener("progress", (progressEvent) => {
      if (progressEvent.lengthComputable) {
        setUploadPercent(Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100)));
      }
    });
    xhr.upload.addEventListener("load", () => {
      setUploadPercent(100);
      setIsSaving(true);
    });
    xhr.addEventListener("load", () => {
      xhrRef.current = null;
      setIsUploading(false);
      setIsSaving(false);
      const response = parseUploadResponse(xhr.responseText);
      const uploadUrl = new URL(action, window.location.href);
      const responseUrl = new URL(xhr.responseURL || action, window.location.href);
      const stayedOnUploadRoute =
        responseUrl.origin === uploadUrl.origin && responseUrl.pathname === uploadUrl.pathname;
      if (xhr.status < 200 || xhr.status >= 300) {
        setUploadPercent(null);
        setUploadError(response?.error ?? `Tải lên thất bại (HTTP ${xhr.status}). Vui lòng thử lại.`);
        return;
      }
      if (response?.error || (response?.hasSuccess && !response.success)) {
        setUploadPercent(null);
        setUploadError(response.error ?? "Máy chủ từ chối lưu tài liệu. Vui lòng kiểm tra lại tệp.");
        return;
      }
      if (!response?.success && !stayedOnUploadRoute) {
        setUploadPercent(null);
        setUploadError(
          responseUrl.pathname === "/login"
            ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kiểm tra danh sách tài liệu."
            : "Máy chủ chưa xác nhận lưu tài liệu. Vui lòng tải lại trang và thử lại.",
        );
        return;
      }

      setUploadPercent(null);
      setSelectedFile(null);
      setUploadSuccess(true);
      form.reset();
      onSuccess();
    });
    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Mất kết nối trong khi tải lên. Hãy kiểm tra mạng rồi thử lại.");
    });
    xhr.addEventListener("abort", () => {
      xhrRef.current = null;
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Tải lên đã bị hủy. Hãy thử lại.");
    });
    try {
      xhr.send(formData);
    } catch {
      xhrRef.current = null;
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Không thể bắt đầu tải lên. Hãy thử lại.");
    }
  }

  return (
    <form method="post" encType="multipart/form-data" onSubmit={handleUpload} className="space-y-4">
      <input type="hidden" name="intent" value="upload" />
      <div className="space-y-2">
        <Label htmlFor="course-document-file">Tệp tài liệu</Label>
        <div
          className={`relative overflow-hidden rounded-lg border border-dashed bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${
            isUploading
              ? "cursor-not-allowed border-input opacity-60"
              : "cursor-pointer border-input hover:border-primary/60 hover:bg-muted/30"
          }`}
        >
          <input
            id="course-document-file"
            name="file"
            type="file"
            accept={COURSE_DOCUMENT_ACCEPT}
            required
            disabled={isUploading}
            aria-describedby="course-document-file-help"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              setSelectedFile(event.currentTarget.files?.[0] ?? null);
              setUploadError(null);
              setUploadSuccess(false);
            }}
          />
          <div className="pointer-events-none flex min-h-[5.25rem] items-center gap-3 px-4 py-3 sm:gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={selectedFile?.name}>
                {selectedFile?.name ?? "Chọn tệp tài liệu"}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {selectedFile
                  ? `${formatCourseDocumentSize(selectedFile.size)} · Nhấn để thay đổi`
                  : "Nhấn để duyệt tệp từ thiết bị"}
              </span>
            </span>
            <span className="inline-flex h-9 shrink-0 items-center rounded-md border bg-background px-3 text-sm font-medium text-foreground shadow-sm">
              Chọn tệp
            </span>
          </div>
        </div>
        <p id="course-document-file-help" className="text-xs text-muted-foreground">
          PDF, Word, Excel, PowerPoint hoặc ảnh JPG, PNG, GIF, WEBP · thời gian tải tùy dung lượng và mạng.
        </p>
      </div>
      {isUploading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm" role="status" aria-live="polite">
            <span>{isSaving ? "Đang lưu tệp trên máy chủ..." : "Đang tải tệp lên..."}</span>
            {uploadPercent !== null && <span className="tabular-nums">{uploadPercent}%</span>}
          </div>
          {uploadPercent !== null && (
            <div
              role="progressbar"
              aria-label="Tiến trình tải tài liệu lên"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadPercent}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full origin-left rounded-full bg-primary"
                style={{ transform: `scaleX(${uploadPercent / 100})` }}
              />
            </div>
          )}
        </div>
      )}
      {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
      {uploadSuccess && <p role="status" className="text-sm text-green-700 dark:text-green-400">Tải tài liệu thành công.</p>}
      <Button type="submit" disabled={isUploading}>
        <Upload aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {isUploading
          ? isSaving
            ? "Đang lưu..."
            : uploadPercent === null
              ? "Đang tải lên..."
              : `Đang tải lên ${uploadPercent}%`
          : "Tải tài liệu lên"}
      </Button>
    </form>
  );
}
