import { createCookieSessionStorage, redirect } from "react-router";

export type UserRole = "admin" | "teacher" | "student";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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

export async function getUserFromSession(request: Request): Promise<SessionUser | null> {
  const session = await getSession(request);
  const user = session.get("user");
  return user ?? null;
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getUserFromSession(request);
  if (!user) throw redirect("/login");
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
  session.set("user", user);
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
