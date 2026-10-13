/**
 * Nhận diện trình duyệt tích hợp trong app (Zalo, Facebook, Instagram...).
 *
 * Các webview này không có Web Speech API (Android) hoặc bị chặn quyền mic
 * (iOS WKWebView), nên tính năng đọc/nhận diện giọng nói không chạy được.
 * Trang web không thể tự cấp quyền — cách duy nhất là mở bằng trình duyệt
 * ngoài (Chrome/Safari).
 */

export type InAppBrowserPlatform = "android" | "ios" | "other";

export type InAppBrowserInfo = {
  /** Tên app chủ để hiện trong hướng dẫn, ví dụ "Zalo" */
  appName: string;
  platform: InAppBrowserPlatform;
};

/** Các mẫu user-agent của webview in-app phổ biến ở Việt Nam */
const IN_APP_PATTERNS: Array<{ pattern: RegExp; appName: string }> = [
  { pattern: /\bZalo\b/i, appName: "Zalo" },
  { pattern: /FBAN|FBAV|FB_IAB|FBIOS|FBDV/i, appName: "Facebook" },
  { pattern: /Messenger/i, appName: "Messenger" },
  { pattern: /Instagram/i, appName: "Instagram" },
  { pattern: /BytedanceWebview|musical_ly|TikTok/i, appName: "TikTok" },
  { pattern: /MicroMessenger/i, appName: "WeChat" },
  { pattern: /\bLine\//i, appName: "LINE" },
  { pattern: /Twitter|TwitterAndroid/i, appName: "X" },
  { pattern: /GSA\//i, appName: "Google App" },
];

function detectPlatform(userAgent: string): InAppBrowserPlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  return "other";
}

/**
 * Trả về thông tin app chủ nếu đang chạy trong webview in-app, null nếu đang ở
 * trình duyệt thường. Chỉ gọi được ở client.
 */
export function detectInAppBrowser(userAgent: string): InAppBrowserInfo | null {
  const matched = IN_APP_PATTERNS.find((entry) => entry.pattern.test(userAgent));
  if (!matched) return null;
  return { appName: matched.appName, platform: detectPlatform(userAgent) };
}

/**
 * Link `intent://` để Android mở thẳng URL hiện tại bằng Chrome.
 * `S.browser_fallback_url` lo trường hợp máy không có Chrome.
 */
export function buildAndroidChromeIntentUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  const withoutScheme = `${url.host}${url.pathname}${url.search}${url.hash}`;
  const fallback = encodeURIComponent(currentUrl);
  return `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

/**
 * Scheme riêng của Safari. Một số webview iOS chịu nhảy ra, số khác chặn —
 * nên luôn kèm hướng dẫn mở thủ công.
 */
export function buildIosSafariUrl(currentUrl: string): string {
  return currentUrl.replace(/^https?:\/\//, "x-safari-https://");
}
