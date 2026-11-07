DO $$
DECLARE
    requeued_count INTEGER;
BEGIN
    UPDATE "CourseReviewAttempt"
    SET
        "status" = 'SUBMITTED',
        "correctCount" = 0,
        "percentage" = 0,
        "gradedAt" = NULL,
        "returnedAt" = NULL
    WHERE "status" = 'RETURNED'
      AND "teacherId" IS NULL
      AND "grades" = '[]'::jsonb;

    GET DIAGNOSTICS requeued_count = ROW_COUNT;
    RAISE NOTICE 'Queued % legacy review attempts for teacher grading; student answers were preserved.', requeued_count;
END
$$;
