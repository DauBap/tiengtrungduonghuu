import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GraduationCap,
  Loader2,
  RotateCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import { toast } from "sonner";

const WEEKDAYS = [
  { value: 1, short: "T2", label: "Thứ 2" },
  { value: 2, short: "T3", label: "Thứ 3" },
  { value: 3, short: "T4", label: "Thứ 4" },
  { value: 4, short: "T5", label: "Thứ 5" },
  { value: 5, short: "T6", label: "Thứ 6" },
  { value: 6, short: "T7", label: "Thứ 7" },
  { value: 0, short: "CN", label: "Chủ nhật" },
] as const;

const UNSCHEDULED_PAGE_SIZE = 5;

const TEACHER_COLORS = [
  { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
  { chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100", dot: "bg-emerald-600 dark:bg-emerald-400" },
  { chip: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100", dot: "bg-sky-600 dark:bg-sky-400" },
];

interface ScheduleSlot {
  days: number[];
  startTime: string;
  endTime: string;
}

interface ActionResult {
  success?: boolean;
  classId?: string;
  teacherId?: string | null;
  error?: string;
}

function getWeekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function shiftWeek(date: Date, weeks: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + weeks * 7);
  return shifted;
}

function parseSchedule(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const slot = item as Record<string, unknown>;
    if (
      !Array.isArray(slot.days)
      || !slot.days.every((day) => Number.isInteger(day) && typeof day === "number" && day >= 0 && day <= 6)
      || typeof slot.startTime !== "string"
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)
      || typeof slot.endTime !== "string"
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.endTime)
    ) {
      return [];
    }

    return [{
      days: [...new Set(slot.days as number[])],
      startTime: slot.startTime,
      endTime: slot.endTime,
    }];
  });
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .trim();
}

function hashColorIndex(value: string) {
  return [...value].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % TEACHER_COLORS.length;
}

interface SearchableFilterOption {
  value: string;
  label: string;
  searchText?: string;
}

function SearchableFilter({
  id,
  label,
  placeholder,
  options,
  value,
  query,
  onQueryChange,
  onSelect,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: SearchableFilterOption[];
  value: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = `${id}-options`;
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const filteredOptions = query
    ? options.filter((option) => normalizeSearchText(`${option.label} ${option.searchText ?? ""}`).includes(normalizeSearchText(query)))
    : options;

  const selectOption = (option: SearchableFilterOption) => {
    onSelect(option.value);
    setIsOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="relative min-w-0 sm:w-48">
      <Input
        id={id}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen && filteredOptions.length > 0 ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 && filteredOptions.length > 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder={query ? undefined : selectedLabel || placeholder}
        value={query}
        onFocus={() => {
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onChange={(event) => {
          onQueryChange(event.currentTarget.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onBlur={() => setIsOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
          } else if (event.key === "ArrowDown" && filteredOptions.length > 0) {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => (index + 1) % filteredOptions.length);
          } else if (event.key === "ArrowUp" && filteredOptions.length > 0) {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => (
              index < 0 ? filteredOptions.length - 1 : (index - 1 + filteredOptions.length) % filteredOptions.length
            ));
          } else if (event.key === "Enter" && isOpen && filteredOptions[activeIndex]) {
            event.preventDefault();
            selectOption(filteredOptions[activeIndex]);
          }
        }}
        className="h-11"
      />
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {filteredOptions.length > 0 ? (
            <div id={listboxId} role="listbox" aria-label={label}>
              {filteredOptions.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "cursor-pointer rounded-sm px-2 py-2 text-sm",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {option.label}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">Không tìm thấy lựa chọn phù hợp.</p>
          )}
        </div>
      )}
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const [teachers, classes] = await Promise.all([
    prisma.user.findMany({
      where: { role: "teacher", isActive: true, isActivated: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.class.findMany({
      where: { completedAt: null },
      select: {
        id: true,
        name: true,
        teacherId: true,
        schedule: true,
        teacher: { select: { id: true, name: true, isActive: true, isActivated: true } },
        course: { select: { id: true, code: true, title: true, hskLevel: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
    }),
  ]);

  return {
    user,
    teachers,
    classes: classes.map((cls) => ({
      ...cls,
      schedule: parseSchedule(cls.schedule),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  if (form.get("intent") !== "change-teacher") return { error: "Thao tác không hợp lệ." };

  const classId = String(form.get("classId") ?? "").trim();
  const requestedTeacherId = String(form.get("teacherId") ?? "").trim();
  const teacherId = requestedTeacherId || null;
  if (!classId) return { error: "Không tìm thấy lớp cần cập nhật." };

  return prisma.$transaction(async (tx) => {
    const cls = await tx.class.findFirst({
      where: { id: classId, completedAt: null },
      select: { id: true },
    });
    if (!cls) return { error: "Lớp học không còn hoạt động. Hãy tải lại lịch." };

    if (teacherId) {
      const teacher = await tx.user.findFirst({
        where: {
          id: teacherId,
          role: "teacher",
          isActive: true,
          isActivated: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!teacher) return { error: "Giáo viên này không còn khả dụng. Hãy chọn người khác." };
    }

    const updated = await tx.class.updateMany({
      where: { id: cls.id, completedAt: null },
      data: { teacherId },
    });
    if (updated.count !== 1) {
      return { error: "Lớp học không còn hoạt động. Hãy tải lại lịch." };
    }

    return { success: true, classId: cls.id, teacherId };
  });
}

type Teacher = Awaited<ReturnType<typeof loader>>["teachers"][number];
type ScheduledClass = Awaited<ReturnType<typeof loader>>["classes"][number];

function TeacherAssignment({
  cls,
  teachers,
  compact = false,
}: {
  cls: ScheduledClass;
  teachers: Teacher[];
  compact?: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [teacherId, setTeacherId] = useState(cls.teacherId ?? "");
  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    setTeacherId(cls.teacherId ?? "");
  }, [cls.teacherId]);

  useEffect(() => {
    if (fetcher.data?.error) {
      setTeacherId(cls.teacherId ?? "");
      toast.error(fetcher.data.error);
    }
  }, [cls.teacherId, fetcher.data]);

  const currentTeacherIsUnavailable = Boolean(
    cls.teacherId
    && !teachers.some((teacher) => teacher.id === cls.teacherId),
  );

  return (
    <fetcher.Form method="post" className={cn("flex items-center gap-1.5", compact ? "mt-1" : "mt-2")}>
      <label htmlFor={`teacher-${cls.id}`} className="sr-only">
        Giáo viên phụ trách lớp {cls.name}
      </label>
      <select
        id={`teacher-${cls.id}`}
        name="teacherId"
        value={teacherId}
        disabled={isSaving}
        onChange={(event) => {
          const nextTeacherId = event.currentTarget.value;
          setTeacherId(nextTeacherId);
          fetcher.submit(
            { intent: "change-teacher", classId: cls.id, teacherId: nextTeacherId },
            { method: "post" },
          );
        }}
        className={cn(
          "h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs font-medium",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-wait disabled:opacity-70",
        )}
      >
        {currentTeacherIsUnavailable && cls.teacher && (
          <option value={cls.teacher.id} disabled>
            {cls.teacher.name} · Tạm ngưng
          </option>
        )}
        <option value="">Chưa phân công</option>
        {teachers.map((teacher) => (
          <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
        ))}
      </select>
      <span className="flex h-8 w-5 shrink-0 items-center justify-center" aria-live="polite">
        {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Đang lưu" />}
      </span>
    </fetcher.Form>
  );
}

type ScheduleEntry = {
  cls: ScheduledClass;
  slot: ScheduleSlot;
  slotIndex: number;
};

type ScheduleTimeGroup = {
  key: string;
  startTime: string;
  endTime: string;
  entries: ScheduleEntry[];
};

function ScheduleClassCard({
  entry,
  teachers,
  compact = false,
}: {
  entry: ScheduleEntry;
  teachers: Teacher[];
  compact?: boolean;
}) {
  const { cls, slot, slotIndex } = entry;
  const teacherIndex = cls.teacherId
    ? teachers.findIndex((teacher) => teacher.id === cls.teacherId)
    : -1;
  const colorIndex = teacherIndex >= 0
    ? teacherIndex % TEACHER_COLORS.length
    : cls.teacherId
      ? hashColorIndex(cls.teacherId)
      : -1;
  const color = colorIndex >= 0 ? TEACHER_COLORS[colorIndex] : null;

  return (
    <article
      key={`${cls.id}-${slot.startTime}-${slot.endTime}-${slotIndex}`}
      className={cn(
        "min-w-0 rounded-lg transition-colors",
        compact ? "p-2" : "p-2.5",
        color ? color.chip : "bg-warning/10 text-warning-foreground dark:text-warning",
      )}
    >
      {!compact && (
        <p className="flex items-center gap-1 text-xs font-semibold tabular-nums">
          <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{slot.startTime}–{slot.endTime}</span>
        </p>
      )}
      <h3
        title={cls.name}
        className={cn(
          "break-words text-sm font-semibold leading-snug",
          compact ? "line-clamp-2" : "mt-1.5",
        )}
      >
        {cls.name}
      </h3>
      <p className="mt-1 break-words text-xs opacity-80">
        {cls.course.code} · HSK {cls.course.hskLevel}
        {compact && cls._count.enrollments > 0 && ` · ${cls._count.enrollments} học viên`}
      </p>
      {!compact && cls._count.enrollments > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
          <Users className="h-3 w-3" aria-hidden="true" />
          {cls._count.enrollments} học viên
        </p>
      )}
      <TeacherAssignment cls={cls} teachers={teachers} compact={compact} />
    </article>
  );
}

function ScheduleTimeSlot({
  group,
  teachers,
  day,
}: {
  group: ScheduleTimeGroup;
  teachers: Teacher[];
  day: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const slotId = `schedule-slot-${day}-${group.startTime.replace(":", "")}-${group.endTime.replace(":", "")}`;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isExpanded && !dialog.open) {
      dialog.showModal();
    } else if (!isExpanded && dialog.open) {
      dialog.close();
    }
  }, [isExpanded]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
        aria-controls={slotId}
        aria-label={`${group.startTime} đến ${group.endTime}, ${group.entries.length} lớp. Bấm để xem danh sách lớp.`}
        onClick={() => setIsExpanded(true)}
        className="flex min-h-12 w-full items-center gap-1.5 rounded-lg border bg-card px-2 text-left text-xs font-semibold shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Clock3 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 whitespace-nowrap tabular-nums">
          {group.startTime}–{group.endTime}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {group.entries.length} lớp
        </span>
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        id={slotId}
        aria-labelledby={`${slotId}-title`}
        onClose={() => setIsExpanded(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.close();
          }
        }}
        className="teacher-slot-dialog fixed inset-auto left-1/2 top-1/2 m-0 max-h-[85dvh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-card p-0 text-card-foreground shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <h2 id={`${slotId}-title`} className="font-semibold">Các lớp cùng khung giờ</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {group.startTime}–{group.endTime} · {group.entries.length} lớp
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng danh sách lớp"
            onClick={() => dialogRef.current?.close()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid max-h-[min(68dvh,38rem)] grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          {group.entries.map((entry) => (
            <ScheduleClassCard
              key={`${entry.cls.id}-${entry.slot.startTime}-${entry.slot.endTime}-${entry.slotIndex}`}
              entry={entry}
              teachers={teachers}
              compact
            />
          ))}
        </div>
      </dialog>
    </>
  );
}

export default function AdminTeachers() {
  const { user, teachers, classes } = useLoaderData<typeof loader>();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [search, setSearch] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [courseSearch, setCourseSearch] = useState("");
  const [unscheduledPage, setUnscheduledPage] = useState(1);
  const today = new Date();

  const courses = useMemo(() => {
    const uniqueCourses = new Map(classes.map((cls) => [cls.course.id, cls.course]));
    return [...uniqueCourses.values()].sort((a, b) => a.code.localeCompare(b.code, "vi"));
  }, [classes]);

  const filteredClasses = useMemo(() => {
    const query = normalizeSearchText(search);
    const teacherQuery = normalizeSearchText(teacherSearch);
    const courseQuery = normalizeSearchText(courseSearch);
    return classes.filter((cls) => {
      if (teacherQuery) {
        if (!normalizeSearchText(cls.teacher?.name ?? "").includes(teacherQuery)) return false;
      } else if (teacherFilter === "unassigned" ? cls.teacherId !== null : teacherFilter !== "all" && cls.teacherId !== teacherFilter) {
        return false;
      }
      if (courseQuery) {
        const courseText = normalizeSearchText(`${cls.course.code} ${cls.course.title} HSK ${cls.course.hskLevel}`);
        if (!courseText.includes(courseQuery)) return false;
      } else if (courseFilter !== "all" && cls.course.id !== courseFilter) {
        return false;
      }
      if (!query) return true;

      return [
        cls.name,
        cls.course.title,
        cls.course.code,
        cls.teacher?.name ?? "",
      ].some((value) => normalizeSearchText(value).includes(query));
    });
  }, [classes, courseFilter, courseSearch, search, teacherFilter, teacherSearch]);

  const scheduledClasses = filteredClasses.filter((cls) => cls.schedule.length > 0);
  const unscheduledClasses = filteredClasses.filter((cls) => cls.schedule.length === 0);
  const unscheduledPageCount = Math.ceil(unscheduledClasses.length / UNSCHEDULED_PAGE_SIZE);
  const paginatedUnscheduledClasses = unscheduledClasses.slice(
    (unscheduledPage - 1) * UNSCHEDULED_PAGE_SIZE,
    unscheduledPage * UNSCHEDULED_PAGE_SIZE,
  );
  useEffect(() => {
    setUnscheduledPage(1);
  }, [filteredClasses]);
  const unassignedClassCount = classes.filter((cls) => !cls.teacherId).length;
  const weekDates = WEEKDAYS.map((weekday, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return { ...weekday, date };
  });
  const weekEnd = weekDates[weekDates.length - 1].date;
  const rangeLabel = `${weekStart.toLocaleDateString("vi-VN", { day: "numeric", month: "long" })} – ${weekEnd.toLocaleDateString("vi-VN", { day: "numeric", month: "long", year: "numeric" })}`;

  const clearFilters = () => {
    setSearch("");
    setTeacherFilter("all");
    setTeacherSearch("");
    setCourseFilter("all");
    setCourseSearch("");
    setUnscheduledPage(1);
  };

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Lịch giáo viên</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Thời khóa biểu các lớp đang học và phân công giáo viên.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/admin/classes"><Users className="mr-2 h-4 w-4" />Quản lý lớp học</Link>
          </Button>
        </header>

        <section
          aria-label="Tổng quan lịch dạy"
          className="grid grid-cols-3 divide-x rounded-xl border bg-card"
        >
          <div className="px-3 py-3.5 sm:px-5">
            <p className="text-xs text-muted-foreground sm:text-sm">Giáo viên hoạt động</p>
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">{teachers.length}</p>
          </div>
          <div className="px-3 py-3.5 sm:px-5">
            <p className="text-xs text-muted-foreground sm:text-sm">Lớp đang hoạt động</p>
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">{classes.length}</p>
          </div>
          <div className="px-3 py-3.5 sm:px-5">
            <p className="text-xs text-muted-foreground sm:text-sm">Lớp chưa phân công</p>
            <p className={cn("text-xl font-semibold tabular-nums sm:text-2xl", unassignedClassCount > 0 && "text-warning")}>
              {unassignedClassCount}
            </p>
          </div>
        </section>

        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Tìm lớp hoặc giáo viên"
                  placeholder="Tìm tên lớp, khóa học hoặc giáo viên..."
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  className="h-11 pl-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <SearchableFilter
                  id="teacher-filter"
                  label="Lọc theo giáo viên"
                  placeholder="Tìm giáo viên..."
                  value={teacherFilter}
                  query={teacherSearch}
                  onQueryChange={(query) => {
                    setTeacherSearch(query);
                    setTeacherFilter("all");
                  }}
                  onSelect={(value) => {
                    setTeacherFilter(value);
                    setTeacherSearch("");
                  }}
                  options={[
                    { value: "all", label: "Tất cả giáo viên" },
                    { value: "unassigned", label: "Chưa phân công" },
                    ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
                  ]}
                />
                <SearchableFilter
                  id="course-filter"
                  label="Lọc theo khóa học"
                  placeholder="Tìm khóa học..."
                  value={courseFilter}
                  query={courseSearch}
                  onQueryChange={(query) => {
                    setCourseSearch(query);
                    setCourseFilter("all");
                  }}
                  onSelect={(value) => {
                    setCourseFilter(value);
                    setCourseSearch("");
                  }}
                  options={[
                    { value: "all", label: "Tất cả khóa học" },
                    ...courses.map((course) => ({
                      value: course.id,
                      label: `${course.code} · HSK ${course.hskLevel}`,
                      searchText: course.title,
                    })),
                  ]}
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border bg-background p-1 sm:justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Tuần trước"
                  onClick={() => setWeekStart((current) => shiftWeek(current, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <p className="min-w-0 flex-1 text-center text-sm font-medium sm:min-w-48">{rangeLabel}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Tuần sau"
                  onClick={() => setWeekStart((current) => shiftWeek(current, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => setWeekStart(getWeekStart(new Date()))}
                >
                  Tuần này
                </Button>
              </div>
            </div>

          </CardContent>
        </Card>

        {classes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-14 text-center">
              <GraduationCap className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-semibold">Chưa có lớp đang hoạt động</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Tạo lớp học và thiết lập lịch để bắt đầu sắp xếp thời khóa biểu giáo viên.
              </p>
              <Button asChild className="mt-5"><Link to="/admin/classes">Tạo lớp học</Link></Button>
            </CardContent>
          </Card>
        ) : filteredClasses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <Search className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-semibold">Không tìm thấy lớp phù hợp</h2>
              <p className="mt-1 text-sm text-muted-foreground">Thử đổi từ khóa hoặc bộ lọc giáo viên, khóa học.</p>
              <Button type="button" variant="outline" className="mt-4" onClick={clearFilters}>
                <RotateCcw className="mr-2 h-4 w-4" />Xóa bộ lọc
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
              {weekDates.map(({ value, short, label, date }) => {
                const isToday = date.toDateString() === today.toDateString();
                const dayClasses: ScheduleEntry[] = scheduledClasses.flatMap((cls) =>
                  cls.schedule
                    .filter((slot) => slot.days.includes(value))
                    .map((slot, slotIndex) => ({ cls, slot, slotIndex })),
                ).sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime) || a.cls.name.localeCompare(b.cls.name, "vi"));
                const timeGroups = dayClasses.reduce<ScheduleTimeGroup[]>((groups, entry) => {
                  const key = `${entry.slot.startTime}-${entry.slot.endTime}`;
                  const group = groups.find((candidate) => candidate.key === key);
                  if (group) {
                    group.entries.push(entry);
                  } else {
                    groups.push({
                      key,
                      startTime: entry.slot.startTime,
                      endTime: entry.slot.endTime,
                      entries: [entry],
                    });
                  }
                  return groups;
                }, []);

                return (
                  <section
                    key={value}
                    aria-label={`${label}, ${date.toLocaleDateString("vi-VN")}`}
                    className={cn(
                      "min-h-36 border-border sm:border-b xl:min-h-[25rem] xl:border-b-0 xl:border-r last:border-0",
                      isToday && "bg-primary/[0.035]",
                    )}
                  >
                    <div className={cn("flex items-center justify-between border-b px-3 py-3", isToday && "bg-primary/10")}>
                      <h2 className={cn("text-sm font-semibold", isToday && "text-primary")}>
                        <span className="xl:hidden">{label}</span>
                        <span className="hidden xl:inline">{short}</span>
                      </h2>
                      <span className={cn(
                        "flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-sm tabular-nums",
                        isToday ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                      )}>
                        {date.getDate()}
                      </span>
                    </div>

                    <div className="space-y-2 p-2">
                      {timeGroups.length > 0 ? timeGroups.map((group) => (
                        group.entries.length === 1 ? (
                          <ScheduleClassCard
                            key={`${group.key}-${group.entries[0].cls.id}-${group.entries[0].slotIndex}`}
                            entry={group.entries[0]}
                            teachers={teachers}
                          />
                        ) : (
                          <ScheduleTimeSlot
                            key={group.key}
                            group={group}
                            teachers={teachers}
                            day={value}
                          />
                        )
                      )) : (
                        <p className="px-1 py-2 text-xs text-muted-foreground">Không có lớp</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {teachers.length === 0 && classes.length > 0 && (
          <div role="status" className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-warning-foreground dark:text-warning">
              Chưa có giáo viên đang hoạt động để phân công cho các lớp.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/accounts">Quản lý tài khoản giáo viên</Link>
            </Button>
          </div>
        )}

        {filteredClasses.length > 0 && scheduledClasses.length === 0 && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-warning-foreground dark:text-warning">
              Các lớp phù hợp chưa có lịch cố định. Hãy bổ sung thời gian học trong mục{" "}
              <Link to="/admin/classes" className="font-semibold underline underline-offset-2">Quản lý lớp học</Link>.
            </p>
          </div>
        )}

        {unscheduledClasses.length > 0 && scheduledClasses.length > 0 && (
          <section aria-labelledby="unscheduled-heading" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="unscheduled-heading" className="font-semibold">
                Lớp chưa có lịch cố định <span className="text-sm font-normal text-muted-foreground">({unscheduledClasses.length})</span>
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/classes">Cập nhật lịch lớp</Link>
              </Button>
            </div>
            <Card>
              <CardContent className="divide-y p-0">
                {paginatedUnscheduledClasses.map((cls) => (
                  <div key={cls.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{cls.name}</p>
                      <p className="text-sm text-muted-foreground">{cls.course.code} · HSK {cls.course.hskLevel}</p>
                    </div>
                    <div className="sm:w-64">
                      <TeacherAssignment cls={cls} teachers={teachers} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            {unscheduledPageCount > 1 && (
              <nav
                aria-label="Phân trang lớp chưa có lịch cố định"
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Hiển thị {(unscheduledPage - 1) * UNSCHEDULED_PAGE_SIZE + 1}–
                  {Math.min(unscheduledPage * UNSCHEDULED_PAGE_SIZE, unscheduledClasses.length)} trong {unscheduledClasses.length} lớp
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unscheduledPage <= 1}
                    onClick={() => setUnscheduledPage((page) => Math.max(1, page - 1))}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Trang trước
                  </Button>
                  <span className="min-w-16 text-center text-sm tabular-nums" aria-label={`Trang ${unscheduledPage} trên ${unscheduledPageCount}`}>
                    {unscheduledPage}/{unscheduledPageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unscheduledPage >= unscheduledPageCount}
                    onClick={() => setUnscheduledPage((page) => Math.min(unscheduledPageCount, page + 1))}
                  >
                    Trang sau
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
