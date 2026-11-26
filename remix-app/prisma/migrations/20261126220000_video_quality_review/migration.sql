CREATE TYPE "AttendanceSessionQualityStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "AttendanceSession"
ADD COLUMN "quality_review_status" "AttendanceSessionQualityStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "quality_reviewed_recording_url" TEXT;

CREATE INDEX "AttendanceSession_quality_review_status_created_at_idx"
ON "AttendanceSession" ("quality_review_status", "createdAt");
