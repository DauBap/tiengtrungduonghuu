import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check, MicOff } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  detectInAppBrowser,
  buildAndroidChromeIntentUrl,
  buildIosSafariUrl,
  type InAppBrowserInfo,
} from "~/lib/in-app-browser";

/**
 * Trả về thông tin webview in-app, hoặc null nếu đang ở trình duyệt thường.
 * Chạy sau hydrate nên lần render đầu luôn là null — tránh lệch SSR.
 */
export function useInAppBrowser(): InAppBrowserInfo | null {
  const [info, setInfo] = useState<InAppBrowserInfo | null>(null);

  useEffect(() => {
    setInfo(detectInAppBrowser(window.navigator.userAgent));
  }, []);

  return info;
}

/**
 * Banner thay cho tính năng cần mic khi đang ở webview in-app.
 * Android nhảy thẳng ra Chrome; iOS phải hướng dẫn thủ công vì WKWebView
 * thường chặn scheme thoát app.
 */
export function OpenInBrowserNotice({ info }: { info: InAppBrowserInfo }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await window.navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API bị chặn trong một số webview — người dùng copy từ thanh địa chỉ
    }
  };

  const openExternal = () => {
    const currentUrl = window.location.href;
    if (info.platform === "android") {
      window.location.href = buildAndroidChromeIntentUrl(currentUrl);
      return;
    }
    if (info.platform === "ios") {
      window.location.href = buildIosSafariUrl(currentUrl);
      return;
    }
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <MicOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-amber-900 dark:text-amber-200">
            Cần mở bằng trình duyệt để luyện đọc
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/80">
            Trình duyệt trong {info.appName} không cho phép dùng micro, nên phần nhận diện
            giọng nói không chạy được. Mở bài học bằng{" "}
            {info.platform === "ios" ? "Safari" : "Chrome"} để luyện đọc bình thường.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={openExternal}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Mở bằng {info.platform === "ios" ? "Safari" : "Chrome"}
            </Button>
            <Button type="button" variant="outline" onClick={copyLink}>
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Đã copy link
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy link
                </>
              )}
            </Button>
          </div>

          <details className="mt-4 text-sm text-amber-800 dark:text-amber-200/80">
            <summary className="cursor-pointer font-medium">
              Nút trên không mở được? Làm theo cách này
            </summary>
            {info.platform === "ios" ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Chạm nút ••• hoặc biểu tượng chia sẻ ở góc màn hình.</li>
                <li>Chọn &ldquo;Mở trong Safari&rdquo; (Open in Safari).</li>
                <li>Quay lại tab bài học và bấm &ldquo;Bắt đầu đọc&rdquo;.</li>
              </ol>
            ) : (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Chạm nút ⋮ ở góc trên bên phải.</li>
                <li>Chọn &ldquo;Mở bằng trình duyệt&rdquo; hoặc &ldquo;Mở trong Chrome&rdquo;.</li>
                <li>Nếu không thấy, bấm &ldquo;Copy link&rdquo; rồi dán vào Chrome.</li>
              </ol>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}
