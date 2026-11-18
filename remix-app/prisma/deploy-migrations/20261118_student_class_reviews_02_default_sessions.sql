UPDATE "Class" AS classroom
SET
  "midterm_review_session" = CASE course."code"
    WHEN 'HSK1-3.0' THEN 24
    WHEN 'HSK2-3.0' THEN 20
    WHEN 'HSK3-3.0' THEN 32
  END,
  "final_review_session" = NULL
FROM "Course" AS course
WHERE classroom."courseId" = course."id"
  AND course."code" IN ('HSK1-3.0', 'HSK2-3.0', 'HSK3-3.0');
