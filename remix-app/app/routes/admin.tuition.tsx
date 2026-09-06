import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireRole } from "~/lib/session.server";
import { PlaceholderPage } from "~/components/common/placeholder-page";
import { Wallet } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminTuition() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <PlaceholderPage
      user={user}
      title="Học phí"
      description="Theo dõi học phí, hóa đơn và tình trạng thanh toán."
      icon={<Wallet className="h-10 w-10" />}
    />
  );
}
