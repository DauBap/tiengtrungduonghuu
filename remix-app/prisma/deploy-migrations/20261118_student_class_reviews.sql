DO $$
BEGIN
  CREATE TYPE "ClassReviewSessionType" AS ENUM ('MIDTERM', 'FINAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "StudentClassReviewStatus" AS ENUM ('CAN_ADVANCE', 'CANNOT_ADVANCE', 'DROPPED_OUT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Class"
  ADD COLUMN IF NOT EXISTS "midterm_review_session" INTEGER,
  ADD COLUMN IF NOT EXISTS "final_review_session" INTEGER;

ALTER TABLE "ClassFinalResult"
  ALTER COLUMN "decision" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "student_class_reviews" (
  "id" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "sessionType" "ClassReviewSessionType" NOT NULL,
  "sessionNumber" INTEGER NOT NULL,
  "status" "StudentClassReviewStatus" NOT NULL,
  "teacherId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_class_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_class_reviews_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "student_class_reviews_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "student_class_reviews_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_class_reviews_classId_studentId_sessionType_key"
  ON "student_class_reviews"("classId", "studentId", "sessionType");

CREATE INDEX IF NOT EXISTS "student_class_reviews_studentId_sessionType_idx"
  ON "student_class_reviews"("studentId", "sessionType");

CREATE INDEX IF NOT EXISTS "student_class_reviews_classId_sessionType_sessionNumber_idx"
  ON "student_class_reviews"("classId", "sessionType", "sessionNumber");
