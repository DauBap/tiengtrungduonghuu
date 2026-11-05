export function getStudentsAbsentForThreeConsecutiveSessions(
  sessions: readonly {
    id: string;
    records: readonly { studentId: string; status: string | null }[];
  }[],
  targetSessionId: string,
) {
  const targetIndex = sessions.findIndex((session) => session.id === targetSessionId);
  if (targetIndex < 2) return new Set<string>();

  const recentSessions = sessions.slice(targetIndex - 2, targetIndex + 1);
  const absentStudentIdsBySession = recentSessions.map((session) => new Set(
    session.records
      .filter((record) => record.status === "ABSENT" || record.status === "absent")
      .map((record) => record.studentId),
  ));
  const latestAbsentStudentIds = absentStudentIdsBySession[2];
  if (!latestAbsentStudentIds) return new Set<string>();

  return new Set(
    [...latestAbsentStudentIds].filter((studentId) =>
      absentStudentIdsBySession.every((studentIds) => studentIds.has(studentId)),
    ),
  );
}
