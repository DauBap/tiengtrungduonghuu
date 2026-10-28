import { useEffect } from "react";

let activeModalCount = 0;
let originalStyles: {
  bodyOverflow: string;
  bodyPaddingRight: string;
  documentOverflow: string;
} | null = null;
let lockedScrollY = 0;

function lockDocumentScroll() {
  if (typeof document === "undefined") return () => {};

  activeModalCount += 1;
  if (activeModalCount === 1) {
    const body = document.body;
    const documentElement = document.documentElement;
    lockedScrollY = window.scrollY;
    originalStyles = {
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      documentOverflow: documentElement.style.overflow,
    };

    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
  }

  return () => {
    activeModalCount = Math.max(0, activeModalCount - 1);
    if (activeModalCount !== 0 || !originalStyles) return;

    document.body.style.overflow = originalStyles.bodyOverflow;
    document.body.style.paddingRight = originalStyles.bodyPaddingRight;
    document.documentElement.style.overflow = originalStyles.documentOverflow;
    originalStyles = null;
    window.scrollTo(0, lockedScrollY);
  };
}

export function useModalScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;
    return lockDocumentScroll();
  }, [isOpen]);
}
