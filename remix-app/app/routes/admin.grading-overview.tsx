import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { AppShell } from "~/components/layout/app-shell";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
  const classOptions = classes.map(({ id, name }) => ({ id, name }));
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
            <div className="grid gap-1.5">
              <Label htmlFor="grading-class-filter">Lớp</Label>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger id="grading-class-filter" className="w-full sm:w-48">
                  <SelectValue placeholder="Tất cả lớp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả lớp</SelectItem>
                  {classOptions.map((classroom) => (
                    <SelectItem key={classroom.id} value={classroom.id}>{classroom.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="grading-teacher-filter">Giáo viên</Label>
              <Select value={teacherFilter} onValueChange={setTeacherFilter}>
                <SelectTrigger id="grading-teacher-filter" className="w-full sm:w-48">
                  <SelectValue placeholder="Tất cả giáo viên" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả giáo viên</SelectItem>
                  <SelectItem value="unassigned">Chưa phân công</SelectItem>
                  {teacherOptions.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
