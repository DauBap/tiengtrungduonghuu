import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ExamTabPlaceholder } from "~/components/admin/exam/tab-placeholder";
import { ListChecks } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  const exam = await prisma.exam.findUnique({
    where: { id: params.examId! },
    select: { id: true },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });
  return { examId: exam.id };
}

export default function ExamQuestionsTab() {
  useLoaderData<typeof loader>();
  return (
    <ExamTabPlaceholder
      icon={<ListChecks className="h-10 w-10" />}
      title="Câu hỏi trong đề"
      message="Gắn câu hỏi từ kho vào từng phần, đặt điểm và thứ tự. Đang hoàn thiện."
    />
  );
}
