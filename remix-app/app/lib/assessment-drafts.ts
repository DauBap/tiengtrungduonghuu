export type AssessmentDraftScope =
  | { kind: "lesson-test"; lessonId: string }
  | {
      kind: "lesson-tab";
      lessonId: string;
      tab: "VOCABULARY_TEST" | "TRANSLATION" | "GRAMMAR" | "LISTENING" | "PHONETICS" | "WORKBOOK";
      activityId?: string;
    }
  | { kind: "course-review"; reviewSetId: string }
  | { kind: "combined-test"; courseId: string; lessonIds: string[] };

export type AssessmentDraftData = {
  answers?: unknown;
  currentIndex?: number;
  state?: unknown;
};

export function getAssessmentDraftScopeKey(scope: AssessmentDraftScope): string {
  switch (scope.kind) {
    case "lesson-test":
      return `lesson-test:${scope.lessonId}`;
    case "lesson-tab":
      return `lesson-tab:${scope.lessonId}:${scope.tab}:${scope.activityId ?? ""}`;
    case "course-review":
      return `course-review:${scope.reviewSetId}`;
    case "combined-test":
      return `combined-test:${scope.courseId}:${[...scope.lessonIds].sort().join(",")}`;
  }
}

export function isAssessmentDraftData(value: unknown): value is AssessmentDraftData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
