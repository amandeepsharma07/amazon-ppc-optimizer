"use client";

import { useState } from "react";
import type { AccountView, Coverage, JobRow } from "@/lib/research";

const MARKETS = [
  ["IN", "India — amazon.in"], ["US", "USA — amazon.com"], ["CA", "Canada — amazon.ca"],
  ["UK", "UK — amazon.co.uk"], ["DE", "Germany — amazon.de"], ["AE", "UAE — amazon.ae"],
  ["AU", "Australia — amazon.com.au"], ["SA", "Saudi Arabia — amazon.sa"],
  ["SG", "Singapore — amazon.sg"], ["JP", "Japan — amazon.co.jp"],
] as const;

export default function AmazonConnection({
  accounts, jobs, coverage, hasKey, suggestedKey,
}: {
  accounts: AccountView[]; jobs: JobRow[]; coverage: Coverage[];
  hasKey: boolean; suggestedKey: string;
}) {
  const [marketplace, setMarketplace] = useState("IN");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/spapi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, marketplace, ...extra }),
      });
      const data = await response.json();
      setMessage({ ok: response.ok, text: data.message ?? data.error ?? "Done." });
      if (response.ok && action === "save") {
        setClientSecret(""); setRefreshToken("");
      }
      if (response.ok) setTimeout(() => location.reload(), action === "save" ? 800 : 1200);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack">
      {!hasKey && (
        <div className="card notice-bad">
          <h2 className="section">One setting is missing</h2>
          <p className="hint">
            Amazon&apos;s refresh token lets anyone holding it pull your account&apos;s reports, so it is
            encrypted before it is stored — and the key cannot live in the database beside it.
            Add this to your hosting environment as <code>SPAPI_ENCRYPTION_KEY</code>, then redeploy:
          </p>
          <div className="terms-out">{suggestedKey}</div>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Vercel → Settings → Environment Variables. Keep a copy: change it later and the stored
            credentials can no longer be read, and you would have to paste them again.
          </p>
        </div>
      )}

      <div className="card">
        <h2 className="section">Connect a marketplace</h2>
        <p className="hint">
          From Seller Central → Apps &amp; Services → Develop Apps. Create an app, tick the
          <b> Brand Analytics</b> role, then use <b>Authorise</b> on your own account to get a
          refresh token. Nothing here is shared with anyone; the secrets are encrypted before storage.
        </p>

        <div className="row">
          <div className="narrow">
            <label className="field-label" htmlFor="sp-market">Marketplace</label>
            <select id="sp-market" value={marketplace} onChange={e => setMarketplace(e.target.value)}>
              {MARKETS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="sp-client">LWA client ID</label>
            <input id="sp-client" type="text" value={clientId} placeholder="amzn1.application-oa2-client.…"
              onChange={e => setClientId(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div>
            <label className="field-label" htmlFor="sp-secret">Client secret</label>
            <input id="sp-secret" type="password" value={clientSecret} autoComplete="off"
              onChange={e => setClientSecret(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="sp-token">Refresh token</label>
            <input id="sp-token" type="password" value={refreshToken} placeholder="Atzr|…" autoComplete="off"
              onChange={e => setRefreshToken(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 4 }}>
          <button className="btn narrow" disabled={!!busy || !hasKey} onClick={() => send("save", { clientId, clientSecret, refreshToken })}>
            {busy === "save" ? "Saving…" : "Save credentials"}
          </button>
          <button className="btn-ghost narrow" disabled={!!busy} onClick={() => send("test")}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button className="btn-ghost narrow" disabled={!!busy} onClick={() => send("pull")}>
            {busy === "pull" ? "Asking…" : "Pull search terms now"}
          </button>
          <button className="btn-ghost narrow" disabled={!!busy} onClick={() => send("collect")}>
            {busy === "collect" ? "Collecting…" : "Collect finished reports"}
          </button>
        </div>

        {message && (
          <p className={message.ok ? "hint" : "field-bad"} style={{ marginTop: 10, marginBottom: 0 }}>
            {message.text}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="section">Connected</h2>
        {accounts.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>Nothing connected yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Marketplace</th><th>Client ID</th><th>Secret</th><th>Token</th>
                <th>Last good</th><th>Status</th><th />
              </tr></thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.marketplace}>
                    <td>{a.label}</td>
                    <td className="ell" title={a.clientId}>{a.clientId}</td>
                    <td>{a.secretHint}</td>
                    <td>{a.tokenHint}</td>
                    <td>{a.lastOkAt ? new Date(a.lastOkAt).toLocaleString() : "—"}</td>
                    <td>{a.lastError
                      ? <span className="chip crit" title={a.lastError}>needs attention</span>
                      : <span className="chip good">ok</span>}</td>
                    <td>
                      <button className="btn-link danger"
                        onClick={() => { setMarketplace(a.marketplace); send("forget"); }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {accounts.some(a => a.lastError) && (
          <p className="field-bad" style={{ marginBottom: 0 }}>
            {accounts.find(a => a.lastError)!.lastError}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="section">Data held</h2>
        {coverage.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            No search term data yet. Connect a marketplace and pull — Brand Analytics data appears a
            few days after each week closes, so the most recent week may not exist yet.
          </p>
        ) : (
          <div className="statline">
            {coverage.map(c => (
              <div key={c.marketplace}>
                <b>{c.terms.toLocaleString()}</b>
                <span>{c.marketplace} terms · {c.periods} period{c.periods === 1 ? "" : "s"} · to {c.latest}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="card">
          <h2 className="section">Recent pulls</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Started</th><th>Market</th><th>Period</th><th>Status</th><th className="num">Terms</th><th>Detail</th></tr></thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id}>
                    <td>{new Date(j.started_at).toLocaleString()}</td>
                    <td>{j.marketplace}</td>
                    <td>{j.period}</td>
                    <td>
                      <span className={`chip ${j.status === "done" ? "good" : j.status === "failed" ? "crit" : "warn"}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="num">{j.rows_stored.toLocaleString()}</td>
                    <td className="ell" title={j.detail}>{j.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            A pull runs in two steps because Amazon takes minutes to build a report — longer than a
            web request may last. The scheduled run at 06:00 UTC collects whatever finished and asks
            for the next one, so after the first setup this needs no attention.
          </p>
        </div>
      )}
    </div>
  );
}
