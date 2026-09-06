import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { ClipboardCheck } from "lucide-react";
import { BLOCK_TYPES, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";

/** Tab bài kiểm tra không phải một dạng block — nó là route riêng. */
export type LessonTab = LearningBlockType | "TEST";

interface LessonTabsProps {
  activeTab: LessonTab;
  onTabChange: (tab: LearningBlockType) => void;
  /** Dạng bài có nội dung học được trong bài này; dạng khác vẫn hiện nhưng mờ đi. */
  availableTypes: Set<LearningBlockType>;
  lessonId: string;
  courseId: string;
}

export function LessonTabs({ activeTab, onTabChange, availableTypes, lessonId, courseId }: LessonTabsProps) {
  const baseTab = "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap";

  return (
    <div className="border-b border-border">
      {/* overflow-x-auto: 5 tab dễ tràn trên màn hình hẹp */}
      <div className="flex overflow-x-auto">
        {BLOCK_TYPES.map((type) => {
          const Icon = BLOCK_META[type].icon;
          const isActive = activeTab === type;
          const hasContent = availableTypes.has(type);

          return (
            <button
              key={type}
              type="button"
              onClick={() => onTabChange(type)}
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
              {BLOCK_META[type].label}
            </button>
          );
        })}

        <Link
          to={`/student/courses/${courseId}/lessons/${lessonId}/test`}
          className={cn(baseTab, "border-transparent text-muted-foreground hover:text-foreground hover:border-border")}
        >
          <ClipboardCheck className="h-4 w-4" />
          Bài thi
        </Link>
      </div>
    </div>
  );
}
