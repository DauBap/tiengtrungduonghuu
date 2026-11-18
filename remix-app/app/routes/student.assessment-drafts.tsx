import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import { isAssessmentDraftData } from "~/lib/assessment-drafts";
import {
  deleteAssessmentDraft,
  saveAssessmentDraft,
  validateAssessmentDraftScope,
} from "~/lib/assessment-drafts.server";

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const formData = await request.formData();
  const intent = formData.get("intent");
  let scope: unknown;
  try {
    scope = JSON.parse(String(formData.get("scope") ?? ""));
  } catch {
    return Response.json({ error: "Thông tin lưu bài không hợp lệ." }, { status: 400 });
  }

  const validated = await validateAssessmentDraftScope(user.id, scope);
  if (!validated) {
    return Response.json({ error: "Không thể lưu nháp cho phần làm bài này." }, { status: 403 });
  }

  if (intent === "delete") {
    await deleteAssessmentDraft(user.id, validated.scope);
    return Response.json({ success: true });
  }

  if (intent !== "save") {
    return Response.json({ error: "Thao tác lưu nháp không hợp lệ." }, { status: 400 });
  }

  const rawData = formData.get("data");
  if (typeof rawData !== "string" || rawData.length > 262_144) {
    return Response.json({ error: "Bản nháp vượt quá dung lượng cho phép." }, { status: 400 });
  }

  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    return Response.json({ error: "Dữ liệu bản nháp không hợp lệ." }, { status: 400 });
  }
  if (!isAssessmentDraftData(data)) {
    return Response.json({ error: "Dữ liệu bản nháp không hợp lệ." }, { status: 400 });
  }

  const saved = await saveAssessmentDraft(user.id, validated.scope, data);
  return Response.json({ success: true, savedAt: saved.updatedAt.toISOString() });
}

export default function AssessmentDraftResource() {
  return null;
}
