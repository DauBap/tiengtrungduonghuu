CREATE TABLE "ClassScheduleCancellation" (
  "id" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassScheduleCancellation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClassScheduleCancellation_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClassScheduleCancellation_classId_date_key"
  ON "ClassScheduleCancellation"("classId", "date");
