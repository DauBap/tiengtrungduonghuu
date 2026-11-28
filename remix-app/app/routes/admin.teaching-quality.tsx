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
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  LoaderCircle,
  Search,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import {
  SearchableDropdown,
  type SearchableDropdownOption,
  normalizeFilterSearch,
} from "~/components/common/searchable-dropdown";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { toast } from "sonner";

type ReviewTab = "pending" | "approved" | "rejected";
type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

const REVIEW_TABS: Array<{ id: ReviewTab; label: string }> = [
  { id: "pending", label: "Đang chờ kiểm tra" },
  { id: "approved", label: "Đã kiểm tra" },
  { id: "rejected", label: "Chưa đạt" },
];

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

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const sessions = await prisma.attendanceSession.findMany({
    where: { recordingUrl: { not: null } },
    orderBy: [
      { date: "desc" },
      { scheduleStartTime: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      title: true,
      date: true,
      createdAt: true,
      scheduleStartTime: true,
      scheduleEndTime: true,
      recordingUrl: true,
      qualityReviewStatus: true,
      qualityReviewedRecordingUrl: true,
      courseLesson: { select: { title: true } },
      class: {
        select: {
          id: true,
          name: true,
          teacherId: true,
          teacher: { select: { id: true, name: true, role: true, isActive: true, deletedAt: true } },
          course: { select: { hskLevel: true, title: true } },
        },
      },
    },
  });

  return {
    user,
    sessions: sessions.map((session) => ({
      ...session,
      date: session.date.toISOString().slice(0, 10),
      classroom: session.class,
      reviewStatus: session.qualityReviewStatus !== "PENDING"
        && session.qualityReviewedRecordingUrl !== session.recordingUrl
        ? "PENDING" as const
        : session.qualityReviewStatus,
      lessonTitle: session.courseLesson?.title || "",
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const sessionId = String(form.get("sessionId") ?? "").trim();
  if (!sessionId) {
    return { success: false as const, intent, error: "Không tìm thấy buổi học cần xử lý." };
  }

  if (intent === "mark-quality-reviewed" || intent === "mark-quality-rejected") {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId, recordingUrl: { not: null } },
      select: { recordingUrl: true },
    });
    if (!session?.recordingUrl) {
      return {
        success: false as const,
        intent,
        error: "Buổi học không còn link ghi hình. Hãy tải lại trang để cập nhật.",
      };
    }

    const reviewStatus: ReviewStatus = intent === "mark-quality-reviewed" ? "APPROVED" : "REJECTED";
    const result = await prisma.attendanceSession.updateMany({
      where: { id: sessionId, recordingUrl: session.recordingUrl },
      data: {
        qualityReviewStatus: reviewStatus,
        qualityReviewedRecordingUrl: session.recordingUrl,
      },
    });
    if (result.count !== 1) {
      return {
        success: false as const,
        intent,
        error: "Link ghi hình vừa được cập nhật. Tải lại trang để kiểm tra link mới.",
      };
    }

    return {
      success: true as const,
      intent,
      message: reviewStatus === "APPROVED"
        ? "Đã chuyển buổi học sang Đã kiểm tra."
        : "Đã chuyển buổi học sang Chưa đạt.",
    };
  }

  if (intent === "remind-quality-review") {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId, recordingUrl: { not: null } },
      select: {
        title: true,
        date: true,
        recordingUrl: true,
        qualityReviewStatus: true,
        qualityReviewedRecordingUrl: true,
        class: {
          select: {
            name: true,
            teacher: { select: { id: true, name: true, role: true, isActive: true, deletedAt: true } },
          },
        },
      },
    });
    const teacher = session?.class.teacher;
    if (
      !session
      || !teacher
      || teacher.role !== "teacher"
      || !teacher.isActive
      || teacher.deletedAt
    ) {
      return {
        success: false as const,
        intent,
        error: "Không tìm thấy giáo viên đang hoạt động cho buổi học này.",
      };
    }
    if (
      session.qualityReviewStatus !== "REJECTED"
      || session.qualityReviewedRecordingUrl !== session.recordingUrl
    ) {
      return {
        success: false as const,
        intent,
        error: "Link đã được cập nhật hoặc trạng thái đã thay đổi. Tải lại trang để kiểm tra.",
      };
    }

    await prisma.userNotification.create({
      data: {
        recipientId: teacher.id,
        actorId: admin.id,
        kind: "TEACHING_VIDEO_QUALITY_REVISION_REQUIRED",
        title: "Video bài dạy cần được xem lại",
        message: `${session.class.name} · ${session.title || "Buổi học"} ngày ${session.date.toISOString().slice(0, 10)} chưa đạt kiểm tra chất lượng. Vui lòng xem lại video và cập nhật link ghi hình nếu cần.`,
        targetUrl: "/teacher/attendance",
        entityId: sessionId,
      },
    });

    return {
      success: true as const,
      intent,
      message: `Đã nhắc giáo viên ${teacher.name} xem lại video.`,
    };
  }

  return { success: false as const, intent, error: "Thao tác không hợp lệ." };
}

function ReviewTabButton({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "emerald" | "rose";
}) {
  const countClass = active
    ? "bg-white/20 text-white"
    : tone === "emerald"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "rose"
        ? "bg-rose-100 text-rose-700"
        : "bg-slate-200 text-slate-700";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2 ${
        active ? "bg-[#7F0E17] text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${countClass}`}>
        {count}
      </span>
    </button>
  );
}

function ReviewStat({
  label,
  count,
  detail,
  tone,
}: {
  label: string;
  count: number;
  detail: string;
  tone: "slate" | "emerald" | "rose";
}) {
  const colors = {
    slate: { dot: "bg-slate-400", value: "text-slate-900" },
    emerald: { dot: "bg-emerald-500", value: "text-emerald-700" },
    rose: { dot: "bg-rose-500", value: "text-rose-700" },
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
      </div>
      <div className={`mt-1 text-2xl font-bold leading-7 tabular-nums ${colors.value}`}>{count} buổi</div>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</p>
    </div>
  );
}

export default function AdminTeachingQualityPage() {
  const { user, sessions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<ReviewTab>("pending");
  const [teacherId, setTeacherId] = useState("all");
  const [classId, setClassId] = useState("all");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const isSubmitting = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.success) toast.success(result.message);
    else toast.error(result.error);
  }, [fetcher.data]);

  const teachers = useMemo(() => {
    const unique = new Map<string, string>();
    for (const session of sessions) {
      if (session.classroom.teacher) {
        unique.set(session.classroom.teacher.id, session.classroom.teacher.name);
      }
    }
    return [...unique]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }, [sessions]);

  const classes = useMemo(() => {
    const unique = new Map<string, { id: string; name: string }>();
    for (const session of sessions) {
      if (teacherId !== "all" && session.classroom.teacherId !== teacherId) continue;
      unique.set(session.classroom.id, { id: session.classroom.id, name: session.classroom.name });
    }
    return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }, [sessions, teacherId]);

  const levels = useMemo(
    () => [...new Set(sessions.map(({ classroom }) => classroom.course.hskLevel))].sort((a, b) => a - b),
    [sessions],
  );
  const teacherOptions: SearchableDropdownOption[] = [
    { value: "all", label: "Tất cả giáo viên" },
    ...teachers.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const classOptions: SearchableDropdownOption[] = [
    { value: "all", label: `Tất cả lớp học (${classes.length})` },
    ...classes.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const levelOptions: SearchableDropdownOption[] = [
    { value: "all", label: "Tất cả trình độ" },
    ...levels.map((item) => ({ value: String(item), label: `HSK ${item}` })),
  ];

  const filteredSessions = useMemo(() => {
    const normalizedQuery = normalizeFilterSearch(query);
    return sessions.filter((session) => {
      if (teacherId !== "all" && session.classroom.teacherId !== teacherId) return false;
      if (classId !== "all" && session.classroom.id !== classId) return false;
      if (level !== "all" && String(session.classroom.course.hskLevel) !== level) return false;
      if (!normalizedQuery) return true;
      const searchable = normalizeFilterSearch([
        session.title,
        session.lessonTitle,
        session.classroom.name,
        session.classroom.teacher?.name ?? "",
        session.classroom.course.title,
      ].join(" "));
      return searchable.includes(normalizedQuery);
    });
  }, [sessions, teacherId, classId, level, query]);

  const pendingSessions = filteredSessions.filter(({ reviewStatus }) => reviewStatus === "PENDING");
  const approvedSessions = filteredSessions.filter(({ reviewStatus }) => reviewStatus === "APPROVED");
  const rejectedSessions = filteredSessions.filter(({ reviewStatus }) => reviewStatus === "REJECTED");
  const visibleSessions = activeTab === "approved"
    ? approvedSessions
    : activeTab === "rejected"
      ? rejectedSessions
      : pendingSessions;

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-[1320px] space-y-5 text-slate-900 selection:bg-[#FBC7C9] selection:text-[#640B12]">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <span>Quản lý lớp học</span><span aria-hidden="true">/</span>
              <span className="truncate font-semibold text-slate-800">Kiểm tra chất lượng bài dạy</span>
            </div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-slate-900">Kiểm tra chất lượng bài dạy</h1>
            <p className="mt-1 max-w-[74ch] text-[13px] leading-5 text-slate-600">
              Rà soát video ghi hình đã được gắn vào buổi học và theo dõi kết quả kiểm tra.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 sm:self-auto">
            <Video className="h-3.5 w-3.5 text-[#7F0E17]" />
            {sessions.length} video cần quản lý
          </div>
        </div>

        {isLoading && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-[#FBC7C9] bg-[#FDF2F2] px-3 py-2 text-sm text-[#640B12]">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Đang cập nhật danh sách video…
          </div>
        )}

        <section aria-label="Thống kê kiểm tra chất lượng" className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <ReviewStat label="Đang chờ kiểm tra" count={pendingSessions.length} detail="Video cần được rà soát" tone="slate" />
          <ReviewStat label="Đã kiểm tra" count={approvedSessions.length} detail="Video đã được xác nhận đạt" tone="emerald" />
          <ReviewStat label="Chưa đạt" count={rejectedSessions.length} detail="Video cần giáo viên xem lại" tone="rose" />
        </section>

        <section aria-label="Danh sách kiểm tra chất lượng" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="space-y-3.5 border-b border-slate-100 p-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Trạng thái kiểm tra">
              {REVIEW_TABS.map((tab) => (
                <ReviewTabButton
                  key={tab.id}
                  label={tab.label}
                  count={tab.id === "pending" ? pendingSessions.length : tab.id === "approved" ? approvedSessions.length : rejectedSessions.length}
                  active={activeTab === tab.id}
                  tone={tab.id === "approved" ? "emerald" : tab.id === "rejected" ? "rose" : undefined}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_minmax(220px,1.3fr)]">
              <SearchableDropdown
                id="qualityTeacherFilter"
                label="Lọc giáo viên"
                placeholder="Tất cả giáo viên"
                searchPlaceholder="Gõ tên giáo viên để tìm..."
                options={teacherOptions}
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
                id="qualityClassFilter"
                label="Lọc lớp học"
                placeholder={`Tất cả lớp học (${classes.length})`}
                searchPlaceholder="Gõ tên lớp để tìm..."
                options={classOptions}
                value={classId}
                onChange={setClassId}
                className="w-full min-w-0"
                triggerClassName="h-[38px] rounded-lg px-3 text-[13px] font-semibold"
                contentClassName="min-w-0"
              />
              <SearchableDropdown
                id="qualityLevelFilter"
                label="Lọc trình độ"
                placeholder="Tất cả trình độ"
                searchPlaceholder="Gõ trình độ để tìm..."
                options={levelOptions}
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
            <table className="w-full min-w-[900px] table-fixed border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/95 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="w-[23%] py-3 pl-5 pr-2">Giáo viên &amp; Lớp</th>
                  <th scope="col" className="w-[26%] px-2 py-3">Buổi học &amp; Thời gian</th>
                  <th scope="col" className="w-[29%] px-2 py-3">Video ghi hình</th>
                  <th scope="col" className="w-[22%] py-3 pl-2 pr-4 text-right">Kết quả &amp; Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleSessions.map((session) => {
                  const recordingUrl = getSafeRecordUrl(session.recordingUrl);
                  const teacher = session.classroom.teacher;
                  const initials = teacher?.name.split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase() ?? "—";
                  const schedule = [session.scheduleStartTime, session.scheduleEndTime].filter(Boolean).join(" – ");

                  return (
                    <tr key={session.id} className="transition-colors hover:bg-slate-50/75">
                      <td className="py-3.5 pl-5 pr-2">
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
                      <td className="min-w-0 px-2 py-3.5">
                        <div className="truncate font-semibold text-slate-900">{session.title || "Buổi học"}</div>
                        {session.lessonTitle && <div className="mt-0.5 truncate text-xs text-slate-600">{session.lessonTitle}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span>{formatSessionDate(session.date)}</span>
                          {schedule && <><span aria-hidden="true">·</span><span className="font-semibold text-slate-700">{schedule}</span></>}
                        </div>
                      </td>
                      <td className="min-w-0 px-2 py-3.5">
                        {recordingUrl ? (
                          <a
                            href={recordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-semibold text-[#7F0E17] underline decoration-[#FBC7C9] underline-offset-2 hover:text-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F]"
                          >
                            <Video className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{recordingUrl}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs font-medium text-rose-700">Link ghi hình không hợp lệ</span>
                        )}
                      </td>
                      <td className="py-3.5 pl-2 pr-4 text-right">
                        {activeTab === "pending" ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="mark-quality-reviewed" />
                              <input type="hidden" name="sessionId" value={session.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-emerald-700 px-2.5 text-xs font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSubmitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Đã kiểm tra
                              </button>
                            </fetcher.Form>
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="mark-quality-rejected" />
                              <input type="hidden" name="sessionId" value={session.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <X className="h-3.5 w-3.5" />
                                Chưa đạt
                              </button>
                            </fetcher.Form>
                          </div>
                        ) : activeTab === "approved" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />Đã kiểm tra
                          </span>
                        ) : (
                          <div className="flex justify-end">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="remind-quality-review" />
                              <input type="hidden" name="sessionId" value={session.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting || !teacher}
                                className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSubmitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                                Nhắc GV xem lại
                              </button>
                            </fetcher.Form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleSessions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-14 text-center">
                      {sessions.length === 0 ? (
                        <>
                          <CalendarDays className="mx-auto h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-semibold text-slate-800">Chưa có video ghi hình để kiểm tra</p>
                          <p className="mt-1 text-xs text-slate-500">Các buổi học sẽ xuất hiện ở đây sau khi được gắn link ghi hình.</p>
                        </>
                      ) : (
                        <>
                          <Search className="mx-auto h-8 w-8 text-slate-400" />
                          <p className="mt-3 text-sm font-semibold text-slate-800">Không tìm thấy buổi học phù hợp</p>
                          <p className="mt-1 text-xs text-slate-500">Thử đổi tab, bộ lọc hoặc từ khóa tìm kiếm.</p>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {visibleSessions.length} / {filteredSessions.length} buổi học theo bộ lọc</span>
            <span>Video được sắp xếp từ buổi tạo mới nhất đến cũ nhất.</span>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const adminData = useRouteLoaderData<typeof import("./admin").loader>("routes/admin");
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const content = (
    <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
      <FileText className="mx-auto h-8 w-8 text-[#7F0E17]" />
      <h1 className="mt-3 text-lg font-bold text-slate-900">Không tải được dữ liệu kiểm tra chất lượng</h1>
      <p className="mt-1 text-sm text-slate-600">
        {notFound
          ? "Trang này không tồn tại."
          : "Đã xảy ra lỗi khi tải danh sách video. Vui lòng tải lại trang hoặc kiểm tra cấu hình dữ liệu."}
      </p>
      <a
        href="/admin/teaching-quality"
        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-[#7F0E17] px-4 text-sm font-semibold text-white hover:bg-[#640B12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E141F] focus-visible:ring-offset-2"
      >
        Tải lại trang
      </a>
    </div>
  );
  if (adminData?.user) return <AppShell user={adminData.user}>{content}</AppShell>;
  return content;
}
