import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { AuthError, requireUser } from "@/lib/auth";
import { importText } from "@/lib/research";
import { MARKETPLACE_IDS } from "@/lib/spapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A marketplace week can be large; Amazon's own export runs to a few MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Takes the Brand Analytics report downloaded by hand from Seller Central.
 *
 * The same file the scheduled pull would have fetched, arriving by a different
 * route — so it goes through the same parser and the same storage, and the
 * research screens cannot tell which way a row came in. That is what makes the
 * API optional rather than required: the connection automates this step, it
 * does not unlock anything.
 *
 * A spreadsheet is converted to CSV here rather than parsed separately. Seller
 * Central hands out .csv from the web page and .xlsx from some report queues,
 * and having one parser downstream means one set of rules to keep correct.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    const marketplace = String(form.get("marketplace") ?? "IN");
    const periodStart = String(form.get("periodStart") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    if (!MARKETPLACE_IDS[marketplace]) {
      return NextResponse.json({ error: `${marketplace} is not a marketplace Amazon serves.` }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That file is ${Math.round(file.size / 1024 / 1024)} MB; the limit is 25 MB.` },
        { status: 400 }
      );
    }
    if (periodStart && !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
      return NextResponse.json({ error: "The week start needs to be a date." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const isSpreadsheet = /\.(xlsx|xlsm|xls)$/i.test(file.name)
      // A zip header: every modern spreadsheet is one, whatever it is named.
      || (bytes[0] === 0x50 && bytes[1] === 0x4b);

    let body: string;
    if (isSpreadsheet) {
      const book = XLSX.read(bytes, { type: "buffer" });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) return NextResponse.json({ error: "That spreadsheet has no sheets in it." }, { status: 400 });
      body = XLSX.utils.sheet_to_csv(sheet);
    } else {
      body = bytes.toString("utf8");
    }

    const result = await importText(marketplace, body, periodStart || undefined);

    if (!result.rows) {
      return NextResponse.json({ error: result.note }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      rows: result.rows,
      periodStart: result.periodStart,
      skipped: result.skipped,
      message: `${result.rows.toLocaleString()} search terms stored for the week starting `
        + `${result.periodStart}${result.skipped ? `, ${result.skipped} incomplete rows skipped` : ""}.`,
      by: user.email,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The file could not be read." },
      { status: 500 }
    );
  }
}
