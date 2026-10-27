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
  const lessonOrder = Number(params.lessonOrder);
  const lesson = course && Number.isSafeInteger(lessonOrder) && lessonOrder > 0
    ? await prisma.lesson.findFirst({
        where: { courseId: course.id, order: lessonOrder },
        select: { id: true },
      })
    : null;
  const url = new URL(request.url);
  const destination = lesson
    ? `/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lesson.id)}`
    : `/student/courses/${encodeURIComponent(courseId)}`;

  return redirect(`${destination}${url.search}`, 308);
}

export default function LegacyCourseLessonRedirect() {
  return null;
}
