import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { AppShell } from "~/components/layout/app-shell";
import { Label } from "~/components/ui/label";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type PendingGradeRow = {
  id: string;
  type: string;
  activity: string;
  student: string;
  classId: string;
  className: string;
  course: string;
  teacherId: string;
  teacher: string;
  submittedAt: string;
  pendingQuestionCount: number | null;
};

type FilterOption = { value: string; label: string };

function SearchableFilter({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;
  const visibleOptions = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const listId = `${id}-options`;

  const selectOption = (option: FilterOption) => {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-activedescendant={isOpen && visibleOptions[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={isOpen ? query : selectedLabel}
          placeholder={placeholder}
          onFocus={() => {
            setIsOpen(true);
            setQuery("");
            setActiveIndex(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onBlur={() => setIsOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              setQuery("");
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => Math.min(current + 1, visibleOptions.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }
            if (event.key === "Enter" && isOpen && visibleOptions[activeIndex]) {
              event.preventDefault();
              selectOption(visibleOptions[activeIndex]);
            }
          }}
          className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-9 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ChevronsUpDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {isOpen && (
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {visibleOptions.length > 0 ? visibleOptions.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={value === option.value}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                className={`flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none ${
                  activeIndex === index
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/70"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {value === option.value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </div>
            )) : (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Không tìm thấy kết quả phù hợp.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countPendingWorkbookQuestions(details: unknown) {
  if (!isRecord(details) || details.reviewPending !== true || !Array.isArray(details.results)) return 0;
  return details.results.filter((result) =>
    isRecord(result) && result.teacherReviewPending === true,
  ).length;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const classes = await prisma.class.findMany({
    select: {
      id: true,
      name: true,
      courseId: true,
      teacher: { select: { id: true, name: true } },
      course: { select: { title: true } },
      enrollments: {
        where: { user: { is: { role: "student", deletedAt: null } } },
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });
  const classByStudentCourse = new Map<string, (typeof classes)[number]>();
  for (const classroom of classes) {
    for (const enrollment of classroom.enrollments) {
      classByStudentCourse.set(`${classroom.courseId}:${enrollment.user.id}`, classroom);
    }
  }
  const classOptions = classes.map(({ id, name, teacher }) => ({
    id,
    name,
    teacherId: teacher?.id ?? null,
  }));
  const teacherOptions = [...new Map(
    classes.flatMap(({ teacher }) => teacher ? [[teacher.id, teacher.name]] : []),
  )].map(([id, name]) => ({ id, name }));

  const courseIds = [...new Set(classes.map(({ courseId }) => courseId))];
  const studentIds = [...new Set(classes.flatMap(({ enrollments }) =>
    enrollments.map(({ user: student }) => student.id),
  ))];
  if (courseIds.length === 0 || studentIds.length === 0) {
    return { user, pendingRows: [] as PendingGradeRow[], classOptions, teacherOptions };
  }

  const [translationSubmissions, lessonAttempts, reviewAttempts] = await Promise.all([
    prisma.translationSubmission.findMany({
      where: {
        status: "SUBMITTED",
        studentId: { in: studentIds },
        lesson: { courseId: { in: courseIds } },
      },
      select: {
        id: true,
        studentId: true,
        answers: true,
        submittedAt: true,
        student: { select: { name: true, email: true } },
        lesson: {
          select: {
            title: true,
            courseId: true,
            course: { select: { title: true } },
          },
        },
      },
    }),
    prisma.lessonTabAttempt.findMany({
      where: {
        userId: { in: studentIds },
        lesson: { courseId: { in: courseIds } },
        OR: [
          {
            tab: "GRAMMAR",
            mode: "FILL",
            details: { path: ["reviewPending"], equals: true },
          },
          {
            tab: "WORKBOOK",
            details: { path: ["reviewPending"], equals: true },
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        tab: true,
        details: true,
        completedAt: true,
        user: { select: { name: true, email: true } },
        lesson: {
          select: {
            title: true,
            courseId: true,
            course: { select: { title: true } },
          },
        },
      },
    }),
    prisma.courseReviewAttempt.findMany({
      where: {
        status: { in: ["SUBMITTED", "GRADED"] },
        userId: { in: studentIds },
        reviewSet: { courseId: { in: courseIds } },
      },
      select: {
        id: true,
        userId: true,
        grades: true,
        completedAt: true,
        user: { select: { name: true, email: true } },
        reviewSet: {
          select: {
            title: true,
            courseId: true,
            course: { select: { title: true } },
            questions: { select: { id: true } },
          },
        },
      },
    }),
  ]);

  const pendingRows: PendingGradeRow[] = [];
  for (const submission of translationSubmissions) {
    const classroom = classByStudentCourse.get(`${submission.lesson.courseId}:${submission.studentId}`);
    if (!classroom) continue;
    pendingRows.push({
      id: `translation:${submission.id}`,
      type: "Luyện dịch",
      activity: submission.lesson.title,
      student: submission.student.name ?? submission.student.email,
      classId: classroom.id,
      className: classroom.name,
      course: submission.lesson.course.title,
      teacherId: classroom.teacher?.id ?? "unassigned",
      teacher: classroom.teacher?.name ?? "Chưa phân công",
      submittedAt: submission.submittedAt.toISOString(),
      pendingQuestionCount: Array.isArray(submission.answers) ? submission.answers.length : null,
    });
  }

  for (const attempt of lessonAttempts) {
    const classroom = classByStudentCourse.get(`${attempt.lesson.courseId}:${attempt.userId}`);
    if (!classroom) continue;
    const details = isRecord(attempt.details) ? attempt.details : {};
    if (attempt.tab === "GRAMMAR") {
      const results = Array.isArray(details.results) ? details.results : [];
      pendingRows.push({
        id: `grammar:${attempt.id}`,
        type: "Ngữ pháp",
        activity: typeof details.sectionTitle === "string" ? details.sectionTitle : "Bài tập điền",
        student: attempt.user.name ?? attempt.user.email,
        classId: classroom.id,
        className: classroom.name,
        course: attempt.lesson.course.title,
        teacherId: classroom.teacher?.id ?? "unassigned",
        teacher: classroom.teacher?.name ?? "Chưa phân công",
        submittedAt: attempt.completedAt.toISOString(),
        pendingQuestionCount: results.length || null,
      });
      continue;
    }

    const pendingQuestionCount = countPendingWorkbookQuestions(attempt.details);
    if (pendingQuestionCount === 0) continue;
    pendingRows.push({
      id: `workbook:${attempt.id}`,
      type: "Sách bài tập",
      activity: typeof details.blockTitle === "string" ? details.blockTitle : attempt.lesson.title,
      student: attempt.user.name ?? attempt.user.email,
      classId: classroom.id,
      className: classroom.name,
      course: attempt.lesson.course.title,
      teacherId: classroom.teacher?.id ?? "unassigned",
      teacher: classroom.teacher?.name ?? "Chưa phân công",
      submittedAt: attempt.completedAt.toISOString(),
      pendingQuestionCount,
    });
  }

  for (const attempt of reviewAttempts) {
    const classroom = classByStudentCourse.get(`${attempt.reviewSet.courseId}:${attempt.userId}`);
    if (!classroom) continue;
    const gradedQuestionIds = new Set(
      Array.isArray(attempt.grades)
        ? attempt.grades.flatMap((grade) =>
            isRecord(grade) && typeof grade.questionId === "string" && typeof grade.correct === "boolean"
              ? [grade.questionId]
              : [],
          )
        : [],
    );
    const pendingQuestionCount = attempt.reviewSet.questions.filter(({ id }) => !gradedQuestionIds.has(id)).length;
    if (pendingQuestionCount === 0) continue;
    pendingRows.push({
      id: `review:${attempt.id}`,
      type: "Bài ôn tập",
      activity: attempt.reviewSet.title,
      student: attempt.user.name ?? attempt.user.email,
      classId: classroom.id,
      className: classroom.name,
      course: attempt.reviewSet.course.title,
      teacherId: classroom.teacher?.id ?? "unassigned",
      teacher: classroom.teacher?.name ?? "Chưa phân công",
      submittedAt: attempt.completedAt.toISOString(),
      pendingQuestionCount,
    });
  }

  pendingRows.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return { user, pendingRows, classOptions, teacherOptions };
}

export default function AdminGradingOverview() {
  const { user, pendingRows, classOptions, teacherOptions } = useLoaderData<typeof loader>();
  const [classFilter, setClassFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const availableClassOptions = useMemo(
    () => classOptions.filter((classroom) => {
      if (teacherFilter === "all") return true;
      if (teacherFilter === "unassigned") return classroom.teacherId === null;
      return classroom.teacherId === teacherFilter;
    }),
    [classOptions, teacherFilter],
  );
  const teacherFilterOptions: FilterOption[] = [
    { value: "all", label: "Tất cả giáo viên" },
    { value: "unassigned", label: "Chưa phân công" },
    ...teacherOptions.map((teacher) => ({ value: teacher.id, label: teacher.name })),
  ];
  const classFilterOptions: FilterOption[] = [
    { value: "all", label: "Tất cả lớp" },
    ...availableClassOptions.map((classroom) => ({ value: classroom.id, label: classroom.name })),
  ];
  const filteredRows = useMemo(
    () => pendingRows.filter((row) =>
      (classFilter === "all" || row.classId === classFilter)
      && (teacherFilter === "all" || row.teacherId === teacherFilter),
    ),
    [pendingRows, classFilter, teacherFilter],
  );

  return (
    <AppShell user={user}>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Bài chưa chấm</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Danh sách bài học sinh đã nộp đang chờ giáo viên chấm.
          </p>
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {filteredRows.length} / {pendingRows.length} bài đang chờ chấm
          </p>
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <SearchableFilter
              id="grading-teacher-filter"
              label="Giáo viên"
              value={teacherFilter}
              options={teacherFilterOptions}
              placeholder="Tìm giáo viên..."
              onChange={(nextTeacherFilter) => {
                setTeacherFilter(nextTeacherFilter);
                if (
                  classFilter !== "all"
                  && !classOptions.some((classroom) =>
                    classroom.id === classFilter
                    && (
                      nextTeacherFilter === "all"
                      || (nextTeacherFilter === "unassigned"
                        ? classroom.teacherId === null
                        : classroom.teacherId === nextTeacherFilter)
                    ),
                  )
                ) {
                  setClassFilter("all");
                }
              }}
            />
            <SearchableFilter
              id="grading-class-filter"
              label="Lớp"
              value={classFilter}
              options={classFilterOptions}
              placeholder="Tìm lớp..."
              onChange={setClassFilter}
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {pendingRows.length === 0
              ? "Hiện không có bài nào đang chờ giáo viên chấm."
              : "Không có bài chờ chấm phù hợp với bộ lọc đã chọn."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Bài tập</TableHead>
                  <TableHead>Học sinh</TableHead>
                  <TableHead>Lớp</TableHead>
                  <TableHead>Khóa học</TableHead>
                  <TableHead>Giáo viên</TableHead>
                  <TableHead>Ngày nộp</TableHead>
                  <TableHead className="text-right">Câu chờ chấm</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-52">
                      <p className="font-medium">{row.activity}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{row.type}</p>
                    </TableCell>
                    <TableCell className="min-w-40">{row.student}</TableCell>
                    <TableCell>{row.className}</TableCell>
                    <TableCell className="min-w-44">{row.course}</TableCell>
                    <TableCell className="min-w-40">{row.teacher}</TableCell>
                    <TableCell className="min-w-40 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.submittedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.pendingQuestionCount ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
