import type { Prisma as PrismaNamespace } from "@prisma/client";
import { isWordType } from "~/lib/word-types";
import {
  CONTENT_CORRECTION_FIELDS,
  isRecord,
  type ContentCorrectionTarget,
  type ContentCorrectionTargetType,
  type CorrectionData,
} from "~/lib/content-corrections";

export type CorrectionTransaction = PrismaNamespace.TransactionClient;

function pickFields(value: Record<string, unknown>, fields: readonly string[]): CorrectionData {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function lessonTarget(
  type: ContentCorrectionTargetType,
  id: string,
  label: string,
  courseId: string,
  courseTitle: string,
  lessonId: string,
  lessonTitle: string,
  data: Record<string, unknown>,
): ContentCorrectionTarget {
  return { type, id, label, courseId, courseTitle, lessonId, lessonTitle, data };
}

export async function listLessonCorrectionTargets(tx: CorrectionTransaction, lessonId: string) {
  const lesson = await tx.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      courseId: true,
      course: { select: { title: true } },
      content: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          chinese: true,
          chineseAlternatives: true,
          pinyin: true,
          pinyinAlternatives: true,
          translation: true,
          translationAlternatives: true,
          wordTypes: true,
          note: true,
        },
      },
      sentences: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          chinese: true,
          chineseAlternatives: true,
          pinyin: true,
          pinyinAlternatives: true,
          translation: true,
          note: true,
        },
      },
      audioScripts: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          order: true,
          speakers: {
            orderBy: { order: "asc" },
            select: { id: true, speakerName: true, chinese: true, pinyin: true, translation: true },
          },
        },
      },
      grammarSections: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          explanation: true,
          formula: true,
          examples: true,
          note: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              type: true,
              prompt: true,
              options: true,
              answer: true,
              acceptedAnswers: true,
              hint: true,
            },
          },
        },
      },
      phoneticsSections: {
        orderBy: { order: "asc" },
        select: {
          title: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              questionKey: true,
              given: true,
              answer: true,
              syllable: true,
              answerTone: true,
              full: true,
              audioText: true,
            },
          },
        },
      },
      learningBlocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, title: true, description: true },
      },
      test: {
        select: {
          questions: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              prompt: true,
              options: true,
              answer: true,
              acceptedAnswers: true,
              hint: true,
            },
          },
        },
      },
      translationQuestions: {
        orderBy: { order: "asc" },
        select: { id: true, prompt: true, sampleAnswer: true, acceptedAnswers: true, hint: true },
      },
    },
  });
  if (!lesson) return null;

  const targets: ContentCorrectionTarget[] = [];
  for (const item of lesson.content) {
    targets.push(lessonTarget(
      "VOCABULARY_ITEM",
      item.id,
      `Từ vựng · ${item.chinese}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      pickFields(item, CONTENT_CORRECTION_FIELDS.VOCABULARY_ITEM),
    ));
  }
  for (const item of lesson.sentences) {
    targets.push(lessonTarget(
      "SENTENCE_ITEM",
      item.id,
      `Câu mẫu · ${item.chinese}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      pickFields(item, CONTENT_CORRECTION_FIELDS.SENTENCE_ITEM),
    ));
  }
  for (const script of lesson.audioScripts) {
    targets.push(lessonTarget(
      "AUDIO_SCRIPT",
      script.id,
      `Bài khóa ${script.order + 1} · ${script.title}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      { speakers: script.speakers },
    ));
    for (const speaker of script.speakers) {
      targets.push(lessonTarget(
        "AUDIO_SPEAKER",
        speaker.id,
        `${script.title} · ${speaker.speakerName}`,
        lesson.courseId,
        lesson.course.title,
        lesson.id,
        lesson.title,
        pickFields(speaker, CONTENT_CORRECTION_FIELDS.AUDIO_SPEAKER),
      ));
    }
  }
  for (const section of lesson.grammarSections) {
    targets.push(lessonTarget(
      "GRAMMAR_SECTION",
      section.id,
      `Ngữ pháp · ${section.title}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      {
        ...pickFields(section, CONTENT_CORRECTION_FIELDS.GRAMMAR_SECTION.filter((field) => field !== "questions")),
        questions: section.questions,
      },
    ));
    for (const question of section.questions) {
      targets.push(lessonTarget(
        "GRAMMAR_QUESTION",
        question.id,
        `Câu hỏi ngữ pháp · ${question.prompt}`,
        lesson.courseId,
        lesson.course.title,
        lesson.id,
        lesson.title,
        pickFields(question, CONTENT_CORRECTION_FIELDS.GRAMMAR_QUESTION),
      ));
    }
  }
  for (const section of lesson.phoneticsSections) {
    for (const question of section.questions) {
      targets.push(lessonTarget(
        "PHONETICS_QUESTION",
        question.id,
        `Ngữ âm · ${section.title} · câu ${question.questionKey}`,
        lesson.courseId,
        lesson.course.title,
        lesson.id,
        lesson.title,
        pickFields(question, CONTENT_CORRECTION_FIELDS.PHONETICS_QUESTION),
      ));
    }
  }
  for (const block of lesson.learningBlocks) {
    targets.push(lessonTarget(
      "LEARNING_BLOCK",
      block.id,
      `Phần học · ${block.title}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      pickFields(block, CONTENT_CORRECTION_FIELDS.LEARNING_BLOCK),
    ));
  }
  for (const question of lesson.test?.questions ?? []) {
    targets.push(lessonTarget(
      "TEST_QUESTION",
      question.id,
      `Bài kiểm tra · ${question.prompt}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      pickFields(question, CONTENT_CORRECTION_FIELDS.TEST_QUESTION),
    ));
  }
  for (const question of lesson.translationQuestions) {
    targets.push(lessonTarget(
      "TRANSLATION_QUESTION",
      question.id,
      `Luyện dịch · ${question.prompt}`,
      lesson.courseId,
      lesson.course.title,
      lesson.id,
      lesson.title,
      pickFields(question, CONTENT_CORRECTION_FIELDS.TRANSLATION_QUESTION),
    ));
  }
  return targets;
}

export async function listCourseCorrectionTargets(tx: CorrectionTransaction, courseId: string) {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      lessons: { orderBy: { order: "asc" }, select: { id: true } },
    },
  });
  if (!course) return null;

  const lessonTargets = await Promise.all(
    course.lessons.map((lesson) => listLessonCorrectionTargets(tx, lesson.id)),
  );
  const targets = lessonTargets.flatMap((items) => items ?? []);
  const addTarget = (
    type: ContentCorrectionTargetType,
    id: string,
    label: string,
    data: CorrectionData,
    lessonId: string | null = null,
    lessonTitle: string | null = null,
  ) => targets.push({
    type,
    id,
    label,
    courseId: course.id,
    courseTitle: course.title,
    lessonId,
    lessonTitle,
    data,
  });

  const reviewSets = await tx.courseReviewSet.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: {
      title: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          prompt: true,
          answer: true,
          acceptedAnswers: true,
          explanation: true,
          tokens: true,
        },
      },
    },
  });
  for (const set of reviewSets) {
    for (const question of set.questions) {
      addTarget(
        "COURSE_REVIEW_QUESTION",
        question.id,
        `Ôn tập · ${set.title} · ${question.prompt}`,
        pickFields(question, CONTENT_CORRECTION_FIELDS.COURSE_REVIEW_QUESTION),
      );
    }
  }

  const mockExams = await tx.mockExam.findMany({
    where: { courseId },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      sections: {
        orderBy: { order: "asc" },
        select: {
          title: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              prompt: true,
              imageUrl: true,
              audioUrl: true,
              points: true,
              options: {
                orderBy: { order: "asc" },
                select: { id: true, content: true, imageUrl: true, isCorrect: true },
              },
            },
          },
        },
      },
    },
  });
  for (const exam of mockExams) {
    for (const section of exam.sections) {
      for (const question of section.questions) {
        addTarget(
          "MOCK_EXAM_QUESTION",
          question.id,
          `Thi thử · ${exam.title} · ${section.title} · ${question.prompt}`,
          pickFields(question, CONTENT_CORRECTION_FIELDS.MOCK_EXAM_QUESTION),
        );
        for (const option of question.options) {
          addTarget(
            "MOCK_EXAM_OPTION",
            option.id,
            `Thi thử · ${exam.title} · Lựa chọn · ${option.content}`,
            pickFields(option, CONTENT_CORRECTION_FIELDS.MOCK_EXAM_OPTION),
          );
        }
      }
    }
  }

  const exams = await tx.exam.findMany({
    where: {
      OR: [
        { courseId },
        { lesson: { courseId } },
        { accessRules: { some: { courseId } } },
      ],
    },
    select: {
      title: true,
      lesson: { select: { id: true, title: true } },
      versions: {
        select: {
          items: {
            select: {
              question: {
                select: {
                  id: true,
                  prompt: true,
                  payload: true,
                  explanation: true,
                  options: {
                    orderBy: { order: "asc" },
                    select: { id: true, content: true, isCorrect: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const bankQuestions = new Map<string, {
    question: (typeof exams)[number]["versions"][number]["items"][number]["question"];
    examTitle: string;
    lesson: (typeof exams)[number]["lesson"];
  }>();
  for (const exam of exams) {
    for (const version of exam.versions) {
      for (const item of version.items) {
        if (!bankQuestions.has(item.question.id)) {
          bankQuestions.set(item.question.id, {
            question: item.question,
            examTitle: exam.title,
            lesson: exam.lesson,
          });
        }
      }
    }
  }
  for (const { question, examTitle, lesson } of bankQuestions.values()) {
    const lessonId = lesson?.id ?? null;
    const lessonTitle = lesson?.title ?? null;
    const prefix = lessonTitle ? `${lessonTitle} · ` : "";
    addTarget(
      "QUESTION_BANK_ITEM",
      question.id,
      `${prefix}${examTitle} · Câu hỏi · ${question.prompt}`,
      pickFields(question, CONTENT_CORRECTION_FIELDS.QUESTION_BANK_ITEM),
      lessonId,
      lessonTitle,
    );
    for (const option of question.options) {
      addTarget(
        "QUESTION_BANK_OPTION",
        option.id,
        `${prefix}${examTitle} · Lựa chọn · ${option.content}`,
        pickFields(option, CONTENT_CORRECTION_FIELDS.QUESTION_BANK_OPTION),
        lessonId,
        lessonTitle,
      );
    }
  }

  return targets;
}

export async function applyContentCorrection(
  tx: CorrectionTransaction,
  type: ContentCorrectionTargetType,
  id: string,
  courseId: string,
  data: CorrectionData,
) {
  const targets = await listCourseCorrectionTargets(tx, courseId);
  if (!targets?.some((target) => target.type === type && target.id === id)) return false;

  switch (type) {
    case "VOCABULARY_ITEM":
      await tx.vocabItem.update({
        where: { id },
        data: {
          chinese: typeof data.chinese === "string" ? data.chinese : undefined,
          chineseAlternatives: Array.isArray(data.chineseAlternatives) ? data.chineseAlternatives as string[] : undefined,
          pinyin: typeof data.pinyin === "string" ? data.pinyin : undefined,
          pinyinAlternatives: Array.isArray(data.pinyinAlternatives) ? data.pinyinAlternatives as string[] : undefined,
          translation: typeof data.translation === "string" ? data.translation : undefined,
          translationAlternatives: Array.isArray(data.translationAlternatives) ? data.translationAlternatives as string[] : undefined,
          wordTypes: Array.isArray(data.wordTypes) && data.wordTypes.every(isWordType) ? data.wordTypes : undefined,
          note: typeof data.note === "string" || data.note === null ? data.note : undefined,
        },
      });
      return true;
    case "SENTENCE_ITEM":
      await tx.sentenceItem.update({
        where: { id },
        data: {
          chinese: typeof data.chinese === "string" ? data.chinese : undefined,
          chineseAlternatives: Array.isArray(data.chineseAlternatives) ? data.chineseAlternatives as string[] : undefined,
          pinyin: typeof data.pinyin === "string" ? data.pinyin : undefined,
          pinyinAlternatives: Array.isArray(data.pinyinAlternatives) ? data.pinyinAlternatives as string[] : undefined,
          translation: typeof data.translation === "string" ? data.translation : undefined,
          note: typeof data.note === "string" || data.note === null ? data.note : undefined,
        },
      });
      return true;
    case "AUDIO_SPEAKER":
      await tx.lessonAudioSpeaker.update({
        where: { id },
        data: {
          chinese: typeof data.chinese === "string" ? data.chinese : undefined,
          pinyin: typeof data.pinyin === "string" ? data.pinyin : undefined,
          translation: typeof data.translation === "string" ? data.translation : undefined,
        },
      });
      return true;
    case "AUDIO_SCRIPT":
      if (!Array.isArray(data.speakers) || data.speakers.length === 0) return false;
      const speakerLines = data.speakers.flatMap((speaker, order) => {
        if (!isRecord(speaker)) return [];
        return [{
          speakerName: typeof speaker.speakerName === "string" ? speaker.speakerName : "",
          chinese: typeof speaker.chinese === "string" ? speaker.chinese : "",
          pinyin: typeof speaker.pinyin === "string" ? speaker.pinyin : "",
          translation: typeof speaker.translation === "string" ? speaker.translation : "",
          order,
        }];
      });
      if (speakerLines.length !== data.speakers.length) return false;
      await tx.lessonAudioScript.update({
        where: { id },
        data: {
          speakers: {
            deleteMany: {},
            create: speakerLines,
          },
        },
      });
      return true;
    case "GRAMMAR_SECTION":
      await tx.grammarSection.update({
        where: { id },
        data: {
          title: typeof data.title === "string" ? data.title : undefined,
          explanation: typeof data.explanation === "string" || data.explanation === null ? data.explanation : undefined,
          formula: typeof data.formula === "string" || data.formula === null ? data.formula : undefined,
          examples: typeof data.examples === "string" || data.examples === null ? data.examples : undefined,
          note: typeof data.note === "string" || data.note === null ? data.note : undefined,
          questions: Array.isArray(data.questions)
            ? {
                update: data.questions.flatMap((question) => {
                  if (!isRecord(question) || typeof question.id !== "string") return [];
                  return [{
                    where: { id: question.id },
                    data: {
                      type: question.type as "SINGLE_CHOICE" | "ARRANGE" | "FILL",
                      prompt: question.prompt as string,
                      options: question.options as string[],
                      answer: question.answer as string,
                      acceptedAnswers: question.acceptedAnswers as string[],
                      hint: question.hint as string | null,
                    },
                  }];
                }),
              }
            : undefined,
        },
      });
      return true;
    case "GRAMMAR_QUESTION":
      await tx.grammarQuestion.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          options: Array.isArray(data.options) ? data.options as string[] : undefined,
          answer: typeof data.answer === "string" ? data.answer : undefined,
          acceptedAnswers: Array.isArray(data.acceptedAnswers) ? data.acceptedAnswers as string[] : undefined,
          hint: typeof data.hint === "string" || data.hint === null ? data.hint : undefined,
        },
      });
      return true;
    case "PHONETICS_QUESTION":
      await tx.phoneticsQuestion.update({
        where: { id },
        data: {
          given: typeof data.given === "string" || data.given === null ? data.given : undefined,
          answer: typeof data.answer === "string" || data.answer === null ? data.answer : undefined,
          syllable: typeof data.syllable === "string" || data.syllable === null ? data.syllable : undefined,
          answerTone: typeof data.answerTone === "number" || data.answerTone === null ? data.answerTone : undefined,
          full: typeof data.full === "string" ? data.full : undefined,
          audioText: typeof data.audioText === "string" ? data.audioText : undefined,
        },
      });
      return true;
    case "LEARNING_BLOCK":
      await tx.learningBlock.update({
        where: { id },
        data: {
          title: typeof data.title === "string" ? data.title : undefined,
          description: typeof data.description === "string" || data.description === null ? data.description : undefined,
        },
      });
      return true;
    case "TEST_QUESTION":
      await tx.testQuestion.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          options: Array.isArray(data.options) ? data.options as string[] : undefined,
          answer: typeof data.answer === "string" ? data.answer : undefined,
          acceptedAnswers: Array.isArray(data.acceptedAnswers) ? data.acceptedAnswers as string[] : undefined,
          hint: typeof data.hint === "string" || data.hint === null ? data.hint : undefined,
        },
      });
      return true;
    case "TRANSLATION_QUESTION":
      await tx.translationQuestion.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          sampleAnswer: typeof data.sampleAnswer === "string" ? data.sampleAnswer : undefined,
          acceptedAnswers: Array.isArray(data.acceptedAnswers) ? data.acceptedAnswers as string[] : undefined,
          hint: typeof data.hint === "string" ? data.hint : undefined,
        },
      });
      return true;
    case "COURSE_REVIEW_QUESTION":
      await tx.courseReviewQuestion.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          answer: typeof data.answer === "string" ? data.answer : undefined,
          acceptedAnswers: Array.isArray(data.acceptedAnswers) ? data.acceptedAnswers as string[] : undefined,
          explanation: typeof data.explanation === "string" || data.explanation === null ? data.explanation : undefined,
          tokens: Array.isArray(data.tokens) ? data.tokens as string[] : undefined,
        },
      });
      return true;
    case "MOCK_EXAM_QUESTION":
      await tx.mockExamQuestion.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          imageUrl: typeof data.imageUrl === "string" || data.imageUrl === null ? data.imageUrl : undefined,
          audioUrl: typeof data.audioUrl === "string" || data.audioUrl === null ? data.audioUrl : undefined,
          points: typeof data.points === "number" ? data.points : undefined,
        },
      });
      return true;
    case "MOCK_EXAM_OPTION":
      if (typeof data.isCorrect === "boolean") {
        const option = await tx.mockExamOption.findUnique({
          where: { id },
          select: { questionId: true },
        });
        if (!option) return false;
        const question = await tx.mockExamQuestion.findUnique({
          where: { id: option.questionId },
          select: { type: true },
        });
        if (!question) return false;
        const options = await tx.mockExamOption.findMany({
          where: { questionId: option.questionId },
          select: { id: true, isCorrect: true },
        });
        const correctCount = options.filter((item) =>
          item.id === id ? data.isCorrect === true : item.isCorrect,
        ).length;
        if (correctCount === 0 || (question.type !== "MULTIPLE_CHOICE" && correctCount !== 1)) {
          return false;
        }
      }
      await tx.mockExamOption.update({
        where: { id },
        data: {
          content: typeof data.content === "string" ? data.content : undefined,
          imageUrl: typeof data.imageUrl === "string" || data.imageUrl === null ? data.imageUrl : undefined,
          isCorrect: typeof data.isCorrect === "boolean" ? data.isCorrect : undefined,
        },
      });
      return true;
    case "QUESTION_BANK_ITEM":
      await tx.question.update({
        where: { id },
        data: {
          prompt: typeof data.prompt === "string" ? data.prompt : undefined,
          payload: isRecord(data.payload) ? data.payload as PrismaNamespace.InputJsonValue : undefined,
          explanation: typeof data.explanation === "string" || data.explanation === null ? data.explanation : undefined,
        },
      });
      return true;
    case "QUESTION_BANK_OPTION":
      if (typeof data.isCorrect === "boolean") {
        const option = await tx.questionOption.findUnique({
          where: { id },
          select: { questionId: true },
        });
        if (!option) return false;
        const options = await tx.questionOption.findMany({
          where: { questionId: option.questionId },
          select: { id: true, isCorrect: true },
        });
        if (!options.some((item) => item.id === id ? data.isCorrect === true : item.isCorrect)) {
          return false;
        }
      }
      await tx.questionOption.update({
        where: { id },
        data: {
          content: typeof data.content === "string" ? data.content : undefined,
          isCorrect: typeof data.isCorrect === "boolean" ? data.isCorrect : undefined,
        },
      });
      return true;
    default:
      return false;
  }
}
