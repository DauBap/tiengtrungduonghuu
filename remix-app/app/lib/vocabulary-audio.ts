const HSK1_3_LESSON_1_AUDIO_WORDS = new Set([
  "再见",
  "同学",
  "不客气",
  "谢谢",
  "你们",
  "您",
  "老师",
  "们",
  "学生",
  "好",
  "大家",
  "王老师",
  "你好",
]);

export function getVocabularyAudioUrl(
  courseCode: string,
  lessonOrder: number,
  chinese: string,
): string | null {
  if (
    courseCode !== "HSK1-3.0"
    || lessonOrder !== 1
    || !HSK1_3_LESSON_1_AUDIO_WORDS.has(chinese)
  ) {
    return null;
  }

  return `/uploads/audio/vocab/hsk1-3/lesson-01/${encodeURIComponent(chinese)}.MP3`;
}
