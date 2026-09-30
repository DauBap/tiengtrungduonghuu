import type { LoaderFunctionArgs } from "react-router";
import * as XLSX from "xlsx";
import { getCourseById, getLessonsByCourse, isTeacherOfCourse } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingReview(details: unknown) {
  return isRecord(details)
    && details.questionType === "FILL"
    && details.reviewPending === true
    && !isRecord(details.teacherGrading);
}

function readText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readText).join(" ");
  return "";
}

function readDetails(value: unknown) {
  return isRecord(value) ? value : {};
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  SINGLE_CHOICE: "Chọn đáp án",
  ARRANGE: "Sắp xếp từ",
  FILL: "Dịch câu",
};

const QUESTION_TYPES = ["SINGLE_CHOICE", "ARRANGE", "FILL"] as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!(await isTeacherOfCourse(user.id, course.id))) {
    throw new Response("Không có quyền truy cập", { status: 403 });
  }

  const lessons = await getLessonsByCourse(course.id);
  const lesson = lessons.find((item) => item.id === params.lessonId);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });

  const students = await prisma.enrollment.findMany({
    where: { courseId: course.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const attempts = students.length === 0
    ? []
    : await prisma.lessonTabAttempt.findMany({
        where: {
          lessonId: lesson.id,
          tab: "GRAMMAR",
          userId: { in: students.map((enrollment) => enrollment.userId) },
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          userId: true,
          mode: true,
          score: true,
          correctCount: true,
          totalCount: true,
          passed: true,
          details: true,
          completedAt: true,
        },
      });

  const workbook = XLSX.utils.book_new();
  for (const questionType of QUESTION_TYPES) {
    const headers = [
      "STT", "Họ tên", "Email", "Lần làm", "Thời gian nộp", "Phần ngữ pháp",
      "Trạng thái", "Điểm (%)", "Số câu đúng", "Tổng số câu", "Câu hỏi",
      "Câu trả lời của học viên",
      ...(questionType === "FILL"
        ? ["Nhận xét giáo viên", "Kết quả câu", "Điểm câu"]
        : ["Đáp án đúng", "Kết quả câu", "Điểm câu", "Nhận xét giáo viên"]),
    ];
    const rows: unknown[][] = [
      ["Lớp học", course.title],
      ["Bài học", lesson.title],
      [],
      headers,
    ];

    for (const enrollment of students) {
      const studentAttempts = attempts
        .filter((attempt) => attempt.userId === enrollment.userId)
        .filter((attempt) => {
          const details = readDetails(attempt.details);
          return String(details.questionType ?? attempt.mode ?? "") === questionType;
        });

      if (studentAttempts.length === 0) {
        rows.push([
          rows.length - 3,
          enrollment.user.name ?? "Học viên",
          enrollment.user.email,
          "",
          "",
          "",
          "Chưa làm",
          ...Array.from({ length: headers.length - 7 }, () => ""),
        ]);
        continue;
      }

      studentAttempts.forEach((attempt, index) => {
        const details = readDetails(attempt.details);
        const pending = isPendingReview(attempt.details);
        const attemptStatus = pending || attempt.passed === null
          ? "Chờ chấm"
          : attempt.passed
            ? "Đạt"
            : "Chưa đạt";
        const results = Array.isArray(details.results)
          ? details.results.filter(isRecord)
          : [];
        const resultRows = results.length > 0 ? results : [null];

        resultRows.forEach((result, resultIndex) => {
          const correct = result && typeof result.correct === "boolean" ? result.correct : null;
          const questionStatus = pending
            ? "Chờ chấm"
            : correct === null
              ? "Chưa chấm"
              : correct
                ? "Đúng"
                : "Sai";
          const row = [
            rows.length - 3,
            enrollment.user.name ?? "Học viên",
            enrollment.user.email,
            studentAttempts.length - index,
            attempt.completedAt,
            readText(details.sectionTitle),
            attemptStatus,
            pending ? "" : attempt.score ?? "",
            attempt.correctCount ?? "",
            attempt.totalCount ?? "",
            result ? readText(result.prompt) : "",
            result ? readText(result.given) : "",
          ];
          const questionColumns = questionType === "FILL"
            ? [
                result ? readText(result.teacherFeedback) : "",
                result ? questionStatus : "",
                result && typeof result.points === "number" ? result.points : "",
              ]
            : [
                result ? readText(result.correctAnswer) : "",
                result ? questionStatus : "",
                result && typeof result.points === "number" ? result.points : "",
                result ? readText(result.teacherFeedback) : "",
              ];
          rows.push([...row, ...questionColumns]);
        });
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const questionColumnWidths = questionType === "FILL" ? [40, 16, 14] : [40, 16, 14, 40];
    sheet["!cols"] = [8, 24, 32, 12, 22, 28, 16, 14, 14, 14, 48, 40, ...questionColumnWidths]
      .map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(headers.length - 1)}${rows.length}` };
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!") || !sheet[address]) continue;
      if (sheet[address].t === "d") sheet[address].z = "dd/mm/yyyy hh:mm";
    }
    XLSX.utils.book_append_sheet(workbook, sheet, QUESTION_TYPE_LABELS[questionType]);
  }

  const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const safeCourseTitle = course.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/[. ]+$/g, "").trim() || "Lop-hoc";
  const fallbackFileName = safeCourseTitle.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, "-") || "Lop-hoc";
  return new Response(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fallbackFileName}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${safeCourseTitle}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}