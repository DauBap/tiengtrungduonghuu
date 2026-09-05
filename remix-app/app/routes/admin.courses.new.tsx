import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, Link, redirect, useNavigation } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  const code = String(form.get("code")).trim();
  const existing = await prisma.course.findUnique({ where: { code } });
  if (existing) return { error: "Mã khóa học đã tồn tại" };

  await prisma.course.create({
    data: {
      code,
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim(),
      hskLevel: Number(form.get("hskLevel")),
      status: String(form.get("status")) as "DRAFT" | "PUBLISHED" | "ARCHIVED",
      order: Number(form.get("order")),
      thumbnail: String(form.get("thumbnail") || "") || null,
    },
  });
  return redirect("/admin/courses");
}

export default function NewCourse() {
  const { user } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [status, setStatus] = useState("DRAFT");
  const [hskLevel, setHskLevel] = useState("1");

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/admin/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Tạo khóa học</h1>
          <p className="text-muted-foreground text-sm mt-1">Thêm khóa học HSK mới vào nền tảng.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin khóa học</CardTitle>
            <CardDescription>Điền thông tin bên dưới để tạo khóa học mới.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Mã khóa học</Label>
                  <Input id="code" name="code" placeholder="HSK-7" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Tên khóa học</Label>
                  <Input id="title" name="title" placeholder="HSK 7 - Nâng cao" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea id="description" name="description" placeholder="Mô tả khóa học..." rows={4} required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Cấp độ HSK</Label>
                  <Select value={hskLevel} onValueChange={setHskLevel} name="hskLevel">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1,2,3,4,5,6].map(n => <SelectItem key={n} value={String(n)}>HSK {n}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Trạng thái</Label>
                  <Select value={status} onValueChange={setStatus} name="status">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Nháp</SelectItem>
                      <SelectItem value="PUBLISHED">Đã xuất bản</SelectItem>
                      <SelectItem value="ARCHIVED">Đã lưu trữ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="order">Thứ tự</Label>
                  <Input id="order" name="order" type="number" min={0} defaultValue={0} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="thumbnail">URL ảnh đại diện (tùy chọn)</Label>
                <Input id="thumbnail" name="thumbnail" placeholder="https://example.com/anh.jpg" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button asChild variant="outline"><Link to="/admin/courses">Hủy</Link></Button>
                <Button type="submit" disabled={isSubmitting}>
                  <Save className="h-4 w-4 mr-1.5" />{isSubmitting ? "Đang tạo..." : "Tạo khóa học"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
