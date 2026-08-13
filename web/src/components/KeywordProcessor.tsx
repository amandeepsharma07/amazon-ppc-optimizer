"use client";

import { useMemo, useState } from "react";
import {
  packToBytes, processKeywords, type KeywordWord,
} from "@/lib/keyword-tools";
import { BYTE_LIMITS, DEFAULT_BYTE_LIMIT } from "@/lib/backend-keywords";
import { MARKETPLACES } from "@/lib/analyze";

/**
 * Paste keyword lists from anywhere and get them cleaned.
 *
 * Everything happens as you type — there is no server call, because there is
 * nothing here a server could do that the browser cannot.
 */
export default function KeywordProcessor() {
  const [input, setInput] = useState("");
  const [exclude, setExclude] = useState("");
  const [marketplace, setMarketplace] = useState("IN");
  const [removeBrands, setRemoveBrands] = useState(true);
  const [removeStopWords, setRemoveStopWords] = useState(true);
  const [stem, setStem] = useState(true);
  const [copied, setCopied] = useState("");

  const result = useMemo(
    () => processKeywords(input, { exclude, removeBrands, removeStopWords, stem }),
    [input, exclude, removeBrands, removeStopWords, stem]
  );

  const limit = BYTE_LIMITS[marketplace] ?? DEFAULT_BYTE_LIMIT;
  const packed = useMemo(() => packToBytes(result.words, limit), [result.words, limit]);

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(label); setTimeout(() => setCopied(""), 1500); })
      .catch(() => setCopied("failed"));
  }

  const wordLine = (w: KeywordWord) => `${w.word}  ·  ${w.phrases} phrase${w.phrases === 1 ? "" : "s"}`;

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <div className="row-full" style={{ maxWidth: "none" }}>
            <label className="field-label" htmlFor="kw-input">
              Paste your keywords — one per line, or separated by commas
            </label>
            <textarea
              id="kw-input"
              rows={8}
              value={input}
              placeholder={"laptop bag\nlaptop backpack for men\nschool bag, college bag\ntravel rucksack"}
              onChange={e => setInput(e.target.value)}
            />
          </div>
        </div>

        <div className="row">
          <div>
            <label className="field-label" htmlFor="kw-exclude">Words to leave out</label>
            <input
              id="kw-exclude"
              type="text"
              value={exclude}
              placeholder="your brand, words already in the title"
              onChange={e => setExclude(e.target.value)}
            />
          </div>
          <div className="narrow">
            <label className="field-label" htmlFor="kw-market">Marketplace</label>
            <select id="kw-market" value={marketplace} onChange={e => setMarketplace(e.target.value)}>
              {MARKETPLACES.map(m => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ gap: 18 }}>
          <label className="narrow toggle">
            <input type="checkbox" checked={removeBrands} onChange={e => setRemoveBrands(e.target.checked)} />
            Drop other brands
          </label>
          <label className="narrow toggle">
            <input type="checkbox" checked={removeStopWords} onChange={e => setRemoveStopWords(e.target.checked)} />
            Drop stop words
          </label>
          <label className="narrow toggle">
            <input type="checkbox" checked={stem} onChange={e => setStem(e.target.checked)} />
            Fold plurals
          </label>
        </div>
      </div>

      {input.trim() && (
        <>
          <div className="card">
            <div className="statline">
              <div><b>{result.stats.phrasesIn}</b><span>pasted</span></div>
              <div><b>{result.stats.phrasesOut}</b><span>unique phrases</span></div>
              <div><b>{result.stats.duplicatesRemoved}</b><span>duplicates gone</span></div>
              <div><b>{result.stats.wordsOut}</b><span>unique words</span></div>
              <div><b>{result.excludedWords.length}</b><span>held out</span></div>
            </div>
          </div>

          <div className="card">
            <h2 className="section">Search Terms field, packed to {limit} bytes</h2>
            <p className="hint">
              The highest-reach words that fit, in the format the field wants: single
              spaces, no commas, nothing repeated.
            </p>
            <div className="terms-out">{packed.text || "Nothing to pack yet."}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn narrow" onClick={() => copy("terms", packed.text)}>
                {copied === "terms" ? "Copied" : "Copy the field"}
              </button>
              <p className="hint" style={{ margin: 0, flex: "1 1 auto" }}>
                {packed.bytes} of {limit} bytes used, {packed.used.length} words in
                {packed.left.length ? `, ${packed.left.length} did not fit` : ""}.
              </p>
            </div>
          </div>

          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="card" style={{ flex: "1 1 320px", maxWidth: "none" }}>
              <h2 className="section">Unique words, by reach</h2>
              <p className="hint">
                Ranked by how many of your phrases each word appears in — the words
                earning their place across the most searches.
              </p>
              <ul className="plainlist">
                {result.words.slice(0, 40).map(w => (
                  <li key={w.word}>
                    <span>{w.word}</span>
                    <span className="muted-num">{w.phrases}</span>
                  </li>
                ))}
              </ul>
              {result.words.length > 40 && (
                <p className="hint">{result.words.length - 40} more in the copy.</p>
              )}
              <button className="btn-ghost" onClick={() => copy("words", result.words.map(w => w.word).join("\n"))}>
                {copied === "words" ? "Copied" : "Copy all words"}
              </button>
            </div>

            <div className="card" style={{ flex: "1 1 320px", maxWidth: "none" }}>
              <h2 className="section">Phrases, most repeated first</h2>
              <p className="hint">Duplicates folded together; the count is how often each was pasted.</p>
              <ul className="plainlist">
                {result.phrases.slice(0, 40).map(p => (
                  <li key={p.phrase}>
                    <span>{p.phrase}</span>
                    <span className="muted-num">{p.count > 1 ? `×${p.count}` : ""}</span>
                  </li>
                ))}
              </ul>
              {result.phrases.length > 40 && (
                <p className="hint">{result.phrases.length - 40} more in the copy.</p>
              )}
              <button className="btn-ghost" onClick={() => copy("phrases", result.phrases.map(p => p.phrase).join("\n"))}>
                {copied === "phrases" ? "Copied" : "Copy all phrases"}
              </button>
            </div>
          </div>

          {result.excludedWords.length > 0 && (
            <div className="card">
              <h2 className="section">Held out, and why</h2>
              <p className="hint">
                Shown rather than silently dropped — if one of these describes your
                product, switch the matching option off above and it comes back.
              </p>
              <ul className="plainlist">
                {result.excludedWords.slice(0, 30).map(w => (
                  <li key={w.word}>
                    <span>{w.word}</span>
                    <span className="muted-num" style={{ fontVariantNumeric: "normal" }}>{w.excluded}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
