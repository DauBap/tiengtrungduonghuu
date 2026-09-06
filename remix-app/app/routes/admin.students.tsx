import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { PlaceholderPage } from "~/components/common/placeholder-page";
import { Users } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminStudents() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <PlaceholderPage
      user={user}
      title="Học viên"
      description="Quản lý danh sách học viên toàn trung tâm."
      icon={<Users className="h-10 w-10" />}
    />
  );
}
