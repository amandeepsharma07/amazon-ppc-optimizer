import { NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { setupState } from "@/lib/setup";

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const state = await setupState();
  if (state.state === "no-database") {
    return NextResponse.json(
      { error: "The database isn't connected yet — check DATABASE_URL in your hosting settings.", setup: "/setup" },
      { status: 503 }
    );
  }
  if (state.state === "needs-admin") {
    return NextResponse.json(
      { error: "No accounts exist yet. Create the first one.", setup: "/setup" },
      { status: 409 }
    );
  }

  const user = await queryOne<{ id: string; password_hash: string; is_active: boolean }>(
    `SELECT id::text, password_hash, is_active FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );

  // One message for every failure, so it can't be used to discover which
  // email addresses have accounts.
  const wrong = NextResponse.json({ error: "Email or password is wrong." }, { status: 401 });
  if (!user) {
    // Spend comparable time so a missing account isn't obvious from latency.
    await verifyPassword(password, "scrypt$00$00");
    return wrong;
  }
  if (!(await verifyPassword(password, user.password_hash))) return wrong;
  if (!user.is_active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  const sessionId = await createSession(user.id, request.headers.get("user-agent") ?? "");
  await setSessionCookie(sessionId);
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  return NextResponse.json({ ok: true });
}
