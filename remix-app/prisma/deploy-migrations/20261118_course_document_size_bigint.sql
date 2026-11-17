ALTER TABLE "CourseDocument"
  ALTER COLUMN "fileSize" TYPE BIGINT
  USING "fileSize"::BIGINT;
