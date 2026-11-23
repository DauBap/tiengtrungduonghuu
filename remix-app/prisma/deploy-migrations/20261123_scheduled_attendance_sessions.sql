ALTER TABLE "Class"
  ADD COLUMN "schedule_effective_from" DATE;

UPDATE "Class"
SET "schedule_effective_from" = "start_date"
WHERE "schedule_effective_from" IS NULL;

ALTER TABLE "Class"
  ALTER COLUMN "schedule_effective_from" SET NOT NULL;

ALTER TABLE "Class"
  ALTER COLUMN "schedule_effective_from" SET DEFAULT CURRENT_DATE;

ALTER TABLE "AttendanceSession"
  ADD COLUMN "is_schedule_generated" BOOLEAN NOT NULL DEFAULT FALSE;
