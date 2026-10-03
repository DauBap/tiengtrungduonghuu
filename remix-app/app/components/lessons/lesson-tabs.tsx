import { cn } from "~/lib/utils";
import { ClipboardCheck, BookOpen, AudioLines } from "lucide-react";
import { BLOCK_TYPES, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";

/** Tab ôn từ vựng là tab inline, không phải route riêng nữa. */
export type LessonTab = LearningBlockType | "TEST" | "LESSON" | "PHONETICS";

interface LessonTabsProps {
  activeTab: LessonTab;
  onTabChange: (tab: LessonTab) => void;
  /**
   * Dạng bài có nội dung học được trong bài này; dạng khác vẫn hiện nhưng mờ đi.
   * Gồm cả "PHONETICS" — dạng này không phải LearningBlockType (không soạn
   * trong admin) nhưng vẫn có tab riêng.
   */
  availableTypes: Set<LearningBlockType | "PHONETICS">;
  /** Bài có từ vựng để tạo quiz hay chưa. */
  hasQuiz: boolean;
}

export function LessonTabs({ activeTab, onTabChange, availableTypes, hasQuiz }: LessonTabsProps) {
  const baseTab = "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap";
  const ordered = ["FLASHCARD", "LISTENING", "VOCABULARY", "LESSON", "PHONETICS", "TEST", "GRAMMAR", "WORKBOOK"] as const;

  return (
    <div className="border-b border-border">
      <div className="flex overflow-x-auto">
        {ordered.map((type) => {
            if (type === "TEST") {
              return (
                <button
                  key={type}
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
                  Ôn từ vựng
                </button>
              );
            }

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

            if (type === "PHONETICS") {
              // Chỉ hiện khi bài có block Ngữ âm — khác Từ vựng/Ngữ pháp, dạng
              // này không có nội dung thay thế để fallback.
              if (!availableTypes.has("PHONETICS")) return null;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onTabChange("PHONETICS")}
                  aria-current={activeTab === "PHONETICS" ? "page" : undefined}
                  className={cn(
                    baseTab,
                    activeTab === "PHONETICS"
                      ? "border-primary text-primary"
                      : "border-transparent text-foreground hover:text-primary hover:border-border"
                  )}
                >
                  <AudioLines className="h-4 w-4" />
                  Ngữ âm
                </button>
              );
            }

            if ((type === "GRAMMAR" || type === "WORKBOOK") && !availableTypes.has(type)) return null;

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
      </div>
    </div>
  );
}
