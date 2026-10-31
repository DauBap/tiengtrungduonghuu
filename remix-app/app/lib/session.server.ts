import { createCookieSessionStorage, redirect } from "react-router";
import { prisma } from "~/lib/prisma.server";

export type UserRole = "admin" | "teacher" | "student";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET must be set");

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

function isSessionUser(value: unknown): value is SessionUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string"
    && typeof user.email === "string"
    && typeof user.name === "string"
    && (user.role === "admin" || user.role === "teacher" || user.role === "student")
    && (user.mustChangePassword === undefined || typeof user.mustChangePassword === "boolean");
}

async function getValidatedSessionUser(session: Awaited<ReturnType<typeof getSession>>): Promise<SessionUser | null> {
  const sessionUser = session.get("user");
  const authVersion = session.get("authVersion");
  if (!isSessionUser(sessionUser) || typeof authVersion !== "number" || !Number.isSafeInteger(authVersion)) return null;

  const user = await prisma.user.findFirst({
    where: { id: sessionUser.id, isActive: true, isActivated: true, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      mustChangePassword: true,
      updatedAt: true,
    },
  });
  if (
    !user
    || user.role !== sessionUser.role
    || user.updatedAt.getTime() !== authVersion
  ) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function getUserFromSession(request: Request): Promise<SessionUser | null> {
  return getValidatedSessionUser(await getSession(request));
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const session = await getSession(request);
  const user = await getValidatedSessionUser(session);
  if (!user) {
    const headers = session.has("user")
      ? { headers: { "Set-Cookie": await sessionStorage.destroySession(session) } }
      : undefined;
    throw redirect("/login", headers);
  }
  if (user.mustChangePassword) throw redirect("/change-password");
  return user;
}

export async function requireRole(request: Request, roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser(request);
  if (!roles.includes(user.role)) {
    const dest: Record<UserRole, string> = { admin: "/admin", teacher: "/teacher", student: "/student" };
    throw redirect(dest[user.role]);
  }
  return user;
}

export async function createUserSession(user: SessionUser, redirectTo: string) {
  const session = await sessionStorage.getSession();
  const currentUser = await prisma.user.findFirst({
    where: { id: user.id, isActive: true, isActivated: true, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      mustChangePassword: true,
      updatedAt: true,
    },
  });
  if (!currentUser || currentUser.role !== user.role) throw redirect("/login");

  session.set("user", {
    id: currentUser.id,
    email: currentUser.email,
    name: currentUser.name,
    role: currentUser.role,
    mustChangePassword: currentUser.mustChangePassword,
  });
  session.set("authVersion", currentUser.updatedAt.getTime());
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
