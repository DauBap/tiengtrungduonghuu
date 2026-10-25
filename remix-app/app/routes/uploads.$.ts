import type { LoaderFunctionArgs } from "react-router";
import { serveStoredAsset } from "~/lib/storage.server";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const pathname = params["*"];
  if (!pathname) throw new Response("Không tìm thấy tệp", { status: 404 });
  return serveStoredAsset(request, `/uploads/${pathname}`);
}
