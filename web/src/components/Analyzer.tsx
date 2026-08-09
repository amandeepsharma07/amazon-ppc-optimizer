"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  MARKETPLACES, SENSITIVITY, analyze, money, num, pct,
  type BulkData, type Marketplace, type Results, type SearchTermRow, type SensitivityKey,
} from "@/lib/analyze";
import { ingestWorkbook } from "@/lib/parse";

type TabId = "bids" | "negatives" | "harvest" | "campaigns";
const MAX_ROWS = 150;

export default function Analyzer() {
  const [marketplace, setMarketplace] = useState<Marketplace>(MARKETPLACES[0]);
  const [targetMode, setTargetMode] = useState<"ACOS" | "ROAS">("ACOS");
  const [targetValue, setTargetValue] = useState(30);
  const [sensitivity, setSensitivity] = useState<SensitivityKey>("balanced");
  const [bulk, setBulk] = useState<BulkData | null>(null);
  const [searchTerms, setSearchTerms] = useState<SearchTermRow[] | null>(null);
  const [fileNotes, setFileNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Upload at least one file to begin.");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [tab, setTab] = useState<TabId>("bids");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const savedRef = useRef("");

  const targetAcos = useMemo(() => {
    if (!isFinite(targetValue) || targetValue <= 0) return 0.30;
    return targetMode === "ACOS" ? (targetValue > 1 ? targetValue / 100 : targetValue) : 1 / targetValue;
  }, [targetMode, targetValue]);

  const handleFile = useCallback(async (slot: string, file: File) => {
    setError("");
    setStatus(`Reading ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      const found = ingestWorkbook(buffer, file.name);
      if (found.bulk) setBulk(found.bulk);
      if (found.searchTerms) setSearchTerms(found.searchTerms);
      setFileNotes(prev => ({ ...prev, [slot]: `${file.name} — found ${found.summary}` }));
      setStatus("Ready — hit Analyze.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Upload at least one file to begin.");
    }
  }, []);

  const runAnalysis = useCallback(async () => {
    setError("");
    const res = analyze(searchTerms ?? [], bulk, targetAcos, marketplace, sensitivity);
    setResults(res);
    setOpen(new Set());
    setStatus(`Analyzed against a ${pct(targetAcos)} ACOS target (${marketplace.label.split(" — ")[0]}).`);

    // Record the run once per distinct configuration, not on every re-render.
    const fingerprint = JSON.stringify([marketplace.code, targetAcos, sensitivity, Object.values(fileNotes)]);
    if (savedRef.current === fingerprint) return;
    savedRef.current = fingerprint;
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: marketplace.code,
          currency: marketplace.currency,
          targetAcos,
          sensitivity,
          fileNames: Object.values(fileNotes).map(n => n.split(" — ")[0]).join(", "),
          spend: res.totals.spend,
          sales: res.totals.sales,
          clicks: res.totals.clicks,
          orders: res.totals.orders,
          bidChanges: res.bids.length,
          negatives: res.negatives.length,
          harvest: res.harvest.length,
          wastedSpend: res.negatives.reduce((a, n) => a + n.spend, 0),
        }),
      });
    } catch {
      /* History is a convenience; a failed save shouldn't lose the analysis. */
    }
  }, [searchTerms, bulk, targetAcos, marketplace, sensitivity, fileNotes]);

  function downloadWorkbook() {
    if (!results) return;
    const round = (v: number) => Math.round(v * 100) / 100;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.campaigns.map(c => ({
      Campaign: c.campaign, Impressions: c.impressions, Clicks: c.clicks, Spend: round(c.spend),
      Sales: round(c.sales), Orders: c.orders, CTR: +c.ctr.toFixed(4), CVR: +c.cvr.toFixed(4),
      CPC: round(c.cpc), ACOS: +c.acos.toFixed(4), ROAS: +c.roas.toFixed(2),
    }))), "Campaign Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.bids.map(b => ({
      Campaign: b.campaign, "Ad Group": b.adGroup, Target: b.target, "Match Type": b.matchType,
      Clicks: b.clicks, Spend: round(b.spend), Sales: round(b.sales), ACOS: +b.acos.toFixed(4),
      "Current Bid": round(b.currentBid), "New Bid": b.newBid, Action: b.action,
      Reason: b.reason, Explanation: b.why,
    }))), "Bid Recommendations");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.negatives.map(n => ({
      Campaign: n.campaign, "Ad Group": n.adGroup, "Search Term": n.term, Clicks: n.clicks,
      Spend: round(n.spend), Orders: 0, "Add As": "negative exact", Reason: n.reason, Explanation: n.why,
    }))), "Negative Keywords");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.harvest.map(h => ({
      "Search Term": h.term, "From Campaign": h.campaign, "From Ad Group": h.adGroup, Source: h.source,
      Orders: h.orders, Sales: round(h.sales), ACOS: +h.acos.toFixed(4), "Start Bid": h.startBid,
      Reason: h.reason, Explanation: h.why,
    }))), "Keyword Harvest");
    XLSX.writeFile(wb, "ppc-recommendations.xlsx");
  }

  function downloadBulkUpdates() {
    if (!results || !bulk) return;
    const changed = results.bids.filter(
      b => b.rowIndex !== undefined && Math.abs(b.newBid - b.currentBid) >= 0.01
    );
    if (!changed.length) return;
    const opCol = bulk.mapping.operation, bidCol = bulk.mapping.bid;
    const out: unknown[][] = [bulk.headers];
    for (const b of changed) {
      const row = [...(bulk.grid[b.rowIndex!] || [])];
      if (opCol !== undefined) row[opCol] = "Update";
      if (bidCol !== undefined) row[bidCol] = b.newBid;
      out.push(row);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), bulk.sheetName.slice(0, 31));
    XLSX.writeFile(wb, "bulk-bid-updates.xlsx");
  }

  const mk = marketplace;
  const acos = results && results.totals.sales ? results.totals.spend / results.totals.sales : 0;
  const roas = results && results.totals.spend ? results.totals.sales / results.totals.spend : 0;
  const canAnalyze = Boolean(bulk || searchTerms);
  const hasBulkChanges = Boolean(
    results && bulk && results.bids.some(b => b.rowIndex !== undefined && Math.abs(b.newBid - b.currentBid) >= 0.01)
  );

  function toggle(i: number) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <>
      <section className="card" style={{ display: "grid", gap: 16 }}>
        <div className="row">
          <div>
            <label className="field-label" htmlFor="mk">Marketplace</label>
            <select id="mk" value={mk.code}
              onChange={e => setMarketplace(MARKETPLACES.find(m => m.code === e.target.value)!)}>
              {MARKETPLACES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="mode">Target metric</label>
            <select id="mode" value={targetMode}
              onChange={e => {
                const mode = e.target.value as "ACOS" | "ROAS";
                setTargetMode(mode);
                setTargetValue(mode === "ACOS" ? 30 : 4);
              }}>
              <option value="ACOS">ACOS %</option>
              <option value="ROAS">ROAS</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="target">Target value</label>
            <input id="target" type="number" min={0.1} step={0.5} value={targetValue}
              onChange={e => setTargetValue(parseFloat(e.target.value))} />
          </div>
          <div>
            <label className="field-label" htmlFor="sens">Sensitivity</label>
            <select id="sens" value={sensitivity}
              onChange={e => setSensitivity(e.target.value as SensitivityKey)}>
              {Object.entries(SENSITIVITY).map(([key, s]) => (
                <option key={key} value={key}>{s.label} — {s.negativeClicks} clicks</option>
              ))}
            </select>
          </div>
          <div className="narrow" style={{ color: "var(--muted)", fontSize: 12.5, paddingBottom: 10 }}>
            {targetMode === "ACOS"
              ? `= ROAS ${(1 / targetAcos).toFixed(2)}`
              : `= ACOS ${pct(targetAcos)}`}
          </div>
        </div>

        <div className="row">
          {(["a", "b"] as const).map(slot => (
            <div key={slot} className="row-full" style={{ flex: "1 1 280px" }}>
              <label className="field-label" htmlFor={`file-${slot}`}>
                {slot === "a" ? "Bulk sheet or search term report" : "The other file (optional)"}
              </label>
              <input id={`file-${slot}`} type="file" accept=".xlsx,.xlsm,.csv,.tsv"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(slot, f); }} />
              {fileNotes[slot] && (
                <p style={{ color: "var(--good)", fontSize: 12.5, fontWeight: 600, margin: "6px 0 0" }}>
                  {fileNotes[slot]}
                </p>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={runAnalysis} disabled={!canAnalyze}>Analyze</button>
          <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{status}</span>
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
      </section>

      {results && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 22 }}>
            <Kpi label="Ad spend" value={money(results.totals.spend, mk, 0)} sub={`${num(results.totals.clicks, mk)} clicks`} />
            <Kpi label="Ad sales" value={money(results.totals.sales, mk, 0)} sub={`${num(results.totals.orders, mk)} orders`} />
            <Kpi label="ACOS" value={acos ? pct(acos) : "—"} sub={`target ${pct(results.targetAcos)}`}
              chip={acos ? (acos <= results.targetAcos
                ? <span className="chip good">on target</span>
                : <span className="chip crit">over target</span>) : null} />
            <Kpi label="ROAS" value={roas ? roas.toFixed(2) : "—"} sub={`target ${(1 / results.targetAcos).toFixed(2)}`} />
          </div>

          <nav style={{ display: "flex", gap: 4, margin: "24px 0 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            {([
              ["bids", `Bid changes (${results.bids.length})`],
              ["negatives", `Negative keywords (${results.negatives.length})`],
              ["harvest", `Harvest (${results.harvest.length})`],
              ["campaigns", `Campaigns (${results.campaigns.length})`],
            ] as Array<[TabId, string]>).map(([id, label]) => (
              <button key={id} onClick={() => { setTab(id); setOpen(new Set()); }}
                style={{
                  border: 0, background: "none", font: "inherit", fontWeight: 600, cursor: "pointer",
                  padding: "9px 14px", marginBottom: -1,
                  color: tab === id ? "var(--ink)" : "var(--muted)",
                  borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`,
                }}>
                {label}
              </button>
            ))}
          </nav>

          <div style={{ marginTop: 14 }}>
            <ResultsTable results={results} tab={tab} mk={mk} open={open} toggle={toggle} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
            <button className="btn-ghost" onClick={downloadWorkbook}>Download recommendations (.xlsx)</button>
            {hasBulkChanges && (
              <button className="btn-ghost" onClick={downloadBulkUpdates}>Download bid-update bulk file (.xlsx)</button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, chip }: {
  label: string; value: string; sub: string; chip?: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub} {chip}</div>
    </div>
  );
}

function ResultsTable({ results, tab, mk, open, toggle }: {
  results: Results; tab: TabId; mk: Marketplace; open: Set<number>; toggle: (i: number) => void;
}) {
  const arrow = (a: string) =>
    a === "increase" ? <span style={{ color: "var(--good)", fontWeight: 700 }}>↑</span>
      : a === "decrease" ? <span style={{ color: "var(--crit)", fontWeight: 700 }}>↓</span> : null;

  if (tab === "campaigns") {
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Campaign</th><th className="num">Impressions</th><th className="num">Clicks</th>
            <th className="num">Spend</th><th className="num">Sales</th><th className="num">Orders</th>
            <th className="num">CTR</th><th className="num">CVR</th><th className="num">CPC</th>
            <th className="num">ACOS</th><th className="num">ROAS</th>
          </tr></thead>
          <tbody>
            {results.campaigns.map((c, i) => (
              <tr key={i}>
                <td className="ell" title={c.campaign}>{c.campaign}</td>
                <td className="num">{num(c.impressions, mk)}</td>
                <td className="num">{num(c.clicks, mk)}</td>
                <td className="num">{money(c.spend, mk)}</td>
                <td className="num">{money(c.sales, mk)}</td>
                <td className="num">{num(c.orders, mk)}</td>
                <td className="num">{pct(c.ctr)}</td>
                <td className="num">{pct(c.cvr)}</td>
                <td className="num">{money(c.cpc, mk)}</td>
                <td className="num">{c.acos ? pct(c.acos) : "—"}</td>
                <td className="num">{c.roas.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const rows = tab === "bids" ? results.bids.slice(0, MAX_ROWS)
    : tab === "negatives" ? results.negatives.slice(0, MAX_ROWS)
    : results.harvest.slice(0, MAX_ROWS);
  const total = tab === "bids" ? results.bids.length
    : tab === "negatives" ? results.negatives.length : results.harvest.length;

  const headers = tab === "bids"
    ? ["", "Target", "Match", "Campaign", "Clicks", "Spend", "Sales", "ACOS", "Bid", "New bid", "Reason"]
    : tab === "negatives"
      ? ["", "Search term", "Campaign", "Ad group", "Clicks", "Spend", "Add as", "Reason"]
      : ["", "Search term", "Source", "Campaign", "Orders", "Sales", "ACOS", "Start bid", "Reason"];
  const numeric = tab === "bids" ? [4, 5, 6, 7, 8, 9]
    : tab === "negatives" ? [4, 5] : [4, 5, 6, 7];

  return (
    <>
      {total > MAX_ROWS && (
        <p className="hint">Showing the top {MAX_ROWS} of {total} rows by spend — the downloaded workbook has all of them.</p>
      )}
      {!rows.length && <p className="hint">Nothing to act on in this category.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              {headers.map((h, i) => <th key={i} className={numeric.includes(i) ? "num" : ""}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r: any, i) => (
                <FragmentRow key={i} index={i} open={open.has(i)} toggle={toggle} colSpan={headers.length} why={r.why}>
                  {tab === "bids" && <>
                    <td className="ell" title={r.target}><strong>{r.target}</strong></td>
                    <td>{r.matchType || "—"}</td>
                    <td className="ell" title={r.campaign}>{r.campaign}</td>
                    <td className="num">{num(r.clicks, mk)}</td>
                    <td className="num">{money(r.spend, mk)}</td>
                    <td className="num">{money(r.sales, mk)}</td>
                    <td className="num">{r.acos ? pct(r.acos) : "—"}</td>
                    <td className="num">{money(r.currentBid, mk)}</td>
                    <td className="num">{arrow(r.action)} <strong>{money(r.newBid, mk)}</strong></td>
                    <td style={{ color: "var(--muted)" }}>{r.reason}</td>
                  </>}
                  {tab === "negatives" && <>
                    <td className="ell" title={r.term}><strong>{r.term}</strong></td>
                    <td className="ell" title={r.campaign}>{r.campaign}</td>
                    <td className="ell" title={r.adGroup}>{r.adGroup}</td>
                    <td className="num">{num(r.clicks, mk)}</td>
                    <td className="num">{money(r.spend, mk)}</td>
                    <td><span className="chip crit">negative exact</span></td>
                    <td style={{ color: "var(--muted)" }}>{r.reason}</td>
                  </>}
                  {tab === "harvest" && <>
                    <td className="ell" title={r.term}><strong>{r.term}</strong></td>
                    <td>{r.source}</td>
                    <td className="ell" title={r.campaign}>{r.campaign}</td>
                    <td className="num">{num(r.orders, mk)}</td>
                    <td className="num">{money(r.sales, mk)}</td>
                    <td className="num">{pct(r.acos)}</td>
                    <td className="num"><strong>{money(r.startBid, mk)}</strong></td>
                    <td style={{ color: "var(--muted)" }}>{r.reason}</td>
                  </>}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FragmentRow({ index, open, toggle, colSpan, why, children }: {
  index: number; open: boolean; toggle: (i: number) => void;
  colSpan: number; why: string; children: React.ReactNode;
}) {
  return (
    <>
      <tr onClick={() => toggle(index)} style={{ cursor: "pointer" }} aria-expanded={open}>
        <td style={{ color: "var(--muted)", width: 12 }}>{open ? "⌄" : "›"}</td>
        {children}
      </tr>
      {open && (
        <tr>
          <td colSpan={colSpan} style={{ whiteSpace: "normal", color: "var(--muted)", fontSize: 13, padding: "0 14px 12px 32px" }}>
            {why}
          </td>
        </tr>
      )}
    </>
  );
}
