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
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Overlay } from "~/components/common/overlay";
import {
  School, Plus, Pencil, Trash2, X, Search, Loader2, Users, UserCheck, Check, ChevronDown, Save,
  UserPlus, UserMinus, Clock,
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

function parseSchedule(raw: unknown): ScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is ScheduleSlot =>
      s && Array.isArray(s.days) && typeof s.startTime === "string" && typeof s.endTime === "string"
  );
}

function formatSchedule(slots: ScheduleSlot[]): string {
  if (slots.length === 0) return "Chưa có lịch học";
  return slots
    .map((s) => `${s.days.map((d) => DAY_LABELS[d]).join("-")} ${s.startTime}–${s.endTime}`)
    .join(", ");
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
    const scheduleRaw = String(form.get("schedule") ?? "[]");
    let schedule: ScheduleSlot[] = [];
    try { schedule = JSON.parse(scheduleRaw); } catch { schedule = []; }

    if (!name) return { error: "Vui lòng nhập tên lớp", field: "name" };

    if (intent === "create-class") {
      const courseId = String(form.get("courseId") ?? "").trim();
      if (!courseId) return { error: "Vui lòng chọn khóa học", field: "courseId" };
      await prisma.class.create({ data: { name, courseId, teacherId, maxStudents, schedule: schedule as object[] } });
    } else {
      const classId = String(form.get("classId"));
      await prisma.class.update({ where: { id: classId }, data: { name, teacherId, maxStudents, schedule: schedule as object[] } });
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

function SearchableSelect({
  id,
  name,
  options,
  defaultValue,
  placeholder,
  searchPlaceholder,
  emptyMessage,
}: {
  id: string;
  name: string;
  options: SearchableOption[];
  defaultValue: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialOption = options.find((option) => option.value === defaultValue);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [inputValue, setInputValue] = useState(initialOption?.label ?? "");
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = `${id}-options`;
  const filteredOptions = options.filter((option) =>
    normalizeSearchText(`${option.label} ${option.searchText ?? ""}`).includes(normalizeSearchText(query))
  );

  const selectOption = (option: SearchableOption) => {
    setSelectedValue(option.value);
    setInputValue(option.label);
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
          setQuery("");
          setInputValue(options.find((option) => option.value === selectedValue)?.label ?? "");
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
            setInputValue(options.find((option) => option.value === selectedValue)?.label ?? "");
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

function SchedulePicker({ defaultValue }: { defaultValue: ScheduleSlot[] }) {
  const [slots, setSlots] = useState<ScheduleSlot[]>(defaultValue);

  const addSlot = () =>
    setSlots((prev) => [...prev, { days: [1, 3, 5], startTime: "20:00", endTime: "22:00" }]);

  const removeSlot = (i: number) =>
    setSlots((prev) => prev.filter((_, idx) => idx !== i));

  const toggleDay = (slotIdx: number, day: number) =>
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== slotIdx) return s;
        const days = s.days.includes(day) ? s.days.filter((d) => d !== day) : [...s.days, day].sort((a, b) => a - b);
        return { ...s, days };
      })
    );

  const updateTime = (slotIdx: number, field: "startTime" | "endTime", value: string) =>
    setSlots((prev) =>
      prev.map((s, i) => (i === slotIdx ? { ...s, [field]: value } : s))
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
  const courseOptions: SearchableOption[] = [
    { value: "", label: "— Chọn khóa học —", searchText: "chọn khóa học" },
    ...courses.map((course) => ({
      value: course.id,
      label: `HSK${course.hskLevel} · ${course.code} · ${course.title}`,
      searchText: `${course.hskLevel} ${course.code} ${course.title}`,
    })),
  ];
  const teacherOptions: SearchableOption[] = [
    { value: "", label: "— Chưa phân công —", searchText: "chưa phân công" },
    ...teachers.map((teacher) => ({
      value: teacher.id,
      label: `${teacher.name} (${teacher.email})`,
      searchText: `${teacher.name} ${teacher.email}`,
    })),
  ];

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" className="space-y-4">
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
            />
          </div>
        )}

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

        {/* Lịch học */}
        <div className="space-y-2">
          <Label>Lịch học <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <SchedulePicker defaultValue={defaultSchedule} />
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

  const normalizedSearch = search.trim().toLocaleLowerCase("vi");
  const filteredClasses = classes.filter((cls: ClassRow) =>
    [cls.name, cls.course.title, cls.course.code, cls.teacher?.name]
      .some((value) => value?.toLocaleLowerCase("vi").includes(normalizedSearch))
  );

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
        <div className="space-y-6 max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Lớp học</h1>
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
            <div className="space-y-3">
              <div className="relative max-w-md">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Tìm lớp học"
                  placeholder="Tìm theo tên lớp, khóa học hoặc giáo viên..."
                  className="pl-10 pr-10"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Xóa tìm kiếm"
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {filteredClasses.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="font-medium">Không tìm thấy lớp học phù hợp</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Thử tên lớp, khóa học hoặc tên giáo viên khác.
                  </p>
                </div>
              ) : filteredClasses.map((cls: ClassRow) => {
                const schedule = parseSchedule(cls.schedule);
                return (
                  <Card key={cls.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <CardTitle className="text-base">{cls.name}</CardTitle>
                            <Badge variant="outline" className="text-xs">
                              HSK{cls.course.hskLevel} · {cls.course.code}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{cls.course.title}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => openModal("members", cls)}>
                            <Users className="h-4 w-4 mr-1.5" />Thành viên
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => openModal("edit", cls)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="hover:text-destructive hover:bg-destructive/10"
                            onClick={() => openModal("delete", cls)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="h-4 w-4" />
                          {cls.teacher ? cls.teacher.name : <span className="italic">Chưa phân công giáo viên</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Users className="h-4 w-4" />
                          {cls.enrollments.length}/{cls.maxStudents} học sinh
                        </span>
                        {schedule.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4" />
                            {formatSchedule(schedule)}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
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
