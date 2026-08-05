/**
 * The optimisation engine. Pure functions over parsed rows — no DOM, no
 * network — so it runs in the browser (keeping ad data on the user's machine)
 * and is testable directly under `node --test`.
 */

export interface Marketplace {
  code: string;
  label: string;
  locale: string;
  currency: string;
  minBid: number;
}

export const MARKETPLACES: Marketplace[] = [
  { code: "IN", label: "India — amazon.in", locale: "en-IN", currency: "INR", minBid: 1.0 },
  { code: "US", label: "USA — amazon.com", locale: "en-US", currency: "USD", minBid: 0.02 },
  { code: "CA", label: "Canada — amazon.ca", locale: "en-CA", currency: "CAD", minBid: 0.02 },
  { code: "UK", label: "UK — amazon.co.uk", locale: "en-GB", currency: "GBP", minBid: 0.02 },
  { code: "DE", label: "Germany — amazon.de", locale: "de-DE", currency: "EUR", minBid: 0.02 },
  { code: "AE", label: "UAE — amazon.ae", locale: "en-AE", currency: "AED", minBid: 0.24 },
  { code: "AU", label: "Australia — amazon.com.au", locale: "en-AU", currency: "AUD", minBid: 0.10 },
  { code: "MX", label: "Mexico — amazon.com.mx", locale: "es-MX", currency: "MXN", minBid: 0.10 },
];

export const RULES = {
  minClicks: 5,
  maxBidChange: 0.30,
  noSaleClicks: 8,
  noSaleBidCut: 0.25,
  harvestMinOrders: 2,
  harvestMaxAcosMultiple: 1.2,
};

export type SensitivityKey = "conservative" | "balanced" | "aggressive";

export const SENSITIVITY: Record<SensitivityKey, {
  label: string; negativeClicks: number; cpaMultiple: number;
}> = {
  conservative: { label: "Conservative", negativeClicks: 15, cpaMultiple: 2.0 },
  balanced: { label: "Balanced", negativeClicks: 10, cpaMultiple: 1.5 },
  aggressive: { label: "Aggressive", negativeClicks: 5, cpaMultiple: 1.0 },
};

export interface SearchTermRow {
  campaign: string; adGroup: string; targeting: string; matchType: string;
  term: string; bid: number; impressions: number; clicks: number;
  spend: number; sales: number; orders: number;
}

export interface BulkKeyword {
  rowIndex: number; entity: string; campaign: string; adGroup: string;
  target: string; matchType: string; bid: number;
  impressions: number; clicks: number; spend: number; sales: number; orders: number;
}

export interface BulkData {
  sheetName: string;
  headers: unknown[];
  grid: unknown[][];
  mapping: Record<string, number>;
  keywords: BulkKeyword[];
  negativesSet: Set<string>;
  hasPerf: boolean;
}

export interface BidRec {
  campaign: string; adGroup: string; target: string; matchType: string;
  clicks: number; spend: number; sales: number; orders: number; acos: number;
  currentBid: number; newBid: number;
  action: "increase" | "decrease" | "keep";
  reason: string; why: string; rowIndex?: number;
}

export interface NegativeRec {
  campaign: string; adGroup: string; term: string;
  clicks: number; spend: number; orders: number; reason: string; why: string;
}

export interface HarvestRec {
  term: string; campaign: string; adGroup: string; source: string;
  clicks: number; spend: number; sales: number; orders: number;
  acos: number; startBid: number; reason: string; why: string;
}

export interface CampaignRow {
  campaign: string; impressions: number; clicks: number; spend: number;
  sales: number; orders: number; ctr: number; cvr: number; cpc: number;
  acos: number; roas: number;
}

export interface Results {
  targetAcos: number;
  bids: BidRec[];
  bidSource: string;
  negatives: NegativeRec[];
  harvest: HarvestRec[];
  campaigns: CampaignRow[];
  totals: { spend: number; sales: number; clicks: number; orders: number };
}

const AUTO_EXPRESSIONS = new Set(["close-match", "loose-match", "complements", "substitutes", "*"]);

export function money(value: number, marketplace: Marketplace, maxFractionDigits = 2): string {
  return new Intl.NumberFormat(marketplace.locale, {
    style: "currency", currency: marketplace.currency, maximumFractionDigits: maxFractionDigits,
  }).format(value || 0);
}
export function pct(value: number): string { return (value * 100).toFixed(1) + "%"; }
export function num(value: number, marketplace: Marketplace): string {
  return new Intl.NumberFormat(marketplace.locale).format(value || 0);
}

function clampBid(ideal: number, current: number, minBid: number): number {
  const lo = current * (1 - RULES.maxBidChange);
  const hi = current * (1 + RULES.maxBidChange);
  return Math.max(minBid, Math.min(hi, Math.max(lo, ideal)));
}

interface TargetStats {
  campaign: string; adGroup: string; target: string; matchType: string;
  clicks: number; spend: number; sales: number; orders: number;
  currentBid: number; rowIndex?: number;
}

function bidRecFrom(
  stats: TargetStats, targetAcos: number, mk: Marketplace, bidIsReal: boolean
): BidRec | null {
  const current = stats.currentBid > 0 ? stats.currentBid : (stats.clicks ? stats.spend / stats.clicks : 0);
  if (stats.clicks < RULES.minClicks || current <= 0) return null;

  const acos = stats.sales > 0 ? stats.spend / stats.sales : 0;
  const bidWord = bidIsReal ? "bid" : "bid (estimated from average CPC)";
  let suggested: number, action: BidRec["action"], reason: string, why: string;

  if (stats.sales > 0) {
    const rpc = stats.sales / stats.clicks;
    // Scale by how far ACOS sits from target. Pricing straight off revenue per
    // click would assume bid equals realised CPC, which overshoots: in Amazon's
    // auction you usually pay less than you bid.
    suggested = clampBid(current * (targetAcos / acos), current, mk.minBid);
    if (suggested > current * 1.05) {
      action = "increase";
      reason = "Beating target — room to scale";
      why = `This target earns ${money(rpc, mk)} per click and runs at ${pct(acos)} ACOS, comfortably inside your `
          + `${pct(targetAcos)} target. Raising the ${bidWord} from ${money(current, mk)} to ${money(suggested, mk)} `
          + `buys more impressions with the headroom you have. Capped at 30% per run so nothing jumps too far at once.`;
    } else if (suggested < current * 0.95) {
      action = "decrease";
      reason = "Over target — costs too much per click";
      why = `Each click costs ${money(current, mk)} but returns only ${money(rpc, mk)} of sales, putting ACOS at `
          + `${pct(acos)} against your ${pct(targetAcos)} target — ${(acos / targetAcos).toFixed(1)}x what you want to `
          + `pay. Scaling the ${bidWord} down to ${money(suggested, mk)} brings the cost per click back in line. `
          + `Capped at 30% per run so you keep the traffic while it corrects.`;
    } else {
      action = "keep";
      reason = "On target — leave alone";
      why = `ACOS is ${pct(acos)}, near your ${pct(targetAcos)} target, so the current bid of ${money(current, mk)} `
          + `is already about right. Changing it would risk volume for no gain.`;
    }
  } else if (stats.clicks >= RULES.noSaleClicks) {
    suggested = Math.max(mk.minBid, current * (1 - RULES.noSaleBidCut));
    action = "decrease";
    reason = "Clicks but no sales";
    why = `${num(stats.clicks, mk)} clicks and ${money(stats.spend, mk)} spent without a single order. It may still `
        + `convert, so rather than pausing it, cut the ${bidWord} 25% to ${money(suggested, mk)} — it keeps collecting `
        + `data at a lower cost. If it still has no sales next run, negate it.`;
  } else {
    return null;
  }

  return {
    campaign: stats.campaign, adGroup: stats.adGroup, target: stats.target, matchType: stats.matchType,
    clicks: stats.clicks, spend: stats.spend, sales: stats.sales, orders: stats.orders, acos,
    currentBid: current, newBid: Math.round(suggested * 100) / 100,
    action, reason, why, rowIndex: stats.rowIndex,
  };
}

export function analyze(
  strRows: SearchTermRow[],
  bulk: BulkData | null,
  targetAcos: number,
  marketplace: Marketplace,
  sensitivityKey: SensitivityKey
): Results {
  const sens = SENSITIVITY[sensitivityKey];
  const mk = marketplace;

  /* ---- bids ---- */
  let bids: BidRec[] = [];
  let bidSource = "";
  if (bulk && bulk.hasPerf) {
    bidSource = "bulk";
    bids = bulk.keywords
      .map(k => bidRecFrom({ ...k, currentBid: k.bid }, targetAcos, mk, true))
      .filter((b): b is BidRec => b !== null);
  } else if (strRows.length) {
    bidSource = bulk ? "str+bulkbids" : "str";
    const bidLookup = new Map<string, number>();
    if (bulk) {
      for (const k of bulk.keywords) {
        bidLookup.set(`${k.campaign}||${k.adGroup}||${k.target.toLowerCase()}||${k.matchType.toLowerCase()}`, k.bid);
      }
    }
    const targets = new Map<string, TargetStats & { sheetBid: number }>();
    for (const r of strRows) {
      const key = `${r.campaign}||${r.adGroup}||${r.targeting}||${r.matchType}`;
      let t = targets.get(key);
      if (!t) {
        t = { campaign: r.campaign, adGroup: r.adGroup, target: r.targeting, matchType: r.matchType,
              clicks: 0, spend: 0, sales: 0, orders: 0, currentBid: 0, sheetBid: 0 };
        targets.set(key, t);
      }
      t.clicks += r.clicks; t.spend += r.spend; t.sales += r.sales; t.orders += r.orders;
      if (r.bid > 0) t.sheetBid = r.bid;
    }
    bids = [...targets.values()].map(t => {
      const real = bidLookup.get(
        `${t.campaign}||${t.adGroup}||${t.target.toLowerCase()}||${t.matchType.toLowerCase()}`
      ) || t.sheetBid;
      if (real > 0) t.currentBid = real;
      return bidRecFrom(t, targetAcos, mk, real > 0);
    }).filter((b): b is BidRec => b !== null);
  } else if (bulk) {
    bidSource = "bulk-noperf";
  }
  bids.sort((a, b) => b.spend - a.spend);

  /* ---- negatives ---- */
  const negatives: NegativeRec[] = [];
  if (strRows.length) {
    // Compare wasted spend to what one ORDER may cost, not one click. On
    // accounts where a click costs more than a click earns, a per-click
    // ceiling flags nearly every search term.
    const totalSales = strRows.reduce((a, r) => a + r.sales, 0);
    const totalOrders = strRows.reduce((a, r) => a + r.orders, 0);
    const aov = totalOrders ? totalSales / totalOrders : 0;
    const targetCpa = aov * targetAcos;
    const spendCeiling = targetCpa * sens.cpaMultiple;

    const terms = new Map<string, NegativeRec>();
    for (const r of strRows) {
      if (!r.term) continue;
      const key = `${r.campaign}||${r.adGroup}||${r.term.toLowerCase()}`;
      let t = terms.get(key);
      if (!t) {
        t = { campaign: r.campaign, adGroup: r.adGroup, term: r.term,
              clicks: 0, spend: 0, orders: 0, reason: "", why: "" };
        terms.set(key, t);
      }
      t.clicks += r.clicks; t.spend += r.spend; t.orders += r.orders;
    }
    for (const [key, t] of terms) {
      if (t.orders > 0) continue;
      if (bulk && bulk.negativesSet.has(key)) continue;
      if (t.clicks >= sens.negativeClicks) {
        t.reason = `${num(t.clicks, mk)} clicks, no orders`;
        t.why = `Shoppers searching "${t.term}" clicked your ad ${num(t.clicks, mk)} times and bought nothing, costing `
              + `${money(t.spend, mk)}. At ${sens.negativeClicks}+ clicks without a single order, the search simply `
              + `doesn't match what you sell. Adding it as a negative exact keyword blocks this one phrase and leaves `
              + `every other search untouched.`;
      } else if (spendCeiling > 0 && t.spend >= spendCeiling) {
        t.reason = `${money(t.spend, mk)} spent, no orders`;
        t.why = `"${t.term}" has burned ${money(t.spend, mk)} across ${num(t.clicks, mk)} clicks with nothing to show. `
              + `At your ${pct(targetAcos)} target an order can only cost ${money(targetCpa, mk)}, so this term has `
              + `already spent ${(t.spend / targetCpa).toFixed(1)}x that without converting once. Block it as negative exact.`;
      } else {
        continue;
      }
      negatives.push(t);
    }
    negatives.sort((a, b) => b.spend - a.spend);
  }

  /* ---- harvest ---- */
  const harvest: HarvestRec[] = [];
  if (strRows.length) {
    const maxAcos = targetAcos * RULES.harvestMaxAcosMultiple;
    const terms = new Map<string, {
      campaign: string; adGroup: string; term: string; targeting: string; matchType: string;
      clicks: number; spend: number; sales: number; orders: number;
    }>();
    for (const r of strRows) {
      if (!r.term) continue;
      const alreadyExact = r.matchType.toLowerCase() === "exact"
        && r.term.toLowerCase() === r.targeting.toLowerCase();
      if (alreadyExact) continue;
      const key = `${r.campaign}||${r.adGroup}||${r.term.toLowerCase()}`;
      let t = terms.get(key);
      if (!t) {
        t = { campaign: r.campaign, adGroup: r.adGroup, term: r.term, targeting: r.targeting,
              matchType: r.matchType, clicks: 0, spend: 0, sales: 0, orders: 0 };
        terms.set(key, t);
      }
      t.clicks += r.clicks; t.spend += r.spend; t.sales += r.sales; t.orders += r.orders;
    }
    for (const t of terms.values()) {
      if (t.orders < RULES.harvestMinOrders) continue;
      const acos = t.sales > 0 ? t.spend / t.sales : 0;
      if (!t.sales || acos > maxAcos) continue;
      const rpc = t.sales / t.clicks;
      const startBid = Math.round(Math.max(mk.minBid, rpc * targetAcos) * 100) / 100;
      const source = AUTO_EXPRESSIONS.has(t.targeting.toLowerCase()) ? "auto" : (t.matchType || "broad/phrase");
      harvest.push({
        term: t.term, campaign: t.campaign, adGroup: t.adGroup, source,
        clicks: t.clicks, spend: t.spend, sales: t.sales, orders: t.orders, acos, startBid,
        reason: `${num(t.orders, mk)} orders at ${pct(acos)} ACOS`,
        why: `"${t.term}" came in through ${source} targeting and produced ${num(t.orders, mk)} orders worth `
           + `${money(t.sales, mk)} at ${pct(acos)} ACOS — proven demand you are currently reaching by accident. `
           + `Give it its own exact-match keyword at ${money(startBid, mk)} (its revenue per click priced at your `
           + `target) so you control the bid directly, then add it as a negative exact in `
           + `${t.adGroup || "the source ad group"} so the old targeting stops bidding against your new keyword.`,
      });
    }
    harvest.sort((a, b) => b.sales - a.sales);
  }

  /* ---- campaigns ---- */
  const source: Array<{ campaign: string; impressions: number; clicks: number; spend: number; sales: number; orders: number }> =
    strRows.length ? strRows : (bulk ? bulk.keywords : []);
  const camps = new Map<string, CampaignRow>();
  for (const r of source) {
    let c = camps.get(r.campaign);
    if (!c) {
      c = { campaign: r.campaign, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
            ctr: 0, cvr: 0, cpc: 0, acos: 0, roas: 0 };
      camps.set(r.campaign, c);
    }
    c.impressions += r.impressions; c.clicks += r.clicks; c.spend += r.spend;
    c.sales += r.sales; c.orders += r.orders;
  }
  const campaigns = [...camps.values()].map(c => ({
    ...c,
    ctr: c.impressions ? c.clicks / c.impressions : 0,
    cvr: c.clicks ? c.orders / c.clicks : 0,
    cpc: c.clicks ? c.spend / c.clicks : 0,
    acos: c.sales ? c.spend / c.sales : 0,
    roas: c.spend ? c.sales / c.spend : 0,
  })).sort((a, b) => b.spend - a.spend);

  const totals = campaigns.reduce(
    (a, c) => ({ spend: a.spend + c.spend, sales: a.sales + c.sales,
                 clicks: a.clicks + c.clicks, orders: a.orders + c.orders }),
    { spend: 0, sales: 0, clicks: 0, orders: 0 }
  );

  return { targetAcos, bids, bidSource, negatives, harvest, campaigns, totals };
}
