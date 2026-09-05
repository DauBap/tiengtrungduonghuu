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
    route("lessons/:lessonId/blocks/new", "routes/admin.lessons.$lessonId.blocks.new.tsx"),
    route("lessons/:lessonId/blocks/:blockId/edit", "routes/admin.lessons.$lessonId.blocks.$blockId.edit.tsx"),
    route("accounts", "routes/admin.accounts.tsx"),
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
