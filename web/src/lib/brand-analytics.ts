/**
 * Parsing the Brand Analytics search terms report.
 *
 * This is the report that makes real keyword research possible: every search
 * term shoppers used in the marketplace, its Search Frequency Rank, and the
 * three ASINs that took the clicks. The rank is the volume figure — lower
 * means more searched, so rank 1 is the most-searched term of the period — and
 * the clicked ASINs are what allows a reverse lookup from a competitor's ASIN
 * back to the terms winning them traffic.
 *
 * Amazon returns this in more than one shape depending on how it is requested,
 * and the shapes have changed over time: JSON with one row per search term
 * carrying numbered ASIN fields, JSON with one row per clicked ASIN, and a
 * tab-separated form with human-readable column headings. All three are
 * accepted rather than one being assumed, because the cost of guessing wrong
 * is a silent import of zero rows.
 *
 * Note on verification: the shapes below are handled defensively precisely
 * because they could not be checked against a live Brand Analytics account
 * from here. The parser reports what it recognised so a first import can be
 * eyeballed rather than trusted.
 */

export interface ClickedAsin {
  asin: string;
  position: number;
  title?: string;
  clickShare?: number;
  conversionShare?: number;
}

export interface SearchTermRecord {
  searchTerm: string;
  department: string | null;
  rank: number;
  asins: ClickedAsin[];
}

export interface ParseOutcome {
  rows: SearchTermRecord[];
  shape: "json-per-term" | "json-per-asin" | "delimited" | "unknown";
  skipped: number;
  note?: string;
}

const num = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const asinLike = (value: unknown): string | null => {
  const text = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(text) ? text : null;
};

/** Loose header matching: Amazon's spelling of these has moved around. */
function headerIndex(headers: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const i = headers.findIndex(h => pattern.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function fromDelimited(text: string): ParseOutcome {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], shape: "unknown", skipped: 0 };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string) => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ""));

  const headers = split(lines[0]).map(h => h.toLowerCase());
  const termAt = headerIndex(headers, /search\s*term/);
  const rankAt = headerIndex(headers, /search\s*frequency\s*rank/, /^rank$/);
  if (termAt < 0 || rankAt < 0) {
    return { rows: [], shape: "unknown", skipped: lines.length - 1, note: "No search term and rank columns found." };
  }
  const deptAt = headerIndex(headers, /department/);

  // "#1 Clicked ASIN", "#2 Product Title", "#3 Click Share" and so on.
  const slots = [1, 2, 3].map(n => ({
    position: n,
    asin: headerIndex(headers, new RegExp(`#?${n}\\b.*clicked\\s*asin`), new RegExp(`clicked\\s*asin\\s*#?${n}`)),
    title: headerIndex(headers, new RegExp(`#?${n}\\b.*(product\\s*)?title`)),
    click: headerIndex(headers, new RegExp(`#?${n}\\b.*click\\s*share`)),
    conversion: headerIndex(headers, new RegExp(`#?${n}\\b.*conversion\\s*share`)),
  }));

  const rows: SearchTermRecord[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const searchTerm = (cells[termAt] ?? "").toLowerCase().trim();
    const rank = num(cells[rankAt]);
    if (!searchTerm || rank === undefined) { skipped += 1; continue; }

    const asins: ClickedAsin[] = [];
    for (const slot of slots) {
      const asin = slot.asin >= 0 ? asinLike(cells[slot.asin]) : null;
      if (!asin) continue;
      asins.push({
        asin,
        position: slot.position,
        title: slot.title >= 0 ? cells[slot.title] || undefined : undefined,
        clickShare: slot.click >= 0 ? num(cells[slot.click]) : undefined,
        conversionShare: slot.conversion >= 0 ? num(cells[slot.conversion]) : undefined,
      });
    }
    rows.push({ searchTerm, department: deptAt >= 0 ? cells[deptAt] || null : null, rank, asins });
  }
  return { rows, shape: "delimited", skipped };
}

function fromJson(payload: any): ParseOutcome {
  const list: any[] =
    payload?.dataByDepartmentAndSearchTerm
    ?? payload?.dataByAsin
    ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(list) || !list.length) {
    return { rows: [], shape: "unknown", skipped: 0, note: "No search term rows in the document." };
  }

  const byTerm = new Map<string, SearchTermRecord>();
  let skipped = 0;
  let perAsin = false;

  for (const entry of list) {
    const searchTerm = String(entry.searchTerm ?? entry.search_term ?? "").toLowerCase().trim();
    const rank = num(entry.searchFrequencyRank ?? entry.search_frequency_rank);
    if (!searchTerm || rank === undefined) { skipped += 1; continue; }

    const record = byTerm.get(searchTerm) ?? {
      searchTerm,
      department: entry.departmentName ?? entry.department_name ?? null,
      rank,
      asins: [] as ClickedAsin[],
    };

    // Shape A: one row per clicked ASIN, carrying its own rank within the term.
    const single = asinLike(entry.clickedAsin ?? entry.clicked_asin);
    if (single) {
      perAsin = true;
      record.asins.push({
        asin: single,
        position: num(entry.clickShareRank ?? entry.click_share_rank) ?? record.asins.length + 1,
        title: entry.clickedItemName ?? entry.productTitle ?? undefined,
        clickShare: num(entry.clickShare ?? entry.click_share),
        conversionShare: num(entry.conversionShare ?? entry.conversion_share),
      });
    }

    // Shape B: one row per term, with the three ASINs in numbered fields.
    for (const n of [1, 2, 3]) {
      const asin = asinLike(entry[`clickedAsin${n}`] ?? entry[`clicked_asin_${n}`]);
      if (!asin) continue;
      record.asins.push({
        asin,
        position: n,
        title: entry[`clickedItemName${n}`] ?? entry[`product_title_${n}`] ?? undefined,
        clickShare: num(entry[`clickShare${n}`] ?? entry[`click_share_${n}`]),
        conversionShare: num(entry[`conversionShare${n}`] ?? entry[`conversion_share_${n}`]),
      });
    }

    byTerm.set(searchTerm, record);
  }

  for (const record of byTerm.values()) {
    record.asins.sort((a, b) => a.position - b.position);
  }

  return {
    rows: [...byTerm.values()],
    shape: perAsin ? "json-per-asin" : "json-per-term",
    skipped,
  };
}

/** Accepts whichever shape Amazon returned. */
export function parseSearchTermsReport(body: string): ParseOutcome {
  const text = body.trim();
  if (!text) return { rows: [], shape: "unknown", skipped: 0, note: "The document was empty." };
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return fromJson(JSON.parse(text));
    } catch {
      return { rows: [], shape: "unknown", skipped: 0, note: "The document looked like JSON but would not parse." };
    }
  }
  return fromDelimited(text);
}

/* ------------------------------------------------------------------ *
 * What the two screens ask of it
 * ------------------------------------------------------------------ */

/**
 * Magnet: terms related to a seed, most-searched first.
 *
 * Relatedness is word overlap rather than a similarity model — a term is
 * related when it shares a meaningful word with the seed. That is a blunt
 * rule, and it is the honest one: anything cleverer would be inventing a
 * relationship the data does not contain.
 */
export function relatedTerms(
  rows: SearchTermRecord[], seed: string, limit = 200
): SearchTermRecord[] {
  const words = seed.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (!words.length) return [];
  return rows
    .filter(row => words.some(w => row.searchTerm.includes(w)))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}

/**
 * Cerebro: the terms a given ASIN takes clicks on.
 *
 * This is a genuine reverse lookup rather than an estimate — Amazon states
 * which ASINs were clicked for each term, so an ASIN appearing here is a fact
 * about that term, not a guess about ranking.
 */
export function termsForAsin(
  rows: SearchTermRecord[], asin: string, limit = 200
): Array<SearchTermRecord & { position: number; clickShare?: number }> {
  const wanted = asin.trim().toUpperCase();
  const out: Array<SearchTermRecord & { position: number; clickShare?: number }> = [];
  for (const row of rows) {
    const hit = row.asins.find(a => a.asin === wanted);
    if (hit) out.push({ ...row, position: hit.position, clickShare: hit.clickShare });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}
