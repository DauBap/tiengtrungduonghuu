import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { AssessmentDraftData, AssessmentDraftScope } from "~/lib/assessment-drafts";

type DraftResponse = { success?: boolean; error?: string; savedAt?: string };

export function useAssessmentDraft<T extends AssessmentDraftData>({
  scope,
  initialData,
  initialSaved = false,
  enabled = true,
  debounceMs = 500,
}: {
  scope: AssessmentDraftScope | null;
  initialData: T;
  initialSaved?: boolean;
  enabled?: boolean;
  debounceMs?: number;
}) {
  const fetcher = useFetcher<DraftResponse>();
  const scopeJson = scope ? JSON.stringify(scope) : "";
  const [data, setData] = useState<T>(initialData);
  const [dirty, setDirty] = useState(false);
  const [hasSaved, setHasSaved] = useState(initialSaved);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scopeJson || !enabled || !dirty || fetcher.state !== "idle") return;
    const timer = window.setTimeout(() => {
      fetcher.submit(
        {
          intent: "save",
          scope: scopeJson,
          data: JSON.stringify(data),
        },
        { method: "post", action: "/student/assessment-drafts" },
      );
      setDirty(false);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [data, debounceMs, dirty, enabled, fetcher.state, fetcher.submit, scopeJson]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      setHasSaved(true);
      setError(null);
    } else if (fetcher.data.error) {
      setError(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state]);

  const update = useCallback((nextData: T | ((current: T) => T)) => {
    if (!scopeJson || !enabled) return;
    setData((current) => typeof nextData === "function"
      ? nextData(current)
      : nextData);
    setDirty(true);
    setError(null);
  }, [enabled, scopeJson]);
  const clear = useCallback(() => {
    setDirty(false);
    setHasSaved(false);
    setError(null);
    if (!scopeJson || !enabled) return;
    fetcher.submit(
      { intent: "delete", scope: scopeJson },
      { method: "post", action: "/student/assessment-drafts" },
    );
  }, [enabled, fetcher.submit, scopeJson]);

  return {
    data,
    update,
    clear,
    isSaving: dirty || fetcher.state !== "idle",
    hasSaved,
    error,
  };
}
