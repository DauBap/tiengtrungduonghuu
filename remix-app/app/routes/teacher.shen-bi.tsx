import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { AppShell } from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher", "admin"]);
  const url = new URL(request.url);
  const requestedClassId = url.searchParams.get("classId");
  const requestedAssignmentId = url.searchParams.get("assignmentId");
  const [classes, assignments] = await Promise.all([
    prisma.class.findMany({
      where: user.role === "teacher" ? { teacherId: user.id } : undefined,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        enrollments: {
          where: { user: { role: "student", isActive: true, deletedAt: null } },
          select: { userId: true },
        },
      },
    }),
    prisma.shenbiAssignment.findMany({
      where: user.role === "teacher" ? { teacherId: user.id } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        classId: true,
        hskLevel: true,
        lessonFrom: true,
        lessonTo: true,
        mode: true,
        dueAt: true,
        active: true,
        createdAt: true,
        class: { select: { name: true } },
      },
    }),
  ]);
  const selectedAssignment = requestedAssignmentId
    ? assignments.find((assignment) => assignment.id === requestedAssignmentId)
    : undefined;
  if (requestedAssignmentId && !selectedAssignment) {
    throw new Response("Không tìm thấy bài giao hoặc bạn không có quyền xem bài này.", { status: 404 });
  }
  const effectiveClassId = selectedAssignment?.classId ?? requestedClassId;
  const selectedClass = effectiveClassId
    ? classes.find((classItem) => classItem.id === effectiveClassId)
    : undefined;
  if (effectiveClassId && !selectedClass) {
    throw new Response("Không tìm thấy lớp hoặc bạn không có quyền xem lớp này.", { status: 404 });
  }
  const allowedClassIds = selectedClass
    ? [selectedClass.id]
    : classes.map((classItem) => classItem.id);
  const studentIds = user.role === "admin" && !selectedClass
    ? undefined
    : [...new Set(classes
        .filter((classItem) => allowedClassIds.includes(classItem.id))
        .flatMap((classItem) => classItem.enrollments.map((enrollment) => enrollment.userId)))];

  const attempts = await prisma.shenbiAttempt.findMany({
    where: {
      ...(studentIds
        ? { userId: { in: studentIds }, ...(studentIds.length === 0 ? { id: "__no-results__" } : {}) }
        : { user: { role: "student", deletedAt: null } }),
      ...(selectedAssignment ? { assignmentId: selectedAssignment.id } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      hskLevel: true,
      mode: true,
      score: true,
      correctCount: true,
      missedCount: true,
      accuracy: true,
      elapsedSeconds: true,
      assignment: { select: { title: true } },
      reviewWords: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (url.searchParams.get("format") === "csv") {
    const header = ["Học viên", "Email", "Bài giao", "Cấp HSK", "Chế độ", "Điểm", "Viết đúng", "Bỏ lỡ", "Chính xác (%)", "Thời gian (giây)", "Từ cần ôn", "Ngày chơi"];
    const rows = attempts.map((attempt) => {
      const missedWords = Array.isArray(attempt.reviewWords)
        ? attempt.reviewWords.flatMap((word) => isRecord(word) && typeof word.chinese === "string" ? [word.chinese] : [])
        : [];
      return [
        attempt.user.name,
        attempt.user.email,
        attempt.assignment?.title ?? "",
        `HSK ${attempt.hskLevel === 7 ? "7–9" : attempt.hskLevel}`,
        attempt.mode === "challenge" ? "Thử thách 60 giây" : "Vượt ải",
        attempt.score,
        attempt.correctCount,
        attempt.missedCount,
        Math.round(attempt.accuracy),
        attempt.elapsedSeconds,
        [...new Set(missedWords)].join("、"),
        attempt.createdAt.toLocaleString("vi-VN"),
      ].map(csvCell).join(",");
    });
    const csv = `\uFEFF${[header.map(csvCell).join(","), ...rows].join("\r\n")}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="than-but-ket-qua.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const reviewCounts = new Map<string, number>();
  const activeStudents = new Set<string>();
  let accuracyTotal = 0;
  for (const attempt of attempts) {
    activeStudents.add(attempt.user.id);
    accuracyTotal += attempt.accuracy;
    if (!Array.isArray(attempt.reviewWords)) continue;
    for (const word of attempt.reviewWords) {
      if (!isRecord(word) || typeof word.chinese !== "string") continue;
      reviewCounts.set(word.chinese, (reviewCounts.get(word.chinese) ?? 0) + 1);
    }
  }

  return {
    user,
    classes: classes.map(({ id, name }) => ({ id, name })),
    selectedClassId: selectedClass?.id ?? "",
    assignments: assignments.map((assignment) => ({
      ...assignment,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      createdAt: assignment.createdAt.toISOString(),
    })),
    selectedAssignmentId: selectedAssignment?.id ?? "",
    totalAttempts: attempts.length,
    activeStudentCount: activeStudents.size,
    averageAccuracy: attempts.length ? Math.round(accuracyTotal / attempts.length) : 0,
    frequentReviewWords: [...reviewCounts]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"))
      .slice(0, 12)
      .map(([chinese, count]) => ({ chinese, count })),
    attempts: attempts.slice(0, 100).map((attempt) => ({
      id: attempt.id,
      studentName: attempt.user.name,
      email: attempt.user.email,
      hskLevel: attempt.hskLevel,
      mode: attempt.mode,
      score: attempt.score,
      correctCount: attempt.correctCount,
      missedCount: attempt.missedCount,
      accuracy: Math.round(attempt.accuracy),
      elapsedSeconds: attempt.elapsedSeconds,
      assignmentTitle: attempt.assignment?.title ?? null,
      createdAt: attempt.createdAt.toISOString(),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher", "admin"]);
  const formData = await request.formData();
  const classId = String(formData.get("classId") ?? "");
  const hskLevel = Number(formData.get("hskLevel"));
  const mode = String(formData.get("mode") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const lessonFromText = String(formData.get("lessonFrom") ?? "").trim();
  const lessonToText = String(formData.get("lessonTo") ?? "").trim();
  const dueAtText = String(formData.get("dueAt") ?? "").trim();
  const lessonFrom = lessonFromText ? Number(lessonFromText) : null;
  const lessonTo = lessonToText ? Number(lessonToText) : null;
  if (!classId || !Number.isInteger(hskLevel) || hskLevel < 1 || hskLevel > 7 || (mode !== "stage" && mode !== "challenge")) {
    return Response.json({ error: "Hãy chọn lớp, cấp HSK và chế độ chơi hợp lệ." }, { status: 400 });
  }
  if ((lessonFrom === null) !== (lessonTo === null)
    || (lessonFrom !== null && (!Number.isInteger(lessonFrom) || lessonFrom < 1 || lessonFrom > 100))
    || (lessonTo !== null && (!Number.isInteger(lessonTo) || lessonTo < 1 || lessonTo > 100))
    || (lessonFrom !== null && lessonTo !== null && lessonFrom > lessonTo)) {
    return Response.json({ error: "Hãy chọn khoảng bài hợp lệ hoặc để trống cả hai để giao toàn cấp." }, { status: 400 });
  }
  if (title.length > 120) return Response.json({ error: "Tên bài giao không được quá 120 ký tự." }, { status: 400 });

  const classRecord = await prisma.class.findFirst({
    where: { id: classId, ...(user.role === "teacher" ? { teacherId: user.id } : {}) },
    select: { id: true, name: true },
  });
  if (!classRecord) return Response.json({ error: "Bạn không có quyền giao bài cho lớp này." }, { status: 403 });

  let dueAt: Date | null = null;
  if (dueAtText) {
    dueAt = new Date(dueAtText);
    if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date()) {
      return Response.json({ error: "Hạn hoàn thành phải là thời điểm trong tương lai." }, { status: 400 });
    }
  }

  const courseCode = hskLevel === 7 ? "HSK7-9-3.0" : `HSK${hskLevel}-3.0`;
  const lessonFilter = lessonFrom === null || lessonTo === null
    ? undefined
    : { gte: lessonFrom, lte: lessonTo };
  const [courseWordCount, customWordCount] = await Promise.all([
    prisma.vocabItem.count({
      where: {
        lesson: {
          order: lessonFilter,
          course: { code: courseCode, status: "PUBLISHED" },
        },
      },
    }),
    prisma.shenbiVocabulary.count({
      where: { hskLevel, lesson: lessonFilter },
    }),
  ]);
  if (courseWordCount + customWordCount === 0) {
    return Response.json({ error: "Không thể giao bài: chưa có dữ liệu HSK 3.0 cho cấp hoặc phạm vi đã chọn." }, { status: 400 });
  }

  const assignment = await prisma.shenbiAssignment.create({
    data: {
      classId,
      teacherId: user.id,
      title: title || `HSK ${hskLevel === 7 ? "7–9" : hskLevel} · ${lessonFrom === null ? "Toàn cấp" : `Bài ${lessonFrom}–${lessonTo}`}`,
      hskLevel,
      lessonFrom,
      lessonTo,
      mode,
      dueAt,
    },
    select: { id: true },
  });
  return Response.json({ success: true, message: `Đã giao bài Thần Bút cho lớp ${classRecord.name}.`, assignmentId: assignment.id });
}

export default function TeacherShenbiReport() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const exportParams = new URLSearchParams({ format: "csv" });
  if (data.selectedClassId) exportParams.set("classId", data.selectedClassId);
  if (data.selectedAssignmentId) exportParams.set("assignmentId", data.selectedAssignmentId);
  const exportUrl = `?${exportParams.toString()}`;
  const assignmentFilter = new URLSearchParams();
  if (data.selectedAssignmentId) assignmentFilter.set("assignmentId", data.selectedAssignmentId);
  else if (data.selectedClassId) assignmentFilter.set("classId", data.selectedClassId);

  return (
    <AppShell user={data.user}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to={data.user.role === "admin" ? "/admin" : "/teacher"} className="text-sm text-muted-foreground hover:text-foreground">← Bảng điều khiển</Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Kết quả Thần Bút</h1>
            <p className="mt-2 text-sm text-muted-foreground">Theo dõi lượt luyện viết và những từ học viên cần ôn thêm.</p>
          </div>
          <a href={exportUrl} className="inline-flex min-h-10 items-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
            Xuất CSV
          </a>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">
            Lớp học
            <select name="classId" defaultValue={data.selectedClassId} className="h-10 min-w-56 rounded-md border bg-background px-3">
              <option value="">Tất cả lớp được phân công</option>
              {data.classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Bài giao
            <select name="assignmentId" defaultValue={data.selectedAssignmentId} className="h-10 min-w-56 rounded-md border bg-background px-3">
              <option value="">Tất cả lượt chơi</option>
              {data.assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}
            </select>
          </label>
          <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Lọc kết quả</button>
        </form>

        <Card className="shadow-none">
          <CardContent className="p-5">
            <h2 className="font-semibold">Giao bài Thần Bút cho lớp</h2>
            <p className="mt-1 text-sm text-muted-foreground">Học viên thuộc lớp sẽ thấy bài giao và phạm vi từ được khóa theo lựa chọn của giáo viên.</p>
            <fetcher.Form method="post" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-xs font-medium">
                Lớp học
                <select name="classId" required className="h-10 rounded-md border bg-background px-3 text-sm">
                  <option value="">Chọn lớp</option>
                  {data.classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Cấp độ
                <select name="hskLevel" required className="h-10 rounded-md border bg-background px-3 text-sm">
                  {Array.from({ length: 7 }, (_, index) => index + 1).map((level) => <option key={level} value={level}>HSK {level === 7 ? "7–9" : level}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Chế độ
                <select name="mode" className="h-10 rounded-md border bg-background px-3 text-sm">
                  <option value="stage">Vượt ải</option>
                  <option value="challenge">Thử thách 60 giây</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Tên bài giao
                <input name="title" maxLength={120} placeholder="Ví dụ: Ôn từ vựng tuần này" className="h-10 rounded-md border bg-background px-3 text-sm" />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Từ bài
                <input name="lessonFrom" type="number" min={1} max={100} placeholder="Toàn cấp" className="h-10 rounded-md border bg-background px-3 text-sm" />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Đến bài
                <input name="lessonTo" type="number" min={1} max={100} placeholder="Toàn cấp" className="h-10 rounded-md border bg-background px-3 text-sm" />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Hạn hoàn thành (không bắt buộc)
                <input name="dueAt" type="datetime-local" className="h-10 rounded-md border bg-background px-3 text-sm" />
              </label>
              <div className="flex items-end">
                <button type="submit" disabled={fetcher.state !== "idle" || data.classes.length === 0} className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                  {fetcher.state !== "idle" ? "Đang giao…" : "Giao bài"}
                </button>
              </div>
            </fetcher.Form>
            {fetcher.data && (
              <p role={fetcher.data.success ? "status" : "alert"} className={`mt-3 text-sm ${fetcher.data.success ? "text-green-700 dark:text-green-300" : "text-destructive"}`}>
                {fetcher.data.message ?? fetcher.data.error}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="shadow-none"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Lượt luyện</p><p className="mt-2 text-3xl font-semibold tabular-nums">{data.totalAttempts}</p></CardContent></Card>
          <Card className="shadow-none"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Học viên đã chơi</p><p className="mt-2 text-3xl font-semibold tabular-nums">{data.activeStudentCount}</p></CardContent></Card>
          <Card className="shadow-none"><CardContent className="p-5"><p className="text-sm text-muted-foreground">Chính xác trung bình</p><p className="mt-2 text-3xl font-semibold tabular-nums">{data.averageAccuracy}%</p></CardContent></Card>
        </div>

        {data.assignments.length > 0 && (
          <section>
            <h2 className="font-semibold">Bài đã giao gần đây</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.assignments.slice(0, 6).map((assignment) => (
                <Link
                  key={assignment.id}
                  to={`?assignmentId=${encodeURIComponent(assignment.id)}`}
                  className={`border bg-card p-4 transition-colors hover:border-primary/40 ${data.selectedAssignmentId === assignment.id ? "border-primary/60 bg-primary/5" : ""}`}
                >
                  <span className="text-sm font-semibold">{assignment.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {assignment.class.name} · HSK {assignment.hskLevel === 7 ? "7–9" : assignment.hskLevel}
                    {assignment.lessonFrom !== null && assignment.lessonTo !== null ? ` · Bài ${assignment.lessonFrom}–${assignment.lessonTo}` : " · Toàn cấp"}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {assignment.active ? "Đang mở" : "Đã đóng"}
                    {assignment.dueAt ? ` · Hạn ${new Date(assignment.dueAt).toLocaleDateString("vi-VN")}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,.7fr)]">
          <Card className="shadow-none">
            <CardContent className="p-0">
              <div className="border-b p-5"><h2 className="font-semibold">Lịch sử học viên</h2><p className="mt-1 text-sm text-muted-foreground">Tối đa 100 lượt gần nhất trong phạm vi đã chọn.</p></div>
              {data.attempts.length === 0
                ? <p className="p-6 text-sm text-muted-foreground">Chưa có kết quả Thần Bút trong phạm vi này.</p>
                : <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
                      <th className="px-5 py-3 font-medium">Học viên</th><th className="px-3 py-3 font-medium">HSK</th><th className="px-3 py-3 font-medium">Chế độ</th>
                      <th className="px-3 py-3 font-medium">Điểm</th><th className="px-3 py-3 font-medium">Đúng / bỏ lỡ</th><th className="px-3 py-3 font-medium">Ngày chơi</th>
                    </tr></thead>
                    <tbody>{data.attempts.map((attempt) => (
                      <tr key={attempt.id} className="border-t">
                        <td className="px-5 py-3"><span className="block font-medium">{attempt.studentName}</span><span className="text-xs text-muted-foreground">{attempt.email}</span></td>
                        <td className="px-3 py-3">HSK {attempt.hskLevel === 7 ? "7–9" : attempt.hskLevel}</td>
                        <td className="px-3 py-3">{attempt.mode === "challenge" ? "60 giây" : "Vượt ải"}</td>
                        <td className="px-3 py-3 font-semibold tabular-nums">{attempt.score}</td>
                        <td className="px-3 py-3 tabular-nums">{attempt.correctCount} / {attempt.missedCount} · {attempt.accuracy}%</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(attempt.createdAt).toLocaleString("vi-VN")}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>}
            </CardContent>
          </Card>
          <Card className="h-fit shadow-none">
            <CardContent className="p-5">
              <h2 className="font-semibold">Từ thường cần ôn</h2>
              <p className="mt-1 text-sm text-muted-foreground">Đếm từ trong những lượt có từ bị bỏ lỡ.</p>
              {data.frequentReviewWords.length === 0
                ? <p className="mt-5 text-sm text-muted-foreground">Chưa có từ cần ôn.</p>
                : <ol className="mt-4 divide-y">{data.frequentReviewWords.map((word, index) => (
                  <li key={word.chinese} className="flex items-center gap-3 py-3">
                    <span className="w-5 text-xs text-muted-foreground">{index + 1}</span>
                    <strong className="text-xl">{word.chinese}</strong>
                    <span className="ml-auto rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums">{word.count} lần</span>
                  </li>
                ))}</ol>}
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
