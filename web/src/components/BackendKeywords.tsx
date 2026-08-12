"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MARKETPLACES, type Marketplace, type SearchTermRow } from "@/lib/analyze";
import { ingestWorkbook } from "@/lib/parse";
import {
  buildBackendKeywords, byteLimitFor, campaignsInReport, detectBrands, detectOffTopic,
  type BackendKeywordResult, type CampaignSource,
} from "@/lib/backend-keywords";

export default function BackendKeywords() {
  const [marketplace, setMarketplace] = useState<Marketplace>(MARKETPLACES[0]);
  const [productType, setProductType] = useState("");
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [competitorBrands, setCompetitorBrands] = useState("");
  const [customLimit, setCustomLimit] = useState<number | "">("");
  const [rows, setRows] = useState<SearchTermRow[] | null>(null);
  const [fileNote, setFileNote] = useState("");
  const [status, setStatus] = useState("Upload a search term report to begin.");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BackendKeywordResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<CampaignSource[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [excludeWords, setExcludeWords] = useState("");
  const [autoBrands, setAutoBrands] = useState(false);
  /* Words the report suggests belong to another product, and the ones the
     seller has overruled. Suggestions are shown, never silently applied: a
     school bag really can be "casual", carry a "rain cover" and be a "sport"
     bag, so only the seller can settle it. */
  const [offTopic, setOffTopic] = useState<string[]>([]);
  const [kept, setKept] = useState<Set<string>>(new Set());

  const defaultLimit = byteLimitFor(marketplace.code);

  const handleFile = useCallback(async (file: File) => {
    setError("");
    setStatus(`Reading ${file.name}…`);
    try {
      const found = ingestWorkbook(await file.arrayBuffer(), file.name);
      if (!found.searchTerms) {
        throw new Error(
          `No search term data in "${file.name}". This needs a search term report, ` +
          "or a bulk file that includes one."
        );
      }
      const list = campaignsInReport(found.searchTerms);
      const brands = detectBrands(found.searchTerms);
      setRows(found.searchTerms);
      setCampaigns(list);
      setChosen(new Set(list.map(c => c.campaign)));
      setCompetitorBrands(brands.join(", "));
      setAutoBrands(brands.length > 0);
      setFileNote(
        `${file.name} — ${found.searchTerms.length.toLocaleString()} search terms ` +
        `across ${list.length} campaign${list.length === 1 ? "" : "s"}`
      );
      setStatus(
        list.length > 1
          ? "Pick the campaigns that sell this product, then generate."
          : "Ready — fill in your product details and generate."
      );
    } catch (err) {
      setRows(null);
      setFileNote("");
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Upload a search term report to begin.");
    }
  }, []);

  /* Off-topic words depend on which campaigns are in scope, so they are
     recomputed whenever that changes rather than only on upload. */
  useEffect(() => {
    if (!rows || chosen.size === 0 || chosen.size === campaigns.length) {
      setOffTopic([]);
      return;
    }
    setOffTopic(detectOffTopic(rows, chosen));
    setKept(new Set());
  }, [rows, chosen, campaigns.length]);

  const canGenerate = Boolean(rows && productType.trim());

  function generate(
    allowList: Set<string> = allowed,
    campaignList: Set<string> = chosen,
    keepList: Set<string> = kept
  ) {
    if (!rows) return;
    setError("");
    setCopied(false);
    const scoped = campaignList.size
      ? rows.filter(r => campaignList.has(r.campaign || "(no campaign name)"))
      : rows;
    if (!scoped.length) {
      setError("No search terms in the campaigns you picked. Choose at least one.");
      return;
    }
    const res = buildBackendKeywords(scoped, {
      marketplace, title, brand, productType, description, competitorBrands,
      byteLimit: customLimit === "" ? undefined : Number(customLimit),
      allowedBrands: [...allowList],
      excludeWords: [...offTopic.filter(w => !keepList.has(w)), excludeWords].join(", "),
    });
    setResult(res);
    setStatus(
      `Built from ${res.sourceTerms.toLocaleString()} unique customer searches ` +
      `(${res.sourceWords.toLocaleString()} distinct words considered).`
    );
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.searchTerms);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't reach the clipboard — select the text below and copy it manually.");
    }
  }

  /* A kept word still competes for space. Saying so beats letting the seller
     click "keep" and wonder why nothing changed. */
  const keptButNoRoom = useMemo(() => {
    if (!result) return [];
    const inField = new Set(result.included.map(w => w.word));
    return [...kept].filter(w => !inField.has(w));
  }, [result, kept]);

  const fillPct = useMemo(
    () => (result ? Math.min(100, (result.bytes / result.byteLimit) * 100) : 0),
    [result]
  );

  return (
    <>
      <section className="card" style={{ display: "grid", gap: 16 }}>
        <div>
          <h2 className="section">1. Your search term report</h2>
          <p className="hint">
            The words come from what shoppers actually typed, ranked by what converted —
            not guesswork. Read in this browser; nothing is uploaded.
          </p>
          <input type="file" accept=".xlsx,.xlsm,.csv,.tsv"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {fileNote && (
            <p style={{ color: "var(--good)", fontSize: 12.5, fontWeight: 600, margin: "6px 0 0" }}>
              {fileNote}
            </p>
          )}
        </div>

        {campaigns.length > 1 && (
          <div>
            <h2 className="section">2. Which campaigns sell this product?</h2>
            <p className="hint">
              Your report covers the whole account. Leaving other products&apos; campaigns ticked
              pulls their search terms in — that is how a school bag ends up with
              &ldquo;laptop&rdquo; in its keywords. Tick only the campaigns advertising the
              listing you are writing for.
            </p>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn-ghost"
                onClick={() => setChosen(new Set(campaigns.map(c => c.campaign)))}>Select all</button>
              <button type="button" className="btn-ghost"
                onClick={() => setChosen(new Set())}>Clear</button>
              <span style={{ color: "var(--muted)", fontSize: 13, alignSelf: "center" }}>
                {chosen.size} of {campaigns.length} selected
              </span>
            </div>
            <div className="campaign-list">
              {campaigns.map(c => (
                <label key={c.campaign} className="campaign-row">
                  <input type="checkbox" checked={chosen.has(c.campaign)}
                    onChange={e => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(c.campaign); else next.delete(c.campaign);
                      setChosen(next);
                    }} />
                  <span className="campaign-name" title={c.campaign}>{c.campaign}</span>
                  <span className="campaign-stats">
                    {c.terms.toLocaleString()} terms · {c.clicks.toLocaleString()} clicks
                    {c.orders > 0 && ` · ${c.orders.toLocaleString()} orders`}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="section">{campaigns.length > 1 ? "3." : "2."} Your product</h2>
          <p className="hint">
            Anything already on your listing is dropped, because Amazon indexes your title and
            brand anyway — repeating them here spends bytes twice and buys nothing.
          </p>
          <div className="row">
            <div>
              <label className="field-label" htmlFor="bk-market">Marketplace</label>
              <select id="bk-market" value={marketplace.code}
                onChange={e => setMarketplace(MARKETPLACES.find(m => m.code === e.target.value)!)}>
                {MARKETPLACES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="bk-type">Product type *</label>
              <input id="bk-type" type="text" value={productType} placeholder="e.g. school backpack"
                onChange={e => setProductType(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="bk-brand">Your brand</label>
              <input id="bk-brand" type="text" value={brand} placeholder="e.g. Packster"
                onChange={e => setBrand(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="row-full">
              <label className="field-label" htmlFor="bk-title">Listing title</label>
              <input id="bk-title" type="text" value={title}
                placeholder="Paste your full product title — every word in it is skipped"
                onChange={e => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="row-full">
              <label className="field-label" htmlFor="bk-desc">
                Description and bullet points
              </label>
              <textarea id="bk-desc" rows={4} value={description} className="desc-input"
                placeholder="Paste your bullet points and description. Amazon already indexes every word here, so anything you paste is skipped — which frees the budget for words your listing doesn't yet cover."
                onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label className="field-label" htmlFor="bk-comp">
                Competitor brands to avoid
                {autoBrands && <span className="auto-tag">found in your report</span>}
              </label>
              <input id="bk-comp" type="text" value={competitorBrands}
                placeholder="filled from your report — edit if needed"
                onChange={e => { setCompetitorBrands(e.target.value); setAutoBrands(false); }} />
            </div>
            <div>
              <label className="field-label" htmlFor="bk-exclude">Other words to leave out</label>
              <input id="bk-exclude" type="text" value={excludeWords}
                placeholder="anything else, separated by commas"
                onChange={e => setExcludeWords(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="bk-limit">
                Byte limit (default {defaultLimit} for {marketplace.code})
              </label>
              <input id="bk-limit" type="number" min={20} max={2000} value={customLimit}
                placeholder={String(defaultLimit)}
                onChange={e => setCustomLimit(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
        </div>

        {offTopic.length > 0 && (
          <div>
            <h2 className="section">
              Words that look like another product&apos;s
              <span className="auto-tag">found automatically</span>
            </h2>
            <p className="hint">
              These come mostly from campaigns you didn&apos;t pick, so they are set to be left
              out. Click any that genuinely describe your product — a school bag can be
              &ldquo;casual&rdquo;, carry a &ldquo;rain cover&rdquo; or be a &ldquo;sport&rdquo;
              bag — and it goes back in.
            </p>
            <div className="brand-checks">
              {offTopic.map(word => {
                const keeping = kept.has(word);
                return (
                  <button
                    type="button"
                    key={word}
                    className={`word-toggle${keeping ? " keeping" : ""}`}
                    aria-pressed={keeping}
                    onClick={() => {
                      const next = new Set(kept);
                      if (keeping) next.delete(word); else next.add(word);
                      setKept(next);
                      if (result) generate(allowed, chosen, next);
                    }}
                  >
                    {word}
                    <span className="word-state">{keeping ? "keeping" : "left out"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => generate()} disabled={!canGenerate}>
            Generate search terms
          </button>
          <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{status}</span>
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
      </section>

      {result && (
        <>
          <section className="card" style={{ marginTop: 18 }}>
            <h2 className="section">Paste this into Seller Central</h2>
            <p className="hint">
              Inventory → Manage Inventory → Edit → Keywords → <strong>Search Terms</strong>.
              One field, no commas.
            </p>
            <textarea readOnly value={result.searchTerms} rows={4} className="terms-out"
              onFocus={e => e.currentTarget.select()} />
            <div className="byte-row">
              <div className="byte-bar" aria-hidden="true">
                <div className="byte-fill" style={{ width: `${fillPct}%` }} />
              </div>
              <span className="byte-count">
                <strong>{result.bytes}</strong> / {result.byteLimit} bytes
                {result.bytesFree > 0 && <span className="byte-free"> · {result.bytesFree} free</span>}
              </span>
              <button className="btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="hint" style={{ margin: "12px 0 0" }}>
              {result.included.length} words from {result.sourceTerms.toLocaleString()} customer
              searches. Word order doesn&apos;t matter — Amazon matches any combination.
            </p>
            {keptButNoRoom.length > 0 && (
              <p className="hint" style={{ margin: "8px 0 0", color: "var(--warn)" }}>
                <strong>{keptButNoRoom.join(", ")}</strong>{" "}
                {keptButNoRoom.length === 1 ? "was kept but didn't fit" : "were kept but didn't fit"} —
                the field is full at {result.byteLimit} bytes and higher-earning words took the
                space. Leave out a word from the list below to make room.
              </p>
            )}
          </section>

          {(result.heldBack.length > 0 || allowed.size > 0) && (
            <section className="card" style={{ marginTop: 18 }}>
              <h2 className="section">Brand names held back</h2>
              <p className="hint">
                Each of these is both an ordinary word and a well-known brand, so it is
                <strong> left out of the field above</strong>. Tick one only if it honestly
                describes your own product. If shoppers searching it are looking for someone
                else&apos;s product, leave it — that is trademark use, and Amazon suppresses
                listings for it.
              </p>
              <div className="brand-checks">
                {[...result.heldBack.map(w => w.word), ...allowed].sort().map(word => (
                  <label key={word} className="brand-check">
                    <input
                      type="checkbox"
                      checked={allowed.has(word)}
                      onChange={e => {
                        const next = new Set(allowed);
                        if (e.target.checked) next.add(word); else next.delete(word);
                        setAllowed(next);
                        generate(next);
                      }}
                    />
                    {word}
                  </label>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: 18 }}>
            <h2 className="section">What went in, and why</h2>
            <p className="hint">Highest-value words first. Orders count for far more than clicks.</p>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Word</th><th className="num">Orders</th><th className="num">Clicks</th>
                  <th className="num">Searches</th><th className="num">Bytes</th>
                </tr></thead>
                <tbody>
                  {result.included.map(w => (
                    <tr key={w.word}>
                      <td>
                        <strong>{w.word}</strong>
                        {w.review && <span className="chip warn" style={{ marginLeft: 8 }}>check</span>}
                      </td>
                      <td className="num">{w.orders}</td>
                      <td className="num">{w.clicks}</td>
                      <td className="num">{w.termCount}</td>
                      <td className="num">{w.bytes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginTop: 18 }}>
            <h2 className="section">
              Left out ({result.excluded.length + result.droppedForSpace.length})
            </h2>
            <p className="hint">
              Every word that didn&apos;t make it, with the reason. Worth a look — it shows which
              policy rules your search data runs into.
            </p>
            <button className="btn-ghost" onClick={() => setShowExcluded(v => !v)}>
              {showExcluded ? "Hide" : "Show"} the list
            </button>
            {showExcluded && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Word</th><th>Why it was left out</th></tr></thead>
                  <tbody>
                    {[...result.excluded, ...result.droppedForSpace].map(w => (
                      <tr key={w.word + w.reason}>
                        <td>{w.word}</td>
                        <td style={{ whiteSpace: "normal", color: "var(--muted)" }}>{w.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="caveat-box">
            <strong>Check the byte limit against your own listing.</strong> Amazon has changed the
            size of this field before and a few categories differ. Open the Search Terms box in
            Seller Central and confirm it accepts what you paste. The rules applied here — no
            commas, no repetition, no competitor brands, no subjective or temporary claims, nothing
            already in your title — are Amazon&apos;s published guidance, but policy is Amazon&apos;s to
            change, so treat this as a well-informed draft rather than a guarantee.
          </div>
        </>
      )}
    </>
  );
}
