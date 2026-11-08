import { createContext, useContext } from "react";
import { useAppSettings } from "~/lib/app-settings";

const LessonPinyinVisibilityContext = createContext<boolean | null>(null);

export function LessonPinyinVisibilityProvider({
  tab,
  children,
}: {
  tab: string;
  children: React.ReactNode;
}) {
  const settings = useAppSettings();
  const showPinyin = settings.showPinyinByTab[tab] ?? false;

  return (
    <LessonPinyinVisibilityContext.Provider value={showPinyin}>
      {children}
    </LessonPinyinVisibilityContext.Provider>
  );
}

export function usePinyinVisibility() {
  const lessonVisibility = useContext(LessonPinyinVisibilityContext);
  const settings = useAppSettings();
  return lessonVisibility ?? settings.showPinyin;
}
