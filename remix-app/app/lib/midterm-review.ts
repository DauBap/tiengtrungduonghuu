export function shouldPromptForMidtermReview({
  configuredSessionNumber,
  currentSessionNumber,
  hasPendingStudents,
  attendanceComplete,
}: {
  configuredSessionNumber: number | null;
  currentSessionNumber: number;
  hasPendingStudents: boolean;
  attendanceComplete: boolean;
}) {
  return configuredSessionNumber !== null
    && configuredSessionNumber > 0
    && currentSessionNumber >= configuredSessionNumber
    && hasPendingStudents
    && attendanceComplete;
}
