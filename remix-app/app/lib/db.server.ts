/**
 * Shared DB query helpers dùng trong các routes
 */
import { prisma } from "~/lib/prisma.server";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import { parsePhoneticsConfig, type PhoneticsConfig } from "~/lib/learning-blocks";

type TrackedTabProgressRow = {
  lessonId: string;
  tab: string;
  completed: boolean;
  attempts?: { passed: boolean | null }[];
};

function isTrackedTabCompleted(row: TrackedTabProgressRow) {
  return row.tab === "VOCABULARY_TEST" ? row.attempts?.[0]?.passed === true : row.completed;
}

export function computeTrackedCourseProgress(lessonIds: string[], rows: TrackedTabProgressRow[]) {
  const totalTabs = lessonIds.length * LESSON_TAB_KEYS.length;
  if (totalTabs === 0) return 0;

  const lessonIdSet = new Set(lessonIds);
  const completedTabs = rows.filter((row) => lessonIdSet.has(row.lessonId) && isTrackedTabCompleted(row)).length;
  return Math.round((completedTabs / totalTabs) * 100);
}

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
    include: {
      course: true,
      class: { select: { id: true, name: true, schedule: true } }
    },
    orderBy: { course: { order: "asc" } },
  });
  return enrollments.map((e) => e.course);
}

/** Lấy enrollment với thông tin lớp học cho student */
export async function getEnrolledCoursesWithClass(userId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: true,
      class: { select: { id: true, name: true, schedule: true, maxStudents: true } }
    },
    orderBy: { course: { order: "asc" } },
  });
  return enrollments;
}

/** Lấy danh sách course mà teacher phụ trách (qua Class). */
export async function getTeacherCourses(teacherId: string) {
  const classes = await prisma.class.findMany({
    where: { teacherId },
    include: { course: true },
    orderBy: { course: { order: "asc" } },
  });
  // Dedup: teacher có thể phụ trách nhiều lớp cùng một course
  const seen = new Set<string>();
  return classes.flatMap((c) => {
    if (seen.has(c.course.id)) return [];
    seen.add(c.course.id);
    return [c.course];
  });
}

/** Lấy danh sách lớp học mà teacher phụ trách */
export async function getTeacherClasses(teacherId: string) {
  return prisma.class.findMany({
    where: { teacherId },
    include: {
      course: { select: { id: true, code: true, title: true, hskLevel: true } },
      _count: { select: { enrollments: true } }
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });
}

/** Kiểm tra student có được enroll vào course này không. */
export async function isEnrolled(userId: string, courseId: string) {
  const row = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  return Boolean(row);
}

/** Kiểm tra teacher có phụ trách course này không (qua ít nhất một lớp). */
export async function isTeacherOfCourse(teacherId: string, courseId: string) {
  const row = await prisma.class.findFirst({
    where: { teacherId, courseId },
    select: { id: true },
  });
  return Boolean(row);
}

// ─── Classes ─────────────────────────────────────────────────────────────────

export async function getAllClasses() {
  return prisma.class.findMany({
    include: {
      course: { select: { id: true, code: true, title: true, hskLevel: true } },
      teacher: { select: { id: true, name: true, email: true } },
      enrollments: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      },
    },
    orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
  });
}

export async function getClassById(id: string) {
  return prisma.class.findUnique({
    where: { id },
    include: {
      course: { select: { id: true, code: true, title: true, hskLevel: true } },
      teacher: { select: { id: true, name: true, email: true } },
      enrollments: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      },
    },
  });
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

export async function getLessonSummariesByCourse(courseId: string) {
  return prisma.lesson.findMany({
    where: { courseId },
    select: { id: true, courseId: true, order: true, title: true, subtitle: true },
    orderBy: { order: "asc" },
  });
}

export async function getCourseReviewSets(courseId: string) {
  return prisma.courseReviewSet.findMany({
    where: { courseId },
    include: { questions: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });
}

/** Tóm tắt review cho danh sách khóa học; không tải toàn bộ nội dung câu hỏi. */
export async function getCourseReviewSetSummaries(courseId: string) {
  return prisma.courseReviewSet.findMany({
    where: { courseId },
    include: { _count: { select: { questions: true } } },
    orderBy: { order: "asc" },
  });
}

export async function getCourseReviewSetById(courseId: string, reviewId: string) {
  return prisma.courseReviewSet.findFirst({
    where: { id: reviewId, courseId },
    include: { questions: { orderBy: { order: "asc" } } },
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
      learningBlocks: { where: { type: { not: "PHONETICS" } }, orderBy: { order: "asc" } },
      exercise: true,
      // Chỉ đếm câu hỏi, KHÔNG kèm `questions` — `answer`/`hint` không được
      // xuống client trước khi học viên nộp bài kiểm tra.
      test: { include: { _count: { select: { questions: true } } } },
      course: true,
      audioScripts: {
        orderBy: { order: "asc" },
        include: { speakers: { orderBy: { order: "asc" } } },
      },
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
  return prisma.lessonProgress.findMany({
    where: { userId, lesson: { courseId } },
  });
}

/**
 * Tiến độ của nhiều khóa cùng lúc — 2 query cho cả danh sách, thay vì 2 query
 * mỗi khóa. Mỗi round-trip tới Neon là một lần đi mạng, nên vòng lặp `await`
 * theo từng khóa là thứ đắt nhất trên trang danh sách khóa học.
 */
export async function getCourseProgressMap(userId: string, courseIds: string[]) {
  if (courseIds.length === 0) return {};

  const [lessons, progressList] = await Promise.all([
    prisma.lesson.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true },
    }),
    prisma.lessonTabProgress.findMany({
      where: { userId, lesson: { courseId: { in: courseIds } } },
      include: {
        attempts: {
          where: { tab: "VOCABULARY_TEST" },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  const lessonsByCourse = new Map<string, string[]>();
  for (const lesson of lessons) {
    const list = lessonsByCourse.get(lesson.courseId);
    if (list) list.push(lesson.id);
    else lessonsByCourse.set(lesson.courseId, [lesson.id]);
  }

  const result: Record<string, number> = {};
  for (const courseId of courseIds) {
    result[courseId] = computeTrackedCourseProgress(lessonsByCourse.get(courseId) ?? [], progressList);
  }
  return result;
}

/**
 * Số liệu cho dashboard học viên trong 2 query, chỉ `select` các field bảng
 * thật sự dùng. Trước đây trang này gọi `getLessonsByCourse` cho từng khóa,
 * kéo theo cả vocab/exercise/test chỉ để đếm bài và tìm bài đang học.
 */
export async function getStudentDashboardStats(userId: string, courseIds: string[]) {
  if (courseIds.length === 0) {
    return { totalLessons: 0, totalCompleted: 0, currentLesson: null, courseProgress: {}, overallProgress: 0 };
  }

  const [lessons, progressList] = await Promise.all([
    prisma.lesson.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true, order: true, title: true, subtitle: true },
      orderBy: { order: "asc" },
    }),
    prisma.lessonTabProgress.findMany({
      where: { userId, lesson: { courseId: { in: courseIds } } },
      include: {
        attempts: {
          where: { tab: "VOCABULARY_TEST" },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  const progressByLesson = new Map<string, typeof progressList>();
  for (const row of progressList) {
    const rows = progressByLesson.get(row.lessonId) ?? [];
    rows.push(row);
    progressByLesson.set(row.lessonId, rows);
  }
  const isDone = (lessonId: string) => LESSON_TAB_KEYS.every((tab) => {
    const row = progressByLesson.get(lessonId)?.find((item) => item.tab === tab);
    return row ? isTrackedTabCompleted(row) : false;
  });

  const courseProgress: Record<string, number> = {};
  for (const courseId of courseIds) {
    const courseLessons = lessons.filter((l) => l.courseId === courseId);
    courseProgress[courseId] = computeTrackedCourseProgress(
      courseLessons.map((lesson) => lesson.id),
      progressList,
    );
  }

  const totalTrackedTabs = lessons.length * LESSON_TAB_KEYS.length;
  const totalCompletedTabs = progressList.filter(isTrackedTabCompleted).length;

  // Bài đang học = bài chưa xong đầu tiên, theo đúng thứ tự khóa học hiển thị.
  let currentLesson: (typeof lessons)[number] | null = null;
  for (const courseId of courseIds) {
    const next = lessons.find((l) => l.courseId === courseId && !isDone(l.id));
    if (next) {
      currentLesson = next;
      break;
    }
  }

  return {
    totalLessons: lessons.length,
    totalCompleted: lessons.filter((l) => isDone(l.id)).length,
    currentLesson,
    courseProgress,
    overallProgress: totalTrackedTabs > 0 ? Math.round((totalCompletedTabs / totalTrackedTabs) * 100) : 0,
  };
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
      learningBlocks: { where: { type: { not: "PHONETICS" } }, orderBy: { order: "asc" } },
      // Bài kiểm tra cuối bài — hệ riêng, không phải model Exam
      test: { select: { id: true, title: true, passScore: true, timeLimitMinutes: true } },
      course: true,
      audioScripts: {
        orderBy: { order: "asc" },
        include: { speakers: { orderBy: { order: "asc" } } },
      },
    },
  });
}

export async function getLessonsForAdmin(courseId: string) {
  return prisma.lesson.findMany({
    where: { courseId },
    include: {
      _count: { select: { content: true, learningBlocks: { where: { type: { not: "PHONETICS" } } } } },
    },
    orderBy: { order: "asc" },
  });
}

export async function getLearningBlocks(lessonId: string) {
  return prisma.learningBlock.findMany({
    where: { lessonId, type: { not: "PHONETICS" } },
    orderBy: { order: "asc" },
  });
}

/**
 * Block Ngữ âm của bài, nếu có.
 *
 * Dạng PHONETICS bị loại khỏi mọi query `learningBlocks` ở trên (nội dung do
 * script migrate sinh ra, admin không soạn, không tính vào tiến độ bắt buộc)
 * nên phải đọc bằng đường riêng. Mỗi bài tối đa một block — `@@unique([lessonId, type])`.
 */
export async function getPhoneticsBlock(lessonId: string) {
  return prisma.learningBlock.findUnique({
    where: { lessonId_type: { lessonId, type: "PHONETICS" } },
    select: { id: true, title: true, description: true, config: true },
  });
}

/** Load normalized phonetics content, falling back to legacy JSON until migrated. */
export async function getPhoneticsConfig(lessonId: string): Promise<PhoneticsConfig | null> {
  const sections = await prisma.phoneticsSection.findMany({
    where: { lessonId },
    orderBy: { order: "asc" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (sections.length > 0) {
    const parsed = parsePhoneticsConfig({
      sections: sections
        .filter((section) => section.questions.length > 0)
        .map((section) => ({
          id: section.sectionKey,
          title: section.title,
          description: section.description,
          audio: section.audio,
          items: section.questions.map((question) => question.type === "TONE"
            ? {
                id: question.questionKey,
                type: "tone",
                syllable: question.syllable ?? "",
                answerTone: question.answerTone,
                full: question.full,
                audioText: question.audioText,
              }
            : {
                id: question.questionKey,
                type: question.type === "INITIAL" ? "initial" : "final",
                given: question.given ?? "",
                answer: question.answer ?? "",
                full: question.full,
                audioText: question.audioText,
              }),
        })),
    });
    return parsed.ok ? parsed.data : null;
  }

  const legacyBlock = await getPhoneticsBlock(lessonId);
  if (!legacyBlock) return null;
  const parsed = parsePhoneticsConfig(legacyBlock.config);
  return parsed.ok ? parsed.data : null;
}

/** One-time, idempotent import from the former LearningBlock JSON format. */
export async function migrateLegacyPhoneticsToDatabase(lessonId: string) {
  const [existingSections, legacyBlock] = await Promise.all([
    prisma.phoneticsSection.count({ where: { lessonId } }),
    getPhoneticsBlock(lessonId),
  ]);
  if (existingSections > 0 || !legacyBlock) return;

  const parsed = parsePhoneticsConfig(legacyBlock.config);
  if (!parsed.ok) throw new Error(`Cấu hình Ngữ âm cũ không hợp lệ: ${parsed.error}`);

  await prisma.$transaction(async (tx) => {
    const sections = await tx.phoneticsSection.createManyAndReturn({
      data: parsed.data.sections.map((section, order) => ({
        lessonId,
        sectionKey: section.id,
        title: section.title,
        description: section.description,
        audio: section.audio,
        order,
      })),
      select: { id: true, sectionKey: true },
    });
    const sectionIdByKey = new Map(sections.map((section) => [section.sectionKey, section.id]));

    await tx.phoneticsQuestion.createMany({
      data: parsed.data.sections.flatMap((section) => section.items.map((item, order) => ({
        sectionId: sectionIdByKey.get(section.id)!,
        questionKey: item.id,
        type: item.type === "tone" ? "TONE" : item.type === "initial" ? "INITIAL" : "FINAL",
        given: item.type === "tone" ? null : item.given,
        answer: item.type === "tone" ? null : item.answer,
        syllable: item.type === "tone" ? item.syllable : null,
        answerTone: item.type === "tone" ? item.answerTone : null,
        full: item.full,
        audioText: item.audioText,
        order,
      }))),
    });

    await tx.learningBlock.delete({ where: { id: legacyBlock.id } });
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
    where: { lessonId, required: true, type: { not: "PHONETICS" } },
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
  return blocks.map((block) => {
    const done = progressMap.get(block.id) === true;
    return done ? "COMPLETED" : "AVAILABLE";
  });
}
