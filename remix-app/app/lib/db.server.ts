/**
 * Shared DB query helpers dùng trong các routes
 */
import { prisma } from "~/lib/prisma.server";

// ─── Courses ─────────────────────────────────────────────────────────────────

export async function getAllCourses() {
  return prisma.course.findMany({ orderBy: { order: "asc" } });
}

export async function getCourseById(id: string) {
  return prisma.course.findUnique({ where: { id } });
}

export async function getEnrolledCourses(userId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: { course: true },
    orderBy: { course: { order: "asc" } },
  });
  return enrollments.map((e) => e.course);
}

// ─── Lessons ─────────────────────────────────────────────────────────────────

export async function getLessonsByCourse(courseId: string) {
  return prisma.lesson.findMany({
    where: { courseId },
    include: {
      content: { orderBy: { order: "asc" } },
      exercise: true,
      test: true,
    },
    orderBy: { order: "asc" },
  });
}

export async function getLessonById(id: string) {
  return prisma.lesson.findUnique({
    where: { id },
    include: {
      content: { orderBy: { order: "asc" } },
      sentences: { orderBy: { order: "asc" } },
      grammarSections: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
      learningBlocks: { orderBy: { order: "asc" } },
      exercise: true,
      // Chỉ đếm câu hỏi, KHÔNG kèm `questions` — `answer`/`hint` không được
      // xuống client trước khi học viên nộp bài kiểm tra.
      test: { include: { _count: { select: { questions: true } } } },
      course: true,
    },
  });
}

// ─── Progress ────────────────────────────────────────────────────────────────

export async function getLessonProgress(userId: string, lessonId: string) {
  return prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });
}

export async function getAllProgressForCourse(userId: string, courseId: string) {
  const lessons = await prisma.lesson.findMany({
    where: { courseId },
    select: { id: true },
  });
  const lessonIds = lessons.map((l) => l.id);
  return prisma.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessonIds } },
  });
}

export async function upsertLessonProgress(
  userId: string,
  lessonId: string,
  data: { learningCompleted?: boolean; exerciseCompleted?: boolean; testCompleted?: boolean }
) {
  return prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: data,
    create: { userId, lessonId, ...data },
  });
}

export function computeCourseProgress(
  lessons: { id: string }[],
  progressList: { lessonId: string; testCompleted: boolean }[]
) {
  if (lessons.length === 0) return 0;
  const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));
  const completed = lessons.filter((l) => progressMap.get(l.id)?.testCompleted).length;
  return Math.round((completed / lessons.length) * 100);
}

export function computeLessonStatus(
  progress: { learningCompleted: boolean; exerciseCompleted: boolean; testCompleted: boolean } | null
) {
  if (!progress) return { learningStatus: "AVAILABLE", exerciseStatus: "LOCKED", testStatus: "LOCKED" } as const;
  if (progress.testCompleted) return { learningStatus: "COMPLETED", exerciseStatus: "COMPLETED", testStatus: "COMPLETED" } as const;
  if (progress.exerciseCompleted) return { learningStatus: "COMPLETED", exerciseStatus: "COMPLETED", testStatus: "AVAILABLE" } as const;
  if (progress.learningCompleted) return { learningStatus: "COMPLETED", exerciseStatus: "AVAILABLE", testStatus: "LOCKED" } as const;
  return { learningStatus: "AVAILABLE", exerciseStatus: "LOCKED", testStatus: "LOCKED" } as const;
}

// ─── Learning blocks ─────────────────────────────────────────────────────────

/** Bài học kèm mọi thứ admin cần để soạn nội dung */
export async function getLessonForAdmin(id: string) {
  return prisma.lesson.findUnique({
    where: { id },
    include: {
      content: { orderBy: { order: "asc" } },
      sentences: { orderBy: { order: "asc" } },
      grammarSections: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
      learningBlocks: { orderBy: { order: "asc" } },
      // Bài kiểm tra cuối bài — hệ riêng, không phải model Exam
      test: { include: { questions: { orderBy: { order: "asc" } } } },
      course: true,
    },
  });
}

export async function getLessonsForAdmin(courseId: string) {
  return prisma.lesson.findMany({
    where: { courseId },
    include: {
      _count: { select: { content: true, learningBlocks: true } },
    },
    orderBy: { order: "asc" },
  });
}

export async function getLearningBlocks(lessonId: string) {
  return prisma.learningBlock.findMany({
    where: { lessonId },
    orderBy: { order: "asc" },
  });
}

export async function getBlockProgressMap(userId: string, blockIds: string[]) {
  if (blockIds.length === 0) return new Map<string, boolean>();
  const rows = await prisma.blockProgress.findMany({
    where: { userId, blockId: { in: blockIds } },
    select: { blockId: true, completed: true },
  });
  return new Map(rows.map((r) => [r.blockId, r.completed]));
}

export async function markBlockCompleted(userId: string, blockId: string) {
  return prisma.blockProgress.upsert({
    where: { userId_blockId: { userId, blockId } },
    update: { completed: true },
    create: { userId, blockId, completed: true },
  });
}

/**
 * Bật `learningCompleted` khi học viên đã xong mọi block bắt buộc của bài
 * → mở khóa phần Bài tập mà không cần bấm thêm nút nào.
 * Bài chưa có block nào thì không tự bật (vẫn dùng nút "Đánh dấu hoàn thành" như trước).
 *
 * Block rỗng (config không hợp lệ hoặc mọi từ vựng đã bị xóa) bị bỏ qua: học viên
 * không có gì để học ở đó nên không thể hoàn thành, tính vào sẽ khóa Bài tập vĩnh viễn.
 */
export async function syncLearningCompleted(userId: string, lessonId: string) {
  const candidates = await prisma.learningBlock.findMany({
    where: { lessonId, required: true },
    select: { id: true, type: true, config: true },
  });

  const vocabIds = new Set(
    (await prisma.vocabItem.findMany({ where: { lessonId }, select: { id: true } })).map((v) => v.id)
  );

  const requiredBlocks = candidates.filter((b) => {
    if (b.type !== "FLASHCARD") return false; // dạng chưa implement → không tính
    const config = b.config as { vocabItemIds?: unknown };
    const ids = Array.isArray(config?.vocabItemIds) ? (config.vocabItemIds as string[]) : [];
    return ids.some((id) => vocabIds.has(id));
  });

  if (requiredBlocks.length === 0) return false;

  const progressMap = await getBlockProgressMap(userId, requiredBlocks.map((b) => b.id));
  const allDone = requiredBlocks.every((b) => progressMap.get(b.id) === true);
  if (!allDone) return false;

  await upsertLessonProgress(userId, lessonId, { learningCompleted: true });
  return true;
}

/**
 * Trạng thái từng block: block đầu luôn mở, block sau mở khi block trước đã xong.
 * Trả về ProgressStatus để tái dùng component LessonProgress.
 */
export function computeBlockStatuses(
  blocks: { id: string; required?: boolean }[],
  progressMap: Map<string, boolean>
): ("LOCKED" | "AVAILABLE" | "COMPLETED")[] {
  let previousDone = true;
  return blocks.map((block) => {
    const done = progressMap.get(block.id) === true;
    const status = done ? "COMPLETED" : previousDone ? "AVAILABLE" : "LOCKED";
    // Block không bắt buộc (kể cả block rỗng đã bị hạ required ở loader) không
    // được chặn các block phía sau, nếu không học viên sẽ bị khóa vĩnh viễn.
    previousDone = done || block.required === false;
    return status;
  });
}
