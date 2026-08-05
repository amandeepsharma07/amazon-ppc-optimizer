import { NextResponse } from "next/server";
import {
  AuthError, destroyAllSessionsFor, hashPassword, passwordProblem, requireAdmin,
} from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

function fail(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await query(
      `SELECT u.id::text, u.email, u.name, u.role, u.is_active, u.created_at, u.last_login_at,
              (SELECT COUNT(*)::int FROM sessions s
                WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions,
              (SELECT COUNT(*)::int FROM runs r WHERE r.user_id = u.id) AS run_count
         FROM users u
        ORDER BY u.created_at DESC`
    );
    return NextResponse.json({ users });
  } catch (err) { return fail(err); }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { email, name, password, role } = await request.json().catch(() => ({}));

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    const problem = passwordProblem(String(password ?? ""));
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (role !== "admin" && role !== "member") {
      return NextResponse.json({ error: "Role must be admin or member." }, { status: 400 });
    }

    const taken = await queryOne(`SELECT id FROM users WHERE email = $1`, [cleanEmail]);
    if (taken) return NextResponse.json({ error: "That email already has an account." }, { status: 409 });

    const created = await queryOne(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id::text, email, name, role, is_active, created_at, last_login_at`,
      [cleanEmail, String(name ?? "").trim().slice(0, 80), await hashPassword(password), role]
    );
    return NextResponse.json({ user: created });
  } catch (err) { return fail(err); }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const { id, action, password, role } = await request.json().catch(() => ({}));
    const target = await queryOne<{ id: string; role: string; is_active: boolean }>(
      `SELECT id::text, role, is_active FROM users WHERE id = $1`, [id]
    );
    if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });

    // Guard against an account locking itself out or the last admin vanishing.
    const admins = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active`
    );
    const lastAdmin = target.role === "admin" && target.is_active && (admins?.n ?? 0) <= 1;

    if (action === "disable") {
      if (target.id === admin.id) {
        return NextResponse.json({ error: "You can't disable your own account." }, { status: 400 });
      }
      if (lastAdmin) {
        return NextResponse.json({ error: "Promote another admin first." }, { status: 400 });
      }
      await query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [id]);
      await destroyAllSessionsFor(id); // signs them out everywhere, right now
    } else if (action === "enable") {
      await query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [id]);
    } else if (action === "signout") {
      await destroyAllSessionsFor(id);
    } else if (action === "password") {
      const problem = passwordProblem(String(password ?? ""));
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(password), id]);
      await destroyAllSessionsFor(id);
    } else if (action === "role") {
      if (role !== "admin" && role !== "member") {
        return NextResponse.json({ error: "Role must be admin or member." }, { status: 400 });
      }
      if (lastAdmin && role === "member") {
        return NextResponse.json({ error: "Promote another admin first." }, { status: 400 });
      }
      await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, id]);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
