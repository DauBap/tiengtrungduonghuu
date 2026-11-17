CREATE TABLE "CourseDocument" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseDocument_courseId_createdAt_idx"
  ON "CourseDocument"("courseId", "createdAt");

ALTER TABLE "CourseDocument"
  ADD CONSTRAINT "CourseDocument_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
