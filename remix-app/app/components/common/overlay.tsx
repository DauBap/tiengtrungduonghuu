import { useModalScrollLock } from "~/components/common/use-modal-scroll-lock";

/** Nền mờ + hộp thoại giữa màn hình, dùng cho các modal ở trang admin */
export function Overlay({
  children,
  className = "max-w-md",
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  useModalScrollLock(true);

  return (
    <div className="fixed inset-0 !mt-0 z-50 flex items-center justify-center p-3 sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div data-modal-scroll-container className={`relative w-full ${className} max-h-[90vh] overflow-y-auto rounded-xl border bg-background p-4 shadow-xl sm:p-6`}>
        {children}
      </div>
    </div>
  );
}
