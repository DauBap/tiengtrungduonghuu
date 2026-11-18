import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

type ReviewStatus = "CAN_ADVANCE" | "CANNOT_ADVANCE" | "DROPPED_OUT";

const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string; tone: string }[] = [
  { value: "CAN_ADVANCE", label: "Có khả năng học lên", tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  { value: "CANNOT_ADVANCE", label: "Không có khả năng học lên", tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  { value: "DROPPED_OUT", label: "Bỏ học", tone: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
];

function isReviewStatus(value: string | null): value is ReviewStatus {
  return value === "CAN_ADVANCE" || value === "CANNOT_ADVANCE" || value === "DROPPED_OUT";
}

function getReviewStatusLabel(value: string | null) {
  return REVIEW_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? "—";
}

function getReviewStatusTone(value: string | null) {
  return REVIEW_STATUS_OPTIONS.find((option) => option.value === value)?.tone ?? "bg-muted text-muted-foreground";
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const classId = (url.searchParams.get("classId") ?? "").trim().slice(0, 100);
  const parsedHskLevel = Number(url.searchParams.get("hskLevel"));
  const hskLevel = Number.isSafeInteger(parsedHskLevel) && parsedHskLevel > 0
    ? parsedHskLevel
    : null;
  const statusValue = url.searchParams.get("status");
  const status = isReviewStatus(statusValue) ? statusValue : null;
  const requestedPage = parsePage(url.searchParams.get("page"));
  const pageSize = 10;

  const reviewFilter = {
    ...(classId ? { classId } : {}),
    ...(hskLevel ? { classroom: { is: { course: { is: { hskLevel } } } } } : {}),
    ...(status ? { status } : {}),
  };
  const studentFilter = {
    role: "student" as const,
    deletedAt: null,
    studentClassReviews: { some: reviewFilter },
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [totalStudents, classes] = await Promise.all([
    prisma.user.count({ where: studentFilter }),
    prisma.class.findMany({
      where: { studentClassReviews: { some: {} } },
      orderBy: [{ course: { hskLevel: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        course: { select: { hskLevel: true } },
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalStudents / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const students = await prisma.user.findMany({
    where: studentFilter,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      phone: true,
      studentClassReviews: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          sessionType: true,
          sessionNumber: true,
          status: true,
          updatedAt: true,
          classroom: {
            select: {
              id: true,
              name: true,
              course: { select: { hskLevel: true, code: true } },
            },
          },
        },
      },
    },
  });

  return {
    user,
    students,
    classes,
    query,
    classId,
    hskLevel: hskLevel ? String(hskLevel) : "",
    status: status ?? "",
    page,
    pageSize,
    totalStudents,
    totalPages,
    backTo: url.search,
  };
}

export default function AdminStudentReviews() {
  const {
    user,
    students,
    classes,
    query,
    classId,
    hskLevel,
    status,
    page,
    pageSize,
    totalStudents,
    totalPages,
    backTo,
  } = useLoaderData<typeof loader>();
  const hskLevels = [...new Set(classes.map(({ course }) => course.hskLevel))]
    .sort((left, right) => left - right);

  function getPageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (classId) params.set("classId", classId);
    if (hskLevel) params.set("hskLevel", hskLevel);
    if (status) params.set("status", status);
    params.set("page", String(nextPage));
    return `/admin/student-reviews?${params.toString()}`;
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Đánh giá học viên</h1>
          <p className="text-sm text-muted-foreground">
            Tra cứu lịch sử giữa kỳ và cuối kỳ theo từng học viên. Bộ lọc trạng thái áp dụng cho mọi đánh giá trong lịch sử.
          </p>
        </header>

        <form method="get" className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Tìm học viên</span>
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={query} placeholder="Tên hoặc số điện thoại" className="pl-9" />
            </span>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Cấp độ</span>
            <select
              name="hskLevel"
              defaultValue={hskLevel}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả HSK</option>
              {hskLevels.map((level) => <option key={level} value={level}>HSK {level}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Lớp học</span>
            <select
              name="classId"
              defaultValue={classId}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả lớp</option>
              {classes.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  HSK {classroom.course.hskLevel} · {classroom.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Trạng thái trong lịch sử</span>
            <select
              name="status"
              defaultValue={status}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Tất cả trạng thái</option>
              {REVIEW_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" className="w-full sm:w-auto">Lọc</Button>
            {(query || classId || hskLevel || status) && (
              <Link
                to="/admin/student-reviews"
                className="inline-flex h-10 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xóa lọc
              </Link>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {totalStudents === 0
              ? "Chưa có học viên khớp bộ lọc."
              : `Hiển thị ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalStudents)} / ${totalStudents} học viên`}
          </p>
          <p className="text-xs text-muted-foreground">Mỗi trang 10 học viên</p>
        </div>

        {students.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <h2 className="font-semibold">Chưa có dữ liệu đánh giá phù hợp</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Thử đổi bộ lọc hoặc kiểm tra lại sau khi giáo viên lưu đánh giá giữa kỳ/cuối kỳ.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-muted/70">
                <tr className="border-b">
                  <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">Học viên</th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">Số điện thoại</th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">Lớp đánh giá gần nhất</th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">Số mốc</th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">Trạng thái gần nhất</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Xem chi tiết</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((student) => {
                  const latestReview = student.studentClassReviews[0];
                  const reviewedClassCount = new Set(student.studentClassReviews.map(({ classroom }) => classroom.id)).size;
                  return (
                    <tr key={student.id} className="hover:bg-muted/30">
                      <th scope="row" className="px-4 py-3 font-medium">
                        <Link
                          to={`/admin/student-reviews/${student.id}${backTo}`}
                          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {student.name}
                          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                        </Link>
                      </th>
                      <td className="px-4 py-3 text-sm tabular-nums">{student.phone || "Chưa cập nhật"}</td>
                      <td className="px-4 py-3 text-sm">
                        {latestReview
                          ? `HSK ${latestReview.classroom.course.hskLevel} · ${latestReview.classroom.name}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {student.studentClassReviews.length} mốc · {reviewedClassCount} lớp
                      </td>
                      <td className="px-4 py-3">
                        {latestReview ? (
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getReviewStatusTone(latestReview.status)}`}>
                            {getReviewStatusLabel(latestReview.status)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {latestReview
                          ? `${latestReview.sessionType === "MIDTERM" ? "Giữa kỳ" : "Cuối kỳ"} · Buổi ${latestReview.sessionNumber}`
                          : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <nav aria-label="Phân trang học viên" className="flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">Trang {page} / {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to={getPageHref(page - 1)}>
                    <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />Trước
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />Trước
                </Button>
              )}
              {page < totalPages ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to={getPageHref(page + 1)}>
                    Sau<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  Sau<ChevronRight aria-hidden="true" className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </nav>
        )}
      </div>
    </AppShell>
  );
}
