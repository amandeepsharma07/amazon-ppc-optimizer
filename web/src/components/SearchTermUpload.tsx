"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { parseSearchTermsReport, type SearchTermRecord } from "@/lib/brand-analytics";

const MARKETS = [
  ["IN", "India — amazon.in"], ["US", "USA — amazon.com"], ["CA", "Canada — amazon.ca"],
  ["UK", "UK — amazon.co.uk"], ["DE", "Germany — amazon.de"], ["AE", "UAE — amazon.ae"],
  ["AU", "Australia — amazon.com.au"], ["SA", "Saudi Arabia — amazon.sa"],
  ["SG", "Singapore — amazon.sg"], ["JP", "Japan — amazon.co.jp"],
] as const;

/** Small enough that a batch never approaches a request body limit. */
const BATCH = 2000;

/**
 * Uploading the Brand Analytics report by hand.
 *
 * The file is read and parsed here, in the browser, then sent in batches. A
 * whole marketplace week is tens of megabytes and a serverless request body is
 * capped at a few — so uploading the file itself would work locally and fail
 * on the deployment. Parsing here also means the report never has to be
 * narrowed by department to fit, which matters when the products being worked
 * on span several.
 */
export default function SearchTermUpload({ defaultMarket }: { defaultMarket: string }) {
  const [marketplace, setMarketplace] = useState(defaultMarket);
  const [periodStart, setPeriodStart] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function readAsText(f: File): Promise<string> {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isSpreadsheet = /\.(xlsx|xlsm|xls)$/i.test(f.name)
      // Every modern spreadsheet is a zip, whatever it has been renamed to.
      || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    if (!isSpreadsheet) return new TextDecoder().decode(bytes);

    const book = XLSX.read(bytes, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("That spreadsheet has no sheets in it.");
    return XLSX.utils.sheet_to_csv(sheet);
  }

  async function send(rows: SearchTermRecord[], period: string) {
    const response = await fetch("/api/keywords/rows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketplace, periodStart: period, rows }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "A batch was rejected.");
    return data.stored as number;
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setProgress(null);
    try {
      const text = await readAsText(file);
      const parsed = parseSearchTermsReport(text);

      if (!parsed.rows.length) {
        setResult({ ok: false, text: parsed.note ?? "No search term rows were found in that file." });
        return;
      }
      const period = periodStart || parsed.periodStart || new Date().toISOString().slice(0, 10);

      let stored = 0;
      for (let i = 0; i < parsed.rows.length; i += BATCH) {
        stored += await send(parsed.rows.slice(i, i + BATCH), period);
        setProgress({ done: Math.min(i + BATCH, parsed.rows.length), total: parsed.rows.length });
      }

      setResult({
        ok: true,
        text: `${stored.toLocaleString()} search terms stored for the week starting ${period}`
          + `${parsed.skipped ? `, ${parsed.skipped.toLocaleString()} incomplete rows skipped` : ""}.`,
      });
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "The upload failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section">Upload a Brand Analytics report</h2>
      <p className="hint">
        In Seller Central: <strong>Brands → Brand Analytics → Amazon Search Terms</strong>.
        Pick a reporting week, then <strong>Download</strong> — CSV or Excel, either works.
        No need to narrow it by department: the whole marketplace is fine, however many
        categories your products sit across.
      </p>

      <div className="row">
        <div className="narrow">
          <label className="field-label" htmlFor="up-market">Marketplace</label>
          <select id="up-market" value={marketplace} onChange={e => setMarketplace(e.target.value)}>
            {MARKETS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        <div className="narrow">
          <label className="field-label" htmlFor="up-period">Week starting</label>
          <input id="up-period" type="date" value={periodStart}
            onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="up-file">The downloaded file</label>
          <input id="up-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button className="btn narrow" disabled={!file || busy} onClick={upload}>
          {busy ? "Working…" : "Upload"}
        </button>
      </div>

      {progress && (
        <>
          <div className="meter-lg" style={{ marginTop: 4 }}>
            <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} terms stored.
          </p>
        </>
      )}

      <p className="hint" style={{ margin: "12px 0 0" }}>
        The file is read in this browser and sent in batches, so there is no size limit to
        work around. Leave the week blank and the date is taken from the file&apos;s own
        reporting range. Uploading the same week twice replaces it rather than doubling it.
      </p>

      {result && (
        <p className={result.ok ? "hint" : "field-bad"} style={{ margin: "8px 0 0" }}>{result.text}</p>
      )}
    </div>
  );
}
