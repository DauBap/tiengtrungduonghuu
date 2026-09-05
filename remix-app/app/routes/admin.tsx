import { Outlet } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import { AppShell } from "~/components/layout/app-shell";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  return { user };
}

export default function AdminLayout() {
  return <Outlet />;
}

// AppShell is rendered in child routes via useRouteLoaderData
