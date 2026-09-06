import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { PlaceholderPage } from "~/components/common/placeholder-page";
import { ChartColumn } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminReports() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <PlaceholderPage
      user={user}
      title="Báo cáo"
      description="Thống kê tuyển sinh, doanh thu và kết quả học tập."
      icon={<ChartColumn className="h-10 w-10" />}
    />
  );
}
