import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { ExamTabPlaceholder } from "~/components/admin/exam/tab-placeholder";
import { Layers } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  // Id đến từ URL nên vẫn phải kiểm đề có thật, không tin params
  const exam = await prisma.exam.findUnique({
    where: { id: params.examId! },
    select: { id: true },
  });
  if (!exam) throw new Response("Không tìm thấy bài thi", { status: 404 });
  return { examId: exam.id };
}

export default function ExamStructureTab() {
  useLoaderData<typeof loader>();
  return (
    <ExamTabPlaceholder
      icon={<Layers className="h-10 w-10" />}
      title="Cấu trúc đề"
      message="Chia đề thành các phần (Nghe, Đọc, Viết…) với tên và thứ tự do bạn đặt. Đang hoàn thiện."
    />
  );
}
