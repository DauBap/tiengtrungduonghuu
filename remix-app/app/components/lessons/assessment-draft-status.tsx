export function AssessmentDraftStatus({
  isSaving,
  hasSaved,
  error,
}: {
  isSaving: boolean;
  hasSaved: boolean;
  error: string | null;
}) {
  return (
    <div aria-live="polite">
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error} Hãy giữ trang này mở và thử lại.</p>
      ) : (isSaving || hasSaved) ? (
        <p role="status" className="text-xs text-muted-foreground">
          {isSaving ? "Đang lưu câu trả lời..." : "Đã lưu câu trả lời. Bạn có thể quay lại làm tiếp sau."}
        </p>
      ) : null}
    </div>
  );
}
