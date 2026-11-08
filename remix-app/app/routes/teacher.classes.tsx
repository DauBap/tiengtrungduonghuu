import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { DEFAULT_ACCOUNT_PASSWORD } from "~/lib/account-credentials";
import { getClassAttendanceSummary, type ClassAttendanceStatus } from "~/lib/class-attendance";
import { Archive, CheckCircle2, Loader2, LockKeyhole, Plus, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

type ActionResult =
  | { error: string; classId?: string }
  | {
      success: true;
      kind: "created" | "enrolled";
      classId: string;
      studentName: string;
      email: string;
      initialPassword?: string;
    }
  | {
      success: true;
      kind: "password-reset";
      classId: string;
      studentId: string;
      studentName: string;
      studentIsActivated: boolean;
      studentIsActive: boolean;
      initialPassword: string;
    }
  | { success: true; kind: "evaluation-saved"; classId: string }
  | { success: true; kind: "outcome-saved"; classId: string; studentId: string; decision: PromotionDecision }
  | { success: true; kind: "completed"; classId: string };

type PromotionDecision = "PROMOTE" | "ELIGIBLE_NOT_ENROLLED" | "REPEAT";
type CompletionDraft = { score: string; comment: string; decision: PromotionDecision | "" };
type PromotionColumn = {
  decision: PromotionDecision;
  title: string;
  className: string;
};

const promotionColumns: PromotionColumn[] = [
  { decision: "PROMOTE", title: "Học lên", className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  { decision: "ELIGIBLE_NOT_ENROLLED", title: "Đủ điều kiện, chưa đăng ký", className: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  { decision: "REPEAT", title: "Không đủ học lực", className: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
];

function isPromotionDecision(value: unknown): value is PromotionDecision {
  return value === "PROMOTE" || value === "ELIGIBLE_NOT_ENROLLED" || value === "REPEAT";
}

function getPromotionDecisionLabel(decision: PromotionDecision) {
  return promotionColumns.find((column) => column.decision === decision)?.title ?? "Chưa phân loại";
}

function getSuggestedPromotionDecision(score: number, attendancePercentage: number, enrolledInHigherHsk: boolean): PromotionDecision {
  if (score < 6.5 || attendancePercentage < 80) return "REPEAT";
  return enrolledInHigherHsk ? "PROMOTE" : "ELIGIBLE_NOT_ENROLLED";
}

function parseStudentDetails(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const rawPhone = String(form.get("phone") ?? "").trim();
  if (!name || name.length > 120) {
    return { success: false as const, error: "Họ tên là bắt buộc và không được vượt quá 120 ký tự." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false as const, error: "Vui lòng nhập địa chỉ email hợp lệ." };
  }
  if (rawPhone && !/^[+\d\s().-]+$/.test(rawPhone)) {
    return { success: false as const, error: "Số điện thoại chỉ được chứa chữ số và ký tự định dạng hợp lệ." };
  }
  const phone = rawPhone ? rawPhone.replace(/\D/g, "") : null;
  if (phone && (phone.length < 9 || phone.length > 15)) {
    return { success: false as const, error: "Số điện thoại cần có từ 9 đến 15 chữ số." };
  }
  return { success: true as const, name, email, phone };
}

function getKnownRequestError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

function parseScore(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id },
    select: {
      id: true,
      name: true,
      maxStudents: true,
      completedAt: true,
      course: { select: { id: true, code: true, title: true, hskLevel: true } },
      enrollments: {
        where: { user: { is: { role: "student", deletedAt: null } } },
        orderBy: { createdAt: "asc" },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              isActive: true,
              isActivated: true,
              enrollments: {
                where: { classId: { not: null } },
                select: { course: { select: { hskLevel: true } } },
              },
            },
          },
        },
      },
      attendanceSessions: {
        select: {
          records: { select: { studentId: true, status: true } },
        },
      },
      finalResults: {
        select: {
          studentId: true,
          score: true,
          comment: true,
          attendedSessions: true,
          totalSessions: true,
          decision: true,
          student: { select: { name: true } },
        },
      },
      studentScores: { select: { studentId: true, score: true, comment: true, decision: true } },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });
  return { user, classes };
}

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  const user = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const classId = String(form.get("classId") ?? "").trim();
  if (!classId) return { error: "Vui lòng chọn lớp học." };
  if (intent === "save-completion-outcome") {
    const studentId = String(form.get("studentId") ?? "").trim();
    const decision = String(form.get("decision") ?? "");
    if (!studentId || studentId.length > 100 || !isPromotionDecision(decision)) {
      return { error: "Phân loại kết quả không hợp lệ. Hãy thử lại.", classId };
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const classroom = await tx.class.findFirst({
          where: {
            id: classId,
            teacherId: user.id,
            completedAt: null,
            enrollments: {
              some: {
                userId: studentId,
                user: { is: { role: "student", deletedAt: null } },
              },
            },
          },
          select: { id: true },
        });
        if (!classroom) {
          return { error: "Không tìm thấy học viên trong lớp đang dạy hoặc lớp đã kết thúc.", classId };
        }

        const update = await tx.classStudentScore.updateMany({
          where: { classId: classroom.id, studentId },
          data: { decision },
        });
        if (update.count !== 1) {
          return { error: "Chưa tìm thấy điểm đã lưu cho học viên. Hãy quay lại lưu đánh giá trước.", classId };
        }
        return { success: true as const, kind: "outcome-saved" as const, classId, studentId, decision };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (getKnownRequestError(error) === "P2034") {
        return { error: "Lớp vừa thay đổi. Vui lòng tải lại trang và thử lại.", classId };
      }
      throw error;
    }
  }
  if (intent === "save-completion-evaluation") {
    const rawEvaluations = String(form.get("evaluations") ?? "");
    let parsedEvaluations: unknown;
    try {
      parsedEvaluations = JSON.parse(rawEvaluations);
    } catch {
      return { error: "Bảng điểm và nhận xét không hợp lệ. Hãy kiểm tra và thử lại.", classId };
    }
    if (!Array.isArray(parsedEvaluations) || parsedEvaluations.length === 0) {
      return { error: "Lớp cần có học viên để lưu đánh giá.", classId };
    }

    const evaluations: { studentId: string; score: number; comment: string }[] = [];
    for (const value of parsedEvaluations) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: "Có đánh giá học viên không hợp lệ.", classId };
      }
      const record = value as Record<string, unknown>;
      const score = typeof record.score === "number"
        ? record.score
        : typeof record.score === "string" && record.score.trim() !== ""
          ? parseScore(record.score)
          : Number.NaN;
      const comment = typeof record.comment === "string" ? record.comment.trim() : "";
      if (
        typeof record.studentId !== "string"
        || !record.studentId
        || !Number.isFinite(score)
        || score < 0
        || score > 10
        || comment.length === 0
        || comment.length > 2000
      ) {
        return { error: "Mỗi học viên cần có điểm từ 0 đến 10 và nhận xét tối đa 2.000 ký tự.", classId };
      }
      evaluations.push({ studentId: record.studentId, score, comment });
    }
    if (new Set(evaluations.map(({ studentId }) => studentId)).size !== evaluations.length) {
      return { error: "Danh sách đánh giá có học viên bị trùng.", classId };
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const classroom = await tx.class.findFirst({
          where: { id: classId, teacherId: user.id, completedAt: null },
          select: {
            id: true,
            enrollments: {
              where: { user: { is: { role: "student", deletedAt: null } } },
              select: { userId: true },
            },
          },
        });
        if (!classroom) {
          return { error: "Không tìm thấy lớp đang dạy hoặc lớp đã kết thúc.", classId };
        }
        const enrolledIds = new Set(classroom.enrollments.map(({ userId }) => userId));
        if (
          evaluations.length !== enrolledIds.size
          || evaluations.some(({ studentId }) => !enrolledIds.has(studentId))
        ) {
          return { error: "Danh sách đánh giá không khớp với học viên hiện tại của lớp. Hãy tải lại trang.", classId };
        }

        for (const evaluation of evaluations) {
          await tx.classStudentScore.upsert({
            where: {
              classId_studentId: { classId: classroom.id, studentId: evaluation.studentId },
            },
            create: { classId: classroom.id, ...evaluation },
            update: { score: evaluation.score, comment: evaluation.comment },
          });
        }
        return { success: true as const, kind: "evaluation-saved" as const, classId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (getKnownRequestError(error) === "P2034") {
        return { error: "Lớp vừa thay đổi. Vui lòng tải lại trang và thử lại.", classId };
      }
      throw error;
    }
  }
  if (intent === "reset-student-password") {
    const studentId = String(form.get("studentId") ?? "").trim();
    if (!studentId || studentId.length > 100) {
      return { error: "Không tìm thấy học viên cần cấp lại mật khẩu.", classId };
    }
    try {
      return await prisma.$transaction(async (tx) => {
        const enrollment = await tx.enrollment.findFirst({
          where: {
            classId,
            userId: studentId,
            class: { teacherId: user.id, completedAt: null },
            user: { is: { role: "student", deletedAt: null } },
          },
          select: {
            user: { select: { id: true, name: true, isActivated: true, isActive: true } },
          },
        });
        if (!enrollment) {
          return { error: "Không tìm thấy học viên trong lớp đang dạy hoặc lớp đã kết thúc.", classId };
        }

        const update = await tx.user.updateMany({
          where: { id: enrollment.user.id, role: "student", deletedAt: null },
          data: {
            password: await bcrypt.hash(DEFAULT_ACCOUNT_PASSWORD, 10),
            mustChangePassword: true,
          },
        });
        if (update.count !== 1) {
          return { error: "Không thể cấp lại mật khẩu cho tài khoản này. Hãy tải lại trang và thử lại.", classId };
        }

        return {
          success: true as const,
          kind: "password-reset" as const,
          classId,
          studentId: enrollment.user.id,
          studentName: enrollment.user.name,
          studentIsActivated: enrollment.user.isActivated,
          studentIsActive: enrollment.user.isActive,
          initialPassword: DEFAULT_ACCOUNT_PASSWORD,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (getKnownRequestError(error) === "P2034") {
        return { error: "Lớp vừa thay đổi. Vui lòng tải lại trang và thử lại.", classId };
      }
      throw error;
    }
  }
  if (intent === "complete-class") {
    const rawResults = String(form.get("results") ?? "");
    let parsedResults: unknown;
    try {
      parsedResults = JSON.parse(rawResults);
    } catch {
      return { error: "Bảng kết quả cuối khóa không hợp lệ. Hãy kiểm tra và thử lại.", classId };
    }
    if (!Array.isArray(parsedResults) || parsedResults.length === 0) {
      return { error: "Lớp cần có học viên và kết quả cuối khóa trước khi kết thúc.", classId };
    }

    const results: { studentId: string; score: number; comment: string; decision: PromotionDecision }[] = [];
    for (const value of parsedResults) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: "Có kết quả học viên không hợp lệ.", classId };
      }
      const record = value as Record<string, unknown>;
      const score = typeof record.score === "number"
        ? record.score
        : typeof record.score === "string" && record.score.trim() !== ""
          ? parseScore(record.score)
          : Number.NaN;
      const comment = typeof record.comment === "string" ? record.comment.trim() : "";
      if (
        typeof record.studentId !== "string"
        || !record.studentId
        || !Number.isFinite(score)
        || score < 0
        || score > 10
        || comment.length === 0
        || comment.length > 2000
        || !isPromotionDecision(record.decision)
      ) {
        return { error: "Mỗi học viên cần có điểm từ 0 đến 10, nhận xét và lựa chọn kết quả.", classId };
      }
      results.push({
        studentId: record.studentId,
        score,
        comment,
        decision: record.decision,
      });
    }
    if (new Set(results.map(({ studentId }) => studentId)).size !== results.length) {
      return { error: "Danh sách kết quả có học viên bị trùng.", classId };
    }

    return prisma.$transaction(async (tx) => {
      const classroom = await tx.class.findFirst({
        where: { id: classId, teacherId: user.id, completedAt: null },
        select: {
          id: true,
          enrollments: {
            where: { user: { is: { role: "student", deletedAt: null } } },
            select: { userId: true },
          },
          attendanceSessions: {
            select: {
              records: {
                select: { studentId: true, status: true },
              },
            },
          },
        },
      });
      if (!classroom) {
        return { error: "Không tìm thấy lớp đang dạy hoặc lớp đã được kết thúc.", classId };
      }
      const enrolledIds = new Set(classroom.enrollments.map(({ userId }) => userId));
      if (
        results.length !== enrolledIds.size
        || results.some(({ studentId }) => !enrolledIds.has(studentId))
      ) {
        return { error: "Danh sách kết quả không khớp với học viên hiện tại của lớp. Hãy tải lại trang.", classId };
      }

      const attendanceByStudent = new Map<string, ClassAttendanceStatus[]>(
        classroom.enrollments.map(({ userId }) => [userId, []]),
      );
      for (const session of classroom.attendanceSessions) {
        const sessionStatusByStudent = new Map(session.records.map(({ studentId, status }) => [studentId, status]));
        for (const [studentId, statuses] of attendanceByStudent) {
          statuses.push(sessionStatusByStudent.get(studentId) ?? null);
        }
      }
      const update = await tx.class.updateMany({
        where: { id: classroom.id, teacherId: user.id, completedAt: null },
        data: { completedAt: new Date() },
      });
      if (update.count !== 1) {
        return { error: "Lớp vừa được kết thúc ở nơi khác. Hãy tải lại trang.", classId };
      }
      await tx.classFinalResult.createMany({
        data: results.map(({ studentId, score, comment, decision }) => {
          const attendance = getClassAttendanceSummary(attendanceByStudent.get(studentId) ?? []);
          return {
            classId: classroom.id,
            studentId,
            score,
            comment,
            attendedSessions: attendance.attendedSessions,
            totalSessions: attendance.totalSessions,
            decision,
          };
        }),
      });
      await tx.classStudentScore.deleteMany({ where: { classId: classroom.id } });
      return { success: true as const, kind: "completed" as const, classId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  if (intent !== "create-student" && intent !== "add-existing-student") {
    return { error: "Thao tác không hợp lệ.", classId };
  }

  try {
    return await prisma.$transaction(async (tx): Promise<ActionResult> => {
      const cls = await tx.class.findFirst({
        where: { id: classId, teacherId: user.id },
        select: { id: true, courseId: true, name: true, maxStudents: true, completedAt: true },
      });
      if (!cls) return { error: "Không tìm thấy lớp hoặc bạn không được phân công lớp này.", classId };
      if (cls.completedAt) return { error: "Lớp đã kết thúc nên không thể thêm học viên.", classId };

      const occupiedSeats = await tx.enrollment.count({
        where: {
          classId: cls.id,
          user: { is: { role: "student", deletedAt: null } },
        },
      });
      if (occupiedSeats >= cls.maxStudents) {
        return { error: "Lớp đã đủ số lượng học viên.", classId };
      }

      if (intent === "create-student") {
        const studentDetails = parseStudentDetails(form);
        if (!studentDetails.success) return { error: studentDetails.error, classId };
        const existingUser = await tx.user.findUnique({
          where: { email: studentDetails.email },
          select: { id: true, role: true, isActive: true, deletedAt: true },
        });
        if (existingUser) {
          return {
            error: existingUser.role === "student" && existingUser.isActive && !existingUser.deletedAt
              ? 'Email này đã có tài khoản. Hãy dùng mục "Thêm tài khoản có sẵn".'
              : "Email này đã được sử dụng và không thể tạo tài khoản mới. Liên hệ quản trị viên để được hỗ trợ.",
            classId,
          };
        }

        const student = await tx.user.create({
          data: {
            name: studentDetails.name,
            email: studentDetails.email,
            phone: studentDetails.phone,
            password: await bcrypt.hash(DEFAULT_ACCOUNT_PASSWORD, 10),
            role: "student",
            isActivated: false,
            mustChangePassword: true,
          },
          select: { id: true, name: true, email: true },
        });
        await tx.enrollment.create({
          data: { userId: student.id, courseId: cls.courseId, classId: cls.id },
        });
        const admins = await tx.user.findMany({
          where: { role: "admin", isActive: true, isActivated: true, deletedAt: null },
          select: { id: true },
        });
        if (admins.length > 0) {
          await tx.userNotification.createMany({
            data: admins.map((admin) => ({
              recipientId: admin.id,
              actorId: user.id,
              kind: "ACCOUNT_ACTIVATION_REQUEST",
              title: "Tài khoản mới chờ kích hoạt",
              message: `${student.name} (${student.email}) vừa được giáo viên ${user.name} thêm vào lớp ${cls.name}. Đang chờ bạn kích hoạt.`,
              targetUrl: `/admin/accounts?status=PENDING&userId=${encodeURIComponent(student.id)}`,
              entityId: student.id,
            })),
          });
        }
        return {
          success: true,
          kind: "created",
          classId,
          studentName: student.name,
          email: student.email,
          initialPassword: DEFAULT_ACCOUNT_PASSWORD,
        };
      }

      const studentId = String(form.get("studentId") ?? "").trim();
      if (!studentId || studentId.length > 100) {
        return { error: "Vui lòng tìm và chọn một học viên trong danh sách.", classId };
      }
      const student = await tx.user.findFirst({
        where: { id: studentId, role: "student", isActive: true, deletedAt: null },
        select: { id: true, name: true, email: true },
      });
      if (!student) return { error: "Tài khoản học viên không còn khả dụng. Hãy tìm lại.", classId };

      const existingEnrollment = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId: student.id, courseId: cls.courseId } },
        select: { classId: true, class: { select: { name: true } } },
      });
      if (existingEnrollment?.classId === cls.id) {
        return { error: "Học viên này đã ở trong lớp.", classId };
      }
      if (existingEnrollment) {
        return {
          error: `Học viên đã thuộc lớp "${existingEnrollment.class?.name ?? "khác trong khóa học"}". Không tự ý chuyển lớp.`,
          classId,
        };
      }

      await tx.enrollment.create({
        data: { userId: student.id, courseId: cls.courseId, classId: cls.id },
      });
      return {
        success: true,
        kind: "enrolled",
        classId,
        studentName: student.name,
        email: student.email,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const code = getKnownRequestError(error);
    if (code === "P2002") return { error: "Email hoặc đăng ký khóa học vừa được tạo ở nơi khác. Hãy tải lại và kiểm tra lớp.", classId };
    if (code === "P2034") return { error: "Lớp vừa thay đổi số lượng học viên. Vui lòng thử lại.", classId };
    throw error;
  }
}

export default function TeacherClassesPage() {
  const { user, classes } = useLoaderData<typeof loader>();
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id ?? "");
  const [classView, setClassView] = useState<"active" | "completed">("active");
  const [optimisticallyCompletedClassIds, setOptimisticallyCompletedClassIds] = useState<string[]>([]);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completionStep, setCompletionStep] = useState<"evaluation" | "outcomes">("evaluation");
  const [completionDraft, setCompletionDraft] = useState<Record<string, CompletionDraft>>({});
  const [draggedStudentId, setDraggedStudentId] = useState<string | null>(null);
  const [dragOverDecision, setDragOverDecision] = useState<PromotionDecision | null>(null);
  const [savingOutcomeStudentId, setSavingOutcomeStudentId] = useState<string | null>(null);
  const previousOutcomeRef = useRef<{ classId: string; studentId: string; decision: CompletionDraft["decision"] } | null>(null);
  const [studentToResetPassword, setStudentToResetPassword] = useState<{ id: string; name: string } | null>(null);
  const [passwordResetResult, setPasswordResetResult] = useState<Extract<ActionResult, { kind: "password-reset" }> | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "existing" | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string; email: string } | null>(null);
  const createFetcher = useFetcher<typeof action>();
  const existingFetcher = useFetcher<typeof action>();
  const evaluationFetcher = useFetcher<typeof action>();
  const outcomeFetcher = useFetcher<typeof action>();
  const completeFetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const searchFetcher = useFetcher<{ query: string; students: { id: string; name: string; email: string }[] }>();
  const optimisticallyCompletedClassIdSet = new Set(optimisticallyCompletedClassIds);
  const activeClasses = classes.filter((item) =>
    !item.completedAt && !optimisticallyCompletedClassIdSet.has(item.id)
  );
  const completedClasses = classes.filter((item) =>
    Boolean(item.completedAt) || optimisticallyCompletedClassIdSet.has(item.id)
  );
  const visibleClasses = classView === "active" ? activeClasses : completedClasses;
  const selectedClass = visibleClasses.find((item) => item.id === selectedClassId) ?? visibleClasses[0];
  const createBusy = createFetcher.state !== "idle";
  const existingBusy = existingFetcher.state !== "idle";
  const isCompleting = completeFetcher.state !== "idle";
  const isSavingEvaluation = evaluationFetcher.state !== "idle";
  const isSavingOutcome = outcomeFetcher.state !== "idle";
  const isResettingPassword = passwordResetFetcher.state !== "idle";
  const provisionalScoreByStudent = new Map(
    (selectedClass?.studentScores ?? []).map((score) => [score.studentId, score]),
  );
  const normalizedStudentQuery = studentQuery.trim();
  const searchResults = searchFetcher.data?.query === normalizedStudentQuery
    ? searchFetcher.data.students
    : [];
  const isSearching = normalizedStudentQuery.length >= 2
    && (searchFetcher.state !== "idle" || searchedQuery !== normalizedStudentQuery);
  const createError = modalMode === "create" && createFetcher.data && "error" in createFetcher.data
    ? createFetcher.data.error
    : null;
  const existingError = modalMode === "existing" && existingFetcher.data && "error" in existingFetcher.data
    ? existingFetcher.data.error
    : null;
  const createdAccount = createFetcher.data
    && "success" in createFetcher.data
    && createFetcher.data.success
    && createFetcher.data.kind === "created"
    && "studentName" in createFetcher.data
    && createFetcher.data.classId === selectedClass?.id
    ? createFetcher.data
    : null;

  useEffect(() => {
    if (modalMode === "existing" && existingFetcher.state === "idle"
      && existingFetcher.data && "success" in existingFetcher.data && existingFetcher.data.success
      && "studentName" in existingFetcher.data) {
      toast.success(`Đã thêm ${existingFetcher.data.studentName} vào lớp.`);
      existingFetcher.reset();
      setModalMode(null);
    }
  }, [modalMode, existingFetcher.state, existingFetcher.data]);

  useEffect(() => {
    const result = completeFetcher.data;
    if (!result || !("kind" in result) || result.kind !== "completed") {
      if (result && "error" in result) toast.error(result.error);
      return;
    }
    toast.success("Đã chuyển lớp sang danh sách lớp học đã kết thúc.");
    setOptimisticallyCompletedClassIds((current) =>
      current.includes(result.classId) ? current : [...current, result.classId]
    );
    setShowCompleteDialog(false);
    setClassView("completed");
    setSelectedClassId(result.classId);
    completeFetcher.reset();
  }, [completeFetcher.data]);

  useEffect(() => {
    const result = evaluationFetcher.data;
    if (evaluationFetcher.state !== "idle" || !result || "error" in result) return;
    if (result.kind === "evaluation-saved" && result.classId === selectedClass?.id) {
      setCompletionStep("outcomes");
      evaluationFetcher.reset();
    }
  }, [evaluationFetcher.data, evaluationFetcher.state, selectedClass?.id]);

  useEffect(() => {
    const result = outcomeFetcher.data;
    if (outcomeFetcher.state !== "idle" || !result) return;
    if ("error" in result) {
      const previous = previousOutcomeRef.current;
      if (previous && previous.classId === selectedClass?.id) {
        setCompletionDraft((current) => ({
          ...current,
          [previous.studentId]: {
            ...(current[previous.studentId] ?? { score: "", comment: "", decision: "" }),
            decision: previous.decision,
          },
        }));
      }
      previousOutcomeRef.current = null;
      setSavingOutcomeStudentId(null);
      return;
    }
    if (result.kind === "outcome-saved") {
      previousOutcomeRef.current = null;
      setSavingOutcomeStudentId(null);
    }
  }, [outcomeFetcher.data, outcomeFetcher.state, selectedClass?.id]);

  useEffect(() => {
    const result = passwordResetFetcher.data;
    if (passwordResetFetcher.state !== "idle" || !result || "error" in result) return;
    if (result.kind === "password-reset") {
      setPasswordResetResult(result);
      setStudentToResetPassword(null);
    }
  }, [passwordResetFetcher.data, passwordResetFetcher.state]);

  useEffect(() => {
    if (!showCompleteDialog || isCompleting || isSavingEvaluation || isSavingOutcome) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCompleteDialog(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showCompleteDialog, isCompleting, isSavingEvaluation, isSavingOutcome]);

  useEffect(() => {
    const query = normalizedStudentQuery;
    if (modalMode !== "existing" || !selectedClass || query.length < 2) {
      searchFetcher.reset();
      return;
    }

    const timeout = window.setTimeout(() => {
      setSearchedQuery(query);
      const params = new URLSearchParams({ classId: selectedClass.id, q: query });
      searchFetcher.load(`/teacher/classes/search?${params.toString()}`);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [modalMode, selectedClassId, normalizedStudentQuery]);

  const openModal = (mode: "create" | "existing") => {
    createFetcher.reset();
    existingFetcher.reset();
    searchFetcher.reset();
    setStudentQuery("");
    setSearchedQuery("");
    setSelectedStudent(null);
    setModalMode(mode);
  };
  const closeModal = () => {
    createFetcher.reset();
    existingFetcher.reset();
    searchFetcher.reset();
    setStudentToResetPassword(null);
    setPasswordResetResult(null);
    setStudentQuery("");
    setSearchedQuery("");
    setSelectedStudent(null);
    setModalMode(null);
  };
  const changeClassView = (view: "active" | "completed") => {
    const nextClasses = view === "active" ? activeClasses : completedClasses;
    setClassView(view);
    setSelectedClassId(nextClasses[0]?.id ?? "");
    closeModal();
  };
  const completeSelectedClass = () => {
    if (!selectedClass) return;
    evaluationFetcher.reset();
    outcomeFetcher.reset();
    completeFetcher.reset();
    previousOutcomeRef.current = null;
    setCompletionDraft(Object.fromEntries(selectedClass.enrollments.map(({ user: student }) => {
      const savedEvaluation = provisionalScoreByStudent.get(student.id);
      const attendance = getClassAttendanceSummary(
        selectedClass.attendanceSessions.map((session) =>
          session.records.find((record) => record.studentId === student.id)?.status ?? null
        ),
      );
      const suggestedDecision = getSuggestedPromotionDecision(
        savedEvaluation?.score ?? Number.NEGATIVE_INFINITY,
        attendance.percentage,
        student.enrollments.some(({ course }) => course.hskLevel > selectedClass.course.hskLevel),
      );
      return [
        student.id,
        {
          score: String(savedEvaluation?.score ?? ""),
          comment: savedEvaluation?.comment ?? "",
          decision: isPromotionDecision(savedEvaluation?.decision) ? savedEvaluation.decision : suggestedDecision,
        },
      ];
    })));
    setCompletionStep("evaluation");
    setShowCompleteDialog(true);
  };
  const moveStudentToOutcome = (studentId: string, decision: PromotionDecision) => {
    if (!selectedClass || isSavingOutcome) return;
    const currentDecision = completionDraft[studentId]?.decision ?? "";
    if (currentDecision === decision) return;
    previousOutcomeRef.current = { classId: selectedClass.id, studentId, decision: currentDecision };
    setSavingOutcomeStudentId(studentId);
    setCompletionDraft((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] ?? { score: "", comment: "", decision: "" }),
        decision,
      },
    }));
    outcomeFetcher.reset();
    outcomeFetcher.submit(
      {
        intent: "save-completion-outcome",
        classId: selectedClass.id,
        studentId,
        decision,
      },
      { method: "post" },
    );
  };
  const saveCompletionEvaluation = () => {
    if (!selectedClass || !completionEvaluationIsReady) return;
    const updatedDraft = { ...completionDraft };
    for (const { user: student } of selectedClass.enrollments) {
      const savedDecision = provisionalScoreByStudent.get(student.id)?.decision;
      if (isPromotionDecision(savedDecision)) continue;
      const attendance = getClassAttendanceSummary(
        selectedClass.attendanceSessions.map((session) =>
          session.records.find((record) => record.studentId === student.id)?.status ?? null
        ),
      );
      updatedDraft[student.id] = {
        ...updatedDraft[student.id],
        decision: getSuggestedPromotionDecision(
          parseScore(updatedDraft[student.id]?.score ?? ""),
          attendance.percentage,
          student.enrollments.some(({ course }) => course.hskLevel > selectedClass.course.hskLevel),
        ),
      };
    }
    setCompletionDraft(updatedDraft);
    evaluationFetcher.submit(
      {
        intent: "save-completion-evaluation",
        classId: selectedClass.id,
        evaluations: JSON.stringify(selectedClass.enrollments.map(({ user: student }) => ({
          studentId: student.id,
          score: parseScore(updatedDraft[student.id]?.score ?? ""),
          comment: updatedDraft[student.id]?.comment ?? "",
        }))),
      },
      { method: "post" },
    );
  };
  const confirmCompleteClass = () => {
    if (!selectedClass) return;
    completeFetcher.submit(
      {
        intent: "complete-class",
        classId: selectedClass.id,
        results: JSON.stringify(selectedClass.enrollments.map(({ user: student }) => ({
          studentId: student.id,
          score: parseScore(completionDraft[student.id]?.score ?? ""),
          comment: completionDraft[student.id]?.comment,
          decision: completionDraft[student.id]?.decision,
        }))),
      },
      { method: "post" },
    );
  };
  const completionEvaluationIsReady = Boolean(selectedClass?.enrollments.length)
    && selectedClass.enrollments.every(({ user: student }) => {
      const result = completionDraft[student.id];
      const score = parseScore(result?.score ?? "");
      return result
        && result.score.trim() !== ""
        && Number.isFinite(score)
        && score >= 0
        && score <= 10
        && result.comment.trim().length > 0
        && result.comment.length <= 2000;
    });
  const completionIsReady = completionEvaluationIsReady
    && Boolean(selectedClass?.enrollments.every(({ user: student }) => {
      const decision = completionDraft[student.id]?.decision;
      return isPromotionDecision(decision);
    }));

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Lớp học</h1>
          <p className="text-sm text-muted-foreground">Tạo tài khoản học viên mới hoặc thêm tài khoản đã có vào lớp bạn phụ trách.</p>
        </header>

        {studentToResetPassword && selectedClass && classView === "active" && (
          <Overlay onClose={() => setStudentToResetPassword(null)} className="max-w-md">
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="reset-student-password-title"
              aria-describedby="reset-student-password-description"
              className="space-y-5"
            >
              <header className="space-y-1">
                <h2 id="reset-student-password-title" className="text-lg font-semibold">Cấp lại mật khẩu?</h2>
                <p id="reset-student-password-description" className="text-sm text-muted-foreground">
                  Mật khẩu của {studentToResetPassword.name} sẽ được đặt lại và các phiên đăng nhập hiện tại sẽ kết thúc. Học viên cần đổi mật khẩu ở lần đăng nhập tiếp theo.
                </p>
              </header>
              {passwordResetFetcher.data && "error" in passwordResetFetcher.data && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {passwordResetFetcher.data.error}
                </p>
              )}
              <passwordResetFetcher.Form method="post" className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <input type="hidden" name="intent" value="reset-student-password" />
                <input type="hidden" name="classId" value={selectedClass.id} />
                <input type="hidden" name="studentId" value={studentToResetPassword.id} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStudentToResetPassword(null)}
                  disabled={isResettingPassword}
                  className="w-full sm:w-auto"
                >
                  Hủy
                </Button>
                <Button type="submit" disabled={isResettingPassword} className="w-full sm:w-auto">
                  {isResettingPassword && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {isResettingPassword ? "Đang cấp lại..." : "Cấp lại mật khẩu"}
                </Button>
              </passwordResetFetcher.Form>
            </section>
          </Overlay>
        )}

        {passwordResetResult && (
          <Overlay onClose={() => setPasswordResetResult(null)} className="max-w-md">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-student-password-result-title"
              className="space-y-5"
            >
              <header className="space-y-1">
                <h2 id="reset-student-password-result-title" className="text-lg font-semibold">Đã cấp lại mật khẩu</h2>
                <p className="text-sm text-muted-foreground">{passwordResetResult.studentName}</p>
              </header>
              <div role="status" className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                <p>
                  <span className="font-medium">Mật khẩu tạm thời: </span>
                  <strong className="select-all font-mono tabular-nums">{passwordResetResult.initialPassword}</strong>
                </p>
                <p className="text-xs">
                  {!passwordResetResult.studentIsActivated
                    ? "Tài khoản chưa được kích hoạt; học viên chỉ đăng nhập được sau khi quản trị viên kích hoạt."
                    : !passwordResetResult.studentIsActive
                      ? "Tài khoản đang bị khóa; quản trị viên cần mở khóa trước khi học viên có thể đăng nhập."
                      : "Học viên sẽ cần đổi mật khẩu sau khi đăng nhập."}
                </p>
              </div>
              <div className="flex justify-end border-t pt-4">
                <Button type="button" onClick={() => setPasswordResetResult(null)} className="w-full sm:w-auto">
                  Đóng
                </Button>
              </div>
            </section>
          </Overlay>
        )}

        {showCompleteDialog && selectedClass && (
          <Overlay onClose={() => setShowCompleteDialog(false)} className="max-w-6xl">
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="complete-class-title"
              aria-describedby="complete-class-description"
              className="space-y-5"
            >
              {completionStep === "evaluation" ? (
                <>
                  <header className="space-y-1">
                    <h2 id="complete-class-title" className="text-xl font-semibold">Đánh giá cuối khóa · {selectedClass.name}</h2>
                    <p id="complete-class-description" className="text-sm text-muted-foreground">
                      Nhập điểm từ 0 đến 10 và nhận xét cho từng học viên. Chuyên cần được tính tự động; đi muộn vẫn tính là có mặt.
                    </p>
                  </header>
                  {evaluationFetcher.data && "error" in evaluationFetcher.data && (
                    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {evaluationFetcher.data.error}
                    </p>
                  )}
                  {selectedClass.enrollments.length === 0 ? (
                    <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      Lớp chưa có học viên để đánh giá.
                    </p>
                  ) : (
                    <div className="max-h-[55vh] overflow-auto rounded-lg border">
                      <table className="w-full min-w-[760px] border-collapse text-left">
                        <caption className="sr-only">Điểm cuối khóa, chuyên cần và nhận xét từng học viên</caption>
                        <thead className="sticky top-0 bg-muted">
                          <tr className="border-b">
                            <th scope="col" className="px-3 py-3 text-xs font-semibold text-muted-foreground">Học viên</th>
                            <th scope="col" className="w-36 px-3 py-3 text-xs font-semibold text-muted-foreground">Điểm cuối khóa</th>
                            <th scope="col" className="w-36 px-3 py-3 text-xs font-semibold text-muted-foreground">Chuyên cần</th>
                            <th scope="col" className="min-w-[280px] px-3 py-3 text-xs font-semibold text-muted-foreground">Nhận xét</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedClass.enrollments.map(({ user: student }) => {
                            const attendanceSummary = getClassAttendanceSummary(
                              selectedClass.attendanceSessions.map((session) =>
                                session.records.find((record) => record.studentId === student.id)?.status ?? null
                              ),
                            );
                            const draft = completionDraft[student.id] ?? { score: "", comment: "", decision: "" };
                            return (
                              <tr key={student.id}>
                                <th scope="row" className="px-3 py-3 text-sm font-medium">{student.name}</th>
                                <td className="px-3 py-3">
                                  <input
                                    aria-label={`Điểm cuối khóa của ${student.name}`}
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0–10"
                                    value={draft.score}
                                    onChange={(event) => {
                                      const score = event.currentTarget.value;
                                      setCompletionDraft((current) => ({
                                        ...current,
                                        [student.id]: {
                                          ...(current[student.id] ?? draft),
                                          score,
                                        },
                                      }));
                                    }}
                                    disabled={isCompleting}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  />
                                </td>
                                <td className="px-3 py-3 text-sm tabular-nums">
                                  <span className="font-medium">{attendanceSummary.percentage}%</span>
                                  <span className="block text-xs text-muted-foreground">{attendanceSummary.attendedSessions}/{attendanceSummary.totalSessions} buổi</span>
                                </td>
                                <td className="px-3 py-3">
                                  <textarea
                                    aria-label={`Nhận xét cuối khóa cho ${student.name}`}
                                    value={draft.comment}
                                    onChange={(event) => {
                                      const comment = event.currentTarget.value;
                                      setCompletionDraft((current) => ({
                                        ...current,
                                        [student.id]: {
                                          ...(current[student.id] ?? draft),
                                          comment,
                                        },
                                      }));
                                    }}
                                    maxLength={2000}
                                    rows={2}
                                    disabled={isCompleting}
                                    className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCompleteDialog(false)}
                      disabled={isSavingEvaluation}
                      className="w-full sm:w-auto"
                    >
                      Để sau
                    </Button>
                    <Button
                      type="button"
                      onClick={saveCompletionEvaluation}
                      disabled={isSavingEvaluation || !completionEvaluationIsReady}
                      className="w-full sm:w-auto"
                    >
                      {isSavingEvaluation && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
                      {isSavingEvaluation ? "Đang lưu đánh giá..." : "Tiếp tục chọn kết quả"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <header className="space-y-1">
                    <h2 id="complete-class-title" className="text-xl font-semibold">Kết quả cuối khóa · {selectedClass.name}</h2>
                    <p id="complete-class-description" className="text-sm text-muted-foreground">
                      Gợi ý theo điểm từ 6,5 và chuyên cần từ 80%; có thể kéo học viên sang nhóm khác. Lựa chọn được lưu ngay.
                    </p>
                  </header>
                  {completeFetcher.data && "error" in completeFetcher.data && (
                    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {completeFetcher.data.error}
                    </p>
                  )}
                  {outcomeFetcher.data && "error" in outcomeFetcher.data && (
                    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {outcomeFetcher.data.error}
                    </p>
                  )}
                  <div className="grid gap-3 md:grid-cols-3">
                    {promotionColumns.map((column) => {
                      const students = selectedClass.enrollments.filter(({ user: student }) =>
                        completionDraft[student.id]?.decision === column.decision
                      );
                      const isDropTarget = dragOverDecision === column.decision;
                      return (
                        <section
                          key={column.decision}
                          aria-labelledby={`promotion-column-${column.decision}`}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (!isSavingOutcome) setDragOverDecision(column.decision);
                          }}
                          onDragLeave={(event) => {
                            if (event.currentTarget === event.target) setDragOverDecision(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const studentId = event.dataTransfer.getData("text/plain");
                            if (studentId) moveStudentToOutcome(studentId, column.decision);
                            setDraggedStudentId(null);
                            setDragOverDecision(null);
                          }}
                          className={`flex min-h-64 flex-col overflow-hidden rounded-lg border transition-colors ${isDropTarget ? "border-primary bg-primary/5" : "border-border bg-background"}`}
                        >
                          <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                            <h3 id={`promotion-column-${column.decision}`} className={`rounded-full px-2 py-1 text-xs font-medium ${column.className}`}>
                              {column.title}
                            </h3>
                            <span className="text-sm font-semibold tabular-nums" aria-label={`${students.length} học viên`}>
                              {students.length}
                            </span>
                          </header>
                          <ul className="max-h-[42vh] min-h-44 flex-1 space-y-2 overflow-y-auto p-2" aria-label={column.title}>
                            {students.map(({ user: student }) => {
                              const draft = completionDraft[student.id] ?? { score: "", comment: "", decision: "" };
                              const attendance = getClassAttendanceSummary(
                                selectedClass.attendanceSessions.map((session) =>
                                  session.records.find((record) => record.studentId === student.id)?.status ?? null
                                ),
                              );
                              return (
                                <li
                                  key={student.id}
                                  draggable={!isSavingOutcome}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData("text/plain", student.id);
                                    setDraggedStudentId(student.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedStudentId(null);
                                    setDragOverDecision(null);
                                  }}
                                  className={`rounded-md border bg-card p-3 shadow-sm ${draggedStudentId === student.id ? "opacity-50" : ""} ${isSavingOutcome ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="min-w-0 break-words text-sm font-medium">{student.name}</p>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                      {isSavingOutcome && savingOutcomeStudentId === student.id && <Loader2 aria-label="Đang lưu" className="h-4 w-4 animate-spin" />}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Điểm {draft.score || "—"} · Chuyên cần {attendance.percentage}%
                                  </p>
                                </li>
                              );
                            })}
                            {students.length === 0 && (
                              <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                                Chưa có học viên
                              </li>
                            )}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                  <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCompleteDialog(false)}
                      disabled={isCompleting}
                      className="w-full sm:w-auto"
                    >
                      Để sau
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        completeFetcher.reset();
                        setCompletionStep("evaluation");
                      }}
                      disabled={isCompleting || isSavingOutcome}
                      className="w-full sm:w-auto"
                    >
                      Quay lại
                    </Button>
                    <Button
                      type="button"
                      onClick={confirmCompleteClass}
                      disabled={isCompleting || isSavingOutcome || !completionIsReady}
                      className="w-full sm:w-auto"
                    >
                      {isCompleting && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
                      {isCompleting ? "Đang lưu kết quả..." : "Lưu kết quả và kết thúc khóa"}
                    </Button>
                  </div>
                </>
              )}
            </section>
          </Overlay>
        )}

        {classes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <div>
                <h2 className="font-semibold">Bạn chưa được phân công lớp</h2>
                <p className="mt-1 text-sm text-muted-foreground">Liên hệ quản trị viên để được thêm vào lớp học.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b" role="tablist" aria-label="Trạng thái lớp học">
              <button
                type="button"
                role="tab"
                aria-selected={classView === "active"}
                onClick={() => changeClassView("active")}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${classView === "active" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                Lớp đang dạy <span className="tabular-nums">{activeClasses.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={classView === "completed"}
                onClick={() => changeClassView("completed")}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${classView === "completed" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                Lớp học đã kết thúc <span className="tabular-nums">{completedClasses.length}</span>
              </button>
            </div>
            {visibleClasses.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  {classView === "completed" ? <Archive className="h-8 w-8 text-muted-foreground" /> : <Users className="h-8 w-8 text-muted-foreground" />}
                  <div>
                    <h2 className="font-semibold">{classView === "completed" ? "Chưa có lớp học đã kết thúc" : "Bạn chưa được phân công lớp đang dạy"}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {classView === "completed" ? "Các lớp bạn hoàn thành sẽ được lưu tại đây." : "Liên hệ quản trị viên để được thêm vào lớp học."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
              <section className="space-y-2">
                <Label htmlFor="class-select">Chọn lớp</Label>
                <select
                  id="class-select"
                  value={selectedClassId}
                  onChange={(event) => {
                    setSelectedClassId(event.target.value);
                    closeModal();
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {visibleClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name} · {cls.course.code}</option>
                  ))}
                </select>
                {selectedClass && (
                  <p className="text-xs text-muted-foreground">
                    HSK {selectedClass.course.hskLevel} · {selectedClass.course.title}
                  </p>
                )}
              </section>

              {selectedClass && classView === "active" && (
                <section className="flex flex-col justify-end gap-3 sm:flex-row">
                  <Button type="button" variant="outline" onClick={completeSelectedClass} disabled={isCompleting} className="w-full sm:w-auto">
                    <CheckCircle2 className="mr-2 h-4 w-4" />{isCompleting ? "Đang lưu kết quả..." : "Kết thúc khóa học"}
                  </Button>
                </section>
              )}
              {selectedClass && classView === "completed" && (
                <div className="space-y-3 lg:col-span-2">
                  <p className="text-sm text-muted-foreground">
                    Học sinh vẫn có thể truy cập khóa học và tiếp tục làm bài.
                  </p>
                  <section aria-labelledby="final-results-heading" className="overflow-hidden rounded-lg border">
                    <div className="border-b px-4 py-3">
                      <h2 id="final-results-heading" className="text-sm font-semibold">Kết quả cuối khóa</h2>
                    </div>
                    {selectedClass.finalResults.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-muted-foreground">
                        Lớp này được kết thúc trước khi có bảng đánh giá cuối khóa.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] border-collapse text-left">
                          <thead className="bg-muted/50">
                            <tr className="border-b">
                              <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                              <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Điểm</th>
                              <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Chuyên cần</th>
                              <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Kết quả</th>
                              <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Nhận xét</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {selectedClass.finalResults.map((result) => {
                              return (
                                <tr key={result.studentId}>
                                  <th scope="row" className="px-4 py-3 text-sm font-medium">{result.student.name}</th>
                                  <td className="px-4 py-3 text-sm tabular-nums">{result.score}/10</td>
                                  <td className="px-4 py-3 text-sm tabular-nums">
                                    {result.totalSessions > 0
                                      ? `${Math.round((result.attendedSessions / result.totalSessions) * 100)}%`
                                      : "0%"}
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      ({result.attendedSessions}/{result.totalSessions})
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm">{getPromotionDecisionLabel(result.decision)}</td>
                                  <td className="max-w-sm whitespace-pre-wrap px-4 py-3 text-sm text-muted-foreground">{result.comment}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
            )}

            {classView === "active" && selectedClass && selectedClass.enrollments.length >= selectedClass.maxStudents && (
              <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Lớp đã đủ {selectedClass.maxStudents} học viên. Liên hệ quản trị viên nếu cần tăng sĩ số.
              </p>
            )}

            {classView === "active" && modalMode === "create" && selectedClass && (
              <Overlay onClose={closeModal} className="max-w-xl">
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h2 className="text-xl font-semibold tracking-tight">
                        {createdAccount ? "Tài khoản đã được tạo" : "Tạo tài khoản học viên"}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {createdAccount
                          ? `Đã thêm ${createdAccount.studentName} vào lớp ${selectedClass.name}.`
                          : `Tài khoản mới sẽ được thêm vào lớp ${selectedClass.name}.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={createBusy}
                      aria-label="Đóng"
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {createdAccount ? (
                    <>
                      <div role="status" className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                        <p><span className="font-medium">Học viên:</span> {createdAccount.studentName}</p>
                        <p><span className="font-medium">Email:</span> {createdAccount.email}</p>
                        <p><span className="font-medium">Mật khẩu mặc định:</span> <strong className="tabular-nums">{createdAccount.initialPassword}</strong></p>
                        <p className="pt-1 text-xs">Tài khoản đang chờ quản trị viên xác nhận kích hoạt. Học viên chưa thể đăng nhập; sau khi được kích hoạt, học viên cần đổi mật khẩu ở lần đăng nhập đầu tiên.</p>
                      </div>
                      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                        <Button type="button" onClick={closeModal} className="w-full sm:w-auto">Đóng</Button>
                      </div>
                    </>
                  ) : (
                  <createFetcher.Form method="post" className="space-y-4">
                    <input type="hidden" name="intent" value="create-student" />
                    <input type="hidden" name="classId" value={selectedClass.id} />
                    {createError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{createError}</p>}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="new-student-name">Họ tên</Label>
                        <Input id="new-student-name" name="name" autoComplete="name" maxLength={120} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-student-email">Email đăng nhập</Label>
                        <Input id="new-student-email" name="email" type="email" autoComplete="email" maxLength={254} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-student-phone">Số điện thoại (không bắt buộc)</Label>
                        <Input id="new-student-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
                      </div>
                    </div>
                    <div className="rounded-md border bg-muted/40 px-3.5 py-3 text-sm">
                      Mật khẩu mặc định: <strong className="tabular-nums">{DEFAULT_ACCOUNT_PASSWORD}</strong>
                      <p className="mt-1 text-xs text-muted-foreground">Tài khoản cần quản trị viên xác nhận kích hoạt trước khi học viên có thể đăng nhập.</p>
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                      <Button type="button" variant="outline" onClick={closeModal} disabled={createBusy} className="w-full sm:w-auto">
                        Hủy
                      </Button>
                      <Button type="submit" disabled={createBusy} className="w-full sm:w-auto">
                        {createBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Tạo tài khoản
                      </Button>
                    </div>
                  </createFetcher.Form>
                  )}
                </div>
              </Overlay>
            )}

            {classView === "active" && modalMode === "existing" && selectedClass && (
              <Overlay onClose={closeModal} className="max-w-xl">
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h2 className="text-xl font-semibold tracking-tight">Thêm học viên đã có tài khoản</h2>
                      <p className="text-sm text-muted-foreground">
                        Tìm theo tên hoặc email để thêm học viên vào lớp {selectedClass.name}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={existingBusy}
                      aria-label="Đóng"
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <existingFetcher.Form method="post" className="space-y-4">
                    <input type="hidden" name="intent" value="add-existing-student" />
                    <input type="hidden" name="classId" value={selectedClass.id} />
                    <input type="hidden" name="studentId" value={selectedStudent?.id ?? ""} />
                    {existingError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{existingError}</p>}
                    <div className="max-w-md space-y-2">
                      <Label htmlFor="existing-student-search">Tìm học viên theo tên hoặc email</Label>
                      <div className="relative">
                        <Input
                          id="existing-student-search"
                          type="text"
                          autoComplete="off"
                          value={studentQuery}
                          onChange={(event) => {
                            setStudentQuery(event.target.value);
                            setSearchedQuery("");
                            setSelectedStudent(null);
                            existingFetcher.reset();
                          }}
                          placeholder="Nhập ít nhất 2 ký tự..."
                          aria-controls="existing-student-results"
                          aria-expanded={studentQuery.trim().length >= 2}
                          className="pr-10"
                        />
                        {studentQuery && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Xóa nội dung tìm kiếm"
                            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                            onClick={() => {
                              setStudentQuery("");
                              setSearchedQuery("");
                              setSelectedStudent(null);
                              existingFetcher.reset();
                            }}
                          >
                            <X aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div id="existing-student-results" className="max-w-md" aria-live="polite">
                      {normalizedStudentQuery.length < 2 ? null : isSearching ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />Đang tìm học viên...
                        </p>
                      ) : searchResults.length > 0 ? (
                        <ul role="listbox" aria-label="Kết quả tìm học viên" className="max-h-52 divide-y overflow-y-auto rounded-md border">
                          {searchResults.map((student) => {
                            const isSelected = selectedStudent?.id === student.id;
                            return (
                              <li key={student.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    setSelectedStudent(student);
                                    existingFetcher.reset();
                                  }}
                                  className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isSelected ? "bg-primary/10" : ""}`}
                                >
                                  <span className="block text-sm font-medium">{student.name}</span>
                                  <span className="block break-all text-xs text-muted-foreground">{student.email}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">Không tìm thấy học viên phù hợp.</p>
                      )}
                    </div>
                    {selectedStudent && (
                      <p className="text-sm text-muted-foreground">
                        Đã chọn: <span className="font-medium text-foreground">{selectedStudent.name}</span> · {selectedStudent.email}
                      </p>
                    )}
                    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                      <Button type="button" variant="outline" onClick={closeModal} disabled={existingBusy} className="w-full sm:w-auto">
                        Hủy
                      </Button>
                      <Button type="submit" disabled={existingBusy || !selectedStudent} className="w-full sm:w-auto">
                        {existingBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Thêm học viên vào lớp
                      </Button>
                    </div>
                  </existingFetcher.Form>
                </div>
              </Overlay>
            )}

            {selectedClass && (
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="h-4 w-4" />Học viên trong lớp
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedClass.enrollments.length}/{selectedClass.maxStudents} chỗ · {selectedClass.course.title}
                    </p>
                  </div>
                  {classView === "active" && (
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openModal("existing")}
                        disabled={selectedClass.enrollments.length >= selectedClass.maxStudents}
                        className="flex-1 sm:flex-none"
                      >
                        <UserPlus className="mr-2 h-4 w-4" />Thêm tài khoản có sẵn
                      </Button>
                      <Button
                        type="button"
                        onClick={() => openModal("create")}
                        disabled={selectedClass.enrollments.length >= selectedClass.maxStudents}
                        className="flex-1 sm:flex-none"
                      >
                        <Plus className="mr-2 h-4 w-4" />Tạo tài khoản học viên
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {selectedClass.enrollments.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                      Lớp chưa có học viên. Tạo tài khoản mới hoặc thêm tài khoản có sẵn.
                    </p>
                  ) : (
                    <>
                      <ul className="divide-y rounded-md border">
                        {selectedClass.enrollments.map(({ user: student }) => {
                          return (
                            <li key={student.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{student.name}</p>
                                <p className="break-all text-xs text-muted-foreground">{student.email}</p>
                              </div>
                              <div className="flex w-full items-center gap-2 sm:w-auto">
                                {classView === "active" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      passwordResetFetcher.reset();
                                      setPasswordResetResult(null);
                                      setStudentToResetPassword({ id: student.id, name: student.name });
                                    }}
                                    disabled={isResettingPassword || isCompleting}
                                    className="flex-1 sm:flex-none"
                                  >
                                    <LockKeyhole className="mr-1.5 h-4 w-4" />
                                    Cấp lại mật khẩu
                                  </Button>
                                )}
                                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${!student.isActivated ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : student.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>
                                  {!student.isActivated ? "Chưa kích hoạt" : student.isActive ? "Đang học" : "Đã khóa"}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
