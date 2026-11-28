UPDATE "LearningBlock" AS block
SET "config" = jsonb_set(
  block."config",
  '{sections}',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_set(
          section.value,
          '{questions}',
          COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN question.value->>'number' IN ('28', '29', '30')
                    THEN jsonb_set(
                      jsonb_set(question.value, '{gradable}', 'true'::jsonb, true),
                      '{teacherReview}',
                      'true'::jsonb,
                      true
                    )
                  ELSE question.value
                END
                ORDER BY question.ordinality
              )
              FROM jsonb_array_elements(COALESCE(section.value->'questions', '[]'::jsonb))
                WITH ORDINALITY AS question(value, ordinality)
            ),
            '[]'::jsonb
          ),
          true
        )
        ORDER BY section.ordinality
      )
      FROM jsonb_array_elements(COALESCE(block."config"->'sections', '[]'::jsonb))
        WITH ORDINALITY AS section(value, ordinality)
    ),
    '[]'::jsonb
  ),
  true
)
FROM "Lesson" AS lesson
JOIN "Course" AS course ON course."id" = lesson."courseId"
WHERE block."lessonId" = lesson."id"
  AND block."type" = 'WORKBOOK'
  AND course."code" = 'HSK3-3.0'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(block."config"->'sections', '[]'::jsonb)) AS section(value)
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(section.value->'questions', '[]'::jsonb)) AS question(value)
    WHERE question.value->>'number' IN ('28', '29', '30')
  );
