export type ProgressStatus = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED";

export interface LessonProgressState {
  learningStatus: ProgressStatus;
  exerciseStatus: ProgressStatus;
  testStatus: ProgressStatus;
}
