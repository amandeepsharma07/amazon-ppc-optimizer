import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { advanceJobs, forgetCredentials, saveCredentials, startPull } from "@/lib/research";
import { MissingKeyError } from "@/lib/secrets";
import { MARKETPLACE_IDS, SpApiError, accessToken } from "@/lib/spapi";
import { configFor } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Starting a pull is quick; collecting one downloads a report, which is not.
export const maxDuration = 60;

/**
 * Everything an admin can do with the Amazon connection. One route with an
 * action rather than four, because they share all of their error handling and
 * every one of them is admin-only.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const marketplace = String(body.marketplace ?? "IN");

    if (!MARKETPLACE_IDS[marketplace]) {
      return NextResponse.json({ error: `${marketplace} is not a marketplace Amazon serves.` }, { status: 400 });
    }

    if (action === "save") {
      for (const field of ["clientId", "clientSecret", "refreshToken"]) {
        if (!String(body[field] ?? "").trim()) {
          return NextResponse.json({ error: "Fill in all three credentials." }, { status: 400 });
        }
      }
      await saveCredentials({
        marketplace,
        clientId: String(body.clientId),
        clientSecret: String(body.clientSecret),
        refreshToken: String(body.refreshToken),
        by: admin.email,
      });
      return NextResponse.json({ ok: true, message: "Saved. Test the connection to confirm Amazon accepts it." });
    }

    if (action === "forget") {
      await forgetCredentials(marketplace);
      return NextResponse.json({ ok: true, message: "Credentials removed." });
    }

    if (action === "test") {
      const config = await configFor(marketplace);
      if (!config) return NextResponse.json({ error: "Nothing saved for this marketplace yet." }, { status: 400 });
      // Minting a token proves the three credentials work together, which is
      // where setup almost always goes wrong.
      await accessToken(config, fetch);
      return NextResponse.json({ ok: true, message: "Amazon accepted the credentials." });
    }

    if (action === "pull") {
      const { jobId, reportId } = await startPull(marketplace, body.period === "MONTH" ? "MONTH" : "WEEK");
      return NextResponse.json({
        ok: true, jobId, reportId,
        message: "Asked Amazon for the report. It takes a few minutes; collection happens automatically.",
      });
    }

    if (action === "collect") {
      const results = await advanceJobs();
      return NextResponse.json({ ok: true, results });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: err.message, needsKey: true }, { status: 400 });
    }
    if (err instanceof SpApiError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 }
    );
  }
}
