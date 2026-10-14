BEGIN;

DO $$
DECLARE
  target_lesson_id text;
  updated_count integer;
  actual_pinyin text[];
  actual_translations text[];
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
  expected_pinyin text[] := ARRAY[
    'Méi shì.',
    'Duìbuqǐ!',
    'Méi guānxi!',
    'Wǒ méi shì.',
    'Wǒ hěn hǎo.',
    'Wǒ hěn gāoxìng.',
    'Wǒ jiào Lǐ Wén.',
    'Wǒ yě shì xuésheng.',
    'Méi guānxi, nǐ hǎo.',
    'Nǐ jiào shénme míngzi?',
    'Hěn gāoxìng rènshi nǐ.',
    'Wǒ de míngzi jiào Lǐ Wén.',
    'Qǐngwèn, nǐ shì lǎoshī ma?',
    'Qǐngwèn, nǐ jiào shénme míngzi?',
    'Wǒ yě hěn gāoxìng rènshi nǐ.'
  ];
  expected_translations text[] := ARRAY[
    'Không sao.',
    'Xin lỗi!',
    'Không sao đâu!',
    'Tôi không sao.',
    'Tôi rất khỏe / Tôi rất ổn.',
    'Tôi rất vui.',
    'Tôi tên là Lý Văn.',
    'Tôi cũng là học sinh.',
    'Không sao, chào bạn.',
    'Bạn tên là gì?',
    'Rất vui được làm quen với bạn.',
    'Tên tôi là Lý Văn.',
    'Xin hỏi, bạn là giáo viên phải không?',
    'Xin hỏi, bạn tên là gì?',
    'Tôi cũng rất vui được làm quen với bạn.'
  ];
BEGIN
  SELECT l.id INTO target_lesson_id
  FROM "Lesson" l
  JOIN "Course" c ON c.id = l."courseId"
  WHERE c.code = 'HSK1-3.0' AND l."order" = 2;

  IF target_lesson_id IS NULL THEN
    RAISE EXCEPTION 'Cannot find HSK1-3.0 lesson 2 in test database';
  END IF;

  WITH updated AS (
    UPDATE "SentenceItem" s
    SET pinyin = item.pinyin,
        translation = item.translation
    FROM (VALUES
      (1, '没事。', 'Méi shì.', 'Không sao.'),
      (2, '对不起！', 'Duìbuqǐ!', 'Xin lỗi!'),
      (3, '没关系！', 'Méi guānxi!', 'Không sao đâu!'),
      (4, '我没事。', 'Wǒ méi shì.', 'Tôi không sao.'),
      (5, '我很好。', 'Wǒ hěn hǎo.', 'Tôi rất khỏe / Tôi rất ổn.'),
      (6, '我很高兴。', 'Wǒ hěn gāoxìng.', 'Tôi rất vui.'),
      (7, '我叫李文。', 'Wǒ jiào Lǐ Wén.', 'Tôi tên là Lý Văn.'),
      (8, '我也是学生。', 'Wǒ yě shì xuésheng.', 'Tôi cũng là học sinh.'),
      (9, '没关系，你好。', 'Méi guānxi, nǐ hǎo.', 'Không sao, chào bạn.'),
      (10, '你叫什么名字？', 'Nǐ jiào shénme míngzi?', 'Bạn tên là gì?'),
      (11, '很高兴认识你。', 'Hěn gāoxìng rènshi nǐ.', 'Rất vui được làm quen với bạn.'),
      (12, '我的名字叫李文。', 'Wǒ de míngzi jiào Lǐ Wén.', 'Tên tôi là Lý Văn.'),
      (13, '请问，你是老师吗？', 'Qǐngwèn, nǐ shì lǎoshī ma?', 'Xin hỏi, bạn là giáo viên phải không?'),
      (14, '请问，你叫什么名字？', 'Qǐngwèn, nǐ jiào shénme míngzi?', 'Xin hỏi, bạn tên là gì?'),
      (15, '我也很高兴认识你。', 'Wǒ yě hěn gāoxìng rènshi nǐ.', 'Tôi cũng rất vui được làm quen với bạn.')
    ) AS item("order", chinese, pinyin, translation)
    WHERE s."lessonId" = target_lesson_id
      AND s."order" = item."order"
      AND s.chinese = item.chinese
    RETURNING s."order"
  )
  SELECT count(*) INTO updated_count FROM updated;

  IF updated_count <> 15 THEN
    RAISE EXCEPTION 'Expected to update 15 matching listening sentences; updated %', updated_count;
  END IF;

  SELECT
    array_agg(pinyin ORDER BY "order"),
    array_agg(translation ORDER BY "order")
  INTO actual_pinyin, actual_translations
  FROM "SentenceItem"
  WHERE "lessonId" = target_lesson_id;

  IF actual_pinyin IS DISTINCT FROM expected_pinyin
     OR actual_translations IS DISTINCT FROM expected_translations THEN
    RAISE EXCEPTION 'Pinyin and Vietnamese verification failed for HSK1-3.0 lesson 2';
  END IF;

  IF (SELECT array_agg(chinese ORDER BY "order")
      FROM "SentenceItem"
      WHERE "lessonId" = target_lesson_id) IS DISTINCT FROM expected_chinese THEN
    RAISE EXCEPTION 'Chinese sentence list changed unexpectedly during update';
  END IF;
END $$;

COMMIT;
