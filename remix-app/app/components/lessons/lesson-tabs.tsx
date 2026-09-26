import { cn } from "~/lib/utils";
import { ClipboardCheck, BookOpen } from "lucide-react";
import { BLOCK_TYPES, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";

/** Tab bài kiểm tra là tab inline, không phải route riêng nữa. */
export type LessonTab = LearningBlockType | "TEST" | "LESSON";

interface LessonTabsProps {
  activeTab: LessonTab;
  onTabChange: (tab: LessonTab) => void;
  /** Dạng bài có nội dung học được trong bài này; dạng khác vẫn hiện nhưng mờ đi. */
  availableTypes: Set<LearningBlockType>;
  /** Bài có từ vựng để tạo quiz hay chưa. */
  hasQuiz: boolean;
}

export function LessonTabs({ activeTab, onTabChange, availableTypes, hasQuiz }: LessonTabsProps) {
  const baseTab = "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap";
  const ordered = ["FLASHCARD", "LISTENING", "VOCABULARY", "LESSON", "GRAMMAR", "WORKBOOK"] as const;

  return (
    <div className="border-b border-border">
      <div className="flex overflow-x-auto">
        {ordered.map((type) => {
          if (type === "LESSON") {
            return (
              <button
                key={type}
                type="button"
                onClick={() => onTabChange("LESSON")}
                aria-current={activeTab === "LESSON" ? "page" : undefined}
                className={cn(
                  baseTab,
                  activeTab === "LESSON"
                    ? "border-primary text-primary"
                    : "border-transparent text-foreground hover:text-primary hover:border-border"
                )}
              >
                <BookOpen className="h-4 w-4" />
                Bài khóa
              </button>
            );
          }

          const blockType = type as LearningBlockType;
          const Icon = BLOCK_META[blockType].icon;
          const isActive = activeTab === blockType;
          const hasContent = availableTypes.has(blockType);

          return (
            <button
              key={blockType}
              type="button"
              onClick={() => onTabChange(blockType)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                baseTab,
                isActive
                  ? "border-primary text-primary"
                  : hasContent
                    ? "border-transparent text-foreground hover:text-primary hover:border-border"
                    : "border-transparent text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {BLOCK_META[blockType].label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onTabChange("TEST")}
          aria-current={activeTab === "TEST" ? "page" : undefined}
          className={cn(
            baseTab,
            activeTab === "TEST"
              ? "border-primary text-primary"
              : hasQuiz
                ? "border-transparent text-foreground hover:text-primary hover:border-border"
                : "border-transparent text-muted-foreground"
          )}
        >
          <ClipboardCheck className="h-4 w-4" />
          Kiểm tra
        </button>
      </div>
    </div>
  );
}
