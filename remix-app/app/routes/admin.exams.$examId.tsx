import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Outlet, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getExamForAdmin } from "~/lib/exam.server";
import { isExamStatus } from "~/lib/exams";
import { AppShell } from "~/components/layout/app-shell";
import { ExamTabs } from "~/components/admin/exam/exam-tabs";
import { ExamStatusBadge, VersionBadge } from "~/components/admin/exam/version-badge";
import { Button } from "~/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Khung của màn hình soạn đề: tiêu đề + tab bar, nội dung do route con render.
 *
 * Loader này chạy cho mọi tab nên chỉ lấy phần dùng chung ở header. Dữ liệu
 * riêng của từng tab do route con tự nạp, tránh mọi tab cùng gánh một truy vấn
 * nặng.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const exam = await getExamForAdmin(params.examId!);
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });

  const publishedVersion = exam.versions.find((v) => v.status === "PUBLISHED") ?? null;
  const draftVersion = exam.versions.find((v) => v.status === "DRAFT") ?? null;

  return {
    user,
    exam: {
      id: exam.id,
      code: exam.code,
      title: exam.title,
      status: exam.status,
      lesson: exam.lesson,
      course: exam.course,
    },
    publishedVersion,
    draftVersion,
  };
}

export default function AdminExamLayout() {
  const { user, exam, publishedVersion, draftVersion } = useLoaderData<typeof loader>();
  const shown = publishedVersion ?? draftVersion;

  return (
    <AppShell user={user}>
      <div className="space-y-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/admin/exams">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Quay lại danh sách bài thi
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">{exam.title}</h1>
            {isExamStatus(exam.status) && <ExamStatusBadge status={exam.status} />}
            {shown && isExamStatus(shown.status) && (
              <VersionBadge version={shown.version} status={shown.status} />
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            <span className="font-mono text-xs">{exam.code}</span>
            {exam.lesson
              ? ` · Bài ${exam.lesson.order} - ${exam.lesson.title}`
              : exam.course
                ? ` · ${exam.course.title}`
                : " · Đề độc lập"}
            {/* Nhắc admin có bản nháp đang soạn song song với bản đang chạy */}
            {publishedVersion && draftVersion && ` · đang soạn v${draftVersion.version}`}
          </p>
        </div>

        <ExamTabs examId={exam.id} />

        <Outlet />
      </div>
    </AppShell>
  );
}
