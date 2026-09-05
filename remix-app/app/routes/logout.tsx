import type { ActionFunctionArgs } from "react-router";
import { destroyUserSession } from "~/lib/session.server";

export async function action({ request }: ActionFunctionArgs) {
  return destroyUserSession(request);
}

export async function loader() {
  return { ok: true };
}
