import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ExamTabPlaceholder } from "~/components/admin/exam/tab-placeholder";
import { Eye } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  const exam = await prisma.exam.findUnique({
    where: { id: params.examId! },
    select: { id: true },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });
  // Xem thử không được ghi gì vào DB, kể cả lượt thi nháp — loader này chỉ đọc.
  return { examId: exam.id };
}

export default function ExamPreviewTab() {
  useLoaderData<typeof loader>();
  return (
    <ExamTabPlaceholder
      icon={<Eye className="h-10 w-10" />}
      title="Xem thử"
      message="Làm thử đề đúng như học viên thấy, không tạo lượt thi thật. Đang hoàn thiện."
    />
  );
}
