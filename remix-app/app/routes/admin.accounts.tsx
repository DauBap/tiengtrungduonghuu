import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { Role } from "@prisma/client";
import { useLoaderData, useFetcher, Form, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import bcrypt from "bcryptjs";
import { AppShell } from "~/components/layout/app-shell";
import { StatCard } from "~/components/common/stat-card";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Plus, Pencil, Trash2, X, Users, GraduationCap, ShieldCheck, LockKeyhole, LockKeyholeOpen, Search, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";

// createdAt là Date: React Router 7 serialize loader bằng turbo-stream nên Date
// đi qua nguyên vẹn, không bị đổi thành string như JSON.stringify.
// role dùng nguyên enum Role của Prisma; loader đã lọc `in: ["teacher","student"]`
// nhưng TS không suy ra được điều đó từ kiểu trả về.
type UserRecord = { id: string; email: string; name: string; role: Role; isActive: boolean; createdAt: Date };
type ModalMode = "create" | "edit" | "delete" | "toggle" | null;

const ROLE_LABEL: Record<string, string> = { teacher: "Giáo viên", student: "Học viên" };
const ROLE_BADGE: Record<string, string> = { teacher: "bg-accent/15 text-accent border-accent/30", student: "bg-primary/10 text-primary border-primary/30" };

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const users = await prisma.user.findMany({
    where: { role: { in: ["teacher", "student"] }, deletedAt: null },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return { user, users };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "create") {
    const email = String(formData.get("email")).toLowerCase().trim();
    const name = String(formData.get("name")).trim();
    const password = String(formData.get("password"));
    const role = String(formData.get("role")) as "teacher" | "student";
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { error: "Email đã được sử dụng" };
    await prisma.user.create({ data: { email, name, password: await bcrypt.hash(password, 10), role } });
    return { success: true };
  }

  if (intent === "edit") {
    const userId = String(formData.get("userId"));
    const email = String(formData.get("email")).toLowerCase().trim();
    const name = String(formData.get("name")).trim();
    const password = String(formData.get("password"));
    const role = String(formData.get("role")) as "teacher" | "student";
    const data: Record<string, unknown> = { email, name, role };
    if (password.trim()) data.password = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: userId }, data });
    return { success: true };
  }

  if (intent === "toggle") {
    const userId = String(formData.get("userId"));
    const isActive = formData.get("isActive") === "true";
    await prisma.user.update({ where: { id: userId }, data: { isActive: !isActive } });
    return { success: true };
  }

  if (intent === "delete") {
    const userId = String(formData.get("userId"));
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  return null;
}

// ── Modal component ──
function Modal({ mode, user, onClose }: { mode: ModalMode; user: UserRecord | null; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [role, setRole] = useState<"teacher" | "student">(user?.role === "teacher" ? "teacher" : "student");
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "toggle") {
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">{user?.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className={cn("rounded-lg border p-4 text-sm", user?.isActive ? "border-warning/30 bg-warning/5 text-warning" : "border-success/30 bg-success/5 text-success")}>
            <p>Tài khoản <strong>{user?.name}</strong> sẽ {user?.isActive ? "bị khóa" : "được mở khóa"}.</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="toggle" />
            <input type="hidden" name="userId" value={user?.id} />
            <input type="hidden" name="isActive" value={String(user?.isActive)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant={user?.isActive ? "destructive" : "default"} disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {user?.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  if (mode === "delete") {
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa tài khoản</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>Xóa tài khoản <strong>{user?.name}</strong>? Dữ liệu vẫn được lưu trữ.</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="userId" value={user?.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa tài khoản
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";
  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Chỉnh sửa tài khoản" : "Tạo tài khoản mới"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
        <input type="hidden" name="intent" value={isEdit ? "edit" : "create"} />
        {isEdit && <input type="hidden" name="userId" value={user?.id} />}
        <div className="space-y-2">
          <Label htmlFor="name">Họ tên <span className="text-destructive">*</span></Label>
          <Input id="name" name="name" defaultValue={user?.name} placeholder="Nguyễn Văn A" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
          <Input id="email" name="email" type="email" defaultValue={user?.email} placeholder="nguyen@example.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">
            Mật khẩu {isEdit ? <span className="text-muted-foreground font-normal text-xs">(để trống nếu không đổi)</span> : <span className="text-destructive">*</span>}
          </Label>
          <Input id="password" name="password" type="password" placeholder={isEdit ? "••••••••" : "Nhập mật khẩu"} required={!isEdit} />
        </div>
        <div className="space-y-2">
          <Label>Vai trò <span className="text-destructive">*</span></Label>
          <Select value={role} onValueChange={(v) => setRole(v as "teacher" | "student")} name="role">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Giáo viên</SelectItem>
              <SelectItem value="student">Học viên</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Tạo tài khoản"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

export default function AccountsPage() {
  const { user, users } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  const open = (mode: ModalMode, u: UserRecord | null = null) => { setSelectedUser(u); setModalMode(mode); };
  const closeModal = useCallback(() => { setModalMode(null); setSelectedUser(null); }, []);

  const filtered = users.filter((u) => {
    if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
    if (statusFilter === "ACTIVE" && !u.isActive) return false;
    if (statusFilter === "LOCKED" && u.isActive) return false;
    if (search) { const q = search.toLowerCase(); return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q); }
    return true;
  });

  const teacherCount = users.filter((u) => u.role === "teacher").length;
  const studentCount = users.filter((u) => u.role === "student").length;
  const lockedCount = users.filter((u) => !u.isActive).length;

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Quản lý tài khoản</h1>
              <p className="text-muted-foreground text-sm mt-1">Tạo và quản lý tài khoản giáo viên và học viên.</p>
            </div>
            <Button onClick={() => open("create")}><Plus className="h-4 w-4 mr-1.5" />Tạo tài khoản</Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tổng tài khoản" value={users.length} icon={Users} accent="primary" />
            <StatCard label="Giáo viên" value={teacherCount} icon={ShieldCheck} accent="accent" />
            <StatCard label="Học viên" value={studentCount} icon={GraduationCap} accent="success" />
            <StatCard label="Đang bị khóa" value={lockedCount} icon={LockKeyhole} accent="warning" />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Tìm theo tên hoặc email..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả vai trò</SelectItem>
                <SelectItem value="teacher">Giáo viên</SelectItem>
                <SelectItem value="student">Học viên</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
                <SelectItem value="ACTIVE">Đang hoạt động</SelectItem>
                <SelectItem value="LOCKED">Đang bị khóa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Danh sách tài khoản <span className="text-sm font-normal text-muted-foreground">({filtered.length})</span></CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">Không tìm thấy tài khoản</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Họ tên</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Vai trò</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Ngày tạo</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((u) => (
                      <TableRow key={u.id} className={cn(!u.isActive && "opacity-60 bg-muted/20")}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">{u.email}</TableCell>
                        <TableCell><Badge variant="outline" className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge></TableCell>
                        <TableCell>
                          {u.isActive
                            ? <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1"><LockKeyholeOpen className="h-3 w-3" />Hoạt động</Badge>
                            : <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 gap-1"><LockKeyhole className="h-3 w-3" />Bị khóa</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title={u.isActive ? "Khóa" : "Mở khóa"}
                              onClick={() => open("toggle", u)}
                              className={cn(u.isActive ? "hover:text-warning hover:bg-warning/10" : "hover:text-success hover:bg-success/10")}>
                              {u.isActive ? <LockKeyhole className="h-4 w-4" /> : <LockKeyholeOpen className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" title="Chỉnh sửa" onClick={() => open("edit", u)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Xóa" onClick={() => open("delete", u)}
                              className="hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
      <Modal
        key={modalMode ? `${modalMode}-${selectedUser?.id ?? "new"}` : "closed"}
        mode={modalMode}
        user={selectedUser}
        onClose={closeModal}
      />
    </>
  );
}
