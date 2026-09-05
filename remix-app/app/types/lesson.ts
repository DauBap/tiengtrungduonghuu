export interface LearningContentItem {
  chinese: string;
  pinyin: string;
  translation: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  order: number;
  title: string;
  subtitle: string;
  content: LearningContentItem[];
}

export interface Exercise { id: string; lessonId: string; title: string; }
export interface Test { id: string; lessonId: string; title: string; }
