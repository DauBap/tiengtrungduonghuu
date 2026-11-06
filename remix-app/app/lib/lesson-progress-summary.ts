import type { GrammarQuestionType } from "~/lib/grammar";

export interface LessonActivityProgress {
  status: string;
  percent: number;
  score?: number;
  useScoreWhenPartial?: boolean;
}

export interface GrammarQuestionGroup {
  sectionId: string;
  questionType: GrammarQuestionType;
}

export interface GrammarAttemptProgress {
  sectionId: string;
  questionType: GrammarQuestionType;
  completedAt: Date | string;
  reviewPending: boolean;
}

export interface LessonScriptAttempt {
  scriptId: string;
  score: number;
}

export function getLessonScriptProgress(scriptIds: string[], attempts: LessonScriptAttempt[]) {
  const bestScoreByScript = new Map<string, number>();
  for (const attempt of attempts) {
    if (!scriptIds.includes(attempt.scriptId)) continue;
    bestScoreByScript.set(
      attempt.scriptId,
      Math.max(bestScoreByScript.get(attempt.scriptId) ?? 0, Math.max(0, Math.min(100, attempt.score))),
    );
  }

  const scoreTotal = scriptIds.reduce((sum, scriptId) => (
    sum + (bestScoreByScript.get(scriptId) ?? 0)
  ), 0);

  return {
    score: scriptIds.length > 0 ? Math.floor(scoreTotal / scriptIds.length) : 0,
    started: bestScoreByScript.size > 0,
    completed: scriptIds.length > 0 && scriptIds.every((scriptId) => bestScoreByScript.has(scriptId)),
  };
}

export function getGrammarActivityProgress(
  requiredGroups: GrammarQuestionGroup[],
  attempts: GrammarAttemptProgress[],
) {
  const latestAttemptByGroup = new Map<string, GrammarAttemptProgress>();
  for (const attempt of attempts) {
    const key = `${attempt.sectionId}:${attempt.questionType}`;
    const latest = latestAttemptByGroup.get(key);
    const attemptTime = typeof attempt.completedAt === "string"
      ? Date.parse(attempt.completedAt)
      : attempt.completedAt.getTime();
    const latestTime = latest
      ? typeof latest.completedAt === "string"
        ? Date.parse(latest.completedAt)
        : latest.completedAt.getTime()
      : Number.NEGATIVE_INFINITY;
    if (!latest || attemptTime > latestTime) {
      latestAttemptByGroup.set(key, attempt);
    }
  }

  const uniqueGroups = [...new Map(
    requiredGroups.map((group) => [`${group.sectionId}:${group.questionType}`, group]),
  ).values()];
  const completedGroups = uniqueGroups.filter((group) => {
    const latest = latestAttemptByGroup.get(`${group.sectionId}:${group.questionType}`);
    return latest !== undefined && !latest.reviewPending;
  }).length;
  const waiting = uniqueGroups.some((group) => (
    latestAttemptByGroup.get(`${group.sectionId}:${group.questionType}`)?.reviewPending === true
  ));
  const percent = uniqueGroups.length > 0
    ? Math.round((completedGroups / uniqueGroups.length) * 100)
    : 0;

  return {
    percent,
    completed: uniqueGroups.length > 0 && completedGroups === uniqueGroups.length,
    waiting,
    hasStarted: attempts.length > 0,
  };
}

export function getLessonProgress(activities: LessonActivityProgress[]) {
  const available = activities.filter((activity) => activity.status !== "unavailable");
  if (available.length === 0) return { percent: 0, completed: 0, total: 0 };

  const completed = available.filter((activity) => activity.status === "completed").length;
  const percent = Math.round(available.reduce((sum, activity) => {
    const displayedPercent = activity.status === "completed"
      ? activity.score ?? activity.percent
      : activity.status === "partial"
        ? activity.useScoreWhenPartial && activity.score != null
          ? activity.score
          : activity.percent
        : 0;
    return sum + Math.max(0, Math.min(100, displayedPercent));
  }, 0) / available.length);

  return { percent, completed, total: available.length };
}

export function isLessonProgressGreen(percent: number) {
  return percent >= 80;
}

export function areAllAvailableActivitiesGreen(activities: LessonActivityProgress[]) {
  const available = activities.filter((activity) => activity.status !== "unavailable");
  return available.length > 0 && available.every((activity) => activity.status === "completed");
}
