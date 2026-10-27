import { getLessonById, isEnrolled } from "~/lib/db.server";

export async function requireEnrolledLesson(userId: string, courseId: string, lessonId: string) {
  if (!(await isEnrolled(userId, courseId))) {
    throw new Response("Bạn không thuộc khóa học này", { status: 403 });
  }

  const lesson = await getLessonById(lessonId);
  if (!lesson || lesson.courseId !== courseId) {
    throw new Response("Không tìm thấy bài học", { status: 404 });
  }

  return lesson;
}
