ALTER TABLE "AttendanceSession"
  ADD COLUMN "schedule_start_time" TEXT,
  ADD COLUMN "schedule_end_time" TEXT,
  ADD COLUMN "makeup_for_leave_request_id" TEXT;

WITH scheduled_slots AS (
  SELECT
    session."id" AS session_id,
    slot.value->>'startTime' AS start_time,
    slot.value->>'endTime' AS end_time,
    row_number() OVER (
      PARTITION BY session."id"
      ORDER BY slot.value->>'startTime', slot.value->>'endTime'
    ) AS slot_rank
  FROM "AttendanceSession" AS session
  JOIN "Class" AS classroom ON classroom."id" = session."classId"
  CROSS JOIN LATERAL jsonb_array_elements(classroom."schedule"::jsonb) AS slot(value)
  WHERE session."is_schedule_generated" = TRUE
    AND session."schedule_start_time" IS NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(slot.value->'days') AS scheduled_day(value)
      WHERE scheduled_day.value::integer = EXTRACT(DOW FROM session."date")::integer
    )
)
UPDATE "AttendanceSession" AS session
SET
  "schedule_start_time" = scheduled_slots.start_time,
  "schedule_end_time" = scheduled_slots.end_time
FROM scheduled_slots
WHERE session."id" = scheduled_slots.session_id
  AND scheduled_slots.slot_rank = 1;

ALTER TABLE "ClassScheduleCancellation"
  ADD COLUMN "start_time" TEXT,
  ADD COLUMN "end_time" TEXT;

DROP INDEX IF EXISTS "ClassScheduleCancellation_classId_date_key";

CREATE UNIQUE INDEX "ClassScheduleCancellation_full_day_key"
  ON "ClassScheduleCancellation" ("classId", "date")
  WHERE "start_time" IS NULL AND "end_time" IS NULL;

CREATE UNIQUE INDEX "ClassScheduleCancellation_slot_key"
  ON "ClassScheduleCancellation" ("classId", "date", "start_time", "end_time")
  WHERE "start_time" IS NOT NULL AND "end_time" IS NOT NULL;

CREATE UNIQUE INDEX "AttendanceSession_class_date_slot_key"
  ON "AttendanceSession" ("classId", "date", "schedule_start_time", "schedule_end_time");

CREATE TYPE "TeacherLeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "TeacherLeaveRequest" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "reviewer_id" TEXT,
  "class_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "status" "TeacherLeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  "review_note" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherLeaveRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherLeaveRequest_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeacherLeaveRequest_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TeacherLeaveRequest_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "Class"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "AttendanceSession_makeup_for_leave_request_id_fkey"
  FOREIGN KEY ("makeup_for_leave_request_id")
  REFERENCES "TeacherLeaveRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TeacherLeaveRequest_active_slot_key"
  ON "TeacherLeaveRequest" ("class_id", "date", "start_time", "end_time")
  WHERE "status" IN ('PENDING', 'APPROVED');

CREATE INDEX "TeacherLeaveRequest_class_id_date_status_idx"
  ON "TeacherLeaveRequest" ("class_id", "date", "status");

CREATE INDEX "TeacherLeaveRequest_teacher_id_created_at_idx"
  ON "TeacherLeaveRequest" ("teacher_id", "created_at");
