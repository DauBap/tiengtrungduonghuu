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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative w-full ${className} max-h-[90vh] overflow-y-auto rounded-xl border bg-background p-6 shadow-xl`}>
        {children}
      </div>
    </div>
  );
}
