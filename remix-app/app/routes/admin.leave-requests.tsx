import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { CalendarDays, Check, Clock3, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import {
  getClassSessionOrderSnapshot,
  renumberClassAttendanceSessions,
} from "~/lib/attendance-session-order.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

const LEAVE_REQUEST_TABS: Array<{ status: LeaveRequestStatus; label: string; emptyMessage: string }> = [
  { status: "PENDING", label: "Đang chờ xử lý", emptyMessage: "Hiện không có yêu cầu xin nghỉ nào đang chờ xử lý." },
  { status: "APPROVED", label: "Đã duyệt", emptyMessage: "Chưa có yêu cầu xin nghỉ nào được duyệt." },
  { status: "REJECTED", label: "Đã từ chối", emptyMessage: "Chưa có yêu cầu xin nghỉ nào bị từ chối." },
];

function formatDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const [requests, groupedCounts] = await Promise.all([
    prisma.teacherLeaveRequest.findMany({
    orderBy: [{ status: "asc" }, { date: "asc" }, { startTime: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      reason: true,
      status: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      teacher: { select: { name: true, email: true } },
      reviewer: { select: { name: true } },
      classroom: { select: { id: true, name: true, course: { select: { title: true } } } },
      makeupSession: { select: { date: true, scheduleStartTime: true, scheduleEndTime: true } },
    },
    }),
    prisma.teacherLeaveRequest.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);
  const requestCounts: Record<LeaveRequestStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
  };
  for (const { status, _count } of groupedCounts) {
    requestCounts[status] = _count._all;
  }
  return {
    user,
    requests,
    requestCounts,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const requestId = String(form.get("requestId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reviewNote = String(form.get("reviewNote") ?? "").trim();
  if (!requestId || (intent !== "approve" && intent !== "reject")) {
    return { success: false as const, error: "Không tìm thấy yêu cầu nghỉ cần xử lý." };
  }
  if (reviewNote.length > 1000) {
    return { success: false as const, error: "Ghi chú không được vượt quá 1.000 ký tự." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const leaveRequest = await tx.teacherLeaveRequest.findFirst({
        where: { id: requestId, status: "PENDING" },
        select: {
          id: true,
          teacherId: true,
          classId: true,
          date: true,
          startTime: true,
          endTime: true,
          classroom: { select: { name: true, completedAt: true } },
        },
      });
      if (!leaveRequest) {
        return { success: false as const, error: "Yêu cầu này đã được xử lý hoặc không còn tồn tại. Hãy tải lại trang." };
      }

      let removedSession = false;
      if (intent === "approve") {
        if (leaveRequest.classroom.completedAt) {
          return { success: false as const, error: "Lớp học đã kết thúc nên không thể duyệt nghỉ cho ca này." };
        }
        const session = await tx.attendanceSession.findFirst({
          where: {
            classId: leaveRequest.classId,
            date: leaveRequest.date,
            OR: [
              {
                scheduleStartTime: leaveRequest.startTime,
                scheduleEndTime: leaveRequest.endTime,
              },
              { scheduleStartTime: null, scheduleEndTime: null, isScheduleGenerated: false },
            ],
          },
          select: {
            id: true,
            scheduleStartTime: true,
            scheduleEndTime: true,
            isScheduleGenerated: true,
            _count: { select: { records: true } },
          },
        });
        if (session) {
          if (!session.scheduleStartTime || !session.scheduleEndTime || !session.isScheduleGenerated) {
            return { success: false as const, error: "Ngày này có buổi điểm danh tạo riêng chưa gắn ca. Hãy xử lý buổi đó trước khi duyệt nghỉ." };
          }
          if (session._count.records > 0) {
            return { success: false as const, error: "Ca này đã có dữ liệu điểm danh nên không thể duyệt nghỉ." };
          }
          if (!session.isScheduleGenerated) {
            return { success: false as const, error: "Ca này có buổi điểm danh được tạo riêng. Hãy xử lý buổi đó trước khi duyệt nghỉ." };
          }

          const previousOrder = await getClassSessionOrderSnapshot(tx, leaveRequest.classId);
          const sessionNumber = previousOrder.sessions.findIndex(({ id }) => id === session.id) + 1;
          if (sessionNumber > 0) {
            const classReviewSession = await tx.class.findUnique({
              where: { id: leaveRequest.classId },
              select: { midtermReviewSession: true, finalReviewSession: true },
            });
            const hasSavedReview = await tx.studentClassReview.findFirst({
              where: { classId: leaveRequest.classId, sessionNumber },
              select: { id: true },
            });
            if (
              hasSavedReview
              || classReviewSession?.midtermReviewSession === sessionNumber
              || classReviewSession?.finalReviewSession === sessionNumber
            ) {
              return { success: false as const, error: "Ca này đã được đặt làm mốc đánh giá. Hãy đổi mốc trước khi duyệt nghỉ." };
            }
          }

          await tx.attendanceSession.delete({ where: { id: session.id } });
          await renumberClassAttendanceSessions(tx, leaveRequest.classId, previousOrder);
          removedSession = true;
        }
      }

      await tx.teacherLeaveRequest.update({
        where: { id: leaveRequest.id },
        data: {
          status: intent === "approve" ? "APPROVED" : "REJECTED",
          reviewerId: admin.id,
          reviewNote: reviewNote || null,
          reviewedAt: new Date(),
        },
      });
      await tx.userNotification.create({
        data: {
          recipientId: leaveRequest.teacherId,
          actorId: admin.id,
          kind: intent === "approve" ? "TEACHER_LEAVE_REQUEST_APPROVED" : "TEACHER_LEAVE_REQUEST_REJECTED",
          title: intent === "approve" ? "Yêu cầu nghỉ đã được duyệt" : "Yêu cầu nghỉ chưa được duyệt",
          message: intent === "approve"
            ? `Ca ${leaveRequest.startTime}–${leaveRequest.endTime} ngày ${leaveRequest.date.toISOString().slice(0, 10)} của lớp ${leaveRequest.classroom.name} đã được duyệt nghỉ.`
            : `Yêu cầu nghỉ ca ${leaveRequest.startTime}–${leaveRequest.endTime} ngày ${leaveRequest.date.toISOString().slice(0, 10)} của lớp ${leaveRequest.classroom.name} chưa được duyệt.${reviewNote ? ` Phản hồi: ${reviewNote}` : ""}`,
          targetUrl: "/teacher/leave-requests",
          entityId: leaveRequest.id,
        },
      });
      return { success: true as const, intent, requestId: leaveRequest.id, removedSession };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && (error.code === "P2034" || error.code === "P2002")
    ) {
      return { success: false as const, error: "Yêu cầu vừa được cập nhật. Hãy tải lại trang." };
    }
    throw error;
  }
}

function LeaveRequestCard({
  item,
  pending,
}: {
  item: Awaited<ReturnType<typeof loader>>["requests"][number];
  pending: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.intent === "approve" ? "Đã duyệt ca nghỉ." : "Đã từ chối yêu cầu nghỉ.");
    } else {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);
  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{item.classroom.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.classroom.course.title}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          item.status === "APPROVED"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            : item.status === "REJECTED"
              ? "bg-muted text-muted-foreground"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        }`}>
          {item.status === "APPROVED" ? "Đã duyệt" : item.status === "REJECTED" ? "Không duyệt" : "Chờ duyệt"}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <p className="inline-flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {formatDate(item.date)}
        </p>
        <p className="inline-flex items-center gap-2">
          <Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          {item.startTime} – {item.endTime}
        </p>
        <p className="text-muted-foreground">Giáo viên: {item.teacher.name}</p>
      </div>

      <p className="text-sm">
        <span className="font-medium">Lý do xin nghỉ:</span>{" "}
        {item.reason || "Yêu cầu cũ chưa có lý do."}
      </p>

      {item.makeupSession && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          Buổi bù đã xếp: {formatDate(item.makeupSession.date)}
          {item.makeupSession.scheduleStartTime
            ? ` · ${item.makeupSession.scheduleStartTime} – ${item.makeupSession.scheduleEndTime}`
            : ""}
        </p>
      )}
      {!pending && item.reviewNote && (
        <p className="text-sm text-muted-foreground">Phản hồi: {item.reviewNote}</p>
      )}

      {pending && (
        <fetcher.Form method="post" className="space-y-3 border-t pt-3">
          <input type="hidden" name="requestId" value={item.id} />
          <label htmlFor={`leave-review-note-${item.id}`} className="sr-only">Ghi chú xử lý</label>
          <textarea
            id={`leave-review-note-${item.id}`}
            name="reviewNote"
            maxLength={1000}
            rows={2}
            placeholder="Ghi chú cho giáo viên (không bắt buộc)"
            disabled={isSubmitting}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              name="intent"
              value="reject"
              variant="outline"
              disabled={isSubmitting}
            >
              <X aria-hidden="true" className="mr-2 h-4 w-4" />
              Không duyệt
            </Button>
            <Button type="submit" name="intent" value="approve" disabled={isSubmitting}>
              <Check aria-hidden="true" className="mr-2 h-4 w-4" />
              Duyệt nghỉ
            </Button>
          </div>
        </fetcher.Form>
      )}
    </article>
  );
}

export default function AdminLeaveRequests() {
  const { user, requests, requestCounts } = useLoaderData<typeof loader>();
  const [activeStatus, setActiveStatus] = useState<LeaveRequestStatus>("PENDING");
  const visibleRequests = requests.filter(({ status }) => status === activeStatus);
  const activeTab = LEAVE_REQUEST_TABS.find(({ status }) => status === activeStatus)!;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = LEAVE_REQUEST_TABS.findIndex(({ status }) => status === activeStatus);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % LEAVE_REQUEST_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + LEAVE_REQUEST_TABS.length) % LEAVE_REQUEST_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = LEAVE_REQUEST_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = LEAVE_REQUEST_TABS[nextIndex];
    setActiveStatus(nextTab.status);
    document.getElementById(`leave-request-tab-${nextTab.status.toLowerCase()}`)?.focus();
  };

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Duyệt yêu cầu nghỉ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Duyệt hoặc từ chối từng ca. Ca được duyệt sẽ không tạo buổi điểm danh và có thể được xếp lịch bù.
          </p>
        </header>

        <section className="space-y-4">
          <div
            role="tablist"
            aria-label="Lọc yêu cầu xin nghỉ theo trạng thái"
            className="flex flex-wrap gap-2 border-b"
          >
            {LEAVE_REQUEST_TABS.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                id={`leave-request-tab-${status.toLowerCase()}`}
                role="tab"
                aria-selected={activeStatus === status}
                aria-controls="leave-request-panel"
                tabIndex={activeStatus === status ? 0 : -1}
                onClick={() => setActiveStatus(status)}
                onKeyDown={handleTabKeyDown}
                className={`min-h-10 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeStatus === status
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className="ml-1.5 tabular-nums text-xs">{requestCounts[status]}</span>
              </button>
            ))}
          </div>
          <div
            id="leave-request-panel"
            role="tabpanel"
            aria-labelledby={`leave-request-tab-${activeStatus.toLowerCase()}`}
            tabIndex={0}
            className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {visibleRequests.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {activeTab.emptyMessage}
              </p>
            ) : (
              visibleRequests.map((item) => (
                <LeaveRequestCard key={item.id} item={item} pending={activeStatus === "PENDING"} />
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
