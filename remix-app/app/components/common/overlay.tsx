import { useEffect } from "react";
import { useModalScrollLock } from "~/components/common/use-modal-scroll-lock";

/** Nền mờ + hộp thoại giữa màn hình, dùng cho các modal ở trang admin */
export function Overlay({
  children,
  onClose,
  className = "max-w-md",
  closeOnEscape = false,
  closeOnBackdrop = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
}) {
  useModalScrollLock(true);

  useEffect(() => {
    if (!closeOnEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeOnEscape, onClose]);

  return (
    <div className="fixed inset-0 !mt-0 z-50 flex items-center justify-center p-3 sm:p-4" role="presentation">
      {closeOnBackdrop ? (
        <button type="button" className="absolute inset-0 z-0 bg-black/50" aria-label="Đóng hộp thoại" onClick={onClose} />
      ) : (
        <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      )}
      <div data-modal-scroll-container className={`relative z-10 w-full ${className} max-h-[90vh] overflow-y-auto rounded-xl border bg-background p-4 shadow-xl sm:p-6`}>
        {children}
      </div>
    </div>
  );
}
