ALTER TABLE "Class"
  ADD COLUMN "start_date" DATE;

UPDATE "Class"
SET "start_date" = COALESCE("createdAt"::date, CURRENT_DATE)
WHERE "start_date" IS NULL;

ALTER TABLE "Class"
  ALTER COLUMN "start_date" SET NOT NULL;
