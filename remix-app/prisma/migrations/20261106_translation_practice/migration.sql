ALTER TYPE "LessonTabKey" ADD VALUE IF NOT EXISTS 'TRANSLATION';

CREATE TYPE "TranslationSubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED');

CREATE TABLE "TranslationQuestion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL DEFAULT 'VI',
    "targetLanguage" TEXT NOT NULL DEFAULT 'ZH',
    "sampleAnswer" TEXT NOT NULL,
    "hint" TEXT NOT NULL DEFAULT '',
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranslationSubmission" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teacherId" TEXT,
    "answers" JSONB NOT NULL,
    "status" "TranslationSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "score" DOUBLE PRECISION,
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "teacherComment" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TranslationQuestion_lessonId_order_idx" ON "TranslationQuestion"("lessonId", "order");
CREATE INDEX "TranslationSubmission_lessonId_status_submittedAt_idx" ON "TranslationSubmission"("lessonId", "status", "submittedAt");
CREATE INDEX "TranslationSubmission_studentId_lessonId_submittedAt_idx" ON "TranslationSubmission"("studentId", "lessonId", "submittedAt");

ALTER TABLE "TranslationQuestion"
ADD CONSTRAINT "TranslationQuestion_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranslationSubmission"
ADD CONSTRAINT "TranslationSubmission_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranslationSubmission"
ADD CONSTRAINT "TranslationSubmission_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranslationSubmission"
ADD CONSTRAINT "TranslationSubmission_teacherId_fkey"
FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
