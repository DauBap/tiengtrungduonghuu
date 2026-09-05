import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";
import { Toaster } from "~/components/ui/sonner";
import stylesheet from "~/globals.css?url";

export const links: LinksFunction = () => [
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
    { title: "HSK Academy - Học tiếng Trung" },
    { name: "description", content: "Nền tảng học tiếng Trung theo hệ thống HSK." },
  ];
}

export default function App() {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, sans-serif" }}>
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
