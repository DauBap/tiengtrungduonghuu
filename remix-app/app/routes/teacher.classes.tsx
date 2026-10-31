import { useEffect, useState } from "react";
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
import { Loader2, Plus, UserPlus, Users, X } from "lucide-react";
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
    };

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

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const classes = await prisma.class.findMany({
    where: { teacherId: user.id },
    select: {
      id: true,
      name: true,
      maxStudents: true,
      course: { select: { id: true, code: true, title: true, hskLevel: true } },
      enrollments: {
        where: { user: { is: { role: "student", deletedAt: null } } },
        orderBy: { createdAt: "asc" },
        select: {
          user: { select: { id: true, name: true, email: true, phone: true, isActive: true, isActivated: true } },
        },
      },
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
  if (intent !== "create-student" && intent !== "add-existing-student") {
    return { error: "Thao tác không hợp lệ.", classId };
  }

  try {
    return await prisma.$transaction(async (tx): Promise<ActionResult> => {
      const cls = await tx.class.findFirst({
        where: { id: classId, teacherId: user.id },
        select: { id: true, courseId: true, maxStudents: true },
      });
      if (!cls) return { error: "Không tìm thấy lớp hoặc bạn không được phân công lớp này.", classId };

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
  const [modalMode, setModalMode] = useState<"create" | "existing" | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string; email: string } | null>(null);
  const createFetcher = useFetcher<typeof action>();
  const existingFetcher = useFetcher<typeof action>();
  const searchFetcher = useFetcher<{ query: string; students: { id: string; name: string; email: string }[] }>();
  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const createBusy = createFetcher.state !== "idle";
  const existingBusy = existingFetcher.state !== "idle";
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
    && createFetcher.data.classId === selectedClass?.id
    ? createFetcher.data
    : null;

  useEffect(() => {
    if (modalMode === "existing" && existingFetcher.state === "idle"
      && existingFetcher.data && "success" in existingFetcher.data && existingFetcher.data.success) {
      toast.success(`Đã thêm ${existingFetcher.data.studentName} vào lớp.`);
      existingFetcher.reset();
      setModalMode(null);
    }
  }, [modalMode, existingFetcher.state, existingFetcher.data]);

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
    setStudentQuery("");
    setSearchedQuery("");
    setSelectedStudent(null);
    setModalMode(null);
  };

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Lớp học</h1>
          <p className="text-sm text-muted-foreground">Tạo tài khoản học viên mới hoặc thêm tài khoản đã có vào lớp bạn phụ trách.</p>
        </header>

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
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name} · {cls.course.code}</option>
                  ))}
                </select>
                {selectedClass && (
                  <p className="text-xs text-muted-foreground">
                    HSK {selectedClass.course.hskLevel} · {selectedClass.course.title}
                  </p>
                )}
              </section>

              {selectedClass && (
                <section className="flex flex-col justify-end gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openModal("existing")}
                    disabled={selectedClass.enrollments.length >= selectedClass.maxStudents}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />Thêm tài khoản có sẵn
                  </Button>
                  <Button
                    type="button"
                    onClick={() => openModal("create")}
                    disabled={selectedClass.enrollments.length >= selectedClass.maxStudents}
                  >
                    <Plus className="mr-2 h-4 w-4" />Tạo tài khoản học viên
                  </Button>
                </section>
              )}
            </div>

            {selectedClass && selectedClass.enrollments.length >= selectedClass.maxStudents && (
              <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Lớp đã đủ {selectedClass.maxStudents} học viên. Liên hệ quản trị viên nếu cần tăng sĩ số.
              </p>
            )}

            {modalMode === "create" && selectedClass && (
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
                        <p><span className="font-medium">Mật khẩu ban đầu:</span> <strong className="tabular-nums">{createdAccount.initialPassword}</strong></p>
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
                      Mật khẩu ban đầu: <strong className="tabular-nums">{DEFAULT_ACCOUNT_PASSWORD}</strong>
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

            {modalMode === "existing" && selectedClass && (
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
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="h-4 w-4" />Học viên trong lớp
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedClass.enrollments.length}/{selectedClass.maxStudents} chỗ · {selectedClass.course.title}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedClass.enrollments.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                      Lớp chưa có học viên. Tạo tài khoản mới hoặc thêm tài khoản có sẵn.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {selectedClass.enrollments.map(({ user: student }) => (
                        <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{student.name}</p>
                            <p className="break-all text-xs text-muted-foreground">{student.email}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${!student.isActivated ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : student.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>
                            {!student.isActivated ? "Chưa kích hoạt" : student.isActive ? "Đang hoạt động" : "Đã khóa"}
                          </span>
                        </li>
                      ))}
                    </ul>
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
