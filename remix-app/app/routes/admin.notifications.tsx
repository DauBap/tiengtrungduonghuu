import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { PlaceholderPage } from "~/components/common/placeholder-page";
import { Bell } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminNotifications() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <PlaceholderPage
      user={user}
      title="Thông báo"
      description="Gửi và quản lý thông báo tới giáo viên, học viên."
      icon={<Bell className="h-10 w-10" />}
    />
  );
}
