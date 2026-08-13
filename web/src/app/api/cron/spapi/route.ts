import { NextResponse } from "next/server";
import { advanceJobs, listAccounts, startPull } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheduled run: collect whatever finished, then ask for the next report.
 *
 * Vercel sends its own bearer token when CRON_SECRET is set. When it is not
 * set the route is open, which is why it does nothing destructive and nothing
 * that reveals data — the worst an unwanted caller achieves is asking Amazon
 * for a report slightly early.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
  }

  const collected = await advanceJobs(10);

  // Then start the next pull for each connected marketplace. Brand Analytics
  // updates weekly, so a daily request simply picks up the new week the day
  // it appears rather than needing to know when that is.
  const started: Array<{ marketplace: string; jobId?: string; error?: string }> = [];
  for (const account of await listAccounts()) {
    try {
      const { jobId } = await startPull(account.marketplace, "WEEK");
      started.push({ marketplace: account.marketplace, jobId });
    } catch (err) {
      started.push({
        marketplace: account.marketplace,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, collected, started });
}
