import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { PlaceholderPage } from "~/components/common/placeholder-page";
import { GraduationCap } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminTeachers() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <PlaceholderPage
      user={user}
      title="Giáo viên"
      description="Quản lý hồ sơ giáo viên và phân công giảng dạy."
      icon={<GraduationCap className="h-10 w-10" />}
    />
  );
}
