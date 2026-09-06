import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, redirect } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import {
  getExamForAdmin,
  updateExam,
  deleteExam,
  setExamStatus,
  parseExamForm,
  publishVersion,
  getEditableVersion,
  deleteVersion,
} from "~/lib/exam.server";
import { isExamStatus, EXAM_STATUS_META } from "~/lib/exams";
import { ExamFields } from "~/components/admin/exam/exam-fields";
import { VersionBadge } from "~/components/admin/exam/version-badge";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Save, Send, Copy, Trash2, X, Loader2, Layers, ListChecks, Users, AlertTriangle,
} from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  const exam = await getExamForAdmin(params.examId!);
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });

  const [lessons, courses] = await Promise.all([
    prisma.lesson.findMany({
      orderBy: [{ course: { order: "asc" } }, { order: "asc" }],
      select: { id: true, title: true, order: true, courseId: true, course: { select: { title: true } } },
    }),
    prisma.course.findMany({ orderBy: { order: "asc" }, select: { id: true, title: true } }),
  ]);

  return {
    exam,
    lessons: lessons.map((l) => ({
      id: l.id, title: l.title, order: l.order, courseId: l.courseId, courseTitle: l.course.title,
    })),
    courses,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const examId = params.examId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "exam-edit") {
    const parsed = parseExamForm(form);
    if (!parsed.ok) return { error: parsed.error, field: parsed.field };
    const result = await updateExam(examId, parsed.data);
    if (!result.ok) return { error: result.error, field: result.field };
    return { success: true, message: "Đã lưu thông tin đề" };
  }

  if (intent === "exam-status") {
    const status = String(form.get("status"));
    if (!isExamStatus(status)) return { error: "Trạng thái không hợp lệ" };
    const result = await setExamStatus(examId, status);
    if (!result.ok) return { error: result.error };
    return { success: true, message: `Đã chuyển sang: ${EXAM_STATUS_META[status].label}` };
  }

  if (intent === "exam-delete") {
    const result = await deleteExam(examId);
    if (!result.ok) return { error: result.error };
    return redirect("/admin/exams");
  }

  if (intent === "version-publish") {
    // Id version đến từ client nên phải đối chiếu nó thuộc đúng đề này
    const versionId = String(form.get("versionId"));
    const owned = await prisma.examVersion.findFirst({
      where: { id: versionId, examId }, select: { id: true },
    });
    if (!owned) return { error: "Không tìm thấy phiên bản của đề này" };

    const result = await publishVersion(versionId);
    if (!result.ok) return { error: result.error };
    return { success: true, message: `Đã phát hành ${result.data.itemCount} câu hỏi` };
  }

  if (intent === "version-new-draft") {
    const result = await getEditableVersion(examId);
    if (!result.ok) return { error: result.error };
    return {
      success: true,
      message: result.createdNew
        ? `Đã tạo bản nháp v${result.data.version}`
        : `Đang sửa bản nháp v${result.data.version}`,
    };
  }

  if (intent === "version-delete") {
    const versionId = String(form.get("versionId"));
    const owned = await prisma.examVersion.findFirst({
      where: { id: versionId, examId }, select: { id: true },
    });
    if (!owned) return { error: "Không tìm thấy phiên bản của đề này" };

    const result = await deleteVersion(versionId);
    if (!result.ok) return { error: result.error };
    return { success: true, message: "Đã xóa phiên bản" };
  }

  return null;
}

// ─── Modal xóa đề ────────────────────────────────────────────────────────────

function DeleteExamModal({ title, attempts, onClose }: {
  title: string; attempts: number; onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const isLoading = fetcher.state !== "idle";

  return (
    <Overlay onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">Xóa bài thi</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p>Xóa <strong>{title}</strong> cùng toàn bộ phiên bản, phần thi và câu hỏi đã gắn?</p>
          {attempts > 0 && (
            <p className="mt-2 font-medium">
              Đề này đã có {attempts} lượt thi nên không xóa được. Hãy chuyển sang trạng thái lưu trữ.
            </p>
          )}
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="exam-delete" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
            <Button type="submit" variant="destructive" disabled={isLoading || attempts > 0}>
              {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa bài thi
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Overlay>
  );
}

// ─── Trang ───────────────────────────────────────────────────────────────────

export default function ExamOverview() {
  const { exam, lessons, courses } = useLoaderData<typeof loader>();
  const infoFetcher = useFetcher<{ error?: string; field?: string; success?: boolean; message?: string }>();
  const versionFetcher = useFetcher<{ error?: string; success?: boolean; message?: string }>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Thông báo thành công tự tắt để không đọng lại trên màn hình
  useEffect(() => {
    const message = versionFetcher.data?.message ?? infoFetcher.data?.message;
    if (!message) return;
    setNotice(message);
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [versionFetcher.data, infoFetcher.data]);

  const attemptCount = exam.versions.reduce((sum, v) => sum + v._count.attempts, 0);
  const draft = exam.versions.find((v) => v.status === "DRAFT") ?? null;
  const isBusy = versionFetcher.state !== "idle";

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thông tin đề</CardTitle>
              <CardDescription>Sửa ở đây không tạo phiên bản mới.</CardDescription>
            </CardHeader>
            <CardContent>
              <infoFetcher.Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="exam-edit" />

                {infoFetcher.data?.error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {infoFetcher.data.error}
                  </div>
                )}

                <ExamFields
                  values={{
                    code: exam.code,
                    title: exam.title,
                    description: exam.description,
                    lessonId: exam.lessonId,
                    courseId: exam.courseId,
                  }}
                  lessons={lessons}
                  courses={courses}
                  invalidField={infoFetcher.data?.field}
                />

                <div className="flex justify-end">
                  <Button type="submit" disabled={infoFetcher.state !== "idle"}>
                    <Save className="h-4 w-4 mr-1.5" />
                    {infoFetcher.state !== "idle" ? "Đang lưu..." : "Lưu thông tin"}
                  </Button>
                </div>
              </infoFetcher.Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Phiên bản</CardTitle>
                  <CardDescription>
                    Mỗi lần phát hành đóng băng nội dung câu hỏi, nên lượt thi cũ không đổi khi bạn
                    sửa câu trong kho.
                  </CardDescription>
                </div>
                <versionFetcher.Form method="post">
                  <input type="hidden" name="intent" value="version-new-draft" />
                  <Button type="submit" variant="outline" size="sm" disabled={isBusy}>
                    <Copy className="h-4 w-4 mr-1.5" />
                    {draft ? "Tới bản nháp" : "Tạo bản nháp mới"}
                  </Button>
                </versionFetcher.Form>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {versionFetcher.data?.error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {versionFetcher.data.error}
                </div>
              )}
              {notice && (
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
                  {notice}
                </div>
              )}

              {exam.versions.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="flex-1 min-w-0">
                    {isExamStatus(v.status) && <VersionBadge version={v.version} status={v.status} />}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />{v.sections.length} phần
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ListChecks className="h-3.5 w-3.5" />{v._count.items} câu
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />{v._count.attempts} lượt thi
                      </span>
                      {v.publishedAt && (
                        <span>
                          phát hành {new Date(v.publishedAt).toLocaleDateString("vi-VN")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {v.status === "DRAFT" && (
                      <versionFetcher.Form method="post">
                        <input type="hidden" name="intent" value="version-publish" />
                        <input type="hidden" name="versionId" value={v.id} />
                        <Button type="submit" size="sm" disabled={isBusy}>
                          <Send className="h-4 w-4 mr-1.5" />Phát hành
                        </Button>
                      </versionFetcher.Form>
                    )}
                    {v._count.attempts === 0 && exam.versions.length > 1 && (
                      <versionFetcher.Form method="post">
                        <input type="hidden" name="intent" value="version-delete" />
                        <input type="hidden" name="versionId" value={v.id} />
                        <Button
                          type="submit" variant="ghost" size="icon" title="Xóa phiên bản"
                          disabled={isBusy}
                          className="hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </versionFetcher.Form>
                    )}
                  </div>
                </div>
              ))}

              {exam.versions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Đề chưa có phiên bản nào. Bấm “Tạo bản nháp mới” để bắt đầu.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Trạng thái đề</CardTitle>
              <CardDescription>{EXAM_STATUS_META[exam.status].description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((s) => (
                <versionFetcher.Form key={s} method="post">
                  <input type="hidden" name="intent" value="exam-status" />
                  <input type="hidden" name="status" value={s} />
                  <Button
                    type="submit"
                    variant={exam.status === s ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    disabled={isBusy || exam.status === s}
                  >
                    {EXAM_STATUS_META[s].label}
                  </Button>
                </versionFetcher.Form>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Bước tiếp theo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link to={`/admin/exams/${exam.id}/structure`} className="block rounded-lg border p-3 hover:bg-muted/50">
                <p className="font-medium">1. Chia phần thi</p>
                <p className="text-xs text-muted-foreground">Nghe, Đọc, Viết... tên do bạn đặt.</p>
              </Link>
              <Link to={`/admin/exams/${exam.id}/questions`} className="block rounded-lg border p-3 hover:bg-muted/50">
                <p className="font-medium">2. Gắn câu hỏi từ kho</p>
                <p className="text-xs text-muted-foreground">Đặt điểm và thứ tự cho từng câu.</p>
              </Link>
              <Link to={`/admin/exams/${exam.id}/settings`} className="block rounded-lg border p-3 hover:bg-muted/50">
                <p className="font-medium">3. Cấu hình</p>
                <p className="text-xs text-muted-foreground">Thời gian, số lần thi, cách công bố điểm.</p>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-destructive">Vùng nguy hiểm</CardTitle>
            </CardHeader>
            <CardContent>
              {attemptCount > 0 ? (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  Đề đã có {attemptCount} lượt thi nên không xóa được. Dùng trạng thái lưu trữ để dừng.
                </p>
              ) : (
                <Button variant="destructive" size="sm" className="w-full" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" />Xóa bài thi
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {confirmDelete && (
        <DeleteExamModal
          title={exam.title}
          attempts={attemptCount}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
