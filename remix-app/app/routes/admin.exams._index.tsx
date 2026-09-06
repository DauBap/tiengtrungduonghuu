import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { listExamsForAdmin } from "~/lib/exam.server";
import { EXAM_STATUSES, EXAM_STATUS_META, isExamStatus } from "~/lib/exams";
import { AppShell } from "~/components/layout/app-shell";
import { ExamStatusBadge, VersionBadge } from "~/components/admin/exam/version-badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { EmptyState } from "~/components/common/empty-state";
import { Search, Plus, Pencil, ClipboardCheck, Users } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const exams = await listExamsForAdmin();
  return { user, exams };
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("vi-VN", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminExams() {
  const { user, exams } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filtered = useMemo(
    () =>
      exams.filter((e) => {
        if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return e.title.toLowerCase().includes(q) || e.code.toLowerCase().includes(q);
      }),
    [exams, search, statusFilter]
  );

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bài thi</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Soạn đề từ câu hỏi trong kho. Mỗi lần phát hành tạo một phiên bản riêng nên lượt thi
              cũ không bị ảnh hưởng.
            </p>
          </div>
          <Button asChild>
            <Link to="/admin/exams/new">
              <Plus className="h-4 w-4 mr-1.5" />
              Tạo bài thi
            </Link>
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm theo tên, mã đề..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Lọc theo trạng thái"
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-48"
          >
            <option value="ALL">Tất cả trạng thái</option>
            {EXAM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EXAM_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-10 w-10" />}
            title={exams.length === 0 ? "Chưa có bài thi nào" : "Không tìm thấy bài thi"}
            message={
              exams.length === 0
                ? "Tạo bài thi, thêm phần và gắn câu hỏi từ kho, rồi phát hành cho học viên."
                : "Thử điều chỉnh bộ lọc."
            }
            action={
              <Button asChild>
                <Link to="/admin/exams/new">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Tạo bài thi
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Tên đề</TableHead>
                  <TableHead>Gắn với</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Phiên bản</TableHead>
                  <TableHead>Lượt thi</TableHead>
                  <TableHead>Cập nhật</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((exam) => {
                  const shown = exam.publishedVersion ?? exam.latestVersion;
                  return (
                    <TableRow key={exam.id}>
                      <TableCell className="font-mono text-xs font-medium">{exam.code}</TableCell>
                      <TableCell className="font-medium">
                        <Link to={`/admin/exams/${exam.id}`} className="hover:underline">
                          {exam.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {exam.lesson
                          ? `Bài ${exam.lesson.order} · ${exam.lesson.title}`
                          : exam.course
                            ? exam.course.title
                            : "Độc lập"}
                      </TableCell>
                      <TableCell>
                        {isExamStatus(exam.status) && <ExamStatusBadge status={exam.status} />}
                      </TableCell>
                      <TableCell>
                        {shown && isExamStatus(shown.status) ? (
                          <VersionBadge version={shown.version} status={shown.status} />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        {/* Bản nháp đang soạn song song với bản đang chạy */}
                        {exam.publishedVersion && exam.draftVersion && (
                          <p className="text-xs text-muted-foreground mt-1">
                            đang soạn v{exam.draftVersion.version}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {exam.attemptCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            {exam.attemptCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(exam.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/admin/exams/${exam.id}`}>
                            <Pencil className="h-4 w-4 mr-1.5" />
                            Soạn đề
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
