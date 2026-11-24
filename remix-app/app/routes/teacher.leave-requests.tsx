import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Search,
  Plus,
  Umbrella,
  X,
  XCircle,
  RotateCcw,
} from "lucide-react";
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
        reviewedAt: true,
        classroom: { select: { name: true } },
        makeupSession: { select: { date: true, scheduleStartTime: true, scheduleEndTime: true } },
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

  if (intent === "withdraw-leave-request") {
    const requestId = String(form.get("requestId") ?? "").trim();
    if (!requestId) {
      return { success: false as const, intent, error: "Không tìm thấy yêu cầu cần thu hồi." };
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const leaveRequest = await tx.teacherLeaveRequest.findFirst({
          where: { id: requestId, teacherId: teacher.id, status: "PENDING" },
          select: {
            id: true,
            classId: true,
            date: true,
            startTime: true,
            endTime: true,
            classroom: { select: { name: true } },
          },
        });
        if (!leaveRequest) {
          return {
            success: false as const,
            intent,
            error: "Yêu cầu không còn ở trạng thái chờ duyệt. Tải lại trang để xem trạng thái mới nhất.",
          };
        }

        const updated = await tx.teacherLeaveRequest.updateMany({
          where: { id: leaveRequest.id, teacherId: teacher.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        if (updated.count !== 1) {
          return {
            success: false as const,
            intent,
            error: "Yêu cầu vừa được admin xử lý. Tải lại trang để xem trạng thái mới nhất.",
          };
        }

        const admins = await tx.user.findMany({
          where: { role: "admin", isActive: true, isActivated: true, deletedAt: null },
          select: { id: true },
        });
        await tx.userNotification.updateMany({
          where: {
            kind: "TEACHER_LEAVE_REQUEST_SUBMITTED",
            entityId: leaveRequest.id,
            readAt: null,
          },
          data: { readAt: new Date() },
        });
        if (admins.length > 0) {
          const dateValue = leaveRequest.date.toISOString().slice(0, 10);
          await tx.userNotification.createMany({
            data: admins.map(({ id }) => ({
              recipientId: id,
              actorId: teacher.id,
              kind: "TEACHER_LEAVE_REQUEST_WITHDRAWN",
              title: "Giáo viên đã thu hồi yêu cầu nghỉ",
              message: `${teacher.name} đã thu hồi yêu cầu nghỉ lớp ${leaveRequest.classroom.name} ngày ${dateValue}, ca ${leaveRequest.startTime}–${leaveRequest.endTime}.`,
              targetUrl: "/admin/leave-requests",
              entityId: leaveRequest.id,
            })),
          });
        }

        return { success: true as const, intent, requestId: leaveRequest.id };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2034") {
        return {
          success: false as const,
          intent,
          error: "Yêu cầu vừa được cập nhật. Tải lại trang rồi thử lại.",
        };
      }
      throw error;
    }
  }

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

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Không duyệt",
  CANCELLED: "Đã thu hồi",
};

type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type LeaveRequestFilter = LeaveRequestStatus | "ALL";

const LEAVE_REQUEST_TABS: Array<{
  status: LeaveRequestFilter;
  label: string;
  emptyMessage: string;
}> = [
  { status: "ALL", label: "Tất cả", emptyMessage: "Bạn chưa có yêu cầu xin nghỉ nào." },
  { status: "PENDING", label: "Đang chờ duyệt", emptyMessage: "Bạn không có yêu cầu nào đang chờ duyệt." },
  { status: "APPROVED", label: "Đã duyệt", emptyMessage: "Chưa có yêu cầu nghỉ nào được duyệt." },
  { status: "REJECTED", label: "Từ chối", emptyMessage: "Bạn chưa có yêu cầu nào bị từ chối." },
  { status: "CANCELLED", label: "Đã thu hồi", emptyMessage: "Chưa có yêu cầu nào được thu hồi." },
];

const REASON_SUGGESTIONS = [
  "Bận việc cá nhân đột xuất",
  "Lý do sức khỏe / Đi khám",
  "Có việc gia đình quan trọng",
  "Trùng lịch công tác",
];

export default function TeacherLeaveRequests() {
  const { user, classes, requests, today, firstAllowedDate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const withdrawFetcher = useFetcher<typeof action>();
  const [date, setDate] = useState(firstAllowedDate ?? "");
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [activeStatus, setActiveStatus] = useState<LeaveRequestFilter>("PENDING");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [requestSearch, setRequestSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [pendingWithdrawalId, setPendingWithdrawalId] = useState<string | null>(null);
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
  const availableMonths = [...new Set(requests.map((item) => item.date.toISOString().slice(0, 7)))].sort().reverse();
  const requestCounts: Record<LeaveRequestStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    CANCELLED: 0,
  };
  for (const item of requests) requestCounts[item.status] += 1;
  const makeupNeededCount = requests.filter((item) => item.status === "APPROVED" && !item.makeupSession).length;
  const visibleRequests = requests.filter((item) => {
    if (activeStatus !== "ALL" && item.status !== activeStatus) return false;
    if (selectedMonth !== "all" && item.date.toISOString().slice(0, 7) !== selectedMonth) return false;
    const query = requestSearch.trim().toLocaleLowerCase("vi");
    if (!query) return true;
    return [item.classroom.name, item.reason, item.reviewNote ?? ""]
      .some((value) => value.toLocaleLowerCase("vi").includes(query));
  });
  const activeTab = LEAVE_REQUEST_TABS.find(({ status }) => status === activeStatus)!;
  const quickDates = [1, 2, 3, 4]
    .map((offset) => addDaysToDateString(today, offset))
    .filter((value): value is string => Boolean(value));
  const selectableSlotKeys = slotsByClass.flatMap((classroom) => classroom.slots
    .filter((slot) => !requests.some((item) =>
      item.classId === classroom.id
      && item.date.toISOString().slice(0, 10) === date
      && item.startTime === slot.startTime
      && item.endTime === slot.endTime
      && (item.status === "PENDING" || item.status === "APPROVED"),
    ))
    .map((slot) => slot.key));
  const allSelectableSlotsSelected = selectableSlotKeys.length > 0
    && selectableSlotKeys.every((key) => selectedSlots.includes(key));

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

  useEffect(() => {
    if (!withdrawFetcher.data || withdrawFetcher.state !== "idle") return;
    if (withdrawFetcher.data.success && withdrawFetcher.data.intent === "withdraw-leave-request") {
      toast.success("Đã thu hồi yêu cầu nghỉ.");
      setPendingWithdrawalId(null);
    } else if (!withdrawFetcher.data.success && "error" in withdrawFetcher.data) {
      toast.error(withdrawFetcher.data.error);
    }
  }, [withdrawFetcher.data, withdrawFetcher.state]);

  const isSubmitting = fetcher.state !== "idle";
  const isWithdrawing = withdrawFetcher.state !== "idle";
  const pendingWithdrawal = requests.find((item) => item.id === pendingWithdrawalId) ?? null;

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="-mx-4 -mt-2 flex flex-col gap-4 border-b border-border/80 bg-background px-4 py-4 shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">Yêu cầu nghỉ</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Theo dõi trạng thái phê duyệt các ca xin nghỉ dạy và lịch dạy bù.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => setIsCreateOpen(true)} aria-haspopup="dialog" className="shrink-0 gap-2">
                <Plus aria-hidden="true" className="h-4 w-4" />
                Tạo yêu cầu nghỉ
              </Button>
            </div>
          </div>
        </header>

        <section aria-label="Tổng quan yêu cầu nghỉ" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { status: "PENDING" as const, label: "Đang chờ duyệt", count: requestCounts.PENDING, icon: Clock3, tone: "amber" },
            { status: "APPROVED" as const, label: "Đã được duyệt", count: requestCounts.APPROVED, icon: CheckCircle2, tone: "emerald" },
            { status: "REJECTED" as const, label: "Bị từ chối", count: requestCounts.REJECTED, icon: XCircle, tone: "rose" },
          ].map(({ status, label, count, icon: Icon, tone }) => (
            <button
              key={status}
              type="button"
              onClick={() => setActiveStatus(status)}
              aria-pressed={activeStatus === status}
              className={`flex min-h-[5.5rem] items-center gap-3.5 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                activeStatus === status ? "border-primary/40 ring-1 ring-primary/15" : "hover:border-border/70"
              }`}
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                  : tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
              }`}>
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-muted-foreground">{label}</span>
                <span className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold tabular-nums text-foreground">{count}</span>
                  <span className="text-[11px] text-muted-foreground">ca dạy</span>
                </span>
              </span>
            </button>
          ))}
          <div className="flex min-h-[5.5rem] items-center gap-3.5 rounded-2xl border bg-card p-4 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
              <CalendarDays aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-muted-foreground">Cần xếp lịch dạy bù</span>
              <span className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-bold tabular-nums text-foreground">{makeupNeededCount}</span>
                <span className="text-[11px] text-muted-foreground">buổi</span>
              </span>
            </span>
          </div>
        </section>

        <section aria-label="Lịch sử yêu cầu nghỉ" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col gap-4 border-b px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div role="tablist" aria-label="Lọc yêu cầu nghỉ theo trạng thái" className="flex flex-wrap items-center gap-1.5">
              {LEAVE_REQUEST_TABS.map(({ status, label }) => {
                const count = status === "ALL" ? requests.length : requestCounts[status];
                return (
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
                    className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      activeStatus === status
                        ? "border-primary bg-primary font-semibold text-primary-foreground"
                        : "border-transparent bg-muted/70 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span className={`tabular-nums ${activeStatus === status ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1 sm:w-60">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.currentTarget.value)}
                  placeholder="Tìm lớp hoặc lý do..."
                  aria-label="Tìm yêu cầu nghỉ"
                  className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <label className="sr-only" htmlFor="leave-month-filter">Lọc theo tháng</label>
              <select
                id="leave-month-filter"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.currentTarget.value)}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">Tất cả thời gian</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("vi-VN", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            id="teacher-leave-panel"
            role="tabpanel"
            aria-labelledby={`teacher-leave-tab-${activeStatus.toLowerCase()}`}
            tabIndex={0}
            className="space-y-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
          >
            {visibleRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-muted/20 px-4 py-12 text-center sm:px-6">
                <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-card text-primary shadow-sm">
                  <CalendarDays aria-hidden="true" className="h-7 w-7" />
                </span>
                <h2 className="text-base font-semibold">
                  {requests.length > 0 && (requestSearch.trim() || selectedMonth !== "all")
                    ? "Không tìm thấy yêu cầu phù hợp"
                    : activeTab.emptyMessage}
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {requests.length > 0 && (requestSearch.trim() || selectedMonth !== "all")
                    ? "Thử đổi từ khóa hoặc khoảng thời gian để xem các yêu cầu khác."
                    : "Các yêu cầu nghỉ đã gửi sẽ xuất hiện tại đây để bạn tiện theo dõi."}
                </p>
                {requests.length === 0 && (
                  <Button type="button" onClick={() => setIsCreateOpen(true)} className="mt-5 gap-2">
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Tạo yêu cầu nghỉ
                  </Button>
                )}
              </div>
            ) : (
              visibleRequests.map((item) => {
                const dateValue = new Date(`${item.date.toISOString().slice(0, 10)}T00:00:00.000Z`);
                const statusTone = item.status === "PENDING"
                  ? "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                  : item.status === "APPROVED"
                    ? "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : item.status === "REJECTED"
                      ? "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                      : "border-border bg-muted/60 text-muted-foreground";
                return (
                  <article key={item.id} className="flex flex-col gap-4 rounded-2xl border bg-background p-4 transition-colors hover:border-border/70 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:gap-4">
                      <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border ${statusTone}`}>
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          {dateValue.toLocaleDateString("vi-VN", { weekday: "short", timeZone: "UTC" })}
                        </span>
                        <span className="mt-0.5 text-lg font-bold leading-tight tabular-nums">
                          {dateValue.toLocaleDateString("vi-VN", { day: "2-digit", timeZone: "UTC" })}
                        </span>
                        <span className="text-[10px] font-medium">
                          Tháng {dateValue.toLocaleDateString("vi-VN", { month: "2-digit", timeZone: "UTC" })}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              item.status === "PENDING"
                                ? "bg-amber-500"
                                : item.status === "APPROVED"
                                  ? "bg-emerald-600"
                                  : item.status === "REJECTED" ? "bg-rose-500" : "bg-muted-foreground"
                            }`} />
                            {STATUS_LABELS[item.status]}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                            <Clock3 aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                            {item.startTime} – {item.endTime}
                          </span>
                        </div>
                        <h2 className="break-words text-sm font-semibold leading-5 text-foreground sm:text-base">
                          {item.classroom.name}
                        </h2>
                        <p className="break-words text-sm leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground/80">Lý do:</span> {item.reason}
                        </p>
                        {item.reviewNote && (
                          <p className={`break-words rounded-xl border px-3 py-2 text-xs leading-5 ${
                            item.status === "REJECTED"
                              ? "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                              : "border-border bg-muted/50 text-muted-foreground"
                          }`}>
                            <span className="font-semibold">Phản hồi admin:</span> {item.reviewNote}
                          </p>
                        )}
                        {item.status === "APPROVED" && (
                          <p className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                            item.makeupSession
                              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          }`}>
                            <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                            {item.makeupSession
                              ? `Buổi bù đã xếp: ${formatDate(item.makeupSession.date)}${item.makeupSession.scheduleStartTime ? ` · ${item.makeupSession.scheduleStartTime} – ${item.makeupSession.scheduleEndTime}` : ""}`
                              : "Chưa có thông tin buổi bù"}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
                      <div className="flex flex-col gap-1 lg:items-end">
                        <span>
                          Gửi lúc {item.createdAt.toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            timeZone: "Asia/Ho_Chi_Minh",
                          })}
                        </span>
                        {item.reviewedAt && <span>Phản hồi ngày {formatDate(item.reviewedAt)}</span>}
                      </div>
                      {item.status === "PENDING" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1.5"
                          onClick={() => setPendingWithdrawalId(item.id)}
                        >
                          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                          Thu hồi
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {isCreateOpen && (
          <Overlay
            onClose={() => {
              if (!isSubmitting) setIsCreateOpen(false);
            }}
            closeOnEscape
            closeOnBackdrop
            className="!max-h-[92vh] !max-w-2xl !overflow-hidden !rounded-2xl !p-0"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="leave-request-heading"
              className="flex max-h-[92vh] flex-col bg-card"
            >
              <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                    <CalendarDays aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 id="leave-request-heading" className="text-lg font-semibold">Tạo yêu cầu nghỉ</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
                      Chọn ngày và ca dạy cần xin nghỉ. Mỗi ca được gửi riêng để admin duyệt.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Đóng"
                  autoFocus
                  disabled={isSubmitting}
                  onClick={() => setIsCreateOpen(false)}
                  className="-mr-2 -mt-1 shrink-0"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </header>

              <fetcher.Form method="post" className="flex min-h-0 flex-1 flex-col">
                <input type="hidden" name="intent" value="request-leave" />
                <input type="hidden" name="date" value={date} />
                {selectedSlots.map((slot) => <input key={slot} type="hidden" name="slots" value={slot} />)}

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
                  <section aria-labelledby="leave-date-heading">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label id="leave-date-heading" htmlFor="leave-date" className="text-xs font-semibold uppercase tracking-wide text-foreground">
                        Ngày xin nghỉ
                      </label>
                      {date && (
                        <span className="rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                          {formatDate(date)}
                        </span>
                      )}

                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Ngày trước"
                        disabled={isSubmitting || !date || !firstAllowedDate || date <= firstAllowedDate}
                        onClick={() => {
                          const previousDate = addDaysToDateString(date, -1);
                          if (previousDate && previousDate >= (firstAllowedDate ?? "")) setDate(previousDate);
                        }}
                        className="h-10 w-10 shrink-0 rounded-xl"
                      >
                        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      <input
                        id="leave-date"
                        type="date"
                        value={date}
                        min={firstAllowedDate ?? undefined}
                        onChange={(event) => setDate(event.currentTarget.value)}
                        disabled={isSubmitting}
                        className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Ngày tiếp theo"
                        disabled={isSubmitting || !date}
                        onClick={() => {
                          const nextDate = addDaysToDateString(date, 1);
                          if (nextDate) setDate(nextDate);
                        }}
                        className="h-10 w-10 shrink-0 rounded-xl"
                      >
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
                      {quickDates.map((quickDate, index) => (
                        <button
                          key={quickDate}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setDate(quickDate)}
                          className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            date === quickDate
                              ? "border-primary bg-primary font-semibold text-primary-foreground"
                              : "border-transparent bg-muted/70 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {index === 0 ? "Ngày mai" : new Date(`${quickDate}T00:00:00.000Z`).toLocaleDateString("vi-VN", {
                            weekday: "short",
                            day: "2-digit",
                            month: "2-digit",
                            timeZone: "UTC",
                          })}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section aria-labelledby="leave-slots-heading">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <h3 id="leave-slots-heading" className="text-xs font-semibold uppercase tracking-wide">
                        Ca dạy cần xin nghỉ
                      </h3>
                      {selectableSlotKeys.length > 0 && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setSelectedSlots((current) =>
                            allSelectableSlotsSelected
                              ? current.filter((key) => !selectableSlotKeys.includes(key))
                              : [...new Set([...current, ...selectableSlotKeys])]
                          )}
                          className="shrink-0 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {allSelectableSlotsSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${selectableSlotKeys.length})`}
                        </button>
                      )}
                    </div>
                    {slotsByClass.length === 0 ? (
                      <p className="rounded-xl border border-dashed bg-muted/30 px-4 py-5 text-sm leading-6 text-muted-foreground">
                        {classes.length === 0
                          ? "Bạn chưa được phân công lớp đang hoạt động."
                          : date
                            ? "Ngày này bạn không có ca dạy theo lịch."
                            : "Chọn ngày nghỉ để xem các ca dạy."}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {slotsByClass.map((classroom) => (
                          <section key={classroom.id} aria-labelledby={`leave-class-${classroom.id}`} className="rounded-xl border bg-background p-3 sm:p-4">
                            <h4 id={`leave-class-${classroom.id}`} className="break-words text-sm font-semibold">
                              {classroom.name}
                              <span className="ml-1.5 font-normal text-muted-foreground">· {classroom.course.title}</span>
                            </h4>
                            <div className="mt-2 space-y-2">
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
                                  <label
                                    key={slot.key}
                                    className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                      activeRequest
                                        ? "cursor-not-allowed border-border/70 bg-muted/40"
                                        : checked
                                          ? "cursor-pointer border-primary/35 bg-primary/5"
                                          : "cursor-pointer border-border/70 hover:bg-muted/40"
                                    }`}
                                  >
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
                                      className="h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                    <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 text-sm font-medium tabular-nums">
                                      {slot.startTime} – {slot.endTime}
                                    </span>
                                    {activeRequest && (
                                      <span className="max-w-36 text-right text-[11px] font-medium text-muted-foreground">
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
                  </section>

                  <section aria-labelledby="leave-reason-heading">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label id="leave-reason-heading" htmlFor="leave-reason" className="text-xs font-semibold uppercase tracking-wide">
                        Lý do xin nghỉ <span className="text-destructive">*</span>
                      </label>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{reason.length}/1.000</span>
                    </div>
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {REASON_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setReason(suggestion)}
                          className="rounded-lg border border-transparent bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/20 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          + {suggestion}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      id="leave-reason"
                      name="reason"
                      value={reason}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder="Nhập lý do để admin nắm thông tin và sắp xếp lịch dạy..."
                      aria-describedby="leave-reason-hint"
                      required
                      disabled={isSubmitting}
                      className="resize-none rounded-xl"
                    />
                    <p id="leave-reason-hint" className="mt-1.5 text-xs text-muted-foreground">
                      Lý do sẽ được gửi cho admin cùng với từng ca đã chọn.
                    </p>
                  </section>
                </div>

                <footer className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectedSlots.length === 0
                      ? "Chưa chọn ca dạy"
                      : `Đã chọn ${selectedSlots.length} ca dạy`}
                    {date ? ` · ${formatDate(date)}` : ""}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => setIsCreateOpen(false)}>
                      Hủy
                    </Button>
                    <Button type="submit" disabled={isSubmitting || !date || selectedSlots.length === 0 || !reason.trim()} className="gap-2">
                      <Umbrella aria-hidden="true" className="h-4 w-4" />
                      {isSubmitting ? "Đang gửi..." : "Gửi admin duyệt"}
                    </Button>
                  </div>
                </footer>
              </fetcher.Form>
            </section>
          </Overlay>
        )}

        {pendingWithdrawal && (
          <Overlay
            onClose={() => {
              if (!isWithdrawing) setPendingWithdrawalId(null);
            }}
            closeOnEscape={!isWithdrawing}
            closeOnBackdrop={!isWithdrawing}
            className="!max-w-md !rounded-2xl !p-0"
          >
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="withdraw-leave-heading"
              aria-describedby="withdraw-leave-description"
              className="bg-card"
            >
              <div className="space-y-2 px-5 py-5">
                <h2 id="withdraw-leave-heading" className="text-lg font-semibold">Thu hồi yêu cầu nghỉ?</h2>
                <p id="withdraw-leave-description" className="text-sm leading-6 text-muted-foreground">
                  Yêu cầu nghỉ lớp <span className="font-medium text-foreground">{pendingWithdrawal.classroom.name}</span> sẽ
                  được chuyển sang trạng thái đã thu hồi và admin sẽ nhận thông báo.
                </p>
              </div>
              <withdrawFetcher.Form method="post" className="flex justify-end gap-2 border-t px-5 py-4">
                <input type="hidden" name="intent" value="withdraw-leave-request" />
                <input type="hidden" name="requestId" value={pendingWithdrawal.id} />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isWithdrawing}
                  onClick={() => setPendingWithdrawalId(null)}
                >
                  Giữ yêu cầu
                </Button>
                <Button type="submit" variant="destructive" disabled={isWithdrawing} className="gap-2">
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  {isWithdrawing ? "Đang thu hồi..." : "Xác nhận thu hồi"}
                </Button>
              </withdrawFetcher.Form>
            </section>
          </Overlay>
        )}
      </div>
    </AppShell>
  );
}
