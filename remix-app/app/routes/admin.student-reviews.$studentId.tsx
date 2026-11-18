import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

const REVIEW_STATUS_LABELS: Record<string, string> = {
  CAN_ADVANCE: "Có khả năng học lên",
  CANNOT_ADVANCE: "Không có khả năng học lên",
  DROPPED_OUT: "Bỏ học",
};

function formatReviewDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(value);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const studentId = params.studentId;
  if (!studentId || studentId.length > 100) {
    throw new Response("Không tìm thấy học viên.", { status: 404 });
  }

  const student = await prisma.user.findFirst({
    where: { id: studentId, role: "student", deletedAt: null },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      enrollments: {
        where: { classId: { not: null } },
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          class: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              completedAt: true,
              course: { select: { hskLevel: true, code: true, title: true } },
            },
          },
        },
      },
      studentClassReviews: {
        orderBy: [{ createdAt: "asc" }, { sessionNumber: "asc" }],
        select: {
          id: true,
          sessionType: true,
          sessionNumber: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          teacher: { select: { name: true } },
          classroom: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              completedAt: true,
              course: { select: { hskLevel: true, code: true, title: true } },
            },
          },
        },
      },
      classFinalResults: {
        orderBy: { createdAt: "asc" },
        select: {
          classId: true,
          score: true,
          comment: true,
          attendedSessions: true,
          totalSessions: true,
        },
      },
    },
  });
  if (!student) throw new Response("Không tìm thấy học viên.", { status: 404 });
  return { user, student, backTo: new URL(request.url).search };
}

export default function AdminStudentReviewDetails() {
  const { user, student, backTo } = useLoaderData<typeof loader>();
  const finalResultsByClass = new Map(student.classFinalResults.map((result) => [result.classId, result]));
  type Review = (typeof student.studentClassReviews)[number];
  const historyByClass = new Map<string, {
    classroom: Review["classroom"];
    reviews: Review[];
    enrolledAt: Date;
  }>();
  for (const enrollment of student.enrollments) {
    if (!enrollment.class) continue;
    historyByClass.set(enrollment.class.id, {
      classroom: enrollment.class,
      reviews: [],
      enrolledAt: enrollment.createdAt,
    });
  }
  for (const review of student.studentClassReviews) {
    const classHistory = historyByClass.get(review.classroom.id);
    if (classHistory) {
      classHistory.reviews.push(review);
    } else {
      historyByClass.set(review.classroom.id, {
        classroom: review.classroom,
        reviews: [review],
        enrolledAt: review.classroom.createdAt,
      });
    }
  }
  const history = [...historyByClass.values()]
    .map((reviews) => ({
      classroom: reviews.classroom,
      reviews: [...reviews.reviews].sort((left, right) => left.sessionNumber - right.sessionNumber),
      enrolledAt: reviews.enrolledAt,
    }))
    .sort((left, right) => left.enrolledAt.getTime() - right.enrolledAt.getTime());

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" className="-ml-3">
          <Link to={`/admin/student-reviews${backTo}`}>
            <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
            Danh sách đánh giá
          </Link>
        </Button>

        <header className="space-y-2 border-b pb-5">
          <h1 className="text-2xl font-bold tracking-tight">{student.name}</h1>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>SĐT: {student.phone || "Chưa cập nhật"}</span>
            <span>Email: {student.email}</span>
          </div>
        </header>

        <section aria-labelledby="student-review-history-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="student-review-history-heading" className="text-lg font-semibold">Lịch sử lớp và đánh giá</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Chuỗi lớp được sắp theo thời điểm ghi danh; mỗi lớp có thể có mốc giữa kỳ và cuối kỳ.
              </p>
            </div>
            <p className="text-sm tabular-nums text-muted-foreground">
              {history.length} lớp · {student.studentClassReviews.length} mốc
            </p>
          </div>

          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Học viên chưa có lịch sử đánh giá.
            </p>
          ) : (
            <ol className="space-y-4">
              {history.map(({ classroom, reviews }, index) => {
                const finalResult = finalResultsByClass.get(classroom.id);
                return (
                  <li key={classroom.id} className="rounded-lg border bg-card">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
                      <div>
                        <p className="text-sm font-semibold">
                          HSK {classroom.course.hskLevel} · {classroom.course.code}
                        </p>
                        <p className="mt-0.5 text-sm">{classroom.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {classroom.course.title} · {classroom.completedAt ? "Đã kết thúc" : "Đang học"}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Chặng {index + 1}
                      </span>
                    </div>
                    <div className="divide-y">
                      {reviews.map((review) => (
                        <div key={review.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.5fr)_minmax(8rem,1fr)] sm:items-center">
                          <div>
                            <p className="text-sm font-medium">
                              {review.sessionType === "MIDTERM" ? "Giữa kỳ" : "Cuối kỳ"}
                            </p>
                            <p className="text-xs text-muted-foreground">Buổi {review.sessionNumber} · {formatReviewDate(review.updatedAt)}</p>
                          </div>
                          <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                            review.status === "CAN_ADVANCE"
                              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                              : review.status === "CANNOT_ADVANCE"
                                ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          }`}>
                            {REVIEW_STATUS_LABELS[review.status] ?? "Chưa xác định"}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            Giáo viên: {review.teacher?.name ?? "Không còn tài khoản"}
                          </p>
                        </div>
                      ))}
                    </div>
                    {reviews.length === 0 && (
                      <p className="px-4 py-3 text-sm text-muted-foreground">
                        Chưa có mốc đánh giá cho lớp này.
                      </p>
                    )}
                    {finalResult && (
                      <details className="border-t px-4 py-3">
                        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          Xem điểm và nhận xét cuối khóa
                        </summary>
                        <div className="mt-3 space-y-2 text-sm">
                          <p className="tabular-nums">
                            Điểm {finalResult.score}/10 · Chuyên cần {finalResult.attendedSessions}/{finalResult.totalSessions} buổi
                          </p>
                          <p className="whitespace-pre-wrap text-muted-foreground">{finalResult.comment}</p>
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isNotFound = error instanceof Response && error.status === 404;
  return (
    <main className="mx-auto max-w-xl space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{isNotFound ? "Không tìm thấy học viên" : "Không thể tải lịch sử học viên"}</h1>
      <p className="text-sm text-muted-foreground">
        {isNotFound ? "Học viên có thể đã bị xóa hoặc đường dẫn không còn hợp lệ." : "Hãy tải lại trang hoặc quay về danh sách đánh giá."}
      </p>
      <Button asChild variant="outline">
        <Link to="/admin/student-reviews">Về danh sách đánh giá</Link>
      </Button>
    </main>
  );
}
