import { type RouteConfig, route, index } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),

  // Admin
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("courses", "routes/admin.courses._index.tsx"),
    route("courses/new", "routes/admin.courses.new.tsx"),
    route("courses/:courseId/edit", "routes/admin.courses.$courseId.edit.tsx"),
    route("courses/:courseId/lessons", "routes/admin.courses.$courseId.lessons._index.tsx"),
    route("lessons/:lessonId", "routes/admin.lessons.$lessonId.tsx"),
    route("lessons/:lessonId/grammar", "routes/admin.lessons.$lessonId.grammar.tsx"),
    route("lessons/:lessonId/grammar/:sectionId", "routes/admin.lessons.$lessonId.grammar.$sectionId.tsx"),
    route("lessons/:lessonId/test", "routes/admin.lessons.$lessonId.test.tsx"),
    route("lessons/:lessonId/blocks/new", "routes/admin.lessons.$lessonId.blocks.new.tsx"),
    route("lessons/:lessonId/blocks/:blockId/edit", "routes/admin.lessons.$lessonId.blocks.$blockId.edit.tsx"),
    route("accounts", "routes/admin.accounts.tsx"),

    // Bài thi
    route("question-bank", "routes/admin.question-bank._index.tsx"),
    route("exams", "routes/admin.exams._index.tsx"),
    route("exams/new", "routes/admin.exams.new.tsx"),
    // Layout 6 tab: route con render trong <Outlet/> của admin.exams.$examId.tsx
    route("exams/:examId", "routes/admin.exams.$examId.tsx", [
      index("routes/admin.exams.$examId._index.tsx"),
      route("structure", "routes/admin.exams.$examId.structure.tsx"),
      route("questions", "routes/admin.exams.$examId.questions.tsx"),
      route("settings", "routes/admin.exams.$examId.settings.tsx"),
      route("results", "routes/admin.exams.$examId.results.tsx"),
      route("preview", "routes/admin.exams.$examId.preview.tsx"),
    ]),

    // Các mục đã có menu, nội dung chi tiết bổ sung sau
    route("staff", "routes/admin.staff.tsx"),
    route("teachers", "routes/admin.teachers.tsx"),
    route("students", "routes/admin.students.tsx"),
    route("classes", "routes/admin.classes.tsx"),
    route("schedule", "routes/admin.schedule.tsx"),
    route("tuition", "routes/admin.tuition.tsx"),
    route("attendance", "routes/admin.attendance.tsx"),
    route("reports", "routes/admin.reports.tsx"),
    route("notifications", "routes/admin.notifications.tsx"),
    route("settings", "routes/admin.settings.tsx"),
  ]),

  // Teacher
  route("teacher", "routes/teacher._index.tsx"),
  route("teacher/courses", "routes/teacher.courses._index.tsx"),
  route("teacher/courses/:courseId", "routes/teacher.courses.$courseId.tsx"),

  // Student
  route("student", "routes/student._index.tsx"),
  route("student/courses", "routes/student.courses._index.tsx"),
  route("student/courses/:courseId", "routes/student.courses.$courseId.tsx"),
  route(
    "student/courses/:courseId/lessons/:lessonId",
    "routes/student.courses.$courseId.lessons.$lessonId.tsx"
  ),
  route(
    "student/courses/:courseId/lessons/:lessonId/exercise",
    "routes/student.courses.$courseId.lessons.$lessonId.exercise.tsx"
  ),
  route(
    "student/courses/:courseId/lessons/:lessonId/test",
    "routes/student.courses.$courseId.lessons.$lessonId.test.tsx"
  ),
  route("student/progress", "routes/student.progress.tsx"),
] satisfies RouteConfig;
