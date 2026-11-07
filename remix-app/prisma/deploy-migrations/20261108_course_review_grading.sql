DO $$
BEGIN
    CREATE TYPE "CourseReviewAttemptStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

ALTER TYPE "CourseReviewAttemptStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "CourseReviewAttemptStatus" ADD VALUE IF NOT EXISTS 'GRADED';
ALTER TYPE "CourseReviewAttemptStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

ALTER TABLE "CourseReviewAttempt"
    ADD COLUMN IF NOT EXISTS "status" "CourseReviewAttemptStatus" NOT NULL DEFAULT 'RETURNED',
    ADD COLUMN IF NOT EXISTS "grades" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "teacherId" TEXT,
    ADD COLUMN IF NOT EXISTS "gradedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CourseReviewAttempt_reviewSetId_status_completedAt_idx"
    ON "CourseReviewAttempt"("reviewSetId", "status", "completedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'CourseReviewAttempt_teacherId_fkey'
          AND conrelid = '"CourseReviewAttempt"'::regclass
    ) THEN
        ALTER TABLE "CourseReviewAttempt"
            ADD CONSTRAINT "CourseReviewAttempt_teacherId_fkey"
            FOREIGN KEY ("teacherId") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;
