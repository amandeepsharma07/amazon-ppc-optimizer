import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
export { hashPassword, verifyPassword, passwordProblem } from "./password";

export const SESSION_COOKIE = "ppc_session";
const SESSION_DAYS = 14;

export type Role = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

/* ---------- sessions ---------- */

export async function createSession(userId: string, userAgent: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)`,
    [id, userId, expires, userAgent.slice(0, 300)]
  );
  return id;
}

export async function setSessionCookie(sessionId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, or null. Reads the session row on every request, so
 * deleting a session or disabling an account takes effect immediately rather
 * than whenever a token happens to expire.
 */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return queryOne<User>(
    `SELECT u.id::text, u.email, u.name, u.role, u.is_active, u.created_at, u.last_login_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > NOW() AND u.is_active`,
    [sessionId]
  );
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("Not signed in", 401);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admins only", 403);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function destroySession(sessionId: string) {
  await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export async function destroyAllSessionsFor(userId: string) {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
