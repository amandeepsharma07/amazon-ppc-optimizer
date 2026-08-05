import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

function fail(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Members see their own runs; admins see everyone's. */
export async function GET() {
  try {
    const user = await requireUser();
    const runs = user.role === "admin"
      ? await query(
          `SELECT r.*, u.email, u.name AS user_name FROM runs r
             JOIN users u ON u.id = r.user_id
            ORDER BY r.ran_at DESC LIMIT 200`)
      : await query(
          `SELECT r.*, $2::text AS email, $3::text AS user_name FROM runs r
            WHERE r.user_id = $1 ORDER BY r.ran_at DESC LIMIT 200`,
          [user.id, user.email, user.name]);
    return NextResponse.json({ runs, role: user.role });
  } catch (err) { return fail(err); }
}

/**
 * Records that an analysis happened. Only headline figures are stored —
 * the report itself is parsed in the browser and never sent here.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
    const s = (v: unknown, max = 120) => String(v ?? "").slice(0, max);

    await query(
      `INSERT INTO runs (user_id, marketplace, currency, target_acos, sensitivity, file_names,
                         spend, sales, clicks, orders, bid_changes, negatives, harvest, wasted_spend)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        user.id, s(body.marketplace, 8), s(body.currency, 8), n(body.targetAcos),
        s(body.sensitivity, 16), s(body.fileNames, 300),
        n(body.spend), n(body.sales), Math.round(n(body.clicks)), Math.round(n(body.orders)),
        Math.round(n(body.bidChanges)), Math.round(n(body.negatives)),
        Math.round(n(body.harvest)), n(body.wastedSpend),
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
