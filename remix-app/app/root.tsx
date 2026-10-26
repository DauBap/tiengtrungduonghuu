import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useNavigation,
  useLocation,
  useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "~/components/ui/sonner";
import { CourseStudyTracker } from "~/components/courses/course-study-tracker";
import { initializeAppSettings } from "~/lib/app-settings";
import stylesheet from "~/globals.css?url";

const THEME_BOOTSTRAP_SCRIPT = `(() => {
  try {
    const settings = JSON.parse(localStorage.getItem("chinese-study-settings") || "{}");
    const preference = settings?.themePreference;
    const isDark = preference === "dark" || (
      preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    document.documentElement.classList.toggle("dark", isDark);
  } catch {
    document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
})();`;

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;500;600;700&display=swap",
  },
  { rel: "stylesheet", href: stylesheet },
];

export function meta() {
  return [
    { title: "TIẾNG TRUNG DƯƠNG HỮU - Học tiếng Trung" },
    { name: "description", content: "Nền tảng học tiếng Trung theo hệ thống HSK." },
    {
      name: "google-site-verification",
      content: "AwvUI6P3a9Kfhm5KUl2o9mTCafr90EUYc2RzERmcJjg",
    },
  ];
}

export default function App() {
  const navigation = useNavigation();
  const location = useLocation();
  const isLoading = navigation.state !== "idle";
  const coursePathMatch = location.pathname.match(/^\/student\/courses\/([^/]+)/);
  const trackedCourseId = coursePathMatch ? decodeURIComponent(coursePathMatch[1]) : null;

  useEffect(() => {
    initializeAppSettings();
  }, []);

  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {isLoading && (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[100]" role="status" aria-live="polite">
            <div className="h-1 w-full overflow-hidden bg-primary/15">
              <div className="h-full w-1/3 animate-loading-bar rounded-full bg-primary" />
            </div>
            <div className="fixed right-5 top-5 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-2 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Đang tải...
            </div>
          </div>
        )}
        {trackedCourseId && <CourseStudyTracker key={trackedCourseId} courseId={trackedCourseId} />}
        <Outlet />
        <Toaster />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <title>Lỗi</title>
        <Links />
      </head>
      <body>
        <div
          style={{
            display: "flex",
            height: "100vh",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
              {isRouteErrorResponse(error)
                ? `${error.status} ${error.statusText}`
                : "Đã xảy ra lỗi"}
            </h1>
            <p style={{ color: "#666", marginTop: "0.5rem" }}>
              {isRouteErrorResponse(error)
                ? error.data
                : "Vui lòng thử lại sau."}
            </p>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
