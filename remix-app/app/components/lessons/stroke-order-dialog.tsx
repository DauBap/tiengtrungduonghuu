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
import { ChevronDown, ChevronUp, PenLine, RotateCcw, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Overlay } from "~/components/common/overlay";
// Type-only irt: bị xóa hoàn toàn khi build nên không kéo thư viện vào bundle server.
import type HanziWriterInstance from "hanzi-writer";

/** Chỉ chữ Hán mới có dữ liệu nét; bỏ chữ Latin, số và dấu câu lẫn trong từ. */
const HAN_CHAR = /\p{Script=Han}/u;
const HINT_STROKE_COLOR = "#00000069";

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

type WritingProgress = {
  characterIndex: number;
  strokeNumber: number;
  strokeCount: number;
  complete: boolean;
};

function GuidedHandwriting({
  characters,
  characterSize,
  frameHeight,
}: {
  characters: string[];
  characterSize: number;
  frameHeight: number;
}) {
  const containerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const writersRef = useRef<HanziWriterInstance[]>([]);
  const hintPathRef = useRef<SVGPathElement | null>(null);
  const hintFillRef = useRef<SVGPathElement | null>(null);
  const resetQuizRef = useRef<() => void>(() => {});
  const loadFailedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [strokeGuides, setStrokeGuides] = useState<Array<Array<{ path: string; medianPath: string }>>>([]);
  const [activeStrokeIndex, setActiveStrokeIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<WritingProgress>({
    characterIndex: 0,
    strokeNumber: 1,
    strokeCount: 0,
    complete: false,
  });

  useEffect(() => {
    let cancelled = false;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedMotionRef = { current: motionPreference.matches };
    const updateMotionPreference = () => {
      reducedMotionRef.current = motionPreference.matches;
    };
    motionPreference.addEventListener("change", updateMotionPreference);
    loadFailedRef.current = false;
    setStatus("loading");
    setProgress({ characterIndex: 0, strokeNumber: 1, strokeCount: 0, complete: false });
    setStrokeGuides([]);
    setActiveStrokeIndex(null);

    void import("hanzi-writer").then(({ default: HanziWriter }) => {
      if (cancelled) return;
      const writers: HanziWriterInstance[] = [];
      characters.forEach((character, index) => {
        const element = containerRefs.current[index];
        if (!element) return;
        element.innerHTML = "";
        const onLoadCharDataError = () => {
          if (!cancelled) {
            loadFailedRef.current = true;
            setStatus("error");
          }
        };
        writers.push(HanziWriter.create(element, character, {
          width: characterSize,
          height: characterSize,
          padding: 8,
          showCharacter: false,
          showOutline: true,
          outlineColor: "#cbd5e1",
          strokeColor: "#0f172a",
          drawingColor: "#030303",
          drawingWidth: 6,
          markStrokeCorrectAfterMisses: false,
          showHintAfterMisses: false,
          acceptBackwardsStrokes: false,
          onLoadCharDataError,
        }));
      });
      writersRef.current = writers;

      const flashStroke = (strokeNum: number) => {
        setActiveStrokeIndex(strokeNum);
      };

      const startQuiz = (characterIndex: number) => {
        if (cancelled) return;
        const writer = writers[characterIndex];
        if (!writer) {
          setProgress((current) => ({ ...current, complete: true }));
          return;
        }

        setStatus("loading");
        void (async () => {
          try {
            await writer.quiz({
              markStrokeCorrectAfterMisses: false,
              showHintAfterMisses: false,
              acceptBackwardsStrokes: false,
              onCorrectStroke: ({ strokeNum, strokesRemaining }) => {
                if (cancelled) return;
                setProgress({
                  characterIndex,
                  strokeNumber: strokeNum + 2,
                  strokeCount: strokeNum + strokesRemaining + 1,
                  complete: false,
                });
                setStatus("ready");
                if (strokesRemaining > 0) {
                  flashStroke(strokeNum + 1);
                } else {
                  setActiveStrokeIndex(null);
                }
              },
              onComplete: () => {
                if (cancelled) return;
                if (characterIndex + 1 < writers.length) {
                  setProgress({
                    characterIndex: characterIndex + 1,
                    strokeNumber: 1,
                    strokeCount: 0,
                    complete: false,
                  });
                  startQuiz(characterIndex + 1);
                } else {
                  setActiveStrokeIndex(null);
                  setProgress((current) => ({ ...current, complete: true }));
                }
              },
            });
            if (!cancelled && !loadFailedRef.current) {
              flashStroke(0);
              setStatus("ready");
            }
          } catch {
            if (!cancelled) {
              loadFailedRef.current = true;
              setStatus("error");
            }
          }
        })();
      };
      resetQuizRef.current = () => {
        setActiveStrokeIndex(null);
        setStatus("loading");
        void Promise.all(writers.map((writer, index) => writer.setCharacter(characters[index])))
          .then(() => {
            if (cancelled) return;
            setProgress({ characterIndex: 0, strokeNumber: 1, strokeCount: 0, complete: false });
            startQuiz(0);
          })
          .catch(() => {
            if (!cancelled) setStatus("error");
          });
      };

      if (writers.length === 0) {
        setStatus("error");
        return;
      }
      void Promise.all(writers.map((writer) => writer.getCharacterData()))
        .then((characterData) => {
          if (cancelled || loadFailedRef.current) return;
          setStrokeGuides(characterData.map((data) => data.strokes.map((stroke) => ({
            path: stroke.path,
            medianPath: stroke.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "),
          }))));
          startQuiz(0);
        })
        .catch(() => {
          if (!cancelled) {
            loadFailedRef.current = true;
            setStatus("error");
          }
        });
    }).catch(() => {
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      writersRef.current.forEach((writer) => writer.cancelQuiz());
      writersRef.current = [];
      resetQuizRef.current = () => {};
      motionPreference.removeEventListener("change", updateMotionPreference);
      containerRefs.current.forEach((element) => {
        if (element) element.innerHTML = "";
      });
    };
  }, [characters, characterSize, retryKey]);

  useEffect(() => {
    const guide = activeStrokeIndex === null
      ? undefined
      : strokeGuides[progress.characterIndex]?.[activeStrokeIndex];
    const path = hintPathRef.current;
    if (!guide || !path) return;

    const length = path.getTotalLength();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = (length + 600) / (3 * (reducedMotion ? 0.35 : 0.5));
    path.style.strokeDasharray = `${length}px`;
    path.style.strokeDashoffset = `${length}px`;

    if (typeof path.animate !== "function") {
      path.style.strokeDashoffset = "0px";
      return;
    }

    let disposed = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    let animation: Animation | null = null;
    let blinkAnimation: Animation | null = null;
    const playStroke = () => {
      if (disposed) return;
      path.style.strokeDashoffset = `${length}px`;
      animation = path.animate(
        [{ strokeDashoffset: `${length}px` }, { strokeDashoffset: "0px" }],
        { duration, easing: "linear", fill: "forwards" },
      );
      animation.onfinish = () => {
        const fill = hintFillRef.current;
        if (disposed || !fill) return;
        blinkAnimation = fill.animate(
          [
            { opacity: 1 },
            { opacity: reducedMotion ? 0.6 : 0.15 },
            { opacity: 1 },
          ],
          {
            duration: reducedMotion ? 1000 : 500,
            easing: "ease-in-out",
            iterations: 2,
          },
        );
        blinkAnimation.onfinish = () => {
          if (!disposed) pauseTimer = setTimeout(playStroke, 300);
        };
      };
    };
    playStroke();

    return () => {
      disposed = true;
      animation?.cancel();
      blinkAnimation?.cancel();
      if (pauseTimer !== null) clearTimeout(pauseTimer);
    };
  }, [activeStrokeIndex, characterSize, progress.characterIndex, strokeGuides]);

  const retryLoading = () => {
    setProgress({ characterIndex: 0, strokeNumber: 1, strokeCount: 0, complete: false });
    setRetryKey((key) => key + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Viết theo nét mờ đúng thứ tự; nét đúng sẽ chuyển sang màu đen đậm.
        </p>
        {status === "error" ? (
          <Button type="button" variant="outline" size="sm" onClick={retryLoading}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Thử tải lại
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => resetQuizRef.current()}
            disabled={status === "loading"}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Làm lại từ đầu
          </Button>
        )}
      </div>
      <div
        className="flex w-full flex-wrap items-center justify-center gap-2 overflow-hidden rounded-xl border bg-muted/20 p-3"
        style={{ minHeight: frameHeight }}
        aria-label="Vùng luyện viết chữ Hán theo thứ tự nét"
      >
        {characters.map((character, index) => (
          <div
            key={`${character}-${index}`}
            className="relative rounded-lg bg-background transition-opacity duration-200"
            style={{
              width: characterSize,
              height: characterSize,
              opacity: index > progress.characterIndex ? 0.45 : 1,
            }}
          >
            <div
              ref={(element) => { containerRefs.current[index] = element; }}
              className="absolute inset-0"
              style={{
                pointerEvents: index === progress.characterIndex && status === "ready" && !progress.complete ? "auto" : "none",
              }}
              aria-label={`Chữ ${character}, vùng luyện viết`}
            />
            {activeStrokeIndex !== null && index === progress.characterIndex && strokeGuides[index]?.[activeStrokeIndex] && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${characterSize} ${characterSize}`}
                aria-hidden="true"
              >
                <defs>
                  <mask
                    id={`stroke-hint-mask-${index}`}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="-124"
                    width="1024"
                    height="1024"
                  >
                    <path
                      ref={hintPathRef}
                      d={strokeGuides[index][activeStrokeIndex].medianPath}
                      fill="none"
                      stroke="#fff"
                      strokeWidth="240"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </mask>
                </defs>
                <g transform={`translate(8 ${characterSize - 124 * ((characterSize - 16) / 1024) - 8}) scale(${(characterSize - 16) / 1024} ${-((characterSize - 16) / 1024)})`}>
                  <path
                    ref={hintFillRef}
                    d={strokeGuides[index][activeStrokeIndex].path}
                    fill={HINT_STROKE_COLOR}
                    mask={`url(#stroke-hint-mask-${index})`}
                  />
                </g>
              </svg>
            )}
          </div>
        ))}
      </div>
      <p className="min-h-5 text-center text-sm font-medium" aria-live="polite" aria-atomic="true">
        {status === "loading"
          ? "Đang tải dữ liệu nét chữ..."
          : status === "error"
            ? "Không tải được dữ liệu nét chữ. Hãy kiểm tra kết nối mạng rồi thử lại."
            : progress.complete
              ? "Hoàn thành! Bạn đã viết đúng thứ tự tất cả các nét."
              : `Chữ ${progress.characterIndex + 1}/${characters.length} · Nét ${progress.strokeNumber}${progress.strokeCount ? `/${progress.strokeCount}` : ""}`}
      </p>
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
  const [showHandwriting, setShowHandwriting] = useState(false);

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
            <section className="mt-3">
              <GuidedHandwriting
                characters={handwritingChars}
                characterSize={size}
                frameHeight={strokeFrameHeight}
              />
            </section>
          )}
        </div>
      </div>
    </Overlay>
  );
}
