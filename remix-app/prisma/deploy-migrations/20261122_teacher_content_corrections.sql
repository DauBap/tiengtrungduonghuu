CREATE TYPE "ContentCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ContentCorrection" (
  "id" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "reviewerId" TEXT,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetLabel" TEXT NOT NULL,
  "courseId" TEXT,
  "courseTitle" TEXT,
  "lessonId" TEXT,
  "lessonTitle" TEXT,
  "originalData" JSONB NOT NULL,
  "proposedData" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewNote" TEXT,
  "status" "ContentCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentCorrection_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContentCorrection_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ContentCorrection_status_createdAt_idx"
  ON "ContentCorrection"("status", "createdAt");
CREATE INDEX "ContentCorrection_teacherId_createdAt_idx"
  ON "ContentCorrection"("teacherId", "createdAt");
CREATE INDEX "ContentCorrection_targetType_targetId_status_idx"
  ON "ContentCorrection"("targetType", "targetId", "status");
