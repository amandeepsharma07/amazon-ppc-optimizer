import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MARKETPLACES, type SearchTermRow } from "../src/lib/analyze.ts";
import {
  buildBackendKeywords, byteLength, byteLimitFor, campaignsInReport, detectBrands, detectOffTopic,
} from "../src/lib/backend-keywords.ts";

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

test("brand-ambiguous words are kept OUT of the field by default", () => {
  const rows = [term("apple juice concentrate"), term("safari luggage")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  const words = res.searchTerms.split(" ");
  // the copyable output must be safe to paste without reading any warning
  assert.ok(!words.includes("apple"), "apple must not be in the field by default");
  assert.ok(!words.includes("safari"), "safari must not be in the field by default");
  // offered back for a decision
  const held = res.heldBack.map(w => w.word);
  assert.ok(held.includes("apple") && held.includes("safari"));
  // ordinary words are unaffected
  assert.ok(words.includes("juice") && words.includes("luggage"));
});

test("a confirmed brand-ambiguous word goes back in", () => {
  const rows = [term("apple juice concentrate")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base, allowedBrands: ["apple"] });
  assert.ok(res.searchTerms.split(" ").includes("apple"));
  assert.equal(res.heldBack.length, 0);
  assert.ok(res.included.find(w => w.word === "apple")?.review);
});

test("confirming one brand word does not release the others", () => {
  const rows = [term("apple safari genie bag")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base, allowedBrands: ["safari"] });
  const words = res.searchTerms.split(" ");
  assert.ok(words.includes("safari"));
  assert.ok(!words.includes("apple") && !words.includes("genie"));
  assert.deepEqual(res.heldBack.map(w => w.word).sort(), ["apple", "genie"]);
});

test("campaigns in a report are listed with their volume", () => {
  const rows = [
    term("kids bag", { campaign: "School Bags", clicks: 10, orders: 2 }),
    term("kids bag small", { campaign: "School Bags", clicks: 5, orders: 0 }),
    term("laptop sleeve 15 inch", { campaign: "Laptop Sleeve", clicks: 40, orders: 1 }),
  ];
  const camps = campaignsInReport(rows);
  assert.equal(camps.length, 2);
  assert.equal(camps[0].campaign, "Laptop Sleeve"); // busiest first
  assert.equal(camps[0].clicks, 40);
  assert.equal(camps.find(c => c.campaign === "School Bags")?.terms, 2);
});

test("words judged irrelevant are refused", () => {
  const rows = [term("laptop sleeve kids bag")];
  const res = buildBackendKeywords(rows, {
    marketplace: US, ...base, excludeWords: "laptop, sleeve",
  });
  const words = res.searchTerms.split(" ");
  assert.ok(!words.includes("laptop") && !words.includes("sleeve"));
  assert.ok(words.includes("kid") || words.includes("bag"));
  assert.ok(res.excluded.some(e => /not describing your product/i.test(e.reason)));
});

test("multi-word brands are caught on their distinctive word", () => {
  const rows = [term("american tourister backpack"), term("hello kitty pouch")];
  const res = buildBackendKeywords(rows, { marketplace: US, ...base });
  const words = res.searchTerms.split(" ");
  assert.ok(!words.includes("tourister"), "tourister must be refused");
  assert.ok(!words.includes("kitty"), "kitty is brand-ambiguous, so held back");
  // the generic half of the phrase is fine
  assert.ok(words.includes("backpack") || words.includes("pouch"));
});

test("words from the description are not repeated in the field", () => {
  const rows = [term("waterproof padded ergonomic rucksack")];
  const res = buildBackendKeywords(rows, {
    marketplace: US, ...base,
    description: "A waterproof backpack with padded shoulder straps.",
  });
  const words = res.searchTerms.split(" ");
  assert.ok(!words.includes("waterproof"), "already in the description");
  assert.ok(!words.includes("padded"), "already in the description");
  assert.ok(words.includes("ergonomic") && words.includes("rucksack"));
});

test("known brands present in a report are detected", () => {
  const rows = [
    term("skybags rucksack"), term("nike bag"), term("plain cotton tote"),
  ];
  const found = detectBrands(rows);
  assert.ok(found.includes("skybag"), "trademarked brand detected");
  assert.ok(found.includes("nike"), "brand-ambiguous name detected");
  assert.ok(!found.includes("tote"), "ordinary words are not brands");
});

test("words belonging to another product are detected as off-topic", () => {
  const rows = [
    // the product being worked on
    ...Array.from({ length: 6 }, () => term("school bag kids", { campaign: "School", clicks: 30 })),
    term("school bag laptop compartment", { campaign: "School", clicks: 2 }),
    // a different product's campaign
    ...Array.from({ length: 6 }, () => term("laptop sleeve 15 inch", { campaign: "Sleeve", clicks: 40 })),
  ];
  const off = detectOffTopic(rows, new Set(["School"]));
  assert.ok(off.includes("laptop"), "laptop is overwhelmingly from the other campaign");
  // "sleeve" never appears under School at all, so the campaign filter has
  // already removed it — re-suggesting it would be noise.
  assert.ok(!off.includes("sleeve"));
  assert.ok(!off.includes("school"), "words central to the chosen campaign are kept");
  assert.ok(!off.includes("bag"), "shared generic words are kept");
});

test("nothing is suggested as off-topic when no campaign is chosen", () => {
  const rows = [term("laptop sleeve", { campaign: "Sleeve", clicks: 90 })];
  assert.deepEqual(detectOffTopic(rows, new Set()), []);
});
