BEGIN;

DO $$
DECLARE
  target_lesson_id text;
  target_block_id text;
  sentence_ids text[];
  expected_chinese text[] := ARRAY[
    '没事。',
    '对不起！',
    '没关系！',
    '我没事。',
    '我很好。',
    '我很高兴。',
    '我叫李文。',
    '我也是学生。',
    '没关系，你好。',
    '你叫什么名字？',
    '很高兴认识你。',
    '我的名字叫李文。',
    '请问，你是老师吗？',
    '请问，你叫什么名字？',
    '我也很高兴认识你。'
  ];
  actual_chinese text[];
BEGIN
  SELECT l.id INTO target_lesson_id
  FROM "Lesson" l
  JOIN "Course" c ON c.id = l."courseId"
  WHERE c.code = 'HSK1-3.0' AND l."order" = 2;

  IF target_lesson_id IS NULL THEN
    RAISE EXCEPTION 'Cannot find HSK1-3.0 lesson 2 in test database';
  END IF;

  SELECT b.id INTO target_block_id
  FROM "LearningBlock" b
  WHERE b."lessonId" = target_lesson_id AND b.type = 'LISTENING';

  IF target_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot find the listening block for HSK1-3.0 lesson 2';
  END IF;

  DELETE FROM "SentenceItem"
  WHERE "lessonId" = target_lesson_id;

  WITH new_items("order", chinese) AS (
    VALUES
      (1, '没事。'),
      (2, '对不起！'),
      (3, '没关系！'),
      (4, '我没事。'),
      (5, '我很好。'),
      (6, '我很高兴。'),
      (7, '我叫李文。'),
      (8, '我也是学生。'),
      (9, '没关系，你好。'),
      (10, '你叫什么名字？'),
      (11, '很高兴认识你。'),
      (12, '我的名字叫李文。'),
      (13, '请问，你是老师吗？'),
      (14, '请问，你叫什么名字？'),
      (15, '我也很高兴认识你。')
  ),
  inserted AS (
    INSERT INTO "SentenceItem" (
      id,
      "lessonId",
      chinese,
      "chineseAlternatives",
      pinyin,
      "pinyinAlternatives",
      translation,
      "audioUrl",
      note,
      "order"
    )
    SELECT
      'hsk1-3-l2-listening-' || lpad(n."order"::text, 2, '0'),
      target_lesson_id,
      n.chinese,
      ARRAY[]::text[],
      '',
      ARRAY[]::text[],
      '',
      NULL,
      NULL,
      n."order"
    FROM new_items n
    RETURNING id, "order"
  )
  SELECT array_agg(id ORDER BY "order")
  INTO sentence_ids
  FROM inserted;

  UPDATE "LearningBlock"
  SET config = jsonb_set(config, '{sentenceItemIds}', to_jsonb(sentence_ids), true),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = target_block_id;

  SELECT array_agg(chinese ORDER BY "order")
  INTO actual_chinese
  FROM "SentenceItem"
  WHERE "lessonId" = target_lesson_id;

  IF actual_chinese IS DISTINCT FROM expected_chinese THEN
    RAISE EXCEPTION 'Sentence verification failed: stored Chinese text does not match the expected UTF-8 list';
  END IF;
END $$;

COMMIT;
