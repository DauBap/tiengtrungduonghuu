import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import { ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { formatAudioScript, formatGrammarQuestions, isContentCorrectionTargetType, parseCorrectionProposal, serializeCorrectionData, type CorrectionData } from "~/lib/content-corrections";
import { applyContentCorrection, listCourseCorrectionTargets } from "~/lib/content-corrections.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { WORD_TYPE_META, isWordType } from "~/lib/word-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((item) => isRecord(item) && typeof item.chinese === "string")) return formatAudioScript(value);
    if (value.every((item) => isRecord(item) && typeof item.prompt === "string" && Array.isArray(item.options))) return formatGrammarQuestions(value);
    if (value.every(isWordType)) return value.filter(isWordType).map((type) => WORD_TYPE_META[type].label).join(", ");
    return value.join("\n");
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
  return value == null || value === "" ? "—" : String(value);
}

function getFieldLabel(field: string) {
  const labels: Record<string, string> = {
    chinese: "Tiếng Trung",
    chineseAlternatives: "Cách viết khác",
    pinyin: "Pinyin",
    pinyinAlternatives: "Pinyin khác",
    translation: "Nghĩa tiếng Việt",
    translationAlternatives: "Nghĩa khác",
    wordTypes: "Từ loại",
    speakers: "Toàn bộ script",
    questions: "Câu hỏi luyện tập",
    note: "Ghi chú",
    prompt: "Câu hỏi",
    options: "Lựa chọn",
    answer: "Đáp án",
    acceptedAnswers: "Đáp án được chấp nhận",
    hint: "Giải thích / gợi ý",
    title: "Tiêu đề",
    explanation: "Giải thích",
    formula: "Công thức",
    examples: "Ví dụ",
    given: "Nội dung cho trước",
    syllable: "Âm tiết",
    answerTone: "Thanh điệu đáp án",
    full: "Đáp án đầy đủ",
    audioText: "Nội dung đọc",
    description: "Mô tả",
    sampleAnswer: "Đáp án mẫu",
    payload: "Dữ liệu câu hỏi (JSON)",
    content: "Nội dung lựa chọn",
    isCorrect: "Đáp án đúng",
    imageUrl: "Đường dẫn hình ảnh",
    audioUrl: "Đường dẫn âm thanh",
    points: "Điểm câu hỏi",
  };
  return labels[field] ?? field;
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const statusValue = url.searchParams.get("status") ?? "PENDING";
  const status = statusValue === "APPROVED" || statusValue === "REJECTED" || statusValue === "PENDING"
    ? statusValue
    : "ALL";
  const corrections = await prisma.contentCorrection.findMany({
    where: status === "ALL" ? undefined : { status },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      targetType: true,
      targetId: true,
      targetLabel: true,
      courseId: true,
      courseTitle: true,
      lessonTitle: true,
      lessonId: true,
      originalData: true,
      proposedData: true,
      reason: true,
      reviewNote: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      teacher: { select: { id: true, name: true, email: true } },
      reviewer: { select: { name: true } },
    },
  });
  const pendingCount = await prisma.contentCorrection.count({ where: { status: "PENDING" } });
  return { user, corrections, pendingCount, status };
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const id = String(form.get("correctionId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reviewNote = String(form.get("reviewNote") ?? "").trim();
  if (!id || (intent !== "approve" && intent !== "reject")) {
    return { success: false as const, error: "Không tìm thấy góp ý cần xử lý." };
  }
  if (reviewNote.length > 2000) {
    return { success: false as const, error: "Phản hồi không được vượt quá 2.000 ký tự." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const correction = await tx.contentCorrection.findFirst({
        where: { id, status: "PENDING" },
        select: {
          id: true,
          teacherId: true,
          targetType: true,
          targetId: true,
          targetLabel: true,
          courseId: true,
          lessonId: true,
          originalData: true,
          proposedData: true,
        },
      });
      if (!correction) {
        return { success: false as const, error: "Góp ý đã được xử lý hoặc không còn tồn tại. Hãy tải lại trang." };
      }

      if (intent === "approve") {
        if (!correction.courseId || !isContentCorrectionTargetType(correction.targetType)) {
          return { success: false as const, error: "Loại nội dung này chưa được hỗ trợ để áp dụng." };
        }
        const targets = await listCourseCorrectionTargets(tx, correction.courseId);
        const target = targets?.find((item) => item.type === correction.targetType && item.id === correction.targetId);
        if (!target || !isRecord(correction.originalData) || !isRecord(correction.proposedData)) {
          return { success: false as const, error: "Nội dung gốc không còn tồn tại. Góp ý chưa được áp dụng." };
        }
        if (serializeCorrectionData(target.data) !== serializeCorrectionData(correction.originalData)) {
          return { success: false as const, error: "Nội dung đã được thay đổi kể từ lúc gửi góp ý. Hãy từ chối góp ý cũ và đề nghị giáo viên gửi lại." };
        }
        const proposedData = parseCorrectionProposal(correction.targetType, target.data, correction.proposedData);
        if (!proposedData) {
          return { success: false as const, error: "Nội dung đề xuất không hợp lệ hoặc không còn tạo ra thay đổi." };
        }
        const applied = await applyContentCorrection(
          tx,
          correction.targetType,
          correction.targetId,
          correction.courseId,
          proposedData,
        );
        if (!applied) {
          return { success: false as const, error: "Không thể áp dụng thay đổi cho nội dung đã chọn." };
        }
      }

      const status = intent === "approve" ? "APPROVED" : "REJECTED";
      await tx.contentCorrection.update({
        where: { id: correction.id },
        data: { status, reviewerId: admin.id, reviewNote: reviewNote || null, reviewedAt: new Date() },
      });
      await tx.userNotification.create({
        data: {
          recipientId: correction.teacherId,
          actorId: admin.id,
          kind: intent === "approve" ? "CONTENT_CORRECTION_APPROVED" : "CONTENT_CORRECTION_REJECTED",
          title: intent === "approve" ? "Góp ý chỉnh sửa đã được duyệt" : "Góp ý chỉnh sửa chưa được duyệt",
          message: intent === "approve"
            ? `Quản trị viên đã duyệt và áp dụng đề xuất sửa “${correction.targetLabel}” cho nội dung dùng chung.${reviewNote ? ` Phản hồi: ${reviewNote}` : ""}`
            : `Quản trị viên chưa áp dụng đề xuất sửa “${correction.targetLabel}”.${reviewNote ? ` Phản hồi: ${reviewNote}` : ""}`,
          targetUrl: "/teacher/content-corrections",
          entityId: correction.id,
        },
      });
      return { success: true as const, status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { success: false as const, error: "Góp ý vừa được xử lý ở nơi khác. Hãy tải lại trang." };
    }
    throw error;
  }
}

export default function AdminContentCorrections() {
  const { user, corrections, pendingCount, status } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [pendingReview, setPendingReview] = useState<{
    correctionId: string;
    targetLabel: string;
    intent: "approve" | "reject";
    reviewNote: string;
  } | null>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (!dialog) return;
    if (pendingReview && !dialog.open) dialog.showModal();
    if (!pendingReview && dialog.open) dialog.close();
  }, [pendingReview]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.status === "APPROVED" ? "Đã duyệt và áp dụng chỉnh sửa." : "Đã từ chối góp ý.");
    } else {
      toast.error(fetcher.data.error);
    }
    setPendingReview(null);
  }, [fetcher.data]);

  function requestReview(
    event: React.MouseEvent<HTMLButtonElement>,
    correctionId: string,
    targetLabel: string,
    intent: "approve" | "reject",
  ) {
    const form = event.currentTarget.form;
    const reviewNote = form ? new FormData(form).get("reviewNote") : "";
    setPendingReview({
      correctionId,
      targetLabel,
      intent,
      reviewNote: typeof reviewNote === "string" ? reviewNote : "",
    });
  }

  function confirmReview() {
    if (!pendingReview || fetcher.state !== "idle") return;
    fetcher.submit(
      {
        correctionId: pendingReview.correctionId,
        intent: pendingReview.intent,
        reviewNote: pendingReview.reviewNote,
      },
      { method: "post" },
    );
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Duyệt góp ý nội dung</h1>
          <p className="text-sm text-muted-foreground">
            Khi duyệt, thay đổi sẽ áp dụng cho dữ liệu dùng chung trong các lớp. Bài thi đã phát hành và lượt thi cũ được giữ nguyên.
          </p>
        </header>

        <nav aria-label="Lọc góp ý" className="flex flex-wrap gap-2">
          {[
            ["PENDING", `Chờ duyệt (${pendingCount})`],
            ["APPROVED", "Đã duyệt"],
            ["REJECTED", "Chưa duyệt"],
            ["ALL", "Tất cả"],
          ].map(([value, label]) => (
            <Link
              key={value}
              to={`/admin/content-corrections?status=${value}`}
              aria-current={status === value ? "page" : undefined}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${
                status === value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {corrections.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {status === "PENDING" ? "Chưa có góp ý nào cần duyệt." : "Không có góp ý trong mục này."}
          </p>
        ) : (
          <div className="space-y-4">
            {corrections.map((correction) => {
              const originalData = isRecord(correction.originalData) ? correction.originalData as CorrectionData : {};
              const proposedData = isRecord(correction.proposedData) ? correction.proposedData as CorrectionData : {};
              const canReview = correction.status === "PENDING";
              return (
                <article key={correction.id} className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
                  <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{correction.targetLabel}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[correction.courseTitle, correction.lessonTitle].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Giáo viên: {correction.teacher.name} · {correction.teacher.email} · {correction.createdAt.toLocaleDateString("vi-VN")}
                      </p>
                    </div>
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                      correction.status === "APPROVED" ? "bg-emerald-100 text-emerald-800"
                        : correction.status === "REJECTED" ? "bg-destructive/10 text-destructive"
                          : "bg-amber-100 text-amber-900"
                    }`}>
                      {correction.status === "APPROVED" ? "Đã duyệt" : correction.status === "REJECTED" ? "Chưa duyệt" : "Chờ duyệt"}
                    </span>
                  </header>

                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(proposedData).map(([field, value]) => (
                      <section key={field} className="min-w-0 rounded-md border p-3">
                        <h3 className="text-sm font-semibold">{getFieldLabel(field)}</h3>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-muted-foreground">Nội dung hiện tại</p>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-sm font-sans">{formatValue(originalData[field])}</pre>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-primary">Đề xuất</p>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-primary/5 p-2 text-sm font-sans">{formatValue(value)}</pre>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>

                  <section className="rounded-md bg-muted/30 p-3">
                    <h3 className="text-sm font-semibold">Lý do đề xuất</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{correction.reason}</p>
                  </section>

                  {correction.reviewNote && (
                    <p className="text-sm text-muted-foreground">Phản hồi: {correction.reviewNote}</p>
                  )}

                  {canReview && (
                    <fetcher.Form method="post" className="space-y-3 border-t pt-4">
                      <input type="hidden" name="correctionId" value={correction.id} />
                      <label className="block space-y-1.5 text-sm font-medium">
                        Phản hồi giáo viên (không bắt buộc)
                        <textarea
                          name="reviewNote"
                          maxLength={2000}
                          rows={2}
                          placeholder="Ghi chú khi duyệt hoặc lý do từ chối..."
                          className="w-full rounded-md border border-input bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </label>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={fetcher.state !== "idle"}
                          onClick={(event) => requestReview(event, correction.id, correction.targetLabel, "reject")}
                          className="gap-2"
                        >
                          <X aria-hidden="true" className="h-4 w-4" />
                          Từ chối
                        </Button>
                        <Button
                          type="button"
                          disabled={fetcher.state !== "idle"}
                          onClick={(event) => requestReview(event, correction.id, correction.targetLabel, "approve")}
                          className="gap-2"
                        >
                          <Check aria-hidden="true" className="h-4 w-4" />
                          Duyệt và áp dụng
                        </Button>
                      </div>
                    </fetcher.Form>
                  )}
                  {correction.status !== "PENDING" && correction.reviewedAt && (
                    <p className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
                      Đã xử lý {correction.reviewedAt.toLocaleDateString("vi-VN")} bởi {correction.reviewer?.name ?? "quản trị viên"}
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <dialog
        ref={reviewDialogRef}
        aria-labelledby="content-correction-confirm-title"
        aria-describedby="content-correction-confirm-description"
        onCancel={(event) => {
          event.preventDefault();
          setPendingReview(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPendingReview(null);
        }}
        className="fixed left-1/2 top-1/2 m-0 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-foreground/30 backdrop:backdrop-blur-[2px]"
      >
        <div className="space-y-3 p-6">
          <h2 id="content-correction-confirm-title" className="text-lg font-semibold">
            {pendingReview?.intent === "approve" ? "Duyệt và áp dụng góp ý?" : "Từ chối góp ý?"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {pendingReview?.targetLabel && (
              <>Góp ý cho <span className="font-medium text-foreground">{pendingReview.targetLabel}</span>. </>
            )}
            {pendingReview?.intent === "approve"
              ? "Nội dung đề xuất sẽ thay thế dữ liệu hiện tại dùng chung trong các lớp."
              : "Giáo viên sẽ nhận được thông báo góp ý đã bị từ chối."}
          </p>
          <p id="content-correction-confirm-description" className="text-sm leading-6 text-muted-foreground">
            {pendingReview?.reviewNote
              ? `Phản hồi gửi giáo viên: ${pendingReview.reviewNote}`
              : "Bạn có thể quay lại nếu muốn bổ sung phản hồi cho giáo viên."}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t bg-muted/30 p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={fetcher.state !== "idle"}
            onClick={() => setPendingReview(null)}
          >
            Quay lại
          </Button>
          <Button
            type="button"
            variant={pendingReview?.intent === "reject" ? "destructive" : "default"}
            disabled={fetcher.state !== "idle" || !pendingReview}
            onClick={confirmReview}
            className="gap-2"
          >
            {pendingReview?.intent === "approve" ? (
              <><Check aria-hidden="true" className="h-4 w-4" /> Duyệt và áp dụng</>
            ) : (
              <><X aria-hidden="true" className="h-4 w-4" /> Từ chối góp ý</>
            )}
          </Button>
        </div>
      </dialog>
    </AppShell>
  );
}
