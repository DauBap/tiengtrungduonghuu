import { useState } from "react";
import type { FormEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { ArrowLeft, FileText, Trash2, Upload } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import {
  COURSE_DOCUMENT_ACCEPT,
  formatCourseDocumentSize,
} from "~/lib/course-documents";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import {
  CourseDocumentUploadError,
  removeCourseDocumentAsset,
  saveCourseDocumentUpload,
} from "~/lib/storage.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const [course, documents] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, code: true, title: true },
    }),
    prisma.courseDocument.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, fileSize: true, mimeType: true, createdAt: true },
    }),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  return {
    user,
    course,
    documents: documents.map((document) => ({ ...document, fileSize: Number(document.fileSize) })),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const isProgressUpload =
    request.headers.get("X-Course-Document-Upload") === "1" ||
    request.headers.get("accept")?.toLowerCase().includes("application/json") === true;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    let asset: Awaited<ReturnType<typeof saveCourseDocumentUpload>>;
    try {
      asset = await saveCourseDocumentUpload(request, course.id);
    } catch (error) {
      if (!(error instanceof CourseDocumentUploadError)) throw error;
      if (isProgressUpload) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return { error: error.message };
    }

    let documentCreated = false;
    try {
      await prisma.courseDocument.create({
        data: {
          courseId,
          ...asset,
          fileSize: BigInt(asset.fileSize),
        },
      });
      documentCreated = true;
    } finally {
      if (!documentCreated) await removeCourseDocumentAsset(asset.fileUrl);
    }

    if (isProgressUpload) return Response.json({ success: true });
    return redirect(`/admin/courses/${courseId}/documents`);
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    const documentId = String(form.get("documentId") ?? "");
    const document = await prisma.courseDocument.findFirst({
      where: { id: documentId, courseId },
      select: { id: true, fileUrl: true },
    });
    if (!document) return { error: "Không tìm thấy tài liệu cần xóa. Hãy tải lại trang." };

    await prisma.courseDocument.delete({ where: { id: document.id } });
    await removeCourseDocumentAsset(document.fileUrl);
    return redirect(`/admin/courses/${courseId}/documents`);
  }

  return { error: intent === "upload" ? "Yêu cầu tải lên không hợp lệ." : "Thao tác không hợp lệ." };
}

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

export default function CourseDocumentsAdmin() {
  const { user, course, documents } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const isBusy = isSubmitting || isUploading;

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
    xhr.open("POST", form.action);
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
      setIsUploading(false);
      setIsSaving(false);
      const response = parseUploadResponse(xhr.responseText);
      const uploadUrl = new URL(form.action, window.location.href);
      const responseUrl = new URL(xhr.responseURL || form.action, window.location.href);
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
      revalidator.revalidate();
    });
    xhr.addEventListener("error", () => {
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Mất kết nối trong khi tải lên. Hãy kiểm tra mạng rồi thử lại.");
    });
    xhr.addEventListener("abort", () => {
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Tải lên đã bị hủy. Hãy thử lại.");
    });
    try {
      xhr.send(formData);
    } catch {
      setIsUploading(false);
      setIsSaving(false);
      setUploadPercent(null);
      setUploadError("Không thể bắt đầu tải lên. Hãy thử lại.");
    }
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/admin/courses/${course.id}/edit`}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Kho tài liệu khóa học</h1>
          <p className="mt-1 text-sm text-muted-foreground">{course.code} · {course.title}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tải tài liệu lên</CardTitle>
            <CardDescription>
              Học viên đã ghi danh vào các lớp thuộc khóa này sẽ xem được tài liệu.
            </CardDescription>
          </CardHeader>
          <CardContent>
              <form method="post" encType="multipart/form-data" onSubmit={handleUpload} className="space-y-4">
              <input type="hidden" name="intent" value="upload" />
              <div className="space-y-2">
                <Label htmlFor="course-document-file">Tệp tài liệu</Label>
                <div
                  className={`relative overflow-hidden rounded-lg border border-dashed bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${
                    isBusy
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
                    disabled={isBusy}
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
              {(uploadError || actionData?.error) && (
                <p role="alert" className="text-sm text-destructive">{uploadError ?? actionData?.error}</p>
              )}
              {uploadSuccess && (
                <p role="status" className="text-sm text-green-700 dark:text-green-400">
                  Tải tài liệu thành công.
                </p>
              )}
              <Button type="submit" disabled={isBusy}>
                <Upload aria-hidden="true" className="mr-1.5 h-4 w-4" />
                {isUploading
                  ? isSaving
                    ? "Đang lưu..."
                    : uploadPercent === null
                      ? "Đang tải lên..."
                      : `Đang tải lên ${uploadPercent}%`
                  : isSubmitting
                    ? "Đang xử lý..."
                    : "Tải tài liệu lên"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="space-y-3" aria-labelledby="course-documents-list-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="course-documents-list-heading" className="text-lg font-semibold">Tài liệu đã tải lên</h2>
            <span className="text-sm text-muted-foreground">{documents.length} tệp</span>
          </div>
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed px-5 py-10 text-center">
              <FileText aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Chưa có tài liệu</p>
              <p className="mt-1 text-sm text-muted-foreground">Tải lên tài liệu đầu tiên để học viên trong khóa có thể truy cập.</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <a
                        href={`/student/courses/${course.id}/documents/${document.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {document.fileName}
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCourseDocumentSize(document.fileSize)} · {document.createdAt.toLocaleDateString("vi-VN")}
                      </p>
                    </div>
                  </div>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!window.confirm(`Xóa tài liệu “${document.fileName}”?`)) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="documentId" value={document.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={isSubmitting} className="text-destructive hover:text-destructive">
                      <Trash2 aria-hidden="true" className="mr-1.5 h-4 w-4" />Xóa
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
