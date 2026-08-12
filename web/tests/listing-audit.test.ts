import { strict as assert } from "node:assert";
import { test } from "node:test";
// The engine ships inside the Chrome extension, where it runs against the live
// page. It is imported from there rather than copied so there is one set of
// rules, tested here and shipped there.
import {
  auditListing, cleanTitle, gradeFor, keywordGaps, marketplaceFromHost,
  reportToText, titleLimitFor,
} from "../../extension/src/audit.js";

const IN = { code: "IN", label: "India", currency: "₹" };

/** A listing with nothing wrong with it, to vary one field at a time from. */
function listing(over: Record<string, unknown> = {}) {
  return {
    asin: "B0TEST1234",
    url: "https://www.amazon.in/dp/B0TEST1234",
    marketplace: IN,
    title: "Packster Canvas Laptop Backpack for Men and Women, 30 Litre Water Resistant College Bag with Padded 15.6 Inch Sleeve, Grey",
    brand: "Packster",
    bullets: [
      "Holds a 15.6 inch laptop in a padded sleeve that keeps the screen away from the base of the bag, so a knock on the floor does not reach it.",
      "Thirty litres across three compartments: books in the main section, cables in the organiser, a bottle in each side pocket without stretching the seam.",
      "Water resistant canvas with a coated backing sheds a monsoon shower on the walk between the station and the gate rather than soaking through to paper.",
      "Padded shoulder straps and a ventilated back panel spread the weight across the shoulders instead of hanging it off the neck on a long commute.",
      "Reinforced stitching at both handle joints and the base corners, the two points where a loaded bag gives way first after a year of daily carrying.",
    ],
    description:
      "The Packster canvas backpack is built for a daily commute that mixes a laptop with everything else. "
      + "The main compartment takes a fifteen point six inch machine in a padded sleeve, with a separate organiser "
      + "for chargers, pens and a diary. Side pockets take a one litre bottle each. The canvas is coated on the "
      + "reverse so a shower on the walk to the office does not reach what is inside, and the base corners are "
      + "double stitched because that is where a loaded bag fails first. Straps are padded and adjustable, and the "
      + "back panel is ventilated for the ride home in summer. Available in grey, navy and olive, with a one "
      + "compartment version for anyone who carries less.",
    aplus: true,
    images: 8,
    hasVideo: true,
    rating: 4.5,
    reviewCount: 340,
    price: "₹1,499",
    inStock: true,
    category: "Bags & Luggage",
    ...over,
  };
}

test("marketplace comes from the domain, and the domains do not overlap", () => {
  assert.equal(marketplaceFromHost("www.amazon.in")?.code, "IN");
  assert.equal(marketplaceFromHost("amazon.co.uk")?.code, "UK");
  // amazon.com.mx must not be read as a subdomain of amazon.com
  assert.equal(marketplaceFromHost("www.amazon.com.mx")?.code, "MX");
  assert.equal(marketplaceFromHost("www.amazon.com")?.code, "US");
  assert.equal(marketplaceFromHost("flipkart.com"), null);
});

test("title limits follow the marketplace unless overridden", () => {
  assert.equal(titleLimitFor("US"), 200);
  assert.equal(titleLimitFor("JP"), 128);
  assert.equal(titleLimitFor("ZZ"), 200);
  assert.equal(auditListing(listing(), { titleLimit: 150 }).titleLimit, 150);
});

test("a clean listing scores full marks", () => {
  const report = auditListing(listing());
  assert.equal(report.score, 100);
  assert.equal(report.grade, "A");
  assert.equal(report.policyFailures, 0);
  assert.equal(report.fixes.length, 0);
  assert.equal(report.unreadable.length, 0);
});

test("fields that could not be read leave the score alone", () => {
  const blind = auditListing(listing({
    title: null, bullets: null, description: null, aplus: null,
    images: null, hasVideo: null, rating: null, reviewCount: null, inStock: null,
  }));
  assert.equal(blind.available, 0);
  assert.equal(blind.score, null);
  assert.equal(blind.grade, null);
  // Nothing is reported as a failure — every check is simply unreadable.
  assert.equal(blind.fixes.length, 0);
  assert.ok(blind.unreadable.length > 10);
});

test("a missing gallery does not drag down the rest of the score", () => {
  const full = auditListing(listing());
  const noGallery = auditListing(listing({ images: null, hasVideo: null }));
  assert.equal(noGallery.score, full.score);      // still 100 out of what could be read
  assert.equal(noGallery.available, full.available - 15);
  assert.equal(noGallery.unreadable.length, 2);
});

test("an over-length title fails on policy, not style", () => {
  const long = "Packster " + "Canvas Laptop Backpack Water Resistant ".repeat(8);
  const report = auditListing(listing({ title: long }));
  const check = report.fixes.find(f => f.id === "title-length");
  assert.ok(check);
  assert.equal(check.kind, "policy");
  assert.equal(check.status, "fail");
  assert.match(check.detail, /over the limit/);
});

test("shouted words are flagged but genuine acronyms are not", () => {
  const shouted = auditListing(listing({
    title: "Packster CANVAS Laptop Backpack with USB Charging Port and HDMI Pocket, 30 Litre, Grey",
  }));
  const check = shouted.sections.find(s => s.id === "title").checks.find(c => c.id === "title-caps");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.evidence, ["CANVAS"]);   // USB and HDMI left alone
});

test("promotional claims in the title are caught", () => {
  const report = auditListing(listing({
    title: "Packster BEST SELLER Canvas Laptop Backpack, Free Shipping, 30 Litre Water Resistant College Bag, Grey",
  }));
  const check = report.sections.find(s => s.id === "title").checks.find(c => c.id === "title-promo");
  assert.equal(check.status, "fail");
  assert.equal(check.evidence.length, 2);
});

test("another brand's name is found, including two-word brands", () => {
  const report = auditListing(listing({
    description: "A better buy than the American Tourister and Skybag models, and it fits a Harry Potter lunch box.",
  }));
  const check = report.sections.find(s => s.id === "policy").checks.find(c => c.id === "policy-trademarks");
  assert.equal(check.status, "fail");
  assert.ok(check.evidence.includes("skybag"));
  // "American Tourister" arrives as two words; the distinctive one carries it.
  assert.ok(check.evidence.includes("tourister"));
  // "Harry Potter" has no distinctive single word, so the adjacent pair does.
  assert.ok(check.evidence.includes("harry potter"));
});

test("a seller's own brand is never flagged as somebody else's", () => {
  // boAt is a real Indian brand; its own listing must not fail its own name.
  const report = auditListing(listing({
    brand: "boAt",
    title: "boAt Rockerz 255 Wireless Neckband Earphones with 40 Hour Playback and Fast Charge, Black",
    description: "boAt Rockerz neckband earphones with a magnetic clasp.",
  }));
  const check = report.sections.find(s => s.id === "policy").checks.find(c => c.id === "policy-trademarks");
  assert.equal(check.status, "pass");
});

test("contact details are caught, size runs are not", () => {
  const withPhone = auditListing(listing({
    bullets: [...listing().bullets.slice(1), "Any issue, WhatsApp us on +91 98765 43210 or write to care@example.com"],
  }));
  const flagged = withPhone.sections.find(s => s.id === "bullets").checks.find(c => c.id === "bullet-contact");
  assert.equal(flagged.status, "fail");
  assert.equal(flagged.evidence.length, 3); // email, phone, social handle

  const sizes = auditListing(listing({
    bullets: [...listing().bullets.slice(1), "Fits shoe sizes 40 41 42 43 44 45 46 and half sizes in between the whole range."],
  }));
  const clean = sizes.sections.find(s => s.id === "bullets").checks.find(c => c.id === "bullet-contact");
  assert.equal(clean.status, "pass");
});

test("policy failures are listed before anything merely costing points", () => {
  const report = auditListing(listing({
    title: "Packster Best Seller Canvas Laptop Backpack, 30 Litre Water Resistant College Bag, Grey",
    images: 2,
    hasVideo: false,
    aplus: false,
  }));
  assert.ok(report.fixes.length >= 4);
  const firstStyle = report.fixes.findIndex(f => f.kind === "style");
  const lastPolicy = report.fixes.map(f => f.kind).lastIndexOf("policy");
  assert.ok(lastPolicy < firstStyle, "every policy fix comes before the first style fix");
});

test("A+ content stands in for a missing description, but not for a thin one", () => {
  const aplusOnly = auditListing(listing({ description: null, aplus: true }));
  const desc = aplusOnly.sections.find(s => s.id === "content").checks.find(c => c.id === "description");
  assert.equal(desc.status, "pass");

  const thin = auditListing(listing({ description: "Grey backpack.", aplus: true }));
  const thinCheck = thin.sections.find(s => s.id === "content").checks.find(c => c.id === "description");
  assert.equal(thinCheck.status, "warn");
  assert.match(thinCheck.fix, /not indexed/);
});

test("the corrected title fixes what a rule can and reports what it cannot", () => {
  const { text, notes, changed } = cleanTitle(
    "PACKSTER Laptop Backpack!! Best Seller ~ 30L Bag with USB Port {Grey}",
    "Packster", 200,
  );
  assert.ok(changed);
  assert.ok(!/[!{}~]/.test(text));
  assert.ok(!/best seller/i.test(text));
  assert.ok(text.startsWith("Packster"), text);
  assert.ok(text.includes("USB"));               // acronym survives
  assert.ok(notes.some(n => /disallowed characters/i.test(n)));
});

test("removing a phrase does not leave its punctuation behind", () => {
  const { text } = cleanTitle(
    "Packster Canvas Backpack, Free Shipping, 30 Litre Water Resistant Bag, Grey",
    "Packster", 200,
  );
  assert.ok(!/,\s*,/.test(text), text);
  assert.equal(text, "Packster Canvas Backpack, 30 Litre Water Resistant Bag, Grey");
});

test("the corrected title is trimmed on a word boundary, inside the limit", () => {
  const long = "Packster Canvas Laptop Backpack for Men and Women 30 Litre Water Resistant College Bag Padded Sleeve";
  const { text } = cleanTitle(long, "Packster", 60);
  assert.ok(text.length <= 60);
  assert.ok(!text.endsWith(" "));
  assert.ok(long.startsWith(text), "trimmed, not reworded");
});

test("the corrected title puts a missing brand at the front", () => {
  const { text, notes } = cleanTitle("Canvas Laptop Backpack 30 Litre Grey", "Packster", 200);
  assert.equal(text, "Packster Canvas Laptop Backpack 30 Litre Grey");
  assert.ok(notes.some(n => n.includes("front")));
});

test("a title needing nothing is left exactly as it is", () => {
  const original = listing().title;
  const { text, changed } = cleanTitle(original, "Packster", 200);
  assert.equal(changed, false);
  assert.equal(text, original);
});

test("keyword gaps show body words the title is missing", () => {
  const gaps = keywordGaps(listing()).map(g => g.word);
  assert.ok(gaps.includes("straps"), gaps.join(", "));
  assert.ok(gaps.includes("compartment"), gaps.join(", "));
  assert.ok(!gaps.includes("backpack"));   // already in the title
  assert.ok(!gaps.includes("padded"));     // already in the title
  assert.ok(!gaps.includes("with"));       // stop word
});

test("grades follow the score", () => {
  assert.equal(gradeFor(95), "A");
  assert.equal(gradeFor(75), "B");
  assert.equal(gradeFor(60), "C");
  assert.equal(gradeFor(41), "D");
  assert.equal(gradeFor(10), "E");
});

test("the text report carries the score, the failures and the rewrite", () => {
  const item = listing({ title: "PACKSTER Backpack!! Best Seller", images: 1 });
  const text = reportToText(auditListing(item), item);
  assert.match(text, /Listing audit — B0TEST1234 \(India\)/);
  assert.match(text, /Score: \d+\/100/);
  assert.match(text, /FAIL/);
  assert.match(text, /Corrected title:/);
});
