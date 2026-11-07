CREATE TABLE "ClassStudentScore" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassStudentScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassStudentScore_classId_studentId_key"
ON "ClassStudentScore"("classId", "studentId");

CREATE INDEX "ClassStudentScore_studentId_idx"
ON "ClassStudentScore"("studentId");

ALTER TABLE "ClassStudentScore"
ADD CONSTRAINT "ClassStudentScore_classId_fkey"
FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassStudentScore"
ADD CONSTRAINT "ClassStudentScore_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
