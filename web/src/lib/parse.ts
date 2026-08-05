/**
 * Reads Amazon Ads workbooks. Every sheet is scanned, so a bulk operations
 * file that embeds SP/SB Search Term Report sheets is recognised as both a
 * bulk file and a search term report.
 */
import * as XLSX from "xlsx";
import type { BulkData, BulkKeyword, SearchTermRow } from "./analyze";

/**
 * Parentheses are flattened rather than stripped so that "Campaign Name" and
 * "Campaign Name (Informational only)" stay distinct — bulk sheets carry both,
 * and only the second is populated on keyword rows.
 */
export function normHeader(header: unknown): string {
  return String(header ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function toNum(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return isFinite(value) ? value : 0;
  const n = parseFloat(String(value).replace(/[₹$€£,%\s]/g, ""));
  return isFinite(n) ? n : 0;
}

const CAMPAIGN_H = ["campaignname", "campaignnameinformationalonly", "campaign"];
const ADGROUP_H = ["adgroupname", "adgroupnameinformationalonly", "adgroup"];

const STR_FIELDS: Array<{ field: string; test: (h: string) => boolean }> = [
  { field: "campaign", test: h => CAMPAIGN_H.includes(h) },
  { field: "adGroup", test: h => ADGROUP_H.includes(h) },
  { field: "targeting", test: h => h === "targeting" || h === "keywordtext" || h === "producttargetingexpression" },
  { field: "matchType", test: h => h === "matchtype" },
  { field: "term", test: h => h === "customersearchterm" || h === "searchterm" },
  { field: "bid", test: h => h === "bid" },
  { field: "impressions", test: h => h === "impressions" },
  { field: "clicks", test: h => h === "clicks" },
  { field: "spend", test: h => h === "spend" || h === "cost" },
  // "Total Advertising Cost of Sales (ACOS)" must not match as a sales column.
  { field: "sales", test: h => h === "sales" || /(\d+day)?totalsales$/.test(h) || /\d+daysales$/.test(h) },
  { field: "orders", test: h => h === "orders" || h.includes("totalorders") },
];

const BULK_FIELDS: Array<{ field: string; test: (h: string) => boolean }> = [
  { field: "entity", test: h => h === "entity" },
  { field: "operation", test: h => h === "operation" },
  { field: "state", test: h => h === "state" },
  { field: "campaign", test: h => h === "campaignname" },
  { field: "campaignInfo", test: h => h === "campaignnameinformationalonly" },
  { field: "adGroup", test: h => h === "adgroupname" },
  { field: "adGroupInfo", test: h => h === "adgroupnameinformationalonly" },
  { field: "bid", test: h => h === "bid" },
  { field: "keyword", test: h => h === "keywordtext" },
  { field: "targetingExpr", test: h => h === "producttargetingexpression" },
  { field: "matchType", test: h => h === "matchtype" },
  { field: "impressions", test: h => h === "impressions" },
  { field: "clicks", test: h => h === "clicks" },
  { field: "spend", test: h => h === "spend" },
  { field: "sales", test: h => h === "sales" },
  { field: "orders", test: h => h === "orders" },
];

function grid(workbook: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    header: 1, raw: true, defval: null,
  }) as unknown[][];
}

function mapColumns(
  normed: string[], fields: Array<{ field: string; test: (h: string) => boolean }>
): Record<string, number> {
  const mapping: Record<string, number> = {};
  normed.forEach((h, col) => {
    for (const { field, test } of fields) {
      if (mapping[field] === undefined && test(h)) { mapping[field] = col; break; }
    }
  });
  return mapping;
}

/**
 * Search term rows, or null. Sheets named like a search term report are tried
 * first, and Sponsored Products before Brands so an SP account isn't scored on
 * SB data.
 */
export function extractSearchTerms(
  workbook: XLSX.WorkBook
): { rows: SearchTermRow[]; sheetName: string } | null {
  const rank = (n: string) => {
    const s = n.toLowerCase();
    if (!/search\s*term/.test(s)) return 2;
    return /^sb|brand/.test(s) ? 1 : 0;
  };
  const ordered = [...workbook.SheetNames].sort((a, b) => rank(a) - rank(b));

  for (const name of ordered) {
    const g = grid(workbook, name);
    for (let i = 0; i < Math.min(g.length, 15); i++) {
      const normed = (g[i] || []).map(normHeader);
      if (!normed.includes("customersearchterm") && !normed.includes("searchterm")) continue;
      const mapping = mapColumns(normed, STR_FIELDS);
      if (mapping.clicks === undefined) continue; // header-ish row without data columns

      const rows: SearchTermRow[] = [];
      for (let r = i + 1; r < g.length; r++) {
        const raw = g[r] || [];
        const get = (f: string) => (mapping[f] !== undefined ? raw[mapping[f]] : null);
        const row: SearchTermRow = {
          campaign: String(get("campaign") ?? "").trim(),
          adGroup: String(get("adGroup") ?? "").trim(),
          targeting: String(get("targeting") ?? "").trim(),
          matchType: String(get("matchType") ?? "").trim(),
          term: String(get("term") ?? "").trim(),
          bid: toNum(get("bid")),
          impressions: toNum(get("impressions")),
          clicks: toNum(get("clicks")),
          spend: toNum(get("spend")),
          sales: toNum(get("sales")),
          orders: toNum(get("orders")),
        };
        if (row.term) rows.push(row);
      }
      if (rows.length) return { rows, sheetName: name };
    }
  }
  return null;
}

/** Bulk keyword/targeting rows, or null. Prefers a Sponsored Products sheet. */
export function extractBulk(workbook: XLSX.WorkBook): BulkData | null {
  const ordered = [...workbook.SheetNames].sort((a, b) => {
    const score = (n: string) => (/sponsored\s*products/i.test(n) ? 0 : 1);
    return score(a) - score(b);
  });

  for (const name of ordered) {
    const g = grid(workbook, name);
    if (!g.length) continue;
    const normed = (g[0] || []).map(normHeader);
    if (!normed.includes("entity")) continue;
    const mapping = mapColumns(normed, BULK_FIELDS);

    const keywords: BulkKeyword[] = [];
    const negativesSet = new Set<string>();
    for (let i = 1; i < g.length; i++) {
      const raw = g[i] || [];
      const get = (f: string) => (mapping[f] !== undefined ? raw[mapping[f]] : null);
      const entity = String(get("entity") ?? "").trim().toLowerCase();
      const campaign = String(get("campaignInfo") ?? "").trim() || String(get("campaign") ?? "").trim();
      const adGroup = String(get("adGroupInfo") ?? "").trim() || String(get("adGroup") ?? "").trim();

      if (entity === "negative keyword" || entity === "campaign negative keyword") {
        const kw = String(get("keyword") ?? "").trim().toLowerCase();
        if (kw) negativesSet.add(`${campaign}||${adGroup}||${kw}`);
        continue;
      }
      if (entity !== "keyword" && entity !== "product targeting") continue;
      const state = String(get("state") ?? "").trim().toLowerCase();
      if (state && state !== "enabled") continue;

      const target = entity === "keyword"
        ? String(get("keyword") ?? "").trim()
        : String(get("targetingExpr") ?? "").trim();
      if (!target) continue;

      keywords.push({
        rowIndex: i, entity, campaign, adGroup, target,
        matchType: String(get("matchType") ?? "").trim() || (entity === "product targeting" ? "targeting" : ""),
        bid: toNum(get("bid")),
        impressions: toNum(get("impressions")),
        clicks: toNum(get("clicks")),
        spend: toNum(get("spend")),
        sales: toNum(get("sales")),
        orders: toNum(get("orders")),
      });
    }

    if (keywords.length) {
      return {
        sheetName: name, headers: g[0], grid: g, mapping, keywords, negativesSet,
        hasPerf: keywords.some(k => k.clicks > 0),
      };
    }
  }
  return null;
}

export interface Ingested {
  bulk: BulkData | null;
  searchTerms: SearchTermRow[] | null;
  summary: string;
}

/** Scan an uploaded workbook for everything it contains. */
export function ingestWorkbook(data: ArrayBuffer, fileName: string): Ingested {
  const workbook = XLSX.read(data, { type: "array" });
  const bulk = extractBulk(workbook);
  const str = extractSearchTerms(workbook);
  const found: string[] = [];
  if (bulk) found.push(`${bulk.keywords.length.toLocaleString()} keywords/targets` + (bulk.hasPerf ? "" : " (no performance data)"));
  if (str) found.push(`${str.rows.length.toLocaleString()} search terms`);
  if (!found.length) {
    throw new Error(
      `Nothing recognizable in "${fileName}". Sheets checked: ${workbook.SheetNames.join(", ")}. ` +
      "Expected an Amazon bulk operations file or a search term report."
    );
  }
  return { bulk, searchTerms: str ? str.rows : null, summary: found.join(" · ") };
}
