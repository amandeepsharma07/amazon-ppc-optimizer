import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  asinFromHref, browseNodeFromUrl, isAsin, parseCount, parsePrice, parseRating,
  rowsToAsinList, rowsToCsv, rowsToTsv,
} from "../../extension/src/extract.js";

/* The DOM walking in extract.js is exercised in a real browser against a
   fixture page; what is unit-tested here is the parsing, which is where the
   marketplace differences bite. */

test("ASINs are recognised, near-misses are not", () => {
  assert.equal(isAsin("B0CZ8K9LMN"), true);
  assert.equal(isAsin("0143424122"), true);      // an ISBN is a valid ASIN
  assert.equal(isAsin("B0CZ8K9LM"), false);      // nine characters
  assert.equal(isAsin("B0CZ8K9LMNO"), false);    // eleven
  assert.equal(isAsin("b0cz8k9lm-"), false);
});

test("ASINs are pulled out of every link shape Amazon uses", () => {
  assert.equal(asinFromHref("/dp/B0CZ8K9LMN"), "B0CZ8K9LMN");
  assert.equal(asinFromHref("/dp/B0CZ8K9LMN/ref=sr_1_3?keywords=bag"), "B0CZ8K9LMN");
  assert.equal(asinFromHref("https://www.amazon.in/Packster-Backpack/dp/b0cz8k9lmn/"), "B0CZ8K9LMN");
  assert.equal(asinFromHref("/gp/product/B0CZ8K9LMN"), "B0CZ8K9LMN");
  assert.equal(asinFromHref("/gp/aw/d/B0CZ8K9LMN"), "B0CZ8K9LMN");
  assert.equal(asinFromHref("/s?k=laptop+bag"), null);
});

test("review counts survive every way a marketplace groups digits", () => {
  assert.equal(parseCount("1,204 ratings"), 1204);
  assert.equal(parseCount("(1,204)"), 1204);
  assert.equal(parseCount("1,20,456"), 120456);      // Indian grouping
  assert.equal(parseCount("1.204"), 1204);           // German grouping
  assert.equal(parseCount("2.3K"), 2300);
  assert.equal(parseCount(""), null);
  assert.equal(parseCount("ratings"), null);
});

test("ratings are read from the localised star text", () => {
  assert.equal(parseRating("4.3 out of 5 stars"), 4.3);
  assert.equal(parseRating("4,3 von 5 Sternen"), 4.3);
  assert.equal(parseRating("4.3 sur 5 étoiles"), 4.3);
  assert.equal(parseRating("5 out of 5"), 5);
  assert.equal(parseRating("1,204 ratings"), null);   // a count is not a rating
  assert.equal(parseRating(""), null);
});

test("prices are read whichever separator the marketplace uses as the decimal", () => {
  assert.equal(parsePrice("₹1,499"), 1499);
  assert.equal(parsePrice("₹1,499.00"), 1499);
  assert.equal(parsePrice("$24.99"), 24.99);
  assert.equal(parsePrice("1.299,00 €"), 1299);       // German
  assert.equal(parsePrice("₹1,20,456"), 120456);      // Indian grouping
  assert.equal(parsePrice("Currently unavailable"), null);
  assert.equal(parsePrice(""), null);
});

test("the browse node is read from the URL when the URL states one", () => {
  assert.deepEqual(browseNodeFromUrl("https://www.amazon.in/b?node=2454176031"),
    { id: "2454176031", source: "URL node parameter" });
  // Refinements stack; the last is the narrowest.
  assert.deepEqual(browseNodeFromUrl("https://www.amazon.in/s?k=bag&rh=n%3A1571271031%2Cn%3A2454176031"),
    { id: "2454176031", source: "URL refinement" });
  assert.equal(browseNodeFromUrl("https://www.amazon.in/s?k=laptop+bag"), null);
  assert.equal(browseNodeFromUrl("not a url"), null);
});

const rows = [
  {
    position: 1, asin: "B0CZ8K9LMN", title: 'Packster "Canvas" Backpack, 30L', price: "₹1,499",
    priceValue: 1499, rating: 4.3, reviews: 1204, sponsored: true, badge: "Best Seller",
    browseNodeId: "2454176031", browseNodePath: "Bags > Backpacks",
    url: "https://www.amazon.in/dp/B0CZ8K9LMN",
  },
  {
    position: 2, asin: "B0AAAA1234", title: null, price: null, priceValue: null,
    rating: null, reviews: null, sponsored: false, badge: null,
    browseNodeId: "2454176031", browseNodePath: "Bags > Backpacks",
    url: "https://www.amazon.in/dp/B0AAAA1234",
  },
];

test("the Excel export is tab-separated with a header and no stray tabs", () => {
  const lines = rowsToTsv(rows).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split("\t").length, 12);
  for (const line of lines) assert.equal(line.split("\t").length, 12);
  assert.ok(lines[1].includes("B0CZ8K9LMN"));
  assert.ok(lines[1].includes("Yes"));            // sponsored
  assert.ok(lines[2].includes("No"));
});

test("a title containing a tab or newline cannot break the columns", () => {
  const messy = [{ ...rows[0], title: "Line one\tstill one\nline two" }];
  const line = rowsToTsv(messy).split("\n")[1];
  assert.equal(line.split("\t").length, 12);
  assert.ok(line.includes("Line one still one line two"));
});

test("the CSV quotes what has to be quoted", () => {
  const csv = rowsToCsv(rows);
  assert.ok(csv.includes('"Packster ""Canvas"" Backpack, 30L"'));
  assert.ok(csv.split("\r\n").length === 3);
});

test("empty values export as empty, never as null or undefined", () => {
  const tsv = rowsToTsv(rows);
  const csv = rowsToCsv(rows);
  for (const text of [tsv, csv]) {
    assert.ok(!/null|undefined|NaN/.test(text), text);
  }
});

test("the ASIN list is just the ASINs", () => {
  assert.equal(rowsToAsinList(rows), "B0CZ8K9LMN\nB0AAAA1234");
});
