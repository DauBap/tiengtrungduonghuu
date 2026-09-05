import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUserFromSession } from "~/lib/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromSession(request);
  if (!user) return redirect("/login");
  const dest = { admin: "/admin", teacher: "/teacher", student: "/student" };
  return redirect(dest[user.role]);
}

export default function Index() {
  return null;
}
