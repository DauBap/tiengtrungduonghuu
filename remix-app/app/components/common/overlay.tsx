/** Nền mờ + hộp thoại giữa màn hình, dùng cho các modal ở trang admin */
export function Overlay({
  children,
  onClose,
  className = "max-w-md",
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
        aria-label="Đóng hộp thoại"
      />
      <div className={`relative w-full ${className} max-h-[90vh] overflow-y-auto rounded-xl border bg-background p-4 shadow-xl sm:p-6`}>
        {children}
      </div>
    </div>
  );
}
