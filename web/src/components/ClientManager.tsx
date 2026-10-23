"use client";

import { useState } from "react";
import type { ClientAsinRow, ClientRow, ClientTermRow } from "@/lib/research";

const MARKETS = [
  ["IN", "India"], ["US", "USA"], ["CA", "Canada"], ["UK", "UK"], ["DE", "Germany"],
  ["AE", "UAE"], ["AU", "Australia"], ["SA", "Saudi Arabia"], ["SG", "Singapore"], ["JP", "Japan"],
] as const;

export default function ClientManager({
  clients, selected, asins, terms, hasData,
}: {
  clients: ClientRow[];
  selected: ClientRow | null;
  asins: ClientAsinRow[];
  terms: ClientTermRow[];
  hasData: boolean;
}) {
  const [name, setName] = useState("");
  const [marketplace, setMarketplace] = useState("IN");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(payload: Record<string, unknown>, keep = false) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      setMessage({ ok: response.ok, text: data.message ?? data.error ?? "Done." });
      if (response.ok) {
        if (!keep) { setName(""); setPaste(""); }
        setTimeout(() => location.reload(), 700);
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  const byAsin = new Map<string, ClientTermRow[]>();
  for (const row of terms) {
    if (!byAsin.has(row.asin)) byAsin.set(row.asin, []);
    byAsin.get(row.asin)!.push(row);
  }

  return (
    <div className="stack">
      <div className="card">
        <h2 className="section">Add a client</h2>
        <p className="hint">
          A client is a name and a set of ASINs. Research then runs across the whole
          portfolio at once, instead of one product at a time.
        </p>
        <div className="row">
          <div>
            <label className="field-label" htmlFor="cl-name">Client name</label>
            <input id="cl-name" type="text" value={name} placeholder="Packster"
              onChange={e => setName(e.target.value)} />
          </div>
          <div className="narrow">
            <label className="field-label" htmlFor="cl-market">Marketplace</label>
            <select id="cl-market" value={marketplace} onChange={e => setMarketplace(e.target.value)}>
              {MARKETS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <button className="btn narrow" disabled={!name.trim() || busy}
            onClick={() => send({ action: "create", name, marketplace })}>
            Add client
          </button>
        </div>
        {message && (
          <p className={message.ok ? "hint" : "field-bad"} style={{ margin: 0 }}>{message.text}</p>
        )}
      </div>

      {clients.length > 0 && (
        <div className="card">
          <h2 className="section">Clients</h2>
          <div className="chips-row">
            {clients.map(c => (
              <a key={c.id} href={`/clients?id=${c.id}`}
                className={`clientchip${selected?.id === c.id ? " on" : ""}`}>
                {c.name}
                <span>{c.marketplace} · {c.asins} ASIN{c.asins === 1 ? "" : "s"}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <>
          <div className="card">
            <div className="builder-head">
              <h2 className="section" style={{ margin: 0 }}>
                {selected.name} — {selected.marketplace}
              </h2>
              <button className="btn-link danger"
                onClick={() => { if (confirm(`Remove ${selected.name} and its ASIN list?`)) send({ action: "delete", id: selected.id }); }}>
                Remove client
              </button>
            </div>
            <p className="hint">
              Paste ASINs however you have them — a column from a sheet, commas, or one per
              line. Anything that is not an ASIN is reported back rather than dropped, because
              a mistyped ASIN looks exactly like a product with no data.
            </p>
            <div className="row">
              <div className="row-full" style={{ maxWidth: "none" }}>
                <label className="field-label" htmlFor="cl-asins">ASINs</label>
                <textarea id="cl-asins" rows={3} value={paste}
                  placeholder={"B0CZ8K9LMN\nB0AB12CD34, B0ZZ99YY88"}
                  onChange={e => setPaste(e.target.value)} />
              </div>
            </div>
            <button className="btn narrow" disabled={!paste.trim() || busy}
              onClick={() => send({ action: "add-asins", id: selected.id, asins: paste })}>
              Add to {selected.name}
            </button>
          </div>

          {asins.length > 0 && (
            <div className="card">
              <h2 className="section">Products</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>ASIN</th><th className="num">Terms found</th>
                    <th className="num">Best rank</th><th />
                  </tr></thead>
                  <tbody>
                    {asins.map(a => (
                      <tr key={a.asin}>
                        <td className="mono-cell">{a.asin}</td>
                        <td className="num">{a.terms || "—"}</td>
                        <td className="num">{a.best_rank ? a.best_rank.toLocaleString() : "—"}</td>
                        <td>
                          <button className="btn-link danger"
                            onClick={() => send({ action: "remove-asin", id: selected.id, asin: a.asin }, true)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!hasData && (
                <p className="hint" style={{ marginBottom: 0 }}>
                  No search term data stored for {selected.marketplace} yet, so every count reads
                  as none. Upload a Brand Analytics week on Keyword research and these fill in.
                </p>
              )}
            </div>
          )}

          {terms.length > 0 && (
            <div className="card">
              <h2 className="section">
                {terms.length} terms across {byAsin.size} of {asins.length} products
              </h2>
              <p className="hint">
                Every search this client&apos;s products are named for, most searched first. Two of
                their products on one term means they are competing with each other for it.
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th className="num">Rank</th><th>Search term</th><th>ASIN</th>
                    <th className="num">Position</th><th className="num">Click share</th>
                    <th className="num">Weeks</th>
                  </tr></thead>
                  <tbody>
                    {terms.map(t => (
                      <tr key={`${t.search_term}:${t.asin}`}>
                        <td className="num">{t.rank.toLocaleString()}</td>
                        <td>{t.search_term}</td>
                        <td className="mono-cell">{t.asin}</td>
                        <td className="num">#{t.position}</td>
                        <td className="num">
                          {t.click_share === null ? "—" : `${(t.click_share * 100).toFixed(1)}%`}
                        </td>
                        <td className="num">{t.weeks_held}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {asins.length > 0 && terms.length === 0 && hasData && (
            <div className="card">
              <p className="hint" style={{ margin: 0 }}>
                None of {selected.name}&apos;s products are among the three most-clicked for any
                stored search term. Amazon names only three per term, so a product outside them
                leaves no trace — which is itself the finding.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
