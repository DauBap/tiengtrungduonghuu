import { useState, useCallback, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getAllClasses } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Overlay } from "~/components/common/overlay";
import {
  School, Plus, Pencil, Trash2, X, Search, Loader2, Users, UserCheck, Check, ChevronDown, CalendarDays,
  ChevronLeft, ChevronRight, Save, UserPlus, UserMinus, Clock,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { toast } from "sonner";

// ─── Schedule types ───────────────────────────────────────────────────────────

const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const DAY_FULL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

interface ScheduleSlot {
  days: number[];      // 0=CN, 1=T2 … 6=T7
  startTime: string;   // "HH:MM"
  endTime: string;
}

const DEFAULT_SLOT_DURATION_MINUTES = 90;

function addMinutesToTime(time: string, minutes: number): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;

  const totalMinutes = (Number(match[1]) * 60 + Number(match[2]) + minutes) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

function parseSchedule(raw: unknown): ScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is ScheduleSlot =>
      s && Array.isArray(s.days) && typeof s.startTime === "string" && typeof s.endTime === "string"
  );
}

function isValidSchedule(schedule: ScheduleSlot[]): boolean {
  const validTime = (time: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
  return schedule.length > 0 && schedule.every((slot) =>
    slot.days.length > 0
    && slot.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && validTime(slot.startTime)
    && validTime(slot.endTime)
    && slot.startTime < slot.endTime
  );
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function formatStartDate(value: Date): string {
  return value.toLocaleDateString("vi-VN", { timeZone: "UTC" });
}

function formatSchedule(slots: ScheduleSlot[]): string {
  if (slots.length === 0) return "Chưa có lịch học";
  return slots
    .map((s) => `${s.days.map((d) => DAY_LABELS[d]).join("-")} ${s.startTime}–${s.endTime}`)
    .join(", ");
}

function getPaginationItems(totalPages: number, currentPage: number): Array<number | "ellipsis"> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 3) return [1, 2, 3, 4, "ellipsis", totalPages];
  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const classes = await getAllClasses();

  const [courses, teachers, students] = await Promise.all([
    prisma.course.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, code: true, title: true, hskLevel: true },
      orderBy: { order: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "teacher", isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "student", isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { user, classes, courses, teachers, students };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "create-class" || intent === "edit-class") {
    const name = String(form.get("name") ?? "").trim();
    const teacherId = String(form.get("teacherId") ?? "").trim() || null;
    const maxStudents = Math.max(1, parseInt(String(form.get("maxStudents") ?? "6"), 10) || 6);
    const startDate = parseDateOnly(String(form.get("startDate") ?? "").trim());
    const scheduleRaw = String(form.get("schedule") ?? "[]");
    const midtermReviewSession = parseReviewSession(form.get("midtermReviewSession"));
    const finalReviewSession = parseReviewSession(form.get("finalReviewSession"));
    let schedule: ScheduleSlot[] = [];
    try { schedule = parseSchedule(JSON.parse(scheduleRaw)); } catch { schedule = []; }

    if (!name) return { error: "Vui lòng nhập tên lớp", field: "name" };
    if (!startDate) return { error: "Vui lòng chọn ngày bắt đầu.", field: "startDate" };
    if (!isValidSchedule(schedule)) {
      return {
        error: "Vui lòng thêm ít nhất một khung giờ và chọn ngày học, giờ bắt đầu, giờ kết thúc hợp lệ.",
        field: "schedule",
      };
    }
    if (midtermReviewSession === undefined || finalReviewSession === undefined) {
      return { error: "Số buổi đánh giá phải là số nguyên dương hoặc để trống." };
    }
    if (midtermReviewSession !== null && midtermReviewSession === finalReviewSession) {
      return { error: "Buổi đánh giá giữa kỳ và cuối kỳ phải khác nhau." };
    }

    if (intent === "create-class") {
      const courseId = String(form.get("courseId") ?? "").trim();
      if (!courseId) return { error: "Vui lòng chọn khóa học", field: "courseId" };
      await prisma.class.create({
        data: {
          name,
          courseId,
          teacherId,
          startDate,
          maxStudents,
          schedule: schedule as object[],
          midtermReviewSession,
          finalReviewSession,
        },
      });
    } else {
      const classId = String(form.get("classId"));
      await prisma.class.update({
        where: { id: classId },
        data: {
          name,
          teacherId,
          startDate,
          maxStudents,
          schedule: schedule as object[],
          midtermReviewSession,
          finalReviewSession,
        },
      });
    }
    return { success: true };
  }

  if (intent === "delete-class") {
    const classId = String(form.get("classId"));
    await prisma.class.delete({ where: { id: classId } });
    return { success: true };
  }

  if (intent === "sync-students") {
    const classId = String(form.get("classId") ?? "").trim();
    const studentIds = [...new Set(
      form.getAll("studentIds")
        .map((value) => String(value).trim())
        .filter(Boolean),
    )];
    if (!classId) return { error: "Không tìm thấy lớp cần cập nhật." };

    return prisma.$transaction(async (tx) => {
      const cls = await tx.class.findUnique({
        where: { id: classId },
        select: { id: true, courseId: true, maxStudents: true },
      });
      if (!cls) return { error: "Không tìm thấy lớp cần cập nhật." };
      if (studentIds.length > cls.maxStudents) {
        return { error: `Lớp chỉ nhận tối đa ${cls.maxStudents} học sinh.` };
      }

      const currentEnrollments = await tx.enrollment.findMany({
        where: { classId: cls.id, courseId: cls.courseId },
        select: { userId: true },
      });
      const currentStudentIds = new Set(currentEnrollments.map(({ userId }) => userId));
      const activeStudents = await tx.user.findMany({
        where: { id: { in: studentIds }, role: "student", isActive: true, deletedAt: null },
        select: { id: true },
      });
      const eligibleStudentIds = new Set([
        ...activeStudents.map(({ id }) => id),
        ...currentStudentIds,
      ]);
      if (studentIds.some((studentId) => !eligibleStudentIds.has(studentId))) {
        return { error: "Một số tài khoản học sinh không còn khả dụng. Hãy tải lại danh sách." };
      }

      const desiredStudentIds = new Set(studentIds);
      const removedStudentIds = currentEnrollments
        .map(({ userId }) => userId)
        .filter((userId) => !desiredStudentIds.has(userId));

      if (removedStudentIds.length > 0) {
        await tx.enrollment.deleteMany({
          where: { userId: { in: removedStudentIds }, courseId: cls.courseId, classId: cls.id },
        });
      }

      await Promise.all(studentIds.map((studentId) =>
        tx.enrollment.upsert({
          where: { userId_courseId: { userId: studentId, courseId: cls.courseId } },
          update: { classId: cls.id },
          create: { userId: studentId, courseId: cls.courseId, classId: cls.id },
        })
      ));

      return { success: true };
    });
  }

  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ClassRow = Awaited<ReturnType<typeof getAllClasses>>[number];
type ModalMode = "create" | "edit" | "delete" | "members" | null;

interface SearchableOption {
  value: string;
  label: string;
  displayLabel?: string;
  searchText?: string;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .trim();
}

function getDefaultReviewSessions(
  hskLevel: number,
  courseCode: string,
): { midterm: number; final: number | null } | null {
  if (courseCode.endsWith("-3.0")) {
    switch (hskLevel) {
      case 1: return { midterm: 24, final: null };
      case 2: return { midterm: 20, final: null };
      case 3: return { midterm: 32, final: null };
      default: return null;
    }
  }

  switch (hskLevel) {
    case 1: return { midterm: 12, final: 24 };
    case 2: return { midterm: 10, final: 20 };
    case 3: return { midterm: 16, final: 32 };
    default: return null;
  }
}

function parseReviewSession(value: FormDataEntryValue | null): number | null | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const session = Number(raw);
  return Number.isSafeInteger(session) && session > 0 && session <= 2_147_483_647
    ? session
    : undefined;
}

function SearchableSelect({
  id,
  name,
  options,
  defaultValue,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  onValueChange,
}: {
  id: string;
  name: string;
  options: SearchableOption[];
  defaultValue: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  onValueChange?: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialOption = options.find((option) => option.value === defaultValue);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [inputValue, setInputValue] = useState(initialOption?.displayLabel ?? initialOption?.label ?? "");
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = `${id}-options`;
  const filteredOptions = options.filter((option) =>
    normalizeSearchText(`${option.label} ${option.searchText ?? ""}`).includes(normalizeSearchText(query))
  );

  const selectOption = (option: SearchableOption) => {
    setSelectedValue(option.value);
    setInputValue(option.displayLabel ?? option.label);
    setQuery("");
    setIsOpen(false);
    onValueChange?.(option.value);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
          setQuery("");
          const selectedOption = options.find((option) => option.value === selectedValue);
          setInputValue(selectedOption?.displayLabel ?? selectedOption?.label ?? "");
        }
      }}
    >
      <input type="hidden" name={name} value={selectedValue} />
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && filteredOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        className="pr-10"
        value={inputValue}
        onFocus={() => {
          setQuery("");
          const selectedIndex = options.findIndex((option) => option.value === selectedValue);
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setIsOpen(true);
        }}
        onChange={(event) => {
          setInputValue(event.target.value);
          setQuery(event.target.value);
          setSelectedValue("");
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && isOpen && filteredOptions[activeIndex]) {
            event.preventDefault();
            selectOption(filteredOptions[activeIndex]);
          } else if (event.key === "Escape") {
            setIsOpen(false);
            setQuery("");
            const selectedOption = options.find((option) => option.value === selectedValue);
            setInputValue(selectedOption?.displayLabel ?? selectedOption?.label ?? "");
          }
        }}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={searchPlaceholder}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : filteredOptions.map((option, index) => (
            <button
              key={option.value || "unassigned"}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
              className={cn(
                "flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === selectedValue && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Schedule Picker ──────────────────────────────────────────────────────────

function SchedulePicker({
  slots,
  onChange,
}: {
  slots: ScheduleSlot[];
  onChange: (slots: ScheduleSlot[]) => void;
}) {

  const addSlot = () =>
    onChange([...slots, { days: [1, 3, 5], startTime: "20:00", endTime: "21:30" }]);

  const removeSlot = (i: number) =>
    onChange(slots.filter((_, idx) => idx !== i));

  const toggleDay = (slotIdx: number, day: number) =>
    onChange(
      slots.map((s, i) => {
        if (i !== slotIdx) return s;
        const days = s.days.includes(day) ? s.days.filter((d) => d !== day) : [...s.days, day].sort((a, b) => a - b);
        return { ...s, days };
      })
    );

  const updateTime = (slotIdx: number, field: "startTime" | "endTime", value: string) =>
    onChange(
      slots.map((s, i) => {
        if (i !== slotIdx) return s;
        if (field === "endTime") return { ...s, endTime: value };
        const endTime = addMinutesToTime(value, DEFAULT_SLOT_DURATION_MINUTES);
        return { ...s, startTime: value, ...(endTime ? { endTime } : {}) };
      })
    );

  return (
    <div className="space-y-3">
      <input type="hidden" name="schedule" value={JSON.stringify(slots)} />

      {slots.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Chưa có khung giờ nào. Bấm "Thêm khung giờ" để thêm.</p>
      )}

      {slots.map((slot, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-3">
          {/* Chọn ngày */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Ngày học</p>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(i, day)}
                  className={cn(
                    "h-8 w-10 rounded-md border text-xs font-medium transition-colors",
                    slot.days.includes(day)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Giờ bắt đầu / kết thúc */}
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Giờ bắt đầu</p>
              <Input
                type="time"
                value={slot.startTime}
                onChange={(e) => updateTime(i, "startTime", e.target.value)}
                className="h-9"
              />
            </div>
            <span className="mt-5 text-muted-foreground">–</span>
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Giờ kết thúc</p>
              <Input
                type="time"
                value={slot.endTime}
                onChange={(e) => updateTime(i, "endTime", e.target.value)}
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeSlot(i)}
              className="mt-5 hover:text-destructive hover:bg-destructive/10 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addSlot}>
        <Plus className="h-4 w-4 mr-1.5" />Thêm khung giờ
      </Button>
    </div>
  );
}

// ─── Modal tạo/sửa lớp ───────────────────────────────────────────────────────

function ClassFormModal({
  mode,
  cls,
  courses,
  teachers,
  onClose,
}: {
  mode: "create" | "edit";
  cls: ClassRow | null;
  courses: { id: string; code: string; title: string; hskLevel: number }[];
  teachers: { id: string; name: string; email: string }[];
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";
  const isEdit = mode === "edit";
  const defaultSchedule = parseSchedule(cls?.schedule);
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(defaultSchedule);
  const [scheduleError, setScheduleError] = useState(false);
  const [startDateError, setStartDateError] = useState(false);
  const [startDate, setStartDate] = useState(
    cls?.startDate
    ? new Date(cls.startDate).toISOString().slice(0, 10)
    : "",
  );
  const [midtermReviewSession, setMidtermReviewSession] = useState(
    cls?.midtermReviewSession == null ? "" : String(cls.midtermReviewSession),
  );
  const [finalReviewSession, setFinalReviewSession] = useState(
    cls?.finalReviewSession == null ? "" : String(cls.finalReviewSession),
  );
  const courseOptions: SearchableOption[] = [
    { value: "", label: "— Chọn khóa học —", searchText: "chọn khóa học" },
    ...courses.map((course) => ({
      value: course.id,
      label: `HSK${course.hskLevel} · ${course.title}`,
      searchText: `${course.hskLevel} ${course.code} ${course.title}`,
    })),
  ];
  const teacherOptions: SearchableOption[] = [
    { value: "", label: "Không phân công", displayLabel: "", searchText: "chưa phân công" },
    ...teachers.map((teacher) => ({
      value: teacher.id,
      label: `${teacher.name} (${teacher.email})`,
      searchText: `${teacher.name} ${teacher.email}`,
    })),
  ];

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.success) return;
    toast.success(isEdit ? "Đã cập nhật thông tin lớp học." : "Đã tạo lớp học thành công.");
    onClose();
  }, [fetcher.state, fetcher.data, isEdit, onClose]);

  return (
    <Overlay onClose={onClose}>
      <fetcher.Form
        method="post"
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          const form = event.currentTarget;
          const missingStartDate = !startDate;
          const invalidSchedule = !isValidSchedule(schedule);
          setStartDateError(missingStartDate);
          setScheduleError(invalidSchedule);

          if (missingStartDate || invalidSchedule) {
            event.preventDefault();
            if (missingStartDate) {
              form.querySelector<HTMLInputElement>("#startDate")?.focus();
            } else {
              form.querySelector<HTMLButtonElement>("[data-schedule-picker] button")?.focus();
            }
          }
        }}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Sửa lớp học" : "Tạo lớp học mới"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <input type="hidden" name="intent" value={isEdit ? "edit-class" : "create-class"} />
        {isEdit && <input type="hidden" name="classId" value={cls?.id} />}

        {/* Tên lớp */}
        <div className="space-y-2">
          <Label htmlFor="name">Tên lớp <span className="text-destructive">*</span></Label>
          <Input id="name" name="name" defaultValue={cls?.name} placeholder="VD: Lớp HSK1 Tối thứ 2-4-6" />
        </div>

        {/* Khóa học (chỉ khi tạo mới) */}
        {!isEdit && (
          <div className="space-y-2">
            <Label htmlFor="courseId">Khóa học <span className="text-destructive">*</span></Label>
            <SearchableSelect
              id="courseId"
              name="courseId"
              options={courseOptions}
              defaultValue=""
              placeholder="Tìm theo tên hoặc mã khóa học..."
              searchPlaceholder="Tìm khóa học"
              emptyMessage="Không tìm thấy khóa học phù hợp."
              onValueChange={(courseId) => {
                const course = courses.find((item) => item.id === courseId);
                const defaults = course ? getDefaultReviewSessions(course.hskLevel, course.code) : null;
                setMidtermReviewSession(defaults ? String(defaults.midterm) : "");
                setFinalReviewSession(defaults?.final == null ? "" : String(defaults.final));
              }}
            />
          </div>
        )}

        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Mốc đánh giá theo buổi học</legend>
          <p className="text-xs text-muted-foreground">
            {isEdit ? `Mặc định theo HSK${cls?.course.hskLevel ?? "—"}; có thể chỉnh riêng cho lớp này.` : "Chọn khóa học để tự điền mốc mặc định theo cấp độ HSK; bạn có thể chỉnh lại."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="midtermReviewSession">Đánh giá giữa kỳ · buổi</Label>
              <Input
                id="midtermReviewSession"
                name="midtermReviewSession"
                type="number"
                min={1}
                step={1}
                value={midtermReviewSession}
                onChange={(event) => setMidtermReviewSession(event.currentTarget.value)}
                placeholder="Để trống nếu không dùng"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="finalReviewSession">Đánh giá cuối kỳ · buổi</Label>
              <Input
                id="finalReviewSession"
                name="finalReviewSession"
                type="number"
                min={1}
                step={1}
                value={finalReviewSession}
                onChange={(event) => setFinalReviewSession(event.currentTarget.value)}
                placeholder="Để trống để đánh giá khi kết thúc khóa"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Để trống mốc cuối kỳ sẽ dùng quy trình đánh giá khi giáo viên kết thúc khóa học.
          </p>
        </fieldset>

        {/* Giáo viên */}
        <div className="space-y-2">
          <Label htmlFor="teacherId">Giáo viên phụ trách <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <SearchableSelect
            id="teacherId"
            name="teacherId"
            options={teacherOptions}
            defaultValue={cls?.teacher?.id ?? ""}
            placeholder="Tìm theo tên giáo viên..."
            searchPlaceholder="Tìm giáo viên"
            emptyMessage="Không tìm thấy giáo viên phù hợp."
          />
        </div>

        {/* Số lượng học viên tối đa */}
        <div className="space-y-2">
          <Label htmlFor="maxStudents">Số học viên tối đa</Label>
          <Input
            id="maxStudents"
            name="maxStudents"
            type="number"
            min={1}
            max={100}
            defaultValue={cls?.maxStudents ?? 6}
            className="w-32"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">Ngày bắt đầu <span className="text-destructive">*</span></Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            aria-invalid={startDateError}
            aria-describedby={startDateError ? "startDate-error" : undefined}
            value={startDate}
            onChange={(event) => {
              setStartDate(event.currentTarget.value);
              if (event.currentTarget.value) setStartDateError(false);
            }}
          />
          {startDateError && (
            <p id="startDate-error" role="alert" className="text-sm text-destructive">
              Bạn vui lòng chọn ngày bắt đầu cho lớp nhé.
            </p>
          )}
        </div>

        {/* Lịch học */}
        <div className="space-y-2" data-schedule-picker>
          <Label>Lịch học <span className="text-destructive">*</span></Label>
          <SchedulePicker
            slots={schedule}
            onChange={(nextSchedule) => {
              setSchedule(nextSchedule);
              if (isValidSchedule(nextSchedule)) setScheduleError(false);
            }}
          />
          {scheduleError && (
            <p role="alert" className="text-sm text-destructive">
              Vui lòng thêm ít nhất một khung giờ hợp lệ.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Tạo lớp"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

// ─── Modal xóa lớp ───────────────────────────────────────────────────────────

function DeleteClassModal({ cls, onClose }: { cls: ClassRow; onClose: () => void }) {
  const fetcher = useFetcher<{ success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Overlay onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">Xóa lớp học</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Xóa lớp <strong>{cls.name}</strong>? Học sinh sẽ mất quyền truy cập khóa học này.
        </div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete-class" />
          <input type="hidden" name="classId" value={cls.id} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
            <Button type="submit" variant="destructive" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa lớp
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Overlay>
  );
}

// ─── Modal quản lý thành viên ─────────────────────────────────────────────────

function MembersModal({
  cls,
  allStudents,
  onClose,
}: {
  cls: ClassRow;
  allStudents: { id: string; name: string; email: string }[];
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isLoading = fetcher.state !== "idle";
  const [search, setSearch] = useState("");

  const [selectedStudentIds, setSelectedStudentIds] = useState(
    () => cls.enrollments.map((enrollment: { user: { id: string } }) => enrollment.user.id),
  );
  const initialStudentIds = cls.enrollments.map((enrollment: { user: { id: string } }) => enrollment.user.id);
  const initialStudentIdSet = new Set(initialStudentIds);
  const selectedStudentIdSet = new Set(selectedStudentIds);
  const hasChanges = selectedStudentIds.length !== initialStudentIds.length
    || selectedStudentIds.some((studentId) => !initialStudentIdSet.has(studentId));
  const enrolledStudents = selectedStudentIds
    .map((studentId) =>
      allStudents.find((student) => student.id === studentId)
      ?? cls.enrollments.find((enrollment: { user: { id: string } }) => enrollment.user.id === studentId)?.user
    )
    .filter((student): student is { id: string; name: string; email: string } => Boolean(student));
  const isFull = selectedStudentIds.length >= cls.maxStudents;
  const normalizedSearch = normalizeSearchText(search);
  const availableStudents = allStudents.filter(
    (s: { id: string; name: string; email: string }) =>
      !selectedStudentIdSet.has(s.id) &&
      (!normalizedSearch || normalizeSearchText(`${s.name} ${s.email}`).includes(normalizedSearch))
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.success) return;
    toast.success("Đã lưu danh sách học sinh trong lớp.");
    onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : current.length < cls.maxStudents
          ? [...current, studentId]
          : current
    );
  };

  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="sync-students" />
        <input type="hidden" name="classId" value={cls.id} />
        {selectedStudentIds.map((studentId) => (
          <input key={studentId} type="hidden" name="studentIds" value={studentId} />
        ))}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Thành viên lớp {cls.name}</h2>
            <p className="text-sm text-muted-foreground">
              {cls.course.title} · {selectedStudentIds.length}/{cls.maxStudents} học sinh
              {isFull && <span className="ml-1.5 text-warning font-medium">· Đã đầy</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isLoading} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}

        {/* Danh sách học sinh trong lớp */}
        <div>
          <p className="text-sm font-medium mb-2">Đang trong lớp</p>
          {enrolledStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Chưa có học sinh nào trong lớp.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {enrolledStudents.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isLoading}
                    title="Xóa khỏi lớp (chưa lưu)"
                    aria-label={`Xóa ${s.name} khỏi lớp (chưa lưu)`}
                    onClick={() => toggleStudent(s.id)}
                    className="hover:text-destructive hover:bg-destructive/10 h-7 w-7"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Thêm học sinh */}
        <div>
          <p className="text-sm font-medium mb-2">Thêm học sinh</p>
          {isFull ? (
            <p className="text-sm text-warning italic">Lớp đã đủ {cls.maxStudents} học sinh.</p>
          ) : (
            <>
              <Input
                placeholder="Tìm theo tên hoặc email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2"
              />
              {availableStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  {search ? "Không tìm thấy học sinh phù hợp." : "Không còn học sinh nào để thêm."}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {availableStudents.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isLoading || isFull}
                        onClick={() => toggleStudent(s.id)}
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Thêm
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
            {hasChanges ? "Có thay đổi chưa lưu." : "Danh sách đã được lưu."}
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Đóng</Button>
            <Button type="submit" disabled={isLoading || !hasChanges}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Lưu thay đổi
            </Button>
          </div>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

// ─── Trang chính ─────────────────────────────────────────────────────────────

export default function AdminClasses() {
  const { user, classes, courses, teachers, students } = useLoaderData<typeof loader>();
  const [modal, setModal] = useState<ModalMode>(null);
  const [selectedClass, setSelectedClass] = useState<ClassRow | null>(null);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const normalizedSearch = search.trim().toLocaleLowerCase("vi");
  const filteredClasses = classes.filter((cls: ClassRow) =>
    [cls.name, cls.course.title, cls.course.code, cls.teacher?.name]
      .some((value) => value?.toLocaleLowerCase("vi").includes(normalizedSearch))
  );
  const totalPages = Math.max(1, Math.ceil(filteredClasses.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const visibleClasses = filteredClasses.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const openModal = (mode: ModalMode, cls: ClassRow | null = null) => {
    setSelectedClass(cls);
    setModal(mode);
  };
  const closeModal = useCallback(() => { setModal(null); setSelectedClass(null); }, []);

  const currentClass = selectedClass
    ? classes.find((c) => c.id === selectedClass.id) ?? selectedClass
    : null;

  return (
    <>
      <AppShell user={user}>
        <div className="mx-auto max-w-screen-2xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Lớp học</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Tạo lớp, gán giáo viên và học sinh để kiểm soát quyền truy cập khóa học.
              </p>
            </div>
            <Button className="w-full sm:w-auto" onClick={() => openModal("create")}>
              <Plus className="h-4 w-4 mr-1.5" />Tạo lớp mới
            </Button>
          </div>

          {classes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <School className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Chưa có lớp học nào</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Tạo lớp học để gán giáo viên và học sinh vào khóa học.
              </p>
              <Button onClick={() => openModal("create")}>
                <Plus className="h-4 w-4 mr-1.5" />Tạo lớp đầu tiên
              </Button>
            </div>
          ) : (
            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="relative w-full sm:max-w-md">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label="Tìm lớp học"
                    placeholder="Tìm lớp, khóa học hoặc giáo viên..."
                    className="pl-10 pr-10"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setCurrentPage(1);
                    }}
                  />
                  {search && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Xóa tìm kiếm"
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                      onClick={() => {
                        setSearch("");
                        setCurrentPage(1);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
                  {filteredClasses.length === 0
                    ? "Không có lớp phù hợp"
                    : `Hiển thị ${pageStart + 1}–${Math.min(pageStart + pageSize, filteredClasses.length)} / ${filteredClasses.length} lớp`}
                </p>
              </div>

              {filteredClasses.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                  <p className="font-semibold">Không tìm thấy lớp học phù hợp</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Thử tên lớp, khóa học hoặc tên giáo viên khác.
                  </p>
                </div>
              ) : (
                <>
                  <ul aria-label="Danh sách lớp học" className="divide-y">
                    {visibleClasses.map((cls: ClassRow) => {
                      const schedule = parseSchedule(cls.schedule);
                      const isFull = cls.enrollments.length >= cls.maxStudents;
                      return (
                        <li
                          key={cls.id}
                          className="grid gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5 xl:grid-cols-[minmax(200px,1.25fr)_minmax(125px,.8fr)_minmax(150px,.75fr)_minmax(200px,1.1fr)_auto] xl:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="break-words text-sm font-semibold leading-5">{cls.name}</h2>
                              <Badge variant="outline" className="shrink-0 text-[11px] font-medium">
                                HSK{cls.course.hskLevel}
                              </Badge>
                            </div>
                            <p className="mt-1 break-words text-sm text-muted-foreground">{cls.course.title}</p>
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              Bắt đầu {formatStartDate(cls.startDate)}
                            </p>
                          </div>

                          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                            <UserCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className={cn("break-words", !cls.teacher && "italic")}>
                              {cls.teacher ? cls.teacher.name : "Chưa phân công giáo viên"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="whitespace-nowrap tabular-nums">
                              {cls.enrollments.length}/{cls.maxStudents} học sinh
                            </span>
                            {isFull && (
                              <span className="whitespace-nowrap rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                                Đã đầy
                              </span>
                            )}
                          </div>

                          <div className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className={cn("break-words", schedule.length === 0 && "italic")}>
                              {schedule.length > 0 ? formatSchedule(schedule) : "Chưa có lịch học"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 border-t pt-3 sm:justify-end xl:border-0 xl:pt-0">
                            <Button size="sm" variant="outline" onClick={() => openModal("members", cls)}>
                              <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
                              Thành viên
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Sửa lớp ${cls.name}`}
                              title="Sửa lớp"
                              onClick={() => openModal("edit", cls)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Xóa lớp ${cls.name}`}
                              title="Xóa lớp"
                              className="hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => openModal("delete", cls)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {filteredClasses.length > pageSize && (
                    <nav
                      aria-label="Phân trang danh sách lớp"
                      className="flex flex-col gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    >
                      <p className="text-sm text-muted-foreground">
                        10 lớp mỗi trang
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label="Trang trước"
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        >
                          <ChevronLeft className="h-4 w-4 sm:mr-1" aria-hidden="true" />
                          <span className="hidden sm:inline">Trước</span>
                        </Button>
                        {getPaginationItems(totalPages, currentPage).map((item, index) => item === "ellipsis" ? (
                          <span key={`ellipsis-${index}`} className="px-1.5 text-sm text-muted-foreground" aria-hidden="true">
                            …
                          </span>
                        ) : (
                          <Button
                            key={item}
                            type="button"
                            variant={item === currentPage ? "default" : "ghost"}
                            size="sm"
                            aria-label={`Trang ${item}`}
                            aria-current={item === currentPage ? "page" : undefined}
                            onClick={() => setCurrentPage(item)}
                            className="min-w-9 px-2"
                          >
                            {item}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label="Trang sau"
                          disabled={currentPage === totalPages}
                          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        >
                          <span className="hidden sm:inline">Sau</span>
                          <ChevronRight className="h-4 w-4 sm:ml-1" aria-hidden="true" />
                        </Button>
                      </div>
                    </nav>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </AppShell>

      {(modal === "create" || modal === "edit") && (
        <ClassFormModal
          key={`${modal}-${selectedClass?.id ?? "new"}`}
          mode={modal}
          cls={selectedClass}
          courses={courses}
          teachers={teachers}
          onClose={closeModal}
        />
      )}
      {modal === "delete" && currentClass && (
        <DeleteClassModal cls={currentClass} onClose={closeModal} />
      )}
      {modal === "members" && currentClass && (
        <MembersModal
          key={`members-${currentClass.id}`}
          cls={currentClass}
          allStudents={students}
          onClose={closeModal}
        />
      )}
    </>
  );
}
