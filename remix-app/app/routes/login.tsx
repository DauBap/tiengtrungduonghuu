import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import bcrypt from "bcryptjs";
import { prisma } from "~/lib/prisma.server";
import { createUserSession, getUserFromSession } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Languages, Loader2, Mail, Lock, ArrowRight } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromSession(request);
  if (user) {
    const dest = { admin: "/admin", teacher: "/teacher", student: "/student" };
    return redirect(dest[user.role]);
  }
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  if (!email) {
    return { error: "Vui lòng nhập email", field: "email" as const };
  }

  if (!EMAIL_RE.test(email)) {
    return { error: "Email không đúng định dạng, ví dụ: ban@example.com", field: "email" as const };
  }

  if (!password) {
    return { error: "Vui lòng nhập mật khẩu", field: "password" as const };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.deletedAt) {
    return { error: "Email hoặc mật khẩu không đúng" };
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return { error: "Email hoặc mật khẩu không đúng" };
  }

  if (!user.isActive) {
    return { error: "Tài khoản của bạn hiện bị khóa, vui lòng liên hệ với Trung Tâm để được hỗ trợ" };
  }

  const dest = { admin: "/admin", teacher: "/teacher", student: "/student" };
  return createUserSession(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    dest[user.role]
  );
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

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
      <div className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-primary via-primary to-accent relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
        <div className="relative flex flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-foreground/20 backdrop-blur-sm">
              <Languages className="h-6 w-6" />
            </div>
            <span className="text-xl font-bold">Tiếng Trung Dương Hữu</span>
          </div>
          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight">Học tiếng Trung<br />từng bước một.</h1>
            <p className="text-lg text-primary-foreground/80 max-w-md">
              Nền tảng học có cấu trúc theo hệ thống HSK chính thức, từ mới bắt đầu đến thành thạo.
            </p>
            <div className="flex gap-8">
              <div><p className="text-3xl font-bold">6</p><p className="text-sm text-primary-foreground/70">Cấp độ HSK</p></div>
              <div><p className="text-3xl font-bold">100+</p><p className="text-sm text-primary-foreground/70">Bài học</p></div>
              <div><p className="text-3xl font-bold">5.000+</p><p className="text-sm text-primary-foreground/70">Từ vựng</p></div>
            </div>
          </div>
          <p className="text-sm text-primary-foreground/60">HSK 1 đến HSK 6 - Chuẩn quốc tế</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center lg:hidden">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
              <Languages className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold">HSK Academy</h1>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl">Chào mừng trở lại</CardTitle>
              <CardDescription>Đăng nhập vào tài khoản để tiếp tục</CardDescription>
            </CardHeader>
            <CardContent>
              <Form id="login-form" method="post" noValidate className="space-y-4">
                {actionData?.error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {actionData.error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      name="email"
                      type="text"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="ban@example.com"
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
