import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { storeSearchTermRows } from "@/lib/research";
import { MARKETPLACE_IDS } from "@/lib/spapi";
import type { SearchTermRecord } from "@/lib/brand-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stores one batch of parsed search terms.
 *
 * The file is parsed in the browser and sent in pieces rather than uploaded
 * whole, because a serverless request body is capped at a few megabytes and an
 * unfiltered marketplace week is far larger than that. Sending the whole file
 * worked on a laptop and would have failed on the deployment — the same shape
 * of fault as a missing file trace, and worth avoiding the same way.
 *
 * It also means a seller running an agency does not have to narrow the report
 * by department to make it fit, which would have meant a separate download per
 * client's category.
 */
const MAX_ROWS = 5000;

export async function POST(request: Request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => ({}));

    const marketplace = String(body.marketplace ?? "");
    const periodStart = String(body.periodStart ?? "");
    const rows = body.rows as SearchTermRecord[] | undefined;

    if (!MARKETPLACE_IDS[marketplace]) {
      return NextResponse.json({ error: `${marketplace} is not a marketplace Amazon serves.` }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
      return NextResponse.json({ error: "The week start needs to be a date." }, { status: 400 });
    }
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "That batch held no rows." }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Batches are limited to ${MAX_ROWS} rows.` }, { status: 400 });
    }

    // Trust nothing about the shape: this arrives from a browser.
    const clean: SearchTermRecord[] = [];
    for (const row of rows) {
      const searchTerm = String(row?.searchTerm ?? "").trim().toLowerCase();
      const rank = Number(row?.rank);
      if (!searchTerm || !Number.isFinite(rank)) continue;
      clean.push({
        searchTerm: searchTerm.slice(0, 500),
        department: row.department ? String(row.department).slice(0, 120) : null,
        rank: Math.trunc(rank),
        asins: (Array.isArray(row.asins) ? row.asins : []).slice(0, 3)
          .filter(a => /^[A-Z0-9]{10}$/i.test(String(a?.asin ?? "")))
          .map((a, i) => ({
            asin: String(a.asin).toUpperCase(),
            position: Number.isFinite(Number(a.position)) ? Math.trunc(Number(a.position)) : i + 1,
            title: a.title ? String(a.title).slice(0, 400) : undefined,
            clickShare: Number.isFinite(Number(a.clickShare)) ? Number(a.clickShare) : undefined,
            conversionShare: Number.isFinite(Number(a.conversionShare)) ? Number(a.conversionShare) : undefined,
          })),
      });
    }

    const stored = await storeSearchTermRows(marketplace, periodStart, clean);
    return NextResponse.json({ ok: true, stored, skipped: rows.length - clean.length });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The batch could not be stored." },
      { status: 500 }
    );
  }
}
