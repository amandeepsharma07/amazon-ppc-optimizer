import { NextResponse } from "next/server";
import { createSession, hashPassword, passwordProblem, setSessionCookie } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { setupState } from "@/lib/setup";

/**
 * Creates the very first admin. Only works while there are no users at all,
 * so it can't be used to add an account to a running installation.
 */
export async function POST(request: Request) {
  const state = await setupState();
  if (state.state === "no-database") {
    return NextResponse.json(
      { error: `Can't reach the database. ${state.detail}` }, { status: 503 }
    );
  }
  if (state.state === "ready") {
    return NextResponse.json(
      { error: "Setup is already done. Sign in instead." }, { status: 409 }
    );
  }

  const { email, name, password } = await request.json().catch(() => ({}));
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const problem = passwordProblem(String(password ?? ""));
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Re-check inside the write so two people opening /setup at once can't both
  // create an owner account.
  const created = await queryOne<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, role)
     SELECT $1, $2, $3, 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM users)
     RETURNING id::text`,
    [cleanEmail, String(name ?? "").trim().slice(0, 80) || "Administrator", await hashPassword(password)]
  );
  if (!created) {
    return NextResponse.json({ error: "Someone just completed setup. Sign in instead." }, { status: 409 });
  }

  const sessionId = await createSession(created.id, request.headers.get("user-agent") ?? "");
  await setSessionCookie(sessionId);
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [created.id]);
  return NextResponse.json({ ok: true });
}
