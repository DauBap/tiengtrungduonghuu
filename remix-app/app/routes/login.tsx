import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "~/lib/prisma.server";
import { createUserSession, getUserFromSession } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Loader2, Mail, Lock, ArrowRight } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LoginFailureStage = "session-check" | "read-form" | "find-account" | "verify-password" | "create-session" | "session-cookie";
type LoginDiagnostic = { reference: string; stage: LoginFailureStage };

function createLoginDiagnostic(stage: LoginFailureStage): LoginDiagnostic {
  return { reference: `LGN-${randomUUID().slice(0, 8).toUpperCase()}`, stage };
}

function logLoginFailure(diagnostic: LoginDiagnostic, error: unknown) {
  console.error("[login] Unexpected login failure", {
    reference: diagnostic.reference,
    stage: diagnostic.stage,
    error,
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const sessionCheck = new URL(request.url).searchParams.get("sessionCheck");
  try {
    const user = await getUserFromSession(request);
    if (user) {
      if (user.mustChangePassword) return redirect("/change-password");
      const dest = { admin: "/admin", teacher: "/teacher", student: "/student" };
      return redirect(dest[user.role]);
    }
    if (sessionCheck && /^LGN-[A-F0-9]{8}$/.test(sessionCheck)) {
      return {
        diagnostic: { reference: sessionCheck, stage: "session-cookie" as const },
      };
    }
    return null;
  } catch (error) {
    if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
    const diagnostic = createLoginDiagnostic("session-check");
    logLoginFailure(diagnostic, error);
    return { diagnostic };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  let stage: LoginFailureStage = "read-form";
  try {
    const formData = await request.formData();
    const identifier = String(formData.get("email") ?? "").toLowerCase().trim();
    const password = String(formData.get("password") ?? "");

    if (!identifier) {
      return { error: "Vui lòng nhập email hoặc tài khoản", field: "email" as const };
    }

    if (identifier.includes("@") && !EMAIL_RE.test(identifier)) {
      return { error: "Email không đúng định dạng, ví dụ: ban@example.com", field: "email" as const };
    }

    if (!password) {
      return { error: "Vui lòng nhập mật khẩu", field: "password" as const };
    }

    stage = "find-account";
    const matchingUsers = identifier.includes("@")
      ? [await prisma.user.findUnique({ where: { email: identifier } })].filter((user) => user !== null)
      : await prisma.user.findMany({
        where: { email: { startsWith: `${identifier}@`, mode: "insensitive" } },
        take: 2,
      });

    if (matchingUsers.length !== 1) {
      return { error: "Email/tài khoản hoặc mật khẩu không đúng" };
    }

    const user = matchingUsers[0];
    if (user.deletedAt) return { error: "Email/tài khoản hoặc mật khẩu không đúng" };

    stage = "verify-password";
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return { error: "Email/tài khoản hoặc mật khẩu không đúng" };
    }

    if (!user.isActivated) {
      return { error: "Tài khoản chưa được kích hoạt. Vui lòng liên hệ giáo viên hoặc quản trị viên để được hỗ trợ." };
    }

    if (!user.isActive) {
      return { error: "Tài khoản của bạn hiện bị khóa, vui lòng liên hệ với Trung Tâm để được hỗ trợ" };
    }

    const dest = { admin: "/admin", teacher: "/teacher", student: "/student" };
    const diagnostic = createLoginDiagnostic("session-cookie");
    const redirectTo = `/login?sessionCheck=${encodeURIComponent(diagnostic.reference)}`;
    stage = "create-session";
    console.info("[login] Session created; checking browser cookie round-trip", {
      reference: diagnostic.reference,
    });
    return await createUserSession(
      { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
      redirectTo
    );
  } catch (error) {
    if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
    const diagnostic = createLoginDiagnostic(stage);
    logLoginFailure(diagnostic, error);
    return {
      error: "Hệ thống chưa thể hoàn tất đăng nhập. Vui lòng thử lại; nếu vẫn gặp lỗi, gửi mã hỗ trợ bên dưới cho trung tâm.",
      diagnostic,
    };
  }
}

export default function LoginPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  const diagnostic = actionData?.diagnostic ?? (actionData?.error ? undefined : loaderData?.diagnostic);
  const error = actionData?.error ?? (loaderData?.diagnostic
    ? loaderData.diagnostic.stage === "session-cookie"
      ? "Tài khoản và mật khẩu đã được xác nhận nhưng trình duyệt chưa giữ được phiên đăng nhập. Hãy mở trang bằng HTTPS, cho phép cookie và thử lại. Nếu vẫn gặp lỗi, gửi mã hỗ trợ bên dưới cho trung tâm."
      : "Tạm thời chưa kiểm tra được phiên đăng nhập. Bạn vẫn có thể thử đăng nhập lại."
    : null);

  const fillDemo = (email: string, password: string) => {
    const f = document.getElementById("login-form") as HTMLFormElement;
    if (f) {
      (f.querySelector("#email") as HTMLInputElement).value = email;
      (f.querySelector("#password") as HTMLInputElement).value = password;
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:flex-1 bg-brand-gradient relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
        <div className="relative flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img
              src="/logo-duong-huu.webp"
              alt=""
              aria-hidden="true"
              className="h-12 w-12 shrink-0 rounded-full object-contain"
            />
            <span className="header-name text-xl font-bold">TIẾNG TRUNG DƯƠNG HỮU</span>
          </div>
          <div className="space-y-6">
            <h1 className="hero-title text-4xl font-bold leading-tight">Học tiếng Trung<br />từng bước một.</h1>
            <p className="text-lg text-white/80 max-w-md">
              Nền tảng học có cấu trúc theo hệ thống HSK chính thức, từ mới bắt đầu đến thành thạo.
            </p>
            <div className="flex gap-8">
              <div><p className="stat-num text-3xl font-bold">6</p><p className="text-sm text-white/70">Cấp độ HSK</p></div>
              <div><p className="stat-num text-3xl font-bold">100+</p><p className="text-sm text-white/70">Bài học</p></div>
              <div><p className="stat-num text-3xl font-bold">5.000+</p><p className="text-sm text-white/70">Từ vựng</p></div>
            </div>
          </div>
          <p className="text-sm text-white/60">HSK 1 đến HSK 6 - Chuẩn quốc tế</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center lg:hidden">
            <img
              src="/logo-duong-huu.webp"
              alt=""
              aria-hidden="true"
              className="mx-auto mb-3 h-12 w-12 rounded-full object-contain"
            />
            <h1 className="header-name text-xl font-bold">TIẾNG TRUNG DƯƠNG HỮU</h1>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl">Chào mừng trở lại</CardTitle>
              <CardDescription>Đăng nhập vào tài khoản để tiếp tục</CardDescription>
            </CardHeader>
            <CardContent>
              <Form id="login-form" method="post" noValidate className="space-y-4">
                {error && (
                  <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    <p>{error}</p>
                    {diagnostic && (
                      <div className="rounded-md border border-destructive/20 bg-background/70 p-3 text-foreground">
                        <p className="font-medium">Mã hỗ trợ: <span className="select-all font-mono tabular-nums">{diagnostic.reference}</span></p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Bước gặp lỗi: {{
                            "session-check": "kiểm tra phiên đăng nhập",
                            "read-form": "nhận thông tin đăng nhập",
                            "find-account": "tìm tài khoản",
                            "verify-password": "xác thực mật khẩu",
                            "create-session": "tạo phiên đăng nhập",
                            "session-cookie": "xác nhận trình duyệt đã lưu phiên",
                          }[diagnostic.stage]}. Chụp lại thông báo này và gửi cho trung tâm để kiểm tra log.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email hoặc tài khoản</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      name="email"
                      type="text"
                      autoComplete="username"
                      placeholder="Email hoặc tên tài khoản"
                      className="pl-10"
                      aria-invalid={actionData?.field === "email" || undefined}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Mật khẩu</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Nhập mật khẩu"
                      className="pl-10"
                      aria-invalid={actionData?.field === "password" || undefined}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Đăng nhập <ArrowRight className="h-4 w-4 ml-2" /></>}
                </Button>
              </Form>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
