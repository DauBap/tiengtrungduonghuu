import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseKey = params.courseId!;
  const course = await prisma.course.findFirst({
    where: { OR: [{ id: courseKey }, { code: courseKey }] },
    select: { id: true },
  });
  const courseId = course?.id ?? courseKey;
  const url = new URL(request.url);

  return redirect(`/student/courses/${encodeURIComponent(courseId)}${url.search}`, 308);
}

export default function LegacyCourseRedirect() {
  return null;
}
