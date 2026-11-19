import { createHmac, timingSafeEqual } from "node:crypto";

const officeViewerOrigin = "https://view.officeapps.live.com";
const publicSiteHosts = new Set([
  "tiengtrungduonghuu.edu.vn",
  "www.tiengtrungduonghuu.edu.vn",
]);
const shareDurationSeconds = 30 * 60;
const powerpointMimeTypes = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return secret;
}

function createSignature(courseId: string, documentId: string, fileName: string, expiresAt: number) {
  return createHmac("sha256", getSessionSecret())
    .update(`${courseId}:${documentId}:${fileName}:${expiresAt}`)
    .digest("base64url");
}

export function createCourseDocumentOfficeViewerUrl(
  requestUrl: string,
  courseId: string,
  documentId: string,
  mimeType: string,
  fileName: string,
) {
  if (!powerpointMimeTypes.has(mimeType)) return null;

  const requestOrigin = new URL(requestUrl);
  const hostname = requestOrigin.hostname.toLowerCase();
  if (!publicSiteHosts.has(hostname)) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + shareDurationSeconds;
  const sourceUrl = new URL(
    `/student/courses/${encodeURIComponent(courseId)}/documents/${encodeURIComponent(documentId)}/${encodeURIComponent(fileName)}`,
    `https://${hostname}`,
  );
  sourceUrl.searchParams.set("shareExpires", String(expiresAt));
  sourceUrl.searchParams.set("shareSignature", createSignature(courseId, documentId, fileName, expiresAt));

  const viewerUrl = new URL("/op/view.aspx", officeViewerOrigin);
  viewerUrl.searchParams.set("src", sourceUrl.toString());
  return viewerUrl.toString();
}

export function isValidCourseDocumentShare(
  requestUrl: string,
  courseId: string,
  documentId: string,
  fileName: string,
) {
  const searchParams = new URL(requestUrl).searchParams;
  const expiresValue = searchParams.get("shareExpires");
  const signature = searchParams.get("shareSignature");
  if (!expiresValue || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;

  const expiresAt = Number(expiresValue);
  const currentTime = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= currentTime ||
    expiresAt > currentTime + shareDurationSeconds + 60
  ) return false;

  const providedSignature = Buffer.from(signature, "base64url");
  const expectedSignature = Buffer.from(createSignature(courseId, documentId, fileName, expiresAt), "base64url");
  return providedSignature.length === expectedSignature.length
    && timingSafeEqual(providedSignature, expectedSignature);
}
