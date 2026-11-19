import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { ArrowLeft, FileText, Trash2 } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseDocumentUploadForm } from "~/components/courses/course-document-upload-form";
import { CourseDocumentActions } from "~/components/courses/course-document-actions";
import { createCourseDocumentOfficeViewerUrl } from "~/lib/course-document-office-viewer.server";
import { formatCourseDocumentSize } from "~/lib/course-documents";
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
    documents: documents.map((document) => ({
      ...document,
      fileSize: Number(document.fileSize),
      officeViewerUrl: createCourseDocumentOfficeViewerUrl(
        request.url,
        courseId,
        document.id,
        document.mimeType,
        document.fileName,
      ),
    })),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const courseId = params.courseId!;
  const isModalRequest = new URL(request.url).searchParams.get("modal") === "1";
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
    if (isModalRequest) return Response.json({ success: true });
    return redirect(`/admin/courses/${courseId}/documents`);
  }

  return { error: intent === "upload" ? "Yêu cầu tải lên không hợp lệ." : "Thao tác không hợp lệ." };
}

export default function CourseDocumentsAdmin() {
  const { user, course, documents } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";

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
            <CourseDocumentUploadForm
              action={`/admin/courses/${course.id}/documents`}
              onSuccess={() => revalidator.revalidate()}
            />
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
                      <p className="break-all text-sm font-medium">{document.fileName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCourseDocumentSize(document.fileSize)} · {document.createdAt.toLocaleDateString("vi-VN")}
                      </p>
                    </div>
                  </div>
                  <CourseDocumentActions courseId={course.id} document={document} />
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
