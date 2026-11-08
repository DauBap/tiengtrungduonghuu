DO $$
BEGIN
  CREATE TYPE "ClassFinalResultAdminAction" AS ENUM ('PROCESSED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ClassFinalResult"
ADD COLUMN IF NOT EXISTS "adminAction" "ClassFinalResultAdminAction";
