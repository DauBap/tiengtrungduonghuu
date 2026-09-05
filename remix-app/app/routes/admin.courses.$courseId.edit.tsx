import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, Link, redirect, useNavigation } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getCourseById } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatusBadge } from "~/components/courses/course-status-badge";
import { ArrowLeft, Save, ListOrdered } from "lucide-react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  return { user, course };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const form = await request.formData();
  await prisma.course.update({
    where: { id: params.courseId! },
    data: {
      code: String(form.get("code")).trim(),
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

export default function EditCourse() {
  const { user, course } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [status, setStatus] = useState(course.status);
  const [hskLevel, setHskLevel] = useState(String(course.hskLevel));

  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/admin/courses"><ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Chỉnh sửa khóa học</h1>
            <CourseStatusBadge status={course.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">{course.code} - HSK {course.hskLevel}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin khóa học</CardTitle>
            <CardDescription>Cập nhật thông tin khóa học bên dưới.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Mã khóa học</Label>
                  <Input id="code" name="code" defaultValue={course.code} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Tên khóa học</Label>
                  <Input id="title" name="title" defaultValue={course.title} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea id="description" name="description" defaultValue={course.description} rows={4} required />
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
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof course.status)} name="status">
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
                  <Input id="order" name="order" type="number" min={0} defaultValue={course.order} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="thumbnail">URL ảnh đại diện (tùy chọn)</Label>
                <Input id="thumbnail" name="thumbnail" defaultValue={course.thumbnail ?? ""} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button asChild variant="outline"><Link to="/admin/courses">Hủy</Link></Button>
                <Button type="submit" disabled={isSubmitting}>
                  <Save className="h-4 w-4 mr-1.5" />{isSubmitting ? "Đang lưu..." : "Lưu thay đổi"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nội dung khóa học</CardTitle>
            <CardDescription>Quản lý bài học, từ vựng và các dạng bài học của khóa này.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to={`/admin/courses/${course.id}/lessons`}>
                <ListOrdered className="h-4 w-4 mr-1.5" />Quản lý bài học
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
