import { cn } from "~/lib/utils";
import { ClipboardCheck, BookOpen, AudioLines, MoveRight, Languages } from "lucide-react";
import { BLOCK_TYPES, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";

/** Tab ôn từ vựng là tab inline, không phải route riêng nữa. */
export type LessonTab = LearningBlockType | "TEST" | "LESSON" | "PHONETICS" | "TRANSLATION";
export type LessonTabProgressState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_REVIEW";
const EMPTY_PROGRESS_STATES: Readonly<Record<string, LessonTabProgressState>> = {};

interface LessonTabsProps {
  activeTab: LessonTab;
  onTabChange: (tab: LessonTab) => void;
  /**
   * Dạng bài có nội dung học được trong bài này; dạng khác vẫn hiện nhưng mờ đi.
   * Gồm cả "PHONETICS" — dạng này không phải LearningBlockType (không soạn
   * trong admin) nhưng vẫn có tab riêng.
   */
  availableTypes: Set<LearningBlockType | "PHONETICS" | "TRANSLATION">;
  /** Bài có từ vựng để tạo quiz hay chưa. */
  hasQuiz: boolean;
  progressStates?: Readonly<Record<string, LessonTabProgressState>>;
}

export function LessonTabs({ activeTab, onTabChange, availableTypes, hasQuiz, progressStates = EMPTY_PROGRESS_STATES }: LessonTabsProps) {
  const baseTab = "lesson-tab flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap";
  const ordered = ["FLASHCARD", "LISTENING", "VOCABULARY", "LESSON", "PHONETICS", "TEST", "GRAMMAR", "TRANSLATION", "WORKBOOK"] as const;
  const getTabStatus = (type: LessonTab) => progressStates[type === "TEST" ? "VOCABULARY_TEST" : type] ?? "NOT_STARTED";
  const getTabStatusClasses = (type: LessonTab, isActive = false) => {
    const state = getTabStatus(type);
    const activeBorder = isActive ? "border-primary" : "";
    if (state === "COMPLETED") {
      return cn("border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-200", activeBorder);
    }
    if (state === "IN_PROGRESS" || state === "NEEDS_REVIEW") {
      return cn("border-orange-500 bg-orange-50 text-orange-800 dark:border-orange-400 dark:bg-orange-950/50 dark:text-orange-200", activeBorder);
    }
    return cn(isActive ? "border-primary text-primary" : "border-transparent text-foreground", "bg-background");
  };
  const getTabTitle = (type: LessonTab) => {
    const state = getTabStatus(type);
    if (state === "COMPLETED") return "Đã hoàn thành";
    if (state === "IN_PROGRESS") return "Đang làm";
    if (state === "NEEDS_REVIEW") return "Đang chờ giáo viên xem";
    return "Chưa làm";
  };

  return (
    <div className="border-b border-border">
      <div className="flex touch-pan-x overflow-x-auto scrollbar-none">
        {ordered.map((type) => {
            if (type === "TEST") {
              const statusClasses = getTabStatusClasses("TEST", activeTab === "TEST");
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onTabChange("TEST")}
                  aria-current={activeTab === "TEST" ? "page" : undefined}
                  title={getTabTitle("TEST")}
                  className={cn(
                    baseTab,
                    activeTab === "TEST"
                      ? statusClasses
                      : hasQuiz
                        ? cn(statusClasses, "hover:brightness-95")
                        : "border-transparent text-muted-foreground"
                  )}
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Ôn từ vựng
                </button>
              );
            }

            if (type === "LESSON") {
              const statusClasses = getTabStatusClasses("LESSON", activeTab === "LESSON");
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onTabChange("LESSON")}
                  aria-current={activeTab === "LESSON" ? "page" : undefined}
                  title={getTabTitle("LESSON")}
                  className={cn(
                    baseTab,
                    activeTab === "LESSON"
                      ? statusClasses
                      : cn(statusClasses, "hover:brightness-95")
                  )}
                >
                  <BookOpen className="h-4 w-4" />
                  Bài khóa
                </button>
              );
            }

            if (type === "PHONETICS") {
              // Chỉ hiện khi bài có block Ngữ âm — khác Từ vựng/Ngữ pháp, dạng
              // này không có nội dung thay thế để fallback.
              if (!availableTypes.has("PHONETICS")) return null;
              const statusClasses = getTabStatusClasses("PHONETICS", activeTab === "PHONETICS");
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onTabChange("PHONETICS")}
                  aria-current={activeTab === "PHONETICS" ? "page" : undefined}
                  title={getTabTitle("PHONETICS")}
                  className={cn(
                    baseTab,
                    activeTab === "PHONETICS"
                      ? statusClasses
                      : cn(statusClasses, "hover:brightness-95")
                  )}
                >
                  <AudioLines className="h-4 w-4" />
                  Ngữ âm
                </button>
              );
            }

            if (type === "TRANSLATION") {
              if (!availableTypes.has("TRANSLATION")) return null;
              const statusClasses = getTabStatusClasses("TRANSLATION", activeTab === "TRANSLATION");
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onTabChange("TRANSLATION")}
                  aria-current={activeTab === "TRANSLATION" ? "page" : undefined}
                  title={getTabTitle("TRANSLATION")}
                  className={cn(
                    baseTab,
                    activeTab === "TRANSLATION"
                      ? statusClasses
                      : cn(statusClasses, "hover:brightness-95")
                  )}
                >
                  <Languages className="h-4 w-4" />
                  Luyện dịch
                </button>
              );
            }

            if ((type === "GRAMMAR" || type === "WORKBOOK") && !availableTypes.has(type)) return null;

            const blockType = type as LearningBlockType;
            const Icon = BLOCK_META[blockType].icon;
            const isActive = activeTab === blockType;
            const hasContent = availableTypes.has(blockType);
            const statusClasses = getTabStatusClasses(blockType, isActive);

            return (
              <button
                key={blockType}
                type="button"
                onClick={() => onTabChange(blockType)}
                aria-current={isActive ? "page" : undefined}
                title={getTabTitle(blockType)}
                className={cn(
                  baseTab,
                  isActive
                    ? statusClasses
                    : hasContent
                      ? cn(statusClasses, "hover:brightness-95")
                      : "border-transparent text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {BLOCK_META[blockType].label}
              </button>
            );
        })}
      </div>
      <p className="flex items-center justify-end gap-1 px-2 pt-1.5 text-xs text-muted-foreground sm:hidden">
        Vuốt ngang để xem thêm hoạt động
        <MoveRight className="h-3.5 w-3.5" aria-hidden="true" />
      </p>
    </div>
  );
}
