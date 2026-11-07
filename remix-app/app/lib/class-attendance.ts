export type ClassAttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | null;

export function getClassAttendanceSummary(statuses: readonly ClassAttendanceStatus[]) {
  const attendedSessions = statuses.filter((status) => status === "PRESENT" || status === "LATE").length;
  const totalSessions = statuses.length;
  return {
    attendedSessions,
    totalSessions,
    percentage: totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0,
  };
}
