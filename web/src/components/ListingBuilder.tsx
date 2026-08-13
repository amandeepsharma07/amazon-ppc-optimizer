"use client";

import { useMemo, useState } from "react";
import { coverageOf, processKeywords } from "@/lib/keyword-tools";
// The same rules the Chrome extension audits with — synced from it on every
// build, so a title this screen calls clean is one the extension passes.
import { cleanTitle, policyIssues, titleLimitFor } from "@/lib/listing-engine";
import { MARKETPLACES } from "@/lib/analyze";

const BULLET_IDEAL = { min: 150, max: 250 };
const DESCRIPTION_TARGET = 120;

interface Issue { kind: string; found: string; why: string }

function issuesFor(text: string, brand: string): Issue[] {
  return policyIssues(text, brand) as Issue[];
}

/** A field with its own live count, policy check and keyword coverage. */
function Field({
  id, label, value, onChange, rows, limit, hint, brand, keywords,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  rows: number; limit?: number; hint?: string; brand: string; keywords: string[];
}) {
  const issues = useMemo(() => issuesFor(value, brand), [value, brand]);
  const used = useMemo(
    () => (keywords.length ? coverageOf(value, keywords).covered : []),
    [value, keywords]
  );
  const over = limit !== undefined && value.length > limit;

  return (
    <div className="builder-field">
      <div className="builder-head">
        <label className="field-label" htmlFor={id}>{label}</label>
        <span className={`count${over ? " over" : ""}`}>
          {value.length}{limit ? ` / ${limit}` : ""}
          {keywords.length ? ` · ${used.length} keyword${used.length === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <textarea id={id} rows={rows} value={value} onChange={e => onChange(e.target.value)} />
      {hint && !issues.length && !over && <p className="hint" style={{ margin: "4px 0 0" }}>{hint}</p>}
      {over && (
        <p className="field-bad">
          {value.length - limit!} characters over the limit — Amazon suppresses listings for this.
        </p>
      )}
      {issues.map(issue => (
        <p key={issue.found} className="field-bad">
          <b>{issue.found}</b> — {issue.why}
        </p>
      ))}
    </div>
  );
}

export default function ListingBuilder() {
  const [marketplace, setMarketplace] = useState("IN");
  const [brand, setBrand] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [title, setTitle] = useState("");
  const [bullets, setBullets] = useState(["", "", "", "", ""]);
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState("");

  const titleLimit = titleLimitFor(marketplace);

  // Phrases drive coverage; the words behind them drive the "still unused" list.
  const processed = useMemo(
    () => processKeywords(keywordText, { exclude: brand }),
    [keywordText, brand]
  );
  const phrases = useMemo(() => processed.phrases.map(p => p.phrase), [processed]);

  const everything = [title, ...bullets, description].join("\n");
  const coverage = useMemo(() => coverageOf(everything, phrases), [everything, phrases]);
  const titleCoverage = useMemo(() => coverageOf(title, phrases), [title, phrases]);

  const corrected = useMemo(
    () => (title ? cleanTitle(title, brand, titleLimit) : null),
    [title, brand, titleLimit]
  );

  const allIssues = useMemo(
    () => issuesFor(everything, brand),
    [everything, brand]
  );

  const filledBullets = bullets.filter(b => b.trim()).length;
  const thinBullets = bullets.filter(b => b.trim() && b.length < BULLET_IDEAL.min).length;
  const descriptionWords = description.trim() ? description.trim().split(/\s+/).length : 0;

  function exportText() {
    const lines = [
      `Title (${title.length}/${titleLimit})`, title, "",
      "Bullets",
      ...bullets.map((b, i) => `${i + 1}. ${b}`),
      "", "Description", description, "",
      `Keyword coverage: ${coverage.covered.length} of ${phrases.length}`,
    ];
    if (coverage.missing.length) {
      lines.push("Not yet used:", ...coverage.missing.map(m => `  - ${m}`));
    }
    return lines.join("\n");
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(label); setTimeout(() => setCopied(""), 1500); })
      .catch(() => setCopied("failed"));
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <div className="narrow">
            <label className="field-label" htmlFor="lb-market">Marketplace</label>
            <select id="lb-market" value={marketplace} onChange={e => setMarketplace(e.target.value)}>
              {MARKETPLACES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="lb-brand">Your brand</label>
            <input id="lb-brand" type="text" value={brand} placeholder="Packster"
              onChange={e => setBrand(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="row-full" style={{ maxWidth: "none" }}>
            <label className="field-label" htmlFor="lb-keywords">
              Keywords to work in — paste from the processor, or from your reports
            </label>
            <textarea id="lb-keywords" rows={3} value={keywordText}
              placeholder={"laptop backpack\nwater resistant college bag\n30 litre rucksack"}
              onChange={e => setKeywordText(e.target.value)} />
          </div>
        </div>
      </div>

      {phrases.length > 0 && (
        <div className="card">
          <div className="builder-head">
            <h2 className="section" style={{ margin: 0 }}>
              {coverage.covered.length} of {phrases.length} keywords used
            </h2>
            <span className="count">{coverage.percent}%</span>
          </div>
          <div className="meter-lg">
            <span style={{ width: `${coverage.percent}%` }} />
          </div>
          <p className="hint" style={{ margin: "10px 0 6px" }}>
            Matched on stems and ignoring word order, the way Amazon indexes — a title
            with &quot;backpacks&quot; already covers &quot;backpack&quot;. Green means it is in the title,
            which carries far more weight than anywhere else.
          </p>
          <div className="kwchips">
            {phrases.map(p => {
              const inTitle = titleCoverage.covered.includes(p);
              const anywhere = coverage.covered.includes(p);
              return (
                <span key={p} className={`kwchip${inTitle ? " intitle" : anywhere ? " used" : ""}`}>
                  {p}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <Field
          id="lb-title" label="Title" value={title} onChange={setTitle} rows={3}
          limit={titleLimit} brand={brand} keywords={phrases}
          hint={`Brand first, then what it is, then the facts. Aim for 150–${titleLimit} characters.`}
        />
        {corrected?.changed && (
          <div className="rewrite-box">
            <b>Corrected version</b>
            <p>{corrected.text}</p>
            <ul>{corrected.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
            <button className="btn-ghost" onClick={() => setTitle(corrected.text)}>
              Use this
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section">Bullet points</h2>
        <p className="hint">
          {filledBullets} of 5 written
          {thinBullets ? `, ${thinBullets} under ${BULLET_IDEAL.min} characters` : ""}.
          Each one: the benefit, then the fact that proves it.
        </p>
        {bullets.map((bullet, i) => (
          <Field
            key={i}
            id={`lb-bullet-${i}`}
            label={`Bullet ${i + 1}`}
            value={bullet}
            onChange={v => setBullets(bullets.map((b, j) => (j === i ? v : b)))}
            rows={2}
            limit={500}
            brand={brand}
            keywords={phrases}
            hint={i === 0 ? `${BULLET_IDEAL.min}–${BULLET_IDEAL.max} characters is where a bullet earns its place.` : undefined}
          />
        ))}
      </div>

      <div className="card">
        <Field
          id="lb-description" label="Description" value={description} onChange={setDescription}
          rows={6} limit={2000} brand={brand} keywords={phrases}
          hint={`${descriptionWords} words. Aim past ${DESCRIPTION_TARGET} — this text is indexed, unlike A+ content.`}
        />
      </div>

      <div className="card">
        <h2 className="section">Before you paste it into Seller Central</h2>
        {allIssues.length ? (
          <>
            <p className="field-bad" style={{ marginTop: 0 }}>
              {allIssues.length} policy problem{allIssues.length > 1 ? "s" : ""} still in the copy.
            </p>
            <ul className="plainlist">
              {allIssues.map(i => (
                <li key={i.found}><span><b>{i.found}</b></span><span className="muted-num" style={{ fontVariantNumeric: "normal" }}>{i.why}</span></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            No policy problems found in what you have written.
            {coverage.missing.length
              ? ` ${coverage.missing.length} keyword${coverage.missing.length === 1 ? " is" : "s are"} still unused.`
              : phrases.length ? " Every keyword is in." : ""}
          </p>
        )}
        <button className="btn narrow" onClick={() => copy("all", exportText())}>
          {copied === "all" ? "Copied" : "Copy the whole listing"}
        </button>
      </div>
    </div>
  );
}
