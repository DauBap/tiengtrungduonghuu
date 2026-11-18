DO $$
BEGIN
  CREATE TYPE "StudentClassReviewAdminAction" AS ENUM ('PROCESSED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "student_class_reviews"
  ADD COLUMN IF NOT EXISTS "adminAction" "StudentClassReviewAdminAction",
  ADD COLUMN IF NOT EXISTS "adminActionReason" TEXT;
