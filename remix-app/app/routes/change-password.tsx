import { useNavigation, Form, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import bcrypt from "bcryptjs";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getUserFromSession, createUserSession, type UserRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { KeyRound, Loader2, LogOut } from "lucide-react";

const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  teacher: "/teacher",
  student: "/student",
};

async function getActiveSessionUser(request: Request) {
  const sessionUser = await getUserFromSession(request);
  if (!sessionUser) return null;

  return prisma.user.findFirst({
    where: { id: sessionUser.id, deletedAt: null, isActive: true, isActivated: true },
    select: { id: true, email: true, name: true, role: true, password: true, mustChangePassword: true },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getActiveSessionUser(request);
  if (!user) return redirect("/login");
  if (!user.mustChangePassword) return redirect(ROLE_HOME[user.role]);
  return { name: user.name };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getActiveSessionUser(request);
  if (!user) return redirect("/login");
  if (!user.mustChangePassword) return redirect(ROLE_HOME[user.role]);

  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { error: "Mật khẩu mới cần có ít nhất 8 ký tự." };
  }
  if (password !== confirmPassword) {
    return { error: "Mật khẩu xác nhận không khớp." };
  }
  if (await bcrypt.compare(password, user.password)) {
    return { error: "Mật khẩu mới phải khác mật khẩu tạm thời." };
  }

  const result = await prisma.user.updateMany({
    where: { id: user.id, mustChangePassword: true, isActive: true, isActivated: true, deletedAt: null },
    data: { password: await bcrypt.hash(password, 10), mustChangePassword: false },
  });
  if (result.count !== 1) {
    throw new Response("Không thể cập nhật mật khẩu. Vui lòng đăng nhập lại.", { status: 409 });
  }

  return createUserSession(
    { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: false },
    ROLE_HOME[user.role],
  );
}

export default function ChangePasswordPage() {
  const { name } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Đổi mật khẩu lần đầu</CardTitle>
          <CardDescription>
            Xin chào {name}. Hãy tạo mật khẩu mới để tiếp tục sử dụng tài khoản.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            {actionData?.error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {actionData.error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Mật khẩu mới</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="text-xs text-muted-foreground">Tối thiểu 8 ký tự.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Nhập lại mật khẩu mới</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cập nhật mật khẩu
            </Button>
          </Form>
          <Form method="post" action="/logout" className="mt-3">
            <Button type="submit" variant="ghost" className="w-full" disabled={isSubmitting}>
              <LogOut className="mr-2 h-4 w-4" />
              Đăng xuất
            </Button>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
