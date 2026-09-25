/**
 * Hộp thoại hiện cách viết chữ Hán: tô từng nét theo đúng thứ tự bút.
 *
 * Dùng hanzi-writer, thư viện CHỈ chạy được ở browser (nó đọc document/window
 * ngay khi import) nên phải import động trong effect — import thẳng ở đầu file
 * là route chết ở bước server render.
 *
 * Dữ liệu nét chữ được hanzi-writer tải từ CDN jsdelivr theo từng chữ, không
 * nằm trong bundle. Mất mạng thì hiện thông báo lỗi thay vì khung trắng.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Overlay } from "~/components/common/overlay";
// Type-only import: bị xóa hoàn toàn khi build nên không kéo thư viện vào bundle server.
import type HanziWriterInstance from "hanzi-writer";

/** Chỉ chữ Hán mới có dữ liệu nét; bỏ chữ Latin, số và dấu câu lẫn trong từ. */
const HAN_CHAR = /\p{Script=Han}/u;

export function splitHanCharacters(text: string): string[] {
  return [...text].filter((char) => HAN_CHAR.test(char));
}

interface StrokeOrderDialogProps {
  chinese: string;
  pinyin: string;
  translation: string;
  onClose: () => void;
}

export function StrokeOrderDialog({ chinese, pinyin, translation, onClose }: StrokeOrderDialogProps) {
  const chars = splitHanCharacters(chinese);

  // Một ô vẽ cho mỗi chữ. Từ nhiều chữ thì thu nhỏ lại cho vừa hộp thoại.
  const size = chars.length > 3 ? 96 : chars.length > 1 ? 128 : 180;

  const containerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const writersRef = useRef<HanziWriterInstance[]>([]);
  /**
   * Mỗi lượt chạy mang một số thứ tự. Tăng số này là huỷ lượt đang chạy:
   * hanzi-writer không có hàm destroy, và animation bị bỏ giữa đường thì
   * onComplete không bao giờ gọi — nên không thể chờ promise để dừng.
   */
  const runRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  /** Tô lần lượt từng chữ. Trả về khi hết chữ hoặc khi lượt bị huỷ. */
  const play = useCallback(async () => {
    const run = ++runRef.current;
    for (const writer of writersRef.current) {
      if (runRef.current !== run) return;
      await new Promise<void>((resolve) => {
        void writer.animateCharacter({ onComplete: () => resolve() });
      });
    }
  }, []);

  useEffect(() => {
    if (chars.length === 0) {
      setStatus("error");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { default: HanziWriter } = await import("hanzi-writer");
        if (cancelled) return;

        writersRef.current = chars.flatMap((char, i) => {
          const el = containerRefs.current[i];
          if (!el) return [];
          el.innerHTML = "";
          return [
            HanziWriter.create(el, char, {
              width: size,
              height: size,
              padding: 8,
              showCharacter: false,
              strokeAnimationSpeed: 1.2,
              delayBetweenStrokes: 300,
              strokeColor: "#1f2937",
              outlineColor: "#e5e7eb",
            }),
          ];
        });

        if (cancelled) return;
        setStatus("ready");
        void play();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      // Huỷ lượt đang chạy rồi dọn SVG do thư viện chèn vào.
      runRef.current++;
      for (const el of containerRefs.current) {
        if (el) el.innerHTML = "";
      }
      writersRef.current = [];
    };
    // chinese là khóa duy nhất của nội dung cần vẽ; size suy ra từ nó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chinese]);

  return (
    <Overlay onClose={onClose} className="max-w-sm">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold leading-tight">{chinese}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono text-primary">{pinyin}</span>
              {translation ? ` · ${translation}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {status === "error" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {chars.length === 0
              ? "Từ này không có chữ Hán nên không hiện được cách viết."
              : "Không tải được dữ liệu nét chữ. Kiểm tra kết nối mạng rồi thử lại."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-muted/20 p-3">
              {chars.map((char, i) => (
                <div
                  key={`${char}-${i}`}
                  ref={(el) => {
                    containerRefs.current[i] = el;
                  }}
                  style={{ width: size, height: size }}
                  className="rounded-lg bg-background"
                  aria-hidden
                />
              ))}
            </div>

            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void play()}
                disabled={status !== "ready"}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Phát lại
              </Button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
