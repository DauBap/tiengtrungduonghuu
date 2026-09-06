import { cn } from "~/lib/utils";
import { Link } from "react-router";
import { Layers, Headphones, BookOpen, GraduationCap, ClipboardCheck } from "lucide-react";

type BlockType = "FLASHCARD" | "LISTENING" | "VOCABULARY" | "GRAMMAR";

interface LessonTabsProps {
  activeTab: BlockType | "TEST";
  onTabChange: (tab: BlockType | "TEST") => void;
  blockTypes: Set<BlockType>;
  lessonId: string;
  courseId: string;
}

const TAB_ICONS: Record<BlockType | "TEST", React.ComponentType<{ className?: string }>> = {
  FLASHCARD: Layers,
  LISTENING: Headphones,
  VOCABULARY: BookOpen,
  GRAMMAR: GraduationCap,
  TEST: ClipboardCheck,
};

const TAB_LABELS: Record<BlockType | "TEST", string> = {
  FLASHCARD: "Flashcard",
  LISTENING: "Nghe câu",
  VOCABULARY: "Từ vựng",
  GRAMMAR: "Ngữ pháp",
  TEST: "Bài thi",
};

export function LessonTabs({ activeTab, onTabChange, blockTypes, lessonId, courseId }: LessonTabsProps) {
  const tabs: (BlockType | "TEST")[] = ["FLASHCARD", "LISTENING", "VOCABULARY", "GRAMMAR", "TEST"];

  return (
    <div className="border-b border-border">
      <div className="flex gap-0">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const label = TAB_LABELS[tab];
          const isActive = activeTab === tab;
          const hasContent = tab === "TEST" || blockTypes.has(tab as BlockType);

          if (tab === "TEST") {
            return (
              <Link
                key={tab}
                to={`/student/courses/${courseId}/lessons/${lessonId}/test`}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          }

          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : hasContent
                    ? "border-transparent text-foreground hover:text-primary hover:border-border"
                    : "border-transparent text-muted-foreground opacity-60"
              )}
              disabled={!hasContent}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
