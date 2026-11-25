import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Search,
  Video,
  X,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import {
  SearchableDropdown,
  type SearchableDropdownOption,
} from "~/components/common/searchable-dropdown";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { getVietnameseDateString } from "~/lib/schedule-utils";
import { toast } from "sonner";

type StatusTab = "all" | "missing_link" | "has_link" | "upcoming_week";

const DATE_WINDOW_DAYS = 30;
const MAX_URL_LENGTH = 2048;

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function getSafeRecordUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function getSessionNumber(title: string) {
  const match = /^Buổi\s+(\d+)$/i.exec(title.trim());
  return match?.[1] ?? null;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN")
    .trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const today = getVietnameseDateString();
  const fromDate = shiftDate(today, -DATE_WINDOW_DAYS);
  const throughDate = shiftDate(today, DATE_WINDOW_DAYS);
  const [sessions, availableLevels] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: {
        date: { gte: fromDate, lte: throughDate },
        class: { is: { completedAt: null } },
      },
      orderBy: [
        { createdAt: "desc" },
        { date: "desc" },
        { scheduleStartTime: "asc" },
      ],
      select: {
        id: true,
        title: true,
        lesson: true,
        date: true,
        scheduleStartTime: true,
        scheduleEndTime: true,
        recordingUrl: true,
        courseLesson: { select: { title: true } },
        class: {
          select: {
            id: true,
            name: true,
            teacherId: true,
            teacher: { select: { id: true, name: true } },
            course: { select: { hskLevel: true, title: true } },
          },
        },
      },
    }),
    prisma.course.findMany({
      distinct: ["hskLevel"],
      orderBy: { hskLevel: "asc" },
      select: { hskLevel: true },
    }),
  ]);

  return {
    user,
    today,
    levels: availableLevels.map(({ hskLevel }) => hskLevel),
    sessions: sessions.map((session) => ({
      ...session,
      classroom: session.class,
      date: session.date.toISOString().slice(0, 10),
      lessonTitle: session.courseLesson?.title || session.lesson || "",
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-recording-link") {
    const sessionId = String(form.get("sessionId") ?? "").trim();
    const rawUrl = String(form.get("recordingUrl") ?? "").trim();
    if (!sessionId) {
      return { success: false as const, intent, error: "Không tìm thấy buổi học cần cập nhật." };
    }

    let recordingUrl: string | null = null;
    if (rawUrl) {
      try {
        const parsedUrl = new URL(rawUrl);
        if (
          (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")
          || rawUrl.length > MAX_URL_LENGTH
        ) {
          return {
            success: false as const,
            intent,
            error: "Link ghi hình phải là URL HTTP hoặc HTTPS, tối đa 2048 ký tự.",
          };
        }
        recordingUrl = parsedUrl.toString();
      } catch {
        return { success: false as const, intent, error: "Vui lòng nhập URL ghi hình hợp lệ." };
      }
    }

    const updated = await prisma.attendanceSession.updateMany({
      where: {
        id: sessionId,
        class: { is: { completedAt: null } },
      },
      data: { recordingUrl },
    });
    if (updated.count !== 1) {
      return {
        success: false as const,
        intent,
        error: "Buổi học không còn khả dụng. Tải lại trang rồi thử lại.",
      };
    }

    return {
      success: true as const,
      intent,
      message: recordingUrl ? "Đã lưu link ghi hình." : "Đã gỡ link ghi hình.",
    };
  }

  if (intent === "remind-session-teacher") {
    const sessionId = String(form.get("sessionId") ?? "").trim();
    const session = await prisma.attendanceSession.findFirst({
      where: {
        id: sessionId,
        class: {
          is: {
            completedAt: null,
            teacher: { is: { role: "teacher", isActive: true, deletedAt: null } },
          },
        },
      },
      select: {
        id: true,
        title: true,
        date: true,
        recordingUrl: true,
        class: {
          select: {
            name: true,
            teacher: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!session?.class.teacher) {
      return {
        success: false as const,
        intent,
        error: "Không tìm thấy giáo viên hoặc buổi học này đã có link.",
      };
    }
    if (getSafeRecordUrl(session.recordingUrl)) {
      return {
        success: false as const,
        intent,
        error: "Buổi học đã có link ghi hình. Tải lại trang để cập nhật trạng thái.",
      };
    }

    await prisma.userNotification.create({
      data: {
        recipientId: session.class.teacher.id,
        actorId: admin.id,
        kind: "ATTENDANCE_RECORDING_LINK_REMINDER",
        title: "Nhắc bổ sung link ghi hình",
        message: `${session.class.name} · ${session.title || "Buổi học"} ngày ${session.date.toISOString().slice(0, 10)} chưa có link ghi hình.`,
        targetUrl: "/teacher/attendance",
        entityId: session.id,
      },
    });
    return { success: true as const, intent, message: `Đã gửi nhắc ${session.class.teacher.name}.` };
  }

  if (intent === "send-bulk-reminders") {
    const teacherIds = [...new Set(
      form.getAll("teacherId").filter((value): value is string => typeof value === "string" && value.length > 0),
    )];
    if (teacherIds.length === 0) {
      return { success: false as const, intent, error: "Chọn ít nhất một giáo viên để gửi nhắc." };
    }

    const today = getVietnameseDateString();
    const missingSessions = await prisma.attendanceSession.findMany({
      where: {
        date: { gte: shiftDate(today, -DATE_WINDOW_DAYS), lte: shiftDate(today, DATE_WINDOW_DAYS) },
        class: {
          is: {
            completedAt: null,
            teacherId: { in: teacherIds },
            teacher: { is: { role: "teacher", isActive: true, deletedAt: null } },
          },
        },
      },
      select: {
        title: true,
        date: true,
        recordingUrl: true,
        class: {
          select: {
            name: true,
            teacher: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { scheduleStartTime: "asc" }],
    });
    const grouped = new Map<string, {
      name: string;
      sessions: Array<{ title: string; date: string; className: string }>;
    }>();
    for (const session of missingSessions) {
      if (getSafeRecordUrl(session.recordingUrl)) continue;
      const teacher = session.class.teacher;
      if (!teacher) continue;
      const group = grouped.get(teacher.id) ?? { name: teacher.name, sessions: [] };
      group.sessions.push({
        title: session.title || "Buổi học",
        date: session.date.toISOString().slice(0, 10),
        className: session.class.name,
      });
      grouped.set(teacher.id, group);
    }

    const notifications = [...grouped].map(([recipientId, group]) => {
      const sessionsByClass = new Map<string, typeof group.sessions>();
      for (const session of group.sessions.slice(0, 5)) {
        const classSessions = sessionsByClass.get(session.className) ?? [];
        classSessions.push(session);
        sessionsByClass.set(session.className, classSessions);
      }

      const classLines = [...sessionsByClass].map(([className, sessions]) =>
        `• ${className}: ${sessions.map((session) => `${session.title} (${session.date})`).join(", ")}`,
      );
      if (group.sessions.length > 5) {
        classLines.push(`• Còn ${group.sessions.length - 5} buổi học khác.`);
      }

      return {
        recipientId,
        actorId: admin.id,
        kind: "ATTENDANCE_RECORDING_LINK_REMINDER",
        title: "Nhắc bổ sung link ghi hình",
        message: `Bạn còn ${group.sessions.length} buổi học chưa có link ghi hình:\n${classLines.join("\n")}`,
        targetUrl: "/teacher/attendance",
      };
    });
    if (notifications.length === 0) {
      return {
        success: false as const,
        intent,
        error: "Các giáo viên đã chọn không còn buổi nào thiếu link trong khoảng ngày này. Tải lại trang để cập nhật.",
      };
    }

    await prisma.userNotification.createMany({ data: notifications });
    return {
      success: true as const,
      intent,
      message: `Đã gửi thông báo tới ${notifications.length} giáo viên.`,
    };
  }

  return { success: false as const, intent, error: "Thao tác không hợp lệ." };
}

export default function AdminSessionLinksPage() {
  const { user, today, sessions, levels } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [teacherId, setTeacherId] = useState("all");
  const [classId, setClassId] = useState("all");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkReminderOpen, setBulkReminderOpen] = useState(false);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const isSubmitting = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";
  const editingSession = sessions.find(({ id }) => id === editingId) ?? null;

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.success) {
      toast.success(result.message);
      if (result.intent === "save-recording-link") setEditingId(null);
      if (result.intent === "send-bulk-reminders") setBulkReminderOpen(false);
    } else {
      toast.error(result.error);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (!editingId && !bulkReminderOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditingId(null);
        setBulkReminderOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingId, bulkReminderOpen]);

  const teachers = useMemo(() => {
    const unique = new Map<string, string>();
    for (const session of sessions) {
      if (session.classroom.teacher) unique.set(session.classroom.teacher.id, session.classroom.teacher.name);
    }
    return [...unique].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [sessions]);

  const classes = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; teacherId: string | null }>();
    for (const session of sessions) {
      const classroom = session.classroom;
      if (teacherId !== "all" && classroom.teacherId !== teacherId) continue;
      unique.set(classroom.id, {
        id: classroom.id,
        name: classroom.name,
        teacherId: classroom.teacherId,
      });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [sessions, teacherId]);

  const teacherFilterOptions: SearchableDropdownOption[] = [
    { value: "all", label: "Tất cả giáo viên" },
    ...teachers.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const classFilterOptions: SearchableDropdownOption[] = [
    { value: "all", label: `Tất cả lớp học (${classes.length})` },
    ...classes.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const levelFilterOptions: SearchableDropdownOption[] = [
    { value: "all", label: "Tất cả trình độ" },
    ...levels.map((item) => ({ value: String(item), label: `HSK ${item}` })),
  ];
  const filteredBySelectors = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    return sessions.filter((session) => {
      if (teacherId !== "all" && session.classroom.teacherId !== teacherId) return false;
      if (classId !== "all" && session.classroom.id !== classId) return false;
      if (level !== "all" && String(session.classroom.course.hskLevel) !== level) return false;
      if (!normalizedQuery) return true;
      const searchable = normalizeSearch([
        session.title,
        session.lessonTitle,
        session.classroom.name,
        session.classroom.teacher?.name ?? "",
        session.classroom.course.title,
      ].join(" "));
      return searchable.includes(normalizedQuery);
    });
  }, [sessions, teacherId, classId, level, query]);

  const missingSessions = filteredBySelectors.filter(({ recordingUrl }) => !getSafeRecordUrl(recordingUrl));
  const linkedSessions = filteredBySelectors.filter(({ recordingUrl }) => Boolean(getSafeRecordUrl(recordingUrl)));
  const weekThrough = shiftDate(today, 7).toISOString().slice(0, 10);
  const upcomingSessions = filteredBySelectors.filter(
    ({ date }) => date >= today && date <= weekThrough,
  );
  const visibleSessions = activeTab === "missing_link"
    ? missingSessions
    : activeTab === "has_link"
      ? linkedSessions
      : activeTab === "upcoming_week"
        ? upcomingSessions
        : filteredBySelectors;

  const missingByTeacher = useMemo(() => {
    const groups = new Map<string, {
      id: string;
      name: string;
      sessions: typeof missingSessions;
    }>();
    for (const session of missingSessions) {
      const teacher = session.classroom.teacher;
      if (!teacher) continue;
      const group = groups.get(teacher.id) ?? { id: teacher.id, name: teacher.name, sessions: [] };
      group.sessions.push(session);
      groups.set(teacher.id, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [missingSessions]);

  function openBulkReminders() {
    fetcher.reset();
    setSelectedTeacherIds(missingByTeacher.map(({ id }) => id));
    setBulkReminderOpen(true);
  }

  function toggleTeacher(teacher: { id: string }, checked: boolean) {
    setSelectedTeacherIds((current) => checked
      ? [...new Set([...current, teacher.id])]
      : current.filter((id) => id !== teacher.id));
  }

  function exportMissingReport() {
    const rows = [
      ["Giáo viên", "Lớp", "Trình độ", "Buổi học", "Bài học", "Ngày", "Thời gian"],
      ...missingSessions.map((session) => [
        session.classroom.teacher?.name ?? "Chưa phân công",
        session.classroom.name,
        `HSK ${session.classroom.course.hskLevel}`,
        session.title || "Buổi học",
        session.lessonTitle,
        session.date,
        [session.scheduleStartTime, session.scheduleEndTime].filter(Boolean).join("–"),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `buoi-hoc-thieu-link-${today}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success(`Đã xuất ${missingSessions.length} buổi thiếu link theo bộ lọc.`);
  }

  async function copyRecordingLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Đã sao chép link ghi hình.");
    } catch {
      toast.error("Không thể sao chép link. Hãy chọn và sao chép thủ công.");
    }
  }

  const actionFailure = fetcher.data && !fetcher.data.success ? fetcher.data : null;
  const editErrorMessage = actionFailure?.intent === "save-recording-link" ? actionFailure.error : null;
  const bulkErrorMessage = actionFailure?.intent === "send-bulk-reminders" ? actionFailure.error : null;
  const dateLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00.000Z`));

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-[1320px] space-y-5 text-slate-900 selection:bg-[#FBC7C9] selection:text-[#640B12]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <span>Quản lý lớp học</span><span aria-hidden="true">/</span>
              <span className="truncate font-semibold text-slate-800">Link buổi học</span>
            </div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-slate-900">Link buổi học</h1>
            <p className="mt-1 max-w-[74ch] text-[13px] leading-5 text-slate-600">
              Theo dõi link ghi hình của từng buổi học. Trang hiện chỉ lưu link ghi hình bằng dữ liệu sẵn có.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={exportMissingReport}
              className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4 text-slate-500" />
              <span>Xuất báo cáo thiếu link</span>
            </button>
            <button
              type="button"
              onClick={openBulkReminders}
              className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-[#7F0E17] px-4 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(15,23,42,0.18)] transition hover:bg-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2"
            >
              <Bell className="h-4 w-4" />
              <span>Nhắc giáo viên thiếu link</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-bold">{missingByTeacher.length} GV</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Hôm nay: {dateLabel}
          </span>
        </div>

        {isLoading && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-[#FBC7C9] bg-[#FDF2F2] px-3 py-2 text-sm text-[#640B12]">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Đang cập nhật dữ liệu buổi học…
          </div>
        )}

        <section aria-label="Thống kê link buổi học" className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Tổng buổi theo bộ lọc"
            value={`${visibleSessions.length} buổi`}
            detail={`Trong ${new Set(visibleSessions.map(({ classroom }) => classroom.id)).size} lớp đang hoạt động`}
            dotClass="bg-slate-400"
            onClick={() => setActiveTab("all")}
          />
          <KpiCard
            label="Đã có link ghi hình"
            value={`${linkedSessions.length} buổi • ${filteredBySelectors.length ? Math.round(linkedSessions.length / filteredBySelectors.length * 100) : 0}%`}
            detail="Học viên có thể xem bản ghi"
            dotClass="bg-emerald-500"
            onClick={() => setActiveTab("has_link")}
            hoverClass="hover:border-emerald-300"
            valueClass="text-emerald-700"
          />
          <KpiCard
            label="Chưa có link ghi hình"
            value={`${missingSessions.length} buổi`}
            detail="Cần bổ sung link ghi hình"
            dotClass="bg-rose-500"
            onClick={() => setActiveTab("missing_link")}
            hoverClass="hover:border-rose-300"
            valueClass="text-rose-700"
          />
          <KpiCard
            label="Giáo viên thiếu link"
            value={`${missingByTeacher.length} giáo viên`}
            detail={missingByTeacher.map(({ name }) => name).join(", ") || "Không có giáo viên cần nhắc"}
            dotClass="bg-amber-500"
            onClick={openBulkReminders}
            hoverClass="hover:border-amber-300"
            valueClass="text-amber-700"
          />
        </section>

        <section aria-label="Bảng theo dõi link buổi học" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="space-y-3.5 border-b border-slate-100 p-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Lọc trạng thái link">
              <StatusTabButton label="Tất cả" count={filteredBySelectors.length} active={activeTab === "all"} onClick={() => setActiveTab("all")} />
              <StatusTabButton label="Chưa có link" count={missingSessions.length} active={activeTab === "missing_link"} tone="rose" onClick={() => setActiveTab("missing_link")} />
              <StatusTabButton label="Đã có link" count={linkedSessions.length} active={activeTab === "has_link"} tone="emerald" onClick={() => setActiveTab("has_link")} />
              <StatusTabButton label="Tuần này" count={upcomingSessions.length} active={activeTab === "upcoming_week"} onClick={() => setActiveTab("upcoming_week")} />
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_minmax(220px,1.3fr)]">
              <SearchableDropdown
                id="teacherFilter"
                label="Lọc giáo viên"
                placeholder="Tất cả giáo viên"
                searchPlaceholder="Gõ tên giáo viên để tìm..."
                options={teacherFilterOptions}
                value={teacherId}
                onChange={(value) => {
                  setTeacherId(value);
                  setClassId("all");
                }}
                className="w-full min-w-0"
                triggerClassName="h-[38px] rounded-lg px-3 text-[13px] font-semibold"
                contentClassName="min-w-0"
              />
              <SearchableDropdown
                id="classFilter"
                label="Lọc lớp học"
                placeholder={`Tất cả lớp học (${classes.length})`}
                searchPlaceholder="Gõ tên lớp để tìm..."
                options={classFilterOptions}
                value={classId}
                onChange={setClassId}
                className="w-full min-w-0"
                triggerClassName="h-[38px] rounded-lg px-3 text-[13px] font-semibold"
                contentClassName="min-w-0"
              />
              <SearchableDropdown
                id="levelFilter"
                label="Lọc trình độ"
                placeholder="Tất cả trình độ"
                searchPlaceholder="Gõ trình độ để tìm..."
                options={levelFilterOptions}
                value={level}
                onChange={setLevel}
                className="w-full min-w-0"
                triggerClassName="h-[38px] rounded-lg px-3 text-[13px] font-semibold"
                contentClassName="min-w-0"
              />
              <label className="relative block min-w-0">
                <span className="sr-only">Tìm buổi, lớp, bài học hoặc giáo viên</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm buổi, lớp, bài học, giáo viên…"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-900 caret-[#7F0E17] outline-none placeholder:text-slate-400 focus:border-[#9E141F] focus:ring-2 focus:ring-[#9E141F]/15"
                />
              </label>
            </div>
          </div>

          <div className="custom-scrollbar overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/95 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="min-w-[220px] py-3 pl-5 pr-3">Giáo viên &amp; Lớp</th>
                  <th scope="col" className="min-w-[300px] px-3 py-3">Buổi học &amp; Thời gian</th>
                  <th scope="col" className="min-w-[170px] px-3 py-3">Link ghi hình</th>
                  <th scope="col" className="w-36 px-3 py-3">Trạng thái</th>
                  <th scope="col" className="w-48 min-w-[190px] py-3 pl-3 pr-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleSessions.map((session) => {
                  const recordingUrl = getSafeRecordUrl(session.recordingUrl);
                  const teacher = session.classroom.teacher;
                  const initials = teacher?.name.split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase() ?? "—";
                  const sessionNumber = getSessionNumber(session.title);
                  const schedule = [session.scheduleStartTime, session.scheduleEndTime].filter(Boolean).join(" – ");
                  const isUpcoming = session.date >= today && session.date <= weekThrough;
                  return (
                    <tr key={session.id} className="transition-colors hover:bg-slate-50/75">
                      <td className="py-3.5 pl-5 pr-3">
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FBC7C9] bg-[#FDF2F2] text-[11px] font-bold text-[#7F0E17]">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-bold text-slate-900">{teacher?.name ?? "Chưa phân công"}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">{session.classroom.name}</span>
                              <span className="rounded-md bg-[#FDF2F2] px-2 py-0.5 text-[11px] font-semibold text-[#7F0E17]">HSK {session.classroom.course.hskLevel}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="font-semibold text-slate-900">
                          {sessionNumber ? `Buổi ${sessionNumber}` : session.title || "Buổi học"}
                          {sessionNumber && session.lessonTitle ? ` • ${session.lessonTitle}` : ""}
                        </div>
                        {sessionNumber && (
                          <div className="mt-0.5 truncate text-xs text-slate-600">
                            {session.lessonTitle || "Chưa cập nhật bài học"}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span>{formatSessionDate(session.date)}</span>
                          {schedule && <><span aria-hidden="true">·</span><span className="font-semibold text-slate-700">{schedule}</span></>}
                          {isUpcoming && <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">Tuần này</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {recordingUrl ? (
                          <div className="space-y-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <a
                                href={recordingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#7F0E17] underline decoration-[#FBC7C9] underline-offset-2 hover:text-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F]"
                              >
                                <Video className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{recordingUrl}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                              <button
                                type="button"
                                onClick={() => void copyRecordingLink(recordingUrl)}
                                title="Sao chép link"
                                aria-label={`Sao chép link ghi hình ${session.title}`}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-600 transition hover:bg-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F]"
                              >
                                <Clipboard className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="text-[11px] text-slate-500">Video ghi hình buổi học</div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/90 px-2.5 py-1 text-xs font-semibold text-rose-700">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              Chưa gắn link
                            </span>
                            <div className="text-[11px] text-slate-500">Giáo viên chưa cập nhật URL</div>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        {recordingUrl ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Đã có link
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Thiếu link
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              fetcher.reset();
                              setEditingId(session.id);
                            }}
                            className={`inline-flex h-8 min-w-[82px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] ${
                              recordingUrl
                                ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                : "bg-[#7F0E17] text-white shadow-sm hover:bg-[#640B12]"
                            }`}
                          >
                            {recordingUrl ? "Sửa link" : "+ Gắn link"}
                          </button>
                          {!recordingUrl && teacher && (
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="remind-session-teacher" />
                              <input type="hidden" name="sessionId" value={session.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                title="Gửi nhắc giáo viên"
                                className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Nhắc GV
                              </button>
                            </fetcher.Form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleSessions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-14 text-center">
                      {sessions.length === 0 ? (
                        <>
                          <CalendarDays className="mx-auto h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-semibold text-slate-800">Chưa có buổi học trong thời gian này</p>
                          <p className="mt-1 text-xs text-slate-500">Chỉ các buổi thuộc lớp đang hoạt động trong khoảng ±30 ngày được hiển thị.</p>
                        </>
                      ) : (
                        <>
                          <Search className="mx-auto h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-semibold text-slate-800">Không tìm thấy buổi học phù hợp</p>
                          <p className="mt-1 text-xs text-slate-500">Thử đổi bộ lọc, tab trạng thái hoặc từ khóa tìm kiếm.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setTeacherId("all");
                              setClassId("all");
                              setLevel("all");
                              setQuery("");
                              setActiveTab("all");
                            }}
                            className="mt-3 rounded-md px-2 py-1 text-xs font-semibold text-[#7F0E17] underline underline-offset-2 hover:text-[#640B12]"
                          >
                            Xóa bộ lọc
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {visibleSessions.length} / {filteredBySelectors.length} buổi học</span>
            <span>Mẹo: bấm <strong className="text-slate-800">Gắn link</strong> để cập nhật trực tiếp URL ghi hình.</span>
          </div>
        </section>

        {editingSession && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !isSubmitting) setEditingId(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="editRecordingTitle"
              className="max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.22)]"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7F0E17]">Cập nhật link buổi học</span>
                  <h2 id="editRecordingTitle" className="mt-0.5 text-lg font-bold text-slate-900">
                    {getSafeRecordUrl(editingSession.recordingUrl) ? "Sửa link ghi hình" : "Gắn link ghi hình"}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {editingSession.classroom.teacher?.name ?? "Chưa phân công giáo viên"} · {editingSession.classroom.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={isSubmitting}
                  aria-label="Đóng"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="save-recording-link" />
                <input type="hidden" name="sessionId" value={editingSession.id} />
                <div className="space-y-4 p-6 text-[13px]">
                  <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <div className="font-bold text-slate-900">{editingSession.title || "Buổi học"}</div>
                    <div className="text-xs text-slate-700">{editingSession.lessonTitle}</div>
                    <div className="text-xs text-slate-500">
                      {formatSessionDate(editingSession.date)}
                      {editingSession.scheduleStartTime && ` · ${editingSession.scheduleStartTime}`}
                      {editingSession.scheduleEndTime && `–${editingSession.scheduleEndTime}`}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="modalLinkType" className="block font-semibold text-slate-800">Loại đường dẫn</label>
                    <select
                      id="modalLinkType"
                      value="recording"
                      disabled
                      className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-100 px-3 text-[13px] font-medium text-slate-700"
                    >
                      <option value="recording">Video record buổi học</option>
                    </select>
                    <p className="text-[11px] leading-4 text-slate-500">
                      Link phòng họp và tài liệu chưa được hỗ trợ để tránh lưu nhầm vào trường ghi hình của học viên.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="modalSessionUrlInput" className="block font-semibold text-slate-800">URL link ghi hình</label>
                    <input
                      id="modalSessionUrlInput"
                      name="recordingUrl"
                      type="url"
                      maxLength={MAX_URL_LENGTH}
                      defaultValue={getSafeRecordUrl(editingSession.recordingUrl) ?? ""}
                      placeholder="https://drive.google.com/…"
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#9E141F] focus:ring-2 focus:ring-[#9E141F]/15"
                    />
                    <p className="text-[11px] text-slate-500">Dán URL HTTP hoặc HTTPS. Để trống và lưu nếu muốn gỡ link khỏi buổi học.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="modalLinkNoteInput" className="block font-medium text-slate-700">Ghi chú cho giáo viên / học viên</label>
                    <input
                      id="modalLinkNoteInput"
                      type="text"
                      disabled
                      placeholder="Ghi chú chưa được lưu trong dữ liệu hiện có"
                      className="h-[38px] w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 text-[13px] text-slate-500 placeholder:text-slate-400"
                    />
                    <p className="text-[11px] text-slate-500">Theo lựa chọn hiện tại, chỉ URL ghi hình được lưu.</p>
                  </div>
                  {editErrorMessage && (
                    <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">{editErrorMessage}</p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={isSubmitting}
                    className="h-[38px] rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] disabled:opacity-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-[#7F0E17] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {isSubmitting ? "Đang lưu…" : "Lưu cập nhật"}
                  </button>
                </div>
              </fetcher.Form>
            </section>
          </div>
        )}

        {bulkReminderOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !isSubmitting) setBulkReminderOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulkReminderTitle"
              className="flex max-h-[90vh] w-full max-w-[580px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.22)]"
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Điều phối &amp; Nhắc việc</span>
                  <h2 id="bulkReminderTitle" className="mt-0.5 text-lg font-bold text-slate-900">Nhắc giáo viên bổ sung link ghi hình</h2>
                  <p className="mt-0.5 text-xs text-slate-600">Thông báo được gửi vào hệ thống tới giáo viên đang có buổi thiếu link.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkReminderOpen(false)}
                  disabled={isSubmitting}
                  aria-label="Đóng"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <fetcher.Form method="post" className="flex min-h-0 flex-1 flex-col">
                <input type="hidden" name="intent" value="send-bulk-reminders" />
                <div className="custom-scrollbar space-y-2.5 overflow-y-auto p-6 text-[13px]">
                  {missingByTeacher.length === 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center font-medium text-emerald-800">
                      <CheckCircle2 className="mx-auto mb-2 h-6 w-6" />
                      Tất cả buổi học trong bộ lọc đã có link ghi hình.
                    </div>
                  ) : missingByTeacher.map((teacher) => (
                    <label
                      key={teacher.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition hover:border-amber-300"
                    >
                      <input
                        type="checkbox"
                        name="teacherId"
                        value={teacher.id}
                        checked={selectedTeacherIds.includes(teacher.id)}
                        onChange={(event) => toggleTeacher(teacher, event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#7F0E17] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold text-slate-900">{teacher.name}</span>
                          <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Thiếu {teacher.sessions.length} buổi</span>
                        </span>
                        <span className="mt-1 block space-y-0.5 text-xs text-slate-600">
                          {teacher.sessions.slice(0, 5).map((session) => (
                            <span key={session.id} className="block truncate">{session.classroom.name} — {session.title || "Buổi học"} ({formatSessionDate(session.date)})</span>
                          ))}
                          {teacher.sessions.length > 5 && <span className="block">Và {teacher.sessions.length - 5} buổi khác…</span>}
                        </span>
                      </span>
                    </label>
                  ))}
                  {bulkErrorMessage && (
                    <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">{bulkErrorMessage}</p>
                  )}
                </div>
                {missingByTeacher.length > 0 && (
                  <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3.5">
                    <button
                      type="button"
                      onClick={() => setBulkReminderOpen(false)}
                      disabled={isSubmitting}
                      className="h-[38px] rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] disabled:opacity-50"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || selectedTeacherIds.length === 0}
                      className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-[#7F0E17] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                      Nhắc {selectedTeacherIds.length} giáo viên
                    </button>
                  </div>
                )}
              </fetcher.Form>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  detail,
  dotClass,
  valueClass = "text-slate-900",
  hoverClass = "hover:border-slate-300",
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  dotClass: string;
  valueClass?: string;
  hoverClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2 ${hoverClass}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      </span>
      <span className={`mt-1.5 block text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</span>
      <span className="mt-1.5 block truncate text-[11px] text-slate-600" title={detail}>{detail}</span>
    </button>
  );
}

function StatusTabButton({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "rose" | "emerald";
  onClick: () => void;
}) {
  const badgeTone = active
    ? "bg-white/20 text-white"
    : tone === "rose"
      ? "bg-rose-100 text-rose-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-200/80 text-slate-700";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2 ${
        active
          ? "bg-[#7F0E17] font-semibold text-white"
          : "bg-slate-100 font-medium text-slate-700 hover:bg-slate-200/70"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${badgeTone}`}>{count}</span>
    </button>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const adminData = useRouteLoaderData<typeof import("./admin").loader>("routes/admin");
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const errorContent = (
    <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
      <FileText className="mx-auto h-8 w-8 text-[#7F0E17]" />
      <h1 className="mt-3 text-lg font-bold text-slate-900">Không tải được dữ liệu link buổi học</h1>
      <p className="mt-1 text-sm text-slate-600">
        {notFound ? "Trang này không tồn tại." : "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử tải lại trang."}
      </p>
      <a
        href="/admin/session-links"
        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-[#7F0E17] px-4 text-sm font-semibold text-white hover:bg-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2"
      >
        Tải lại trang
      </a>
    </div>
  );
  if (adminData?.user) return <AppShell user={adminData.user}>{errorContent}</AppShell>;
  return (
    errorContent
  );
}
