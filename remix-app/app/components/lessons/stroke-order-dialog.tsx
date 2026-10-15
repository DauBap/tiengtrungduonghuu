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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, PenLine, Redo2, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Overlay } from "~/components/common/overlay";
// Type-only irt: bị xóa hoàn toàn khi build nên không kéo thư viện vào bundle server.
import type HanziWriterInstance from "hanzi-writer";

/** Chỉ chữ Hán mới có dữ liệu nét; bỏ chữ Latin, số và dấu câu lẫn trong từ. */
const HAN_CHAR = /\p{Script=Han}/u;
const INK_COLOR = "#1f2937";

export function splitHanCharacters(text: string): string[] {
  return [...text].filter((char) => HAN_CHAR.test(char));
}

interface StrokeOrderDialogProps {
  chinese: string;
  pinyin: string;
  translation: string;
  showPinyin?: boolean;
  onClose: () => void;
}

type HandwritingCommand = { id: number; action: "undo" | "redo" | "clear" };

function HandwritingCanvas({
  characters,
  characterSize,
  frameHeight,
  command,
  onHistoryChange,
}: {
  characters: string[];
  characterSize: number;
  frameHeight: number;
  command: HandwritingCommand;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outlineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const undoStackRef = useRef<ImageData[]>([]);
  const redoStackRef = useRef<ImageData[]>([]);

  const reportHistory = useCallback(() => {
    onHistoryChange(undoStackRef.current.length > 1, redoStackRef.current.length > 0);
  }, [onHistoryChange]);

  const restoreImage = (image: ImageData) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(image, 0, 0);
  };

  useEffect(() => {
    if (command.id === 0) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    if (command.action === "clear") {
      context.clearRect(0, 0, canvas.width, canvas.height);
      undoStackRef.current = [context.getImageData(0, 0, canvas.width, canvas.height)];
      redoStackRef.current = [];
    } else if (command.action === "undo" && undoStackRef.current.length > 1) {
      redoStackRef.current.push(undoStackRef.current.pop()!);
      restoreImage(undoStackRef.current[undoStackRef.current.length - 1]);
    } else if (command.action === "redo" && redoStackRef.current.length > 0) {
      const image = redoStackRef.current.pop()!;
      undoStackRef.current.push(image);
      restoreImage(image);
    }
    reportHistory();
  }, [command, reportHistory]);

  const getPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = getPosition(event);
    context.beginPath();
    context.arc(x, y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fillStyle = INK_COLOR;
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
  };

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { x, y } = getPosition(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    canvas.releasePointerCapture(event.pointerId);
    const context = canvas.getContext("2d");
    context?.closePath();
    if (context) {
      undoStackRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
      redoStackRef.current = [];
      reportHistory();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const resizeCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(bounds.width * pixelRatio);
      canvas.height = Math.round(bounds.height * pixelRatio);
      context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);
      context.strokeStyle = INK_COLOR;
      context.lineWidth = 4;
      context.lineCap = "round";
      context.lineJoin = "round";
      undoStackRef.current = [context.getImageData(0, 0, canvas.width, canvas.height)];
      redoStackRef.current = [];
      reportHistory();
    };

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    resizeCanvas();
    return () => observer.disconnect();
  }, [reportHistory]);

  useEffect(() => {
    let cancelled = false;
    void import("hanzi-writer").then(({ default: HanziWriter }) => {
      if (cancelled) return;
      characters.forEach((character, index) => {
        const element = outlineRefs.current[index];
        if (!element) return;
        element.innerHTML = "";
        HanziWriter.create(element, character, {
          width: characterSize,
          height: characterSize,
          padding: 8,
          showCharacter: false,
          showOutline: true,
          outlineColor: "#e5e7eb",
          strokeColor: INK_COLOR,
        });
      });
    }).catch(() => {
      if (cancelled) return;
      outlineRefs.current.forEach((element, index) => {
        if (!element) return;
        element.textContent = characters[index] ?? "";
        element.className = "content-text hanzi-display text-7xl text-muted-foreground/20";
      });
    });

    return () => {
      cancelled = true;
      outlineRefs.current.forEach((element) => {
        if (element) element.innerHTML = "";
      });
    };
  }, [characterSize, characters]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-muted/20 p-3" style={{ height: frameHeight }}>
      <div aria-hidden className="pointer-events-none flex h-full flex-wrap items-center justify-center gap-2">
        {characters.map((character, index) => (
          <div
            key={`${character}-${index}`}
            ref={(element) => { outlineRefs.current[index] = element; }}
            className="rounded-lg bg-background"
            style={{ width: characterSize, height: characterSize }}
          />
        ))}
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Vùng luyện viết chữ Hán"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
    </div>
  );
}

export function StrokeOrderDialog({ chinese, pinyin, translation, showPinyin = true, onClose }: StrokeOrderDialogProps) {
  const chars = splitHanCharacters(chinese);

  // Một ô vẽ cho mỗi chữ. Từ nhiều chữ thì thu nhỏ lại cho vừa hộp thoại.
  const size = chars.length > 3 ? 96 : chars.length > 1 ? 128 : 180;
  const handwritingChars = useMemo(() => chars, [chinese]);
  const strokeFrameRef = useRef<HTMLDivElement>(null);
  const [strokeFrameHeight, setStrokeFrameHeight] = useState(size + 26);

  const containerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const writersRef = useRef<HanziWriterInstance[]>([]);
  /**
   * Mỗi lượt chạy mang một số thứ tự. Tăng số này là huỷ lượt đang chạy:
   * hanzi-writer không có hàm destroy, và animation bị bỏ giữa đường thì
   * onComplete không bao giờ gọi — nên không thể chờ promise để dừng.
   */
  const runRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [handwritingKey, setHandwritingKey] = useState(0);
  const [showHandwriting, setShowHandwriting] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [handwritingCommand, setHandwritingCommand] = useState<HandwritingCommand>({ id: 0, action: "clear" });
  const updateHandwritingHistory = useCallback((canUndo: boolean, canRedo: boolean) => {
    setHistoryAvailability({ canUndo, canRedo });
  }, []);

  const performHandwritingCommand = (action: HandwritingCommand["action"]) => {
    if (action === "clear") setHistoryAvailability({ canUndo: false, canRedo: false });
    setHandwritingCommand((command) => ({ id: command.id + 1, action }));
  };

  useEffect(() => {
    const frame = strokeFrameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => setStrokeFrameHeight(frame.offsetHeight));
    observer.observe(frame);
    setStrokeFrameHeight(frame.offsetHeight);
    return () => observer.disconnect();
  }, [chinese]);

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
    <Overlay onClose={onClose} className="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="content-text hanzi-display text-2xl font-bold leading-tight">{chinese}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showPinyin && <span className="content-text pinyin-text text-sm text-primary">{pinyin}{translation ? " · " : ""}</span>}
              {translation && <span className="content-text text-sm">{translation}</span>}
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
            <div ref={strokeFrameRef} className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-muted/20 p-3">
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

        <div className="border-t pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={showHandwriting}
            onClick={() => setShowHandwriting((shown) => !shown)}
          >
            <PenLine className="mr-1.5 h-4 w-4" />
            {showHandwriting ? "Ẩn luyện viết tay" : "Mở luyện viết tay"}
            {showHandwriting
              ? <ChevronUp className="ml-1.5 h-4 w-4" />
              : <ChevronDown className="ml-1.5 h-4 w-4" />}
          </Button>
          {showHandwriting && (
            <section className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Viết theo nét mờ bằng ngón tay, bút cảm ứng hoặc chuột.</p>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Hoàn tác"
                    aria-label="Hoàn tác nét vẽ"
                    disabled={!historyAvailability.canUndo}
                    onClick={() => performHandwritingCommand("undo")}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Làm lại"
                    aria-label="Làm lại nét vẽ"
                    disabled={!historyAvailability.canRedo}
                    onClick={() => performHandwritingCommand("redo")}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Xóa nét"
                    aria-label="Xóa tất cả nét vẽ"
                    onClick={() => performHandwritingCommand("clear")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div key={handwritingKey} className="w-full">
                <HandwritingCanvas
                  characters={handwritingChars}
                  characterSize={size}
                  frameHeight={strokeFrameHeight}
                  command={handwritingCommand}
                  onHistoryChange={updateHandwritingHistory}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </Overlay>
  );
}
