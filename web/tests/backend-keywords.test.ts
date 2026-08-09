import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MARKETPLACES, type SearchTermRow } from "../src/lib/analyze.ts";
import { buildBackendKeywords, byteLength, byteLimitFor } from "../src/lib/backend-keywords.ts";

const IN = MARKETPLACES.find(m => m.code === "IN")!;
const US = MARKETPLACES.find(m => m.code === "US")!;

function term(text: string, over: Partial<SearchTermRow> = {}): SearchTermRow {
  return {
    campaign: "C", adGroup: "AG", targeting: "kw", matchType: "broad",
    term: text, bid: 0, impressions: 100, clicks: 5, spend: 10,
    sales: 0, orders: 0, ...over,
  };
}

const base = { title: "", brand: "", productType: "" };

test("byte limits differ by marketplace", () => {
  assert.equal(byteLimitFor("IN"), 200);
  assert.equal(byteLimitFor("JP"), 500);
  assert.equal(byteLimitFor("US"), 250);
  assert.equal(byteLimitFor("ZZ"), 250); // unknown falls back to the common size
});

test("counts bytes, not characters", () => {
  assert.equal(byteLength("bag"), 3);
  assert.equal(byteLength("café"), 5);       // é is two bytes
  assert.equal(byteLength("बैग"), 9);         // Devanagari is three bytes a character
});

test("output is space separated with no commas or duplicates", () => {
  const rows = [term("school bag"), term("bag school"), term("kids school bag")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  assert.ok(!res.searchTerms.includes(","));
  const words = res.searchTerms.split(" ");
  assert.equal(new Set(words).size, words.length);
});

test("stop words are dropped", () => {
  const rows = [term("bag for the kids")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  for (const w of ["for", "the"]) {
    assert.ok(!res.searchTerms.split(" ").includes(w), `${w} should be excluded`);
    assert.ok(res.excluded.some(e => e.word === w && /stop word/i.test(e.reason)));
  }
});

test("words already in the title, brand or product type are not repeated", () => {
  const rows = [term("packster school backpack waterproof")];
  const res = buildBackendKeywords(rows, {
    marketplace: US, title: "School Backpack", brand: "Packster", productType: "backpack",
  });
  const words = res.searchTerms.split(" ");
  assert.ok(!words.includes("packster"));
  assert.ok(!words.includes("school"));
  assert.ok(!words.includes("backpack"));
  assert.ok(words.includes("waterproof"));
});

test("competitor brands are refused", () => {
  const rows = [term("skybags rucksack")];
  const res = buildBackendKeywords(rows, {
    marketplace: US, ...base, competitorBrands: "Skybags, Wildcraft",
  });
  // Words are held in their stemmed form, so the report names "skybag".
  assert.ok(!/skybag/.test(res.searchTerms));
  assert.ok(res.excluded.some(e => e.word === "skybag" && /competitor/i.test(e.reason)));
  assert.ok(res.searchTerms.split(" ").includes("rucksack"));
});

test("subjective and temporary claims are refused", () => {
  const rows = [term("best cheapest new bag sale")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  for (const w of ["best", "cheapest", "new", "sale"]) {
    assert.ok(!res.searchTerms.split(" ").includes(w), `${w} should be excluded`);
  }
  assert.ok(res.searchTerms.split(" ").includes("bag"));
});

test("ASINs are refused", () => {
  const rows = [term("B0GNMLCZF7 tote")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  assert.ok(!res.searchTerms.toLowerCase().includes("b0gnmlczf7"));
  assert.ok(res.excluded.some(e => /asin/i.test(e.reason)));
});

test("plurals fold into one form so the budget isn't spent twice", () => {
  const rows = [term("bags"), term("bag"), term("bottles"), term("bottle")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  const words = res.searchTerms.split(" ");
  assert.ok(words.includes("bag") && !words.includes("bags"));
  assert.ok(words.includes("bottle") && !words.includes("bottles"));
});

test("converting queries outrank ones that only got clicks", () => {
  const rows = [
    term("clicky", { clicks: 500, orders: 0 }),
    term("converty", { clicks: 5, orders: 20, sales: 5000 }),
  ];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  assert.equal(res.included[0].word, "converty");
});

test("output never exceeds the byte budget", () => {
  const rows = Array.from({ length: 400 }, (_, i) =>
    term(`uniqueword${i} filler${i}`, { clicks: 400 - i }));
  const res = buildBackendKeywords(rows, { marketplace: IN, ...base });
  assert.ok(byteLength(res.searchTerms) <= 200, `used ${byteLength(res.searchTerms)} bytes`);
  assert.equal(res.bytes, byteLength(res.searchTerms));
  assert.ok(res.droppedForSpace.length > 0, "should report what didn't fit");
});

test("multi-byte scripts are measured correctly against the budget", () => {
  const rows = [term("बैग स्कूल बच्चों वाटरप्रूफ यात्रा")];
  const res = buildBackendKeywords(rows, { marketplace: IN, ...base, byteLimit: 30 });
  assert.ok(res.bytes <= 30, `used ${res.bytes} bytes`);
  assert.equal(res.bytes, byteLength(res.searchTerms));
});

test("an explicit byte limit overrides the marketplace default", () => {
  const rows = [term("alpha bravo charlie delta echo foxtrot")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base, byteLimit: 12 });
  assert.ok(res.bytes <= 12);
  assert.equal(res.byteLimit, 12);
});

test("the same query arriving on several keywords is only counted once", () => {
  const twice = [
    term("tote bag", { clicks: 10, orders: 1, targeting: "kw1" }),
    term("tote bag", { clicks: 10, orders: 1, targeting: "kw2" }),
  ];
  const once = [term("tote bag", { clicks: 20, orders: 2 })];
  const a = buildBackendKeywords(twice, { marketplace: US, ...base });
  const b = buildBackendKeywords(once, { marketplace: US, ...base });
  assert.equal(a.sourceTerms, 1);
  assert.deepEqual(a.included.map(i => i.word), b.included.map(i => i.word));
});

test("empty input produces an empty field rather than an error", () => {
  const res = buildBackendKeywords([], { marketplace: US, ...base });
  assert.equal(res.searchTerms, "");
  assert.equal(res.bytes, 0);
  assert.equal(res.bytesFree, 250);
});

test("unambiguous trademarks are refused outright", () => {
  const rows = [term("spiderman school bag"), term("skybags tote"), term("doraemon pouch")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  for (const w of ["spiderman", "skybag", "doraemon"]) {
    assert.ok(!res.searchTerms.split(" ").includes(w), `${w} should be refused`);
  }
  assert.ok(res.excluded.some(e => /trademark/i.test(e.reason)));
  assert.ok(res.searchTerms.split(" ").includes("tote"));
});

test("words that are both brands and ordinary vocabulary are kept but flagged", () => {
  const rows = [term("apple juice concentrate"), term("safari luggage")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  // kept, because only the seller knows whether it is legitimate
  assert.ok(res.searchTerms.split(" ").includes("apple"));
  assert.ok(res.searchTerms.split(" ").includes("safari"));
  // but surfaced for a decision
  const flagged = res.needsReview.map(w => w.word);
  assert.ok(flagged.includes("apple"), "apple should be flagged");
  assert.ok(flagged.includes("safari"), "safari should be flagged");
  assert.ok(!flagged.includes("juice"), "ordinary words should not be flagged");
});
