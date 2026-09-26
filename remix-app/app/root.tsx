import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useNavigation,
  useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";
import { Loader2 } from "lucide-react";
import { Toaster } from "~/components/ui/sonner";
import stylesheet from "~/globals.css?url";

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  },
  { rel: "stylesheet", href: stylesheet },
];

export function meta() {
  return [
    { title: "TIẾNG TRUNG DƯƠNG HỮU - Học tiếng Trung" },
    { name: "description", content: "Nền tảng học tiếng Trung theo hệ thống HSK." },
  ];
}

export default function App() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, sans-serif" }}>
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
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Lỗi</title>
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, sans-serif" }}>
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
