import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ExamTabPlaceholder } from "~/components/admin/exam/tab-placeholder";
import { SlidersHorizontal } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  const exam = await prisma.exam.findUnique({
    where: { id: params.examId! },
    select: { id: true },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });
  return { examId: exam.id };
}

export default function ExamSettingsTab() {
  useLoaderData<typeof loader>();
  return (
    <ExamTabPlaceholder
      icon={<SlidersHorizontal className="h-10 w-10" />}
      title="Cài đặt đề"
      message="Thời gian, điều hướng, cách tính điểm, số lần thi, trộn câu, công bố kết quả. Đang hoàn thiện."
    />
  );
}
