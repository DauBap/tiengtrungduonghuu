CREATE TABLE IF NOT EXISTS "ClassStudentScore" (
  "id" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassStudentScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassStudentScore_classId_studentId_key"
ON "ClassStudentScore"("classId", "studentId");

CREATE INDEX IF NOT EXISTS "ClassStudentScore_studentId_idx"
ON "ClassStudentScore"("studentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ClassStudentScore_classId_fkey'
      AND conrelid = 'public."ClassStudentScore"'::regclass
  ) THEN
    ALTER TABLE "ClassStudentScore"
    ADD CONSTRAINT "ClassStudentScore_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ClassStudentScore_studentId_fkey'
      AND conrelid = 'public."ClassStudentScore"'::regclass
  ) THEN
    ALTER TABLE "ClassStudentScore"
    ADD CONSTRAINT "ClassStudentScore_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
