import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Check, Clock3, Plus, Umbrella, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import {
  addDaysToDateString,
  getScheduledSlotsForDate,
  getVietnameseDateString,
} from "~/lib/schedule-utils";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function formatDate(value: string | Date) {
  const date = typeof value === "string" ? value : value.toISOString().slice(0, 10);
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const [classes, requests] = await Promise.all([
    prisma.class.findMany({
      where: { teacherId: user.id, completedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        startDate: true,
        scheduleEffectiveFrom: true,
        schedule: true,
        course: { select: { title: true } },
      },
    }),
    prisma.teacherLeaveRequest.findMany({
      where: { teacherId: user.id },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        classId: true,
        date: true,
        startTime: true,
        endTime: true,
        reason: true,
        status: true,
        reviewNote: true,
        createdAt: true,
        classroom: { select: { name: true } },
      },
    }),
  ]);
  return {
    user,
    classes,
    requests,
    today: getVietnameseDateString(),
    firstAllowedDate: addDaysToDateString(getVietnameseDateString(), 1),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const teacher = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "request-leave") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return { success: false as const, intent, error: "Vui lòng nhập lý do xin nghỉ." };
    if (reason.length > 1000) {
      return { success: false as const, intent, error: "Lý do xin nghỉ không được vượt quá 1.000 ký tự." };
    }

    const dateValue = String(form.get("date") ?? "");
    const date = parseDate(dateValue);
    if (!date) return { success: false as const, intent, error: "Chọn ngày nghỉ hợp lệ." };
    const firstAllowedDate = addDaysToDateString(getVietnameseDateString(), 1);
    if (!firstAllowedDate || dateValue < firstAllowedDate) {
      return { success: false as const, intent, error: "Bạn có thể xin nghỉ từ ngày mai trở đi." };
    }

    const classes = await prisma.class.findMany({
      where: { teacherId: teacher.id, completedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, startDate: true, scheduleEffectiveFrom: true, schedule: true },
    });
    const classesById = new Map(classes.map((classroom) => [classroom.id, classroom]));
    const availableSlots = new Map<string, {
      classId: string;
      className: string;
      startTime: string;
      endTime: string;
    }>();
    for (const classroom of classes) {
      if (
        dateValue < classroom.startDate.toISOString().slice(0, 10)
        || dateValue < classroom.scheduleEffectiveFrom.toISOString().slice(0, 10)
      ) continue;
      for (const slot of getScheduledSlotsForDate(classroom.schedule, dateValue)) {
        const key = `${classroom.id}|${slot.startTime}|${slot.endTime}`;
        availableSlots.set(key, {
          classId: classroom.id,
          className: classroom.name,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }
    }

    const requestedSlotKeys = [...new Set(form.getAll("slots").map(String))];
    const requestedSlots = requestedSlotKeys.map((key) => availableSlots.get(key));
    if (requestedSlots.length === 0 || requestedSlots.some((slot) => !slot)) {
      return { success: false as const, intent, error: "Chọn ít nhất một ca trong lịch dạy của ngày đã chọn." };
    }

    const admins = await prisma.user.findMany({
      where: { role: "admin", isActive: true, isActivated: true, deletedAt: null },
      select: { id: true },
    });
    if (admins.length === 0) {
      return { success: false as const, intent, error: "Hiện chưa có quản trị viên nhận yêu cầu. Vui lòng thử lại sau." };
    }

    try {
      const createdCount = await prisma.$transaction(async (tx) => {
        const checks = await Promise.all(requestedSlots.map(async (slot) => {
          if (!slot) return null;
          const classroom = classesById.get(slot.classId);
          if (!classroom) return null;
          const [activeRequest, existingSession, cancellation] = await Promise.all([
            tx.teacherLeaveRequest.findFirst({
              where: {
                classId: slot.classId,
                date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                status: { in: ["PENDING", "APPROVED"] },
              },
              select: { id: true },
            }),
            tx.attendanceSession.findFirst({
              where: {
                classId: slot.classId,
                date,
                OR: [
                  { scheduleStartTime: slot.startTime, scheduleEndTime: slot.endTime },
                  { scheduleStartTime: null, scheduleEndTime: null },
                ],
              },
              select: {
                id: true,
                isScheduleGenerated: true,
                _count: { select: { records: true } },
              },
            }),
            tx.classScheduleCancellation.findFirst({
              where: {
                classId: slot.classId,
                date,
                OR: [
                  { startTime: null, endTime: null },
                  { startTime: slot.startTime, endTime: slot.endTime },
                ],
              },
              select: { id: true },
            }),
          ]);
          return { slot, classroom, activeRequest, existingSession, cancellation };
        }));
        for (const check of checks) {
          if (!check) return { success: false as const, error: "Không xác định được ca đã chọn." };
          if (check.activeRequest) {
            return { success: false as const, error: `Lớp ${check.classroom.name} đã có yêu cầu đang chờ hoặc đã được duyệt cho ca ${check.slot.startTime}–${check.slot.endTime}.` };
          }
          if (check.cancellation) {
            return { success: false as const, error: `Ca ${check.slot.startTime}–${check.slot.endTime} của lớp ${check.classroom.name} đã được đánh dấu nghỉ.` };
          }
          if (check.existingSession && !check.existingSession.isScheduleGenerated) {
            return { success: false as const, error: `Lớp ${check.classroom.name} đã có buổi điểm danh tạo riêng; hãy xử lý buổi đó trước khi xin nghỉ ca ${check.slot.startTime}–${check.slot.endTime}.` };
          }
          if (check.existingSession && check.existingSession._count.records > 0) {
            return { success: false as const, error: `Ca ${check.slot.startTime}–${check.slot.endTime} của lớp ${check.classroom.name} đã có dữ liệu điểm danh nên không thể xin nghỉ.` };
          }
        }

        const leaveRequests: Array<{
          id: string;
          slot: { startTime: string; endTime: string; className: string };
        }> = [];
        for (const check of checks) {
          if (!check) continue;
          const { slot } = check;
          const leaveRequest = await tx.teacherLeaveRequest.create({
            data: {
              teacherId: teacher.id,
              classId: check.slot.classId,
              date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              reason,
            },
            select: { id: true },
          });
          leaveRequests.push({ ...leaveRequest, slot: { ...slot, className: check.classroom.name } });
        }

        await tx.userNotification.createMany({
          data: admins.flatMap(({ id }) => leaveRequests.map(({ id: requestId, slot }) => ({
            recipientId: id,
            actorId: teacher.id,
            kind: "TEACHER_LEAVE_REQUEST_SUBMITTED",
            title: "Giáo viên xin nghỉ một ca dạy",
            message: `${teacher.name} xin nghỉ lớp ${slot.className} ngày ${dateValue}, ca ${slot.startTime}–${slot.endTime}.`,
            targetUrl: "/admin/leave-requests",
            entityId: requestId,
          }))),
        });
        return { success: true as const, createdCount: leaveRequests.length };
      }, { isolationLevel: "Serializable" });
      if (!createdCount.success) return { ...createdCount, intent };
      return { ...createdCount, intent, date: dateValue };
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error.code === "P2034" || error.code === "P2002")
      ) {
        return { success: false as const, intent, error: "Ca dạy vừa được gửi yêu cầu hoặc cập nhật. Tải lại trang rồi thử lại." };
      }
      throw error;
    }
  }

  return { success: false as const, error: "Thao tác xin nghỉ không hợp lệ." };
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Không duyệt",
};

type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

const LEAVE_REQUEST_TABS: Array<{
  status: LeaveRequestStatus;
  label: string;
  emptyMessage: string;
}> = [
  { status: "PENDING", label: "Đang chờ duyệt", emptyMessage: "Bạn không có yêu cầu nào đang chờ duyệt." },
  { status: "APPROVED", label: "Đã duyệt", emptyMessage: "Chưa có yêu cầu nghỉ nào được duyệt." },
  { status: "REJECTED", label: "Từ chối", emptyMessage: "Bạn chưa có yêu cầu nào bị từ chối." },
];

export default function TeacherLeaveRequests() {
  const { user, classes, requests, firstAllowedDate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [date, setDate] = useState(firstAllowedDate ?? "");
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [activeStatus, setActiveStatus] = useState<LeaveRequestStatus>("PENDING");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const slotsByClass = useMemo(() => classes.flatMap((classroom) => {
    if (
      !date
      || date < classroom.startDate.toISOString().slice(0, 10)
      || date < classroom.scheduleEffectiveFrom.toISOString().slice(0, 10)
    ) return [];
    const slots = getScheduledSlotsForDate(classroom.schedule, date).map((slot) => ({
      ...slot,
      key: `${classroom.id}|${slot.startTime}|${slot.endTime}`,
    }));
    return slots.length > 0 ? [{ ...classroom, slots }] : [];
  }), [classes, date]);
  const visibleRequests = requests.filter((item) => item.status === activeStatus);
  const requestCounts: Record<LeaveRequestStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
  };
  for (const item of requests) requestCounts[item.status] += 1;
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
    document.getElementById(`teacher-leave-tab-${nextTab.status.toLowerCase()}`)?.focus();
  };

  useEffect(() => {
    setSelectedSlots([]);
  }, [date]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      if (fetcher.data.intent === "request-leave" && "createdCount" in fetcher.data) {
        toast.success(`Đã gửi ${fetcher.data.createdCount} yêu cầu nghỉ admin duyệt.`);
        setSelectedSlots([]);
        setReason("");
        setIsCreateOpen(false);
      }
    } else if ("error" in fetcher.data) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  const isSubmitting = fetcher.state !== "idle";

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Yêu cầu nghỉ</h1>
            <p className="mt-1 text-sm text-muted-foreground">Theo dõi trạng thái các yêu cầu nghỉ đã gửi.</p>
          </div>
          <Button type="button" onClick={() => setIsCreateOpen(true)} aria-haspopup="dialog">
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
            Tạo yêu cầu nghỉ
          </Button>
        </header>

        <section aria-label="Lịch sử yêu cầu nghỉ" className="space-y-4">
          <div
            role="tablist"
            aria-label="Lọc yêu cầu nghỉ theo trạng thái"
            className="flex gap-1 overflow-x-auto border-b"
          >
            {LEAVE_REQUEST_TABS.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                id={`teacher-leave-tab-${status.toLowerCase()}`}
                role="tab"
                aria-selected={activeStatus === status}
                aria-controls="teacher-leave-panel"
                tabIndex={activeStatus === status ? 0 : -1}
                onClick={() => setActiveStatus(status)}
                onKeyDown={handleTabKeyDown}
                className={`min-h-11 shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
            id="teacher-leave-panel"
            role="tabpanel"
            aria-labelledby={`teacher-leave-tab-${activeStatus.toLowerCase()}`}
            tabIndex={0}
            className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {visibleRequests.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {activeTab.emptyMessage}
              </p>
            ) : activeStatus === "APPROVED" ? (
              visibleRequests.map((item) => (
                <article key={item.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-medium">{item.classroom.name} · {formatDate(item.date)}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Ca {item.startTime} – {item.endTime}</p>
                      {item.reason && <p className="mt-1 max-w-prose text-sm text-muted-foreground">Lý do: {item.reason}</p>}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      <Check aria-hidden="true" className="h-3.5 w-3.5" /> Đã duyệt
                    </span>
                  </div>

                </article>
              ))
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {visibleRequests.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.classroom.name} · {formatDate(item.date)}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{item.startTime} – {item.endTime}</p>
                      {item.reason && <p className="mt-1 max-w-prose text-sm text-muted-foreground">Lý do: {item.reason}</p>}
                      {item.reviewNote && <p className="mt-1 max-w-prose text-sm text-muted-foreground">Phản hồi: {item.reviewNote}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      item.status === "PENDING"
                        ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {STATUS_LABELS[item.status] ?? "Chưa xác định"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {isCreateOpen && (
          <Overlay
            onClose={() => setIsCreateOpen(false)}
            closeOnEscape
            closeOnBackdrop
            className="max-w-2xl"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="leave-request-heading"
              className="space-y-4"
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="leave-request-heading" className="text-lg font-semibold">Tạo yêu cầu nghỉ</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Chọn ngày và ca dạy cần nghỉ. Mỗi ca được gửi riêng để admin duyệt.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng"
                  autoFocus
                  onClick={() => setIsCreateOpen(false)}
                  className="-mr-2 -mt-2 shrink-0"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>
            <div className="max-w-sm space-y-1.5">
              <label htmlFor="leave-date" className="text-sm font-medium">Ngày nghỉ</label>
              <input
                id="leave-date"
                type="date"
                value={date}
                min={firstAllowedDate ?? undefined}
                onChange={(event) => setDate(event.currentTarget.value)}
                disabled={isSubmitting}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Ca dạy trong ngày</h3>
              {slotsByClass.length === 0 ? (
                <p className="rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
                  {classes.length === 0
                    ? "Bạn chưa được phân công lớp đang hoạt động."
                    : date
                      ? "Ngày này bạn không có ca dạy theo lịch."
                      : "Chọn ngày nghỉ để xem các ca dạy."}
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {slotsByClass.map((classroom) => (
                    <section key={classroom.id} aria-labelledby={`leave-class-${classroom.id}`} className="min-w-0 px-3 py-3">
                      <h4 id={`leave-class-${classroom.id}`} className="mb-1.5 text-sm font-medium">
                        {classroom.name}
                        <span className="ml-1 font-normal text-muted-foreground">· {classroom.course.title}</span>
                      </h4>
                      <div className="divide-y">
                        {classroom.slots.map((slot) => {
                          const checked = selectedSlots.includes(slot.key);
                          const activeRequest = requests.find((item) =>
                            item.classId === classroom.id
                            && item.date.toISOString().slice(0, 10) === date
                            && item.startTime === slot.startTime
                            && item.endTime === slot.endTime
                            && (item.status === "PENDING" || item.status === "APPROVED"),
                          );
                          return (
                            <label key={slot.key} className="flex min-h-12 cursor-pointer items-center gap-3 py-2.5 hover:bg-muted/40">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isSubmitting || Boolean(activeRequest)}
                                onChange={(event) => {
                                  const isChecked = event.currentTarget.checked;
                                  setSelectedSlots((current) =>
                                    isChecked
                                      ? [...current, slot.key]
                                      : current.filter((value) => value !== slot.key)
                                  );
                                }}
                                className="h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                              />
                              <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="text-sm font-medium">{slot.startTime} – {slot.endTime}</span>
                              {activeRequest && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {activeRequest.status === "PENDING" ? "Đang chờ duyệt" : "Đã duyệt nghỉ"}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            <fetcher.Form method="post" className="space-y-3 border-t pt-4">
              <input type="hidden" name="intent" value="request-leave" />
              <input type="hidden" name="date" value={date} />
              {selectedSlots.map((slot) => <input key={slot} type="hidden" name="slots" value={slot} />)}
              <div className="space-y-1.5">
                <label htmlFor="leave-reason" className="text-sm font-medium">Lý do xin nghỉ (bắt buộc)</label>
                <Textarea
                  id="leave-reason"
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Nhập lý do bạn cần nghỉ..."
                  aria-describedby="leave-reason-hint"
                  required
                  disabled={isSubmitting}
                />
                <p id="leave-reason-hint" className="text-xs text-muted-foreground">
                  Lý do sẽ được gửi cho admin cùng với từng ca đã chọn.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {date ? formatDate(date) : "Chọn ngày nghỉ."}
                  {selectedSlots.length > 0 ? ` · Đã chọn ${selectedSlots.length} ca` : ""}
                </p>
                <Button type="submit" disabled={isSubmitting || !date || selectedSlots.length === 0 || !reason.trim()}>
                  <Umbrella aria-hidden="true" className="mr-2 h-4 w-4" />
                  {isSubmitting ? "Đang gửi..." : "Gửi admin duyệt"}
                </Button>
              </div>
            </fetcher.Form>
            </section>
          </Overlay>
        )}
      </div>
    </AppShell>
  );
}
