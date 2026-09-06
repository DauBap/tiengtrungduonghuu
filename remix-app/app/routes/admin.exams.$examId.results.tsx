import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ExamTabPlaceholder } from "~/components/admin/exam/tab-placeholder";
import { BarChart3 } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  const exam = await prisma.exam.findUnique({
    where: { id: params.examId! },
    select: { id: true },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });

  // Đếm qua version để không phụ thuộc vào version nào đang chạy
  const attemptCount = await prisma.examAttempt.count({
    where: { version: { examId: exam.id } },
  });
  return { examId: exam.id, attemptCount };
}

export default function ExamResultsTab() {
  const { attemptCount } = useLoaderData<typeof loader>();
  return (
    <ExamTabPlaceholder
      icon={<BarChart3 className="h-10 w-10" />}
      title="Kết quả"
      message={
        attemptCount === 0
          ? "Chưa có lượt thi nào. Bảng điểm và chức năng công bố kết quả sẽ hiện ở đây."
          : `Đã có ${attemptCount} lượt thi. Bảng điểm chi tiết đang hoàn thiện.`
      }
    />
  );
}
