import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MARKETPLACES, analyze, type SearchTermRow } from "../src/lib/analyze.ts";
import { normHeader, toNum } from "../src/lib/parse.ts";

const IN = MARKETPLACES[0];
const US = MARKETPLACES[1];

function row(over: Partial<SearchTermRow> = {}): SearchTermRow {
  return {
    campaign: "C1", adGroup: "AG1", targeting: "kw", matchType: "broad",
    term: "a term", bid: 0, impressions: 1000, clicks: 0,
    spend: 0, sales: 0, orders: 0, ...over,
  };
}

test("header normalisation keeps informational-only columns distinct", () => {
  assert.equal(normHeader("Campaign Name"), "campaignname");
  assert.equal(normHeader("Campaign Name (Informational only)"), "campaignnameinformationalonly");
  assert.notEqual(normHeader("Campaign Name"), normHeader("Campaign Name (Informational only)"));
});

test("numbers parse through currency symbols and separators", () => {
  assert.equal(toNum("₹1,234.50"), 1234.5);
  assert.equal(toNum("$99"), 99);
  assert.equal(toNum(""), 0);
  assert.equal(toNum("-"), 0);
  assert.equal(toNum(42), 42);
});

test("bids scale by distance from target rather than revenue per click", () => {
  // ACOS 40% against a 30% target: 30/40 = 0.75x the current bid.
  const rows = [row({ clicks: 100, spend: 400, sales: 1000, orders: 10, bid: 10 })];
  const { bids } = analyze(rows, null, 0.30, US, "balanced");
  assert.equal(bids.length, 1);
  assert.equal(bids[0].action, "decrease");
  assert.equal(bids[0].newBid, 7.5);
});

test("bid moves are capped at 30% per run in both directions", () => {
  const cut = analyze([row({ clicks: 100, spend: 900, sales: 1000, orders: 5, bid: 10 })], null, 0.10, US, "balanced");
  assert.equal(cut.bids[0].newBid, 7); // would be 1.11 uncapped
  const raise = analyze([row({ clicks: 100, spend: 50, sales: 1000, orders: 20, bid: 10 })], null, 0.30, US, "balanced");
  assert.equal(raise.bids[0].action, "increase");
  assert.equal(raise.bids[0].newBid, 13); // would be 60 uncapped
});

test("targets below the click floor are left alone", () => {
  const { bids } = analyze([row({ clicks: 3, spend: 30, sales: 10, orders: 1, bid: 10 })], null, 0.30, US, "balanced");
  assert.equal(bids.length, 0);
});

test("clicks without a sale get a 25% cut, never below the marketplace floor", () => {
  const { bids } = analyze([row({ clicks: 20, spend: 40, bid: 2 })], null, 0.30, US, "balanced");
  assert.equal(bids[0].action, "decrease");
  assert.equal(bids[0].newBid, 1.5);
  const floored = analyze([row({ clicks: 20, spend: 1, bid: 0.02 })], null, 0.30, US, "balanced");
  assert.equal(floored.bids[0].newBid, 0.02);
});

test("wasted spend is judged against cost per order, not cost per click", () => {
  // AOV 500, target 30% -> an order may cost 150; balanced needs 1.5x = 225.
  const rows = [
    row({ term: "winner", clicks: 10, spend: 100, sales: 500, orders: 1 }),
    row({ term: "pricey dud", clicks: 2, spend: 300 }),   // few clicks, past the ceiling
    row({ term: "cheap dud", clicks: 2, spend: 20 }),     // few clicks, under it
  ];
  const { negatives } = analyze(rows, null, 0.30, IN, "balanced");
  const flagged = negatives.map(n => n.term);
  assert.deepEqual(flagged, ["pricey dud"]);
});

test("a term with enough clicks and no orders is negated regardless of spend", () => {
  const rows = [
    row({ term: "winner", clicks: 10, spend: 100, sales: 500, orders: 1 }),
    row({ term: "many clicks", clicks: 12, spend: 5 }),
  ];
  const { negatives } = analyze(rows, null, 0.30, IN, "balanced");
  assert.ok(negatives.some(n => n.term === "many clicks"));
});

test("sensitivity changes how readily terms are negated", () => {
  const rows = [
    row({ term: "winner", clicks: 10, spend: 100, sales: 500, orders: 1 }),
    row({ term: "seven clicks", clicks: 7, spend: 10 }),
  ];
  const counts = (["conservative", "balanced", "aggressive"] as const).map(
    s => analyze(rows, null, 0.30, IN, s).negatives.length
  );
  assert.deepEqual(counts, [0, 0, 1]); // only aggressive negates at 5+ clicks
});

test("converting terms are harvested, and exact-match ones are not", () => {
  const harvestable = [row({ term: "thick yoga mat", targeting: "yoga mat", matchType: "broad",
                             clicks: 20, spend: 12, sales: 80, orders: 4 })];
  const { harvest } = analyze(harvestable, null, 0.30, US, "balanced");
  assert.equal(harvest.length, 1);
  assert.equal(harvest[0].startBid, 1.2); // rpc 4.00 x 30%

  const already = [row({ term: "thick yoga mat", targeting: "thick yoga mat", matchType: "exact",
                         clicks: 20, spend: 12, sales: 80, orders: 4 })];
  assert.equal(analyze(already, null, 0.30, US, "balanced").harvest.length, 0);
});

test("terms that convert too expensively are not harvested", () => {
  const rows = [row({ term: "pricey", clicks: 20, spend: 30, sales: 40, orders: 3 })]; // 75% ACOS
  assert.equal(analyze(rows, null, 0.30, US, "balanced").harvest.length, 0);
});

test("campaign totals divide safely when there are no sales or impressions", () => {
  const rows = [row({ campaign: "Empty", impressions: 0, clicks: 0 })];
  const { campaigns } = analyze(rows, null, 0.30, US, "balanced");
  assert.equal(campaigns[0].acos, 0);
  assert.equal(campaigns[0].ctr, 0);
  assert.equal(campaigns[0].roas, 0);
});
