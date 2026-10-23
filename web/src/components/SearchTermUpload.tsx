"use client";

import { useState } from "react";

const MARKETS = [
  ["IN", "India — amazon.in"], ["US", "USA — amazon.com"], ["CA", "Canada — amazon.ca"],
  ["UK", "UK — amazon.co.uk"], ["DE", "Germany — amazon.de"], ["AE", "UAE — amazon.ae"],
  ["AU", "Australia — amazon.com.au"], ["SA", "Saudi Arabia — amazon.sa"],
  ["SG", "Singapore — amazon.sg"], ["JP", "Japan — amazon.co.jp"],
] as const;

/**
 * Uploading the Brand Analytics report by hand.
 *
 * The same file the scheduled pull would fetch, so everything downstream is
 * identical. Connecting the API only removes this step.
 */
export default function SearchTermUpload({ defaultMarket }: { defaultMarket: string }) {
  const [marketplace, setMarketplace] = useState(defaultMarket);
  const [periodStart, setPeriodStart] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("marketplace", marketplace);
      if (periodStart) body.set("periodStart", periodStart);
      const response = await fetch("/api/keywords/upload", { method: "POST", body });
      const data = await response.json();
      setResult({ ok: response.ok, text: data.message ?? data.error ?? "Done." });
      if (response.ok) setTimeout(() => location.reload(), 1200);
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
        The file is read on the server and the terms stored; nothing else about it is kept.
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
          {busy ? "Reading…" : "Upload"}
        </button>
      </div>

      <p className="hint" style={{ marginBottom: result ? 10 : 0 }}>
        Leave the week blank and the date is taken from the file&apos;s own reporting range.
        Uploading the same week twice replaces it rather than doubling it, so a corrected
        download is safe to re-upload.
      </p>

      {result && (
        <p className={result.ok ? "hint" : "field-bad"} style={{ margin: 0 }}>{result.text}</p>
      )}
    </div>
  );
}
