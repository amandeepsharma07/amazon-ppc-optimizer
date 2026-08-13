import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  coverageOf, namesABrand, packToBytes, processKeywords, singular,
} from "../src/lib/keyword-tools.ts";

test("any delimiter is accepted, but a space is not one", () => {
  const r = processKeywords("laptop bag\nschool backpack, travel rucksack; college bag|duffle bag");
  assert.equal(r.stats.phrasesOut, 5);
  assert.ok(r.phrases.some(p => p.phrase === "laptop bag"), "a space keeps a phrase together");
  assert.ok(r.phrases.some(p => p.phrase === "duffle bag"));
});

test("the same phrase written differently is one phrase, counted twice", () => {
  const r = processKeywords("Laptop Bag\nlaptop  bag\nLAPTOP BAG!\nschool bag");
  assert.equal(r.stats.phrasesIn, 4);
  assert.equal(r.stats.phrasesOut, 2);
  assert.equal(r.stats.duplicatesRemoved, 2);
  assert.equal(r.phrases[0].phrase, "laptop bag");
  assert.equal(r.phrases[0].count, 3);
});

test("words are ranked by how many phrases they reach, not raw frequency", () => {
  const r = processKeywords([
    "laptop bag", "laptop sleeve", "laptop case",   // laptop reaches 3 phrases
    "school bag", "school bag", "school bag",       // school appears often, one phrase
  ].join("\n"));
  assert.equal(r.words[0].word, "laptop");
  assert.equal(r.words[0].phrases, 3);
  const school = r.words.find(w => w.word === "school")!;
  assert.equal(school.phrases, 1);
  assert.equal(school.count, 3);
});

test("plurals fold into one word, as Amazon's stemmer does", () => {
  assert.equal(singular("bags"), "bag");
  assert.equal(singular("boxes"), "box");
  assert.equal(singular("bodies"), "body");
  assert.equal(singular("dress"), "dress");    // not a plural
  assert.equal(singular("bus"), "bus");        // too short to strip

  const r = processKeywords("laptop bags\nlaptop bag\nlaptop backpacks");
  const bag = r.words.find(w => w.word === "bag")!;
  assert.equal(bag.phrases, 2, "bags and bag are the same word");
  assert.equal(r.words.some(w => w.word === "bags"), false);
});

test("stemming can be switched off", () => {
  const r = processKeywords("laptop bags\nlaptop bag", { stem: false });
  assert.ok(r.words.some(w => w.word === "bags"));
  assert.ok(r.words.some(w => w.word === "bag"));
});

test("another brand's name is found, single and two-word", () => {
  assert.equal(namesABrand("american tourister trolley"), "tourister");
  assert.equal(namesABrand("harry potter lunch box"), "harry potter");
  assert.equal(namesABrand("hello kitty bag"), "hello kitty");
  assert.equal(namesABrand("plain canvas backpack"), null);
});

test("phrases naming a brand are dropped, and can be kept on request", () => {
  const input = "laptop bag\nsamsonite trolley\namerican tourister backpack";
  const stripped = processKeywords(input);
  assert.equal(stripped.stats.phrasesOut, 1);
  assert.equal(stripped.phrases[0].phrase, "laptop bag");

  const kept = processKeywords(input, { removeBrands: false });
  assert.equal(kept.stats.phrasesOut, 3);
});

test("stop words, claims and junk are held out with a reason, not deleted silently", () => {
  const r = processKeywords("best laptop bag for the office\ncheap school bag 123456");
  const words = r.words.map(w => w.word);
  assert.ok(!words.includes("for"));
  assert.ok(!words.includes("best"));
  assert.ok(!words.includes("123456"));
  assert.ok(words.includes("laptop"));
  assert.ok(words.includes("office"));

  const reasons = Object.fromEntries(r.excludedWords.map(w => [w.word, w.excluded]));
  assert.match(reasons.for, /stop word/i);
  assert.match(reasons.best, /claim/i);
  assert.match(reasons["123456"], /number/i);
});

test("your own words can be excluded by name", () => {
  const r = processKeywords("packster laptop bag\npackster school bag", { exclude: "Packster, bags" });
  const words = r.words.map(w => w.word);
  assert.ok(!words.includes("packster"));
  assert.ok(!words.includes("bag"), "excluding \"bags\" excludes the stem");
  assert.ok(words.includes("laptop"));
});

test("words pack into a byte budget by reach, and the remainder is reported", () => {
  const r = processKeywords([
    "laptop bag", "laptop sleeve", "laptop case", "school backpack", "travel rucksack",
  ].join("\n"));
  const packed = packToBytes(r.words, 20);
  assert.ok(packed.bytes <= 20);
  assert.ok(packed.used.length >= 1);
  assert.ok(packed.left.length >= 1);
  // Highest reach goes in first.
  assert.equal(packed.used[0].word, "laptop");
  // Rendered exactly as the field wants it: single spaces, no commas.
  assert.equal(packed.text, packed.used.map(w => w.word).join(" "));
  assert.ok(!packed.text.includes(","));
});

test("a byte budget counts bytes, not characters", () => {
  const r = processKeywords("café\nbag");
  const packed = packToBytes(r.words, 5);
  // "café" is 5 bytes, so nothing else fits beside it.
  assert.equal(packed.used.length, 1);
});

test("coverage matches on stems and ignores word order", () => {
  const copy = "Packster Canvas Laptop Backpacks for Men and Women, 30 Litre Grey";
  const { covered, missing, percent } = coverageOf(copy, [
    "laptop backpack",      // plural in the copy, singular in the keyword
    "backpack for men",     // different order
    "canvas bag",           // "bag" is not in the copy
    "grey laptop",
  ]);
  assert.deepEqual(covered.sort(), ["backpack for men", "grey laptop", "laptop backpack"]);
  assert.deepEqual(missing, ["canvas bag"]);
  assert.equal(percent, 75);
});

test("an empty paste produces empty results rather than throwing", () => {
  const r = processKeywords("   \n\n , ; ");
  assert.equal(r.stats.phrasesOut, 0);
  assert.equal(r.words.length, 0);
  assert.equal(coverageOf("", []).percent, 0);
});

test("the character counts describe what came in and what survived", () => {
  const r = processKeywords("laptop bag\nlaptop bag\nschool backpack");
  assert.equal(r.stats.linesIn, 3);
  assert.equal(r.stats.phrasesIn, 3);
  assert.equal(r.stats.phrasesOut, 2);
  assert.ok(r.stats.charsOut < r.stats.charsIn);
});
