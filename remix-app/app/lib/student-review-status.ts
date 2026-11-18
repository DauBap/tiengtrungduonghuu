export function resolveFinalEvaluationStatus(
  reviewStatus: string | null | undefined,
  legacyDecision: string | null | undefined,
) {
  return reviewStatus ?? legacyDecision ?? null;
}
