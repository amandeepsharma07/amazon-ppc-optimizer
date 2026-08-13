import { strict as assert } from "node:assert";
import { test } from "node:test";
import { auditListing } from "../../extension/src/audit.js";
import {
  bulletPlan, buildSuggestions, classifyAttributes, localiseSpelling,
  productType, suggestionsToText, titleVariants, workAreas,
} from "../../extension/src/suggest.js";

const IN = { code: "IN", label: "India", currency: "₹" };

function listing(over: Record<string, unknown> = {}) {
  return {
    asin: "B0TEST1234",
    url: "https://www.amazon.in/dp/B0TEST1234",
    marketplace: IN,
    title: "Packster Laptop Backpack, 30 Litre, Grey",
    brand: "Packster",
    categoryLeaf: "Laptop Backpacks",
    attributes: [
      { label: "Brand", value: "Packster" },
      { label: "Material", value: "Water Resistant Canvas" },
      { label: "Capacity", value: "30 Litres" },
      { label: "Colour", value: "Grey" },
      { label: "Target Audience", value: "Men and Women" },
      { label: "Compatible Devices", value: "15.6 Inch Laptops" },
      { label: "Closure", value: "Zip" },
      { label: "Ürün Kodu", value: "PK-30-GR" },
    ],
    bullets: [
      "Holds a 15.6 inch laptop in a padded sleeve that keeps the screen away from the base of the bag, so a knock on the floor does not reach the machine inside it.",
      "Water resistant canvas with a coated backing sheds a monsoon shower on the walk between the station and the office gate rather than soaking through to paper.",
      "Reinforced stitching at both handle joints and the base corners, the two points where a loaded bag gives way first after a year of daily carrying to college.",
    ],
    description: "A canvas backpack with a padded laptop sleeve, an organiser for chargers and two bottle pockets. The straps are padded and the back panel is ventilated.",
    aplus: false,
    images: 4,
    hasVideo: false,
    rating: 4.2,
    reviewCount: 86,
    inStock: true,
    ...over,
  };
}

test("attributes are classified by role, and foreign labels are kept aside", () => {
  const { byRole, unclassified } = classifyAttributes(listing().attributes);
  assert.equal(byRole.get("material")?.value, "Water Resistant Canvas");
  assert.equal(byRole.get("capacity")?.value, "30 Litres");
  assert.equal(byRole.get("colour")?.value, "Grey");
  assert.equal(byRole.get("audience")?.value, "Men and Women");
  // A label in another language is still read, just not usable.
  assert.equal(unclassified.length, 2);           // Brand and the Turkish label
  assert.ok(unclassified.some(p => p.label === "Ürün Kodu"));
});

test("empty attribute values are ignored rather than proposed", () => {
  const { byRole } = classifyAttributes([
    { label: "Material", value: "N/A" },
    { label: "Colour", value: "—" },
    { label: "Capacity", value: "30 Litres" },
  ]);
  assert.equal(byRole.has("material"), false);
  assert.equal(byRole.has("colour"), false);
  assert.equal(byRole.get("capacity")?.value, "30 Litres");
});

test("the product type prefers Amazon's own breadcrumb when the title agrees", () => {
  assert.equal(productType(listing()), "Laptop Backpack");
});

test("the product type falls back to the head of the title", () => {
  const value = productType(listing({
    categoryLeaf: null,
    title: "Packster Canvas Laptop Backpack for Men and Women, 30 Litre, Grey",
  }));
  assert.equal(value, "Canvas Laptop Backpack");    // stops at "for", brand dropped
});

test("three title variants are built, each leading with a different attribute", () => {
  const variants = titleVariants(listing());
  assert.equal(variants.length, 3);
  for (const v of variants) {
    assert.ok(v.text.startsWith("Packster"), v.text);
    assert.ok(v.text.includes("Laptop Backpack"), v.text);
    assert.ok(v.length <= v.limit);
  }
  const [feature, useCase] = variants;
  // The feature-forward one leads on material; the use-case one on audience.
  assert.ok(feature.text.indexOf("Canvas") < feature.text.indexOf("Men and Women"), feature.text);
  assert.ok(useCase.text.indexOf("Men and Women") < useCase.text.indexOf("Canvas"), useCase.text);
});

test("nothing in a suggested title comes from outside the page", () => {
  const item = listing();
  const source = [item.title, item.brand, item.categoryLeaf, item.description,
    ...item.bullets, ...item.attributes.map(a => a.value)].join(" ").toLowerCase();
  const connectors = new Set(["for", "fits", "and", "with", "the"]);
  for (const variant of titleVariants(item)) {
    for (const word of variant.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
      if (!word || connectors.has(word)) continue;
      assert.ok(source.includes(word), `"${word}" is not on the page (${variant.label})`);
    }
  }
});

test("a suggested title never contains what the audit would fail it for", () => {
  const item = listing({
    title: "Packster BEST SELLER Laptop Backpack!!, Free Shipping, Grey",
    attributes: [
      ...listing().attributes,
      { label: "Special Feature", value: "Best in Class Water Resistance" },
    ],
  });
  for (const variant of titleVariants(item)) {
    assert.ok(!/best\s*sell/i.test(variant.text), variant.text);
    assert.ok(!/best in class/i.test(variant.text), variant.text);
    assert.ok(!/free\s+shipping/i.test(variant.text), variant.text);
    assert.ok(!/[!{}~]/.test(variant.text), variant.text);
  }
});

test("a title variant is not padded with a fact the page does not have", () => {
  const bare = titleVariants(listing({
    attributes: [{ label: "Brand", value: "Packster" }],
    categoryLeaf: "Laptop Backpacks",
    bullets: [],
    description: null,
  }));
  for (const variant of bare) {
    // No attributes and no copy to mine: there is nothing to say beyond the name.
    assert.equal(variant.text, "Packster Laptop Backpack");
    assert.equal(variant.thin, true);
    assert.ok(variant.missing.some(m => m.includes("material")));
    assert.ok(variant.missing.some(m => m.includes("capacity")));
  }
});

test("the keyword variant never spends a word an attribute already supplies", () => {
  const keyword = titleVariants(listing()).find(v => v.id === "keyword")!;
  const counts = new Map<string, number>();
  for (const word of keyword.text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(repeated, [], `${keyword.text} repeats ${repeated.map(r => r[0]).join(", ")}`);
});

test("India gets Indian spellings, other marketplaces are left alone", () => {
  assert.equal(localiseSpelling("Grey color, 30 liters, fiber lining", "IN"), "Grey colour, 30 litres, fibre lining");
  assert.equal(localiseSpelling("Gray color", "US"), "Gray color");
});

test("existing bullets are sorted into the five roles, never rewritten", () => {
  const item = listing();
  const { plan, covered } = bulletPlan(item);
  assert.equal(plan.length, 5);
  assert.equal(covered, 3);

  for (const slot of plan.filter(s => s.status === "reworked")) {
    const body = slot.label ? slot.text.slice(slot.label.length + 3) : slot.text;
    // The sentence is the seller's own, word for word.
    assert.ok(item.bullets.includes(body), body);
    assert.ok(slot.label === null || slot.label === slot.label.toUpperCase());
  }
});

test("the material bullet lands in the slot that asks for material", () => {
  const { plan } = bulletPlan(listing());
  const slot3 = plan.find(s => s.slot === 3);
  assert.equal(slot3.status, "reworked");
  assert.match(slot3.text, /canvas/i);
});

test("an empty slot states the facts the page already has for it", () => {
  const { plan } = bulletPlan(listing({ bullets: [] }));
  assert.equal(plan.every(s => s.status === "missing"), true);
  const slot4 = plan.find(s => s.slot === 4);
  assert.ok(slot4.facts.some(f => f.includes("Men and Women")));
  assert.match(slot4.note, /write the sentence around them/);
});

test("a slot with no bullet and no supporting attribute says so plainly", () => {
  const { plan } = bulletPlan(listing({
    bullets: [],
    attributes: [{ label: "Material", value: "Canvas" }],
  }));
  const slot4 = plan.find(s => s.slot === 4);   // no audience, size or compatibility
  assert.deepEqual(slot4.facts, []);
  assert.match(slot4.note, /a fact only you have/);
});

test("a bullet that breaks policy is never offered back as copy", () => {
  const { plan, blocked } = bulletPlan(listing({
    bullets: [
      "Better than American Tourister at half the price. Any issue, WhatsApp us on +91 98765 43210 for a fast replacement.",
      ...listing().bullets,
    ],
  }));
  assert.equal(blocked, 1);
  const stopped = plan.find(s => s.status === "blocked")!;
  assert.equal(stopped.text, null, "no text means no copy button beside a violation");
  assert.ok(stopped.violations.some(v => /tourister/i.test(v)));
  assert.ok(stopped.violations.some(v => /phone number/i.test(v)));
  assert.match(stopped.note, /cannot be reused/i);

  // And nothing anywhere in the plan carries the offending words.
  const offered = plan.map(s => s.text).filter(Boolean).join(" ");
  assert.ok(!/tourister/i.test(offered));
  assert.ok(!/98765/.test(offered));
});

test("bullets beyond the five slots are surfaced, not discarded", () => {
  const extra = Array.from({ length: 7 }, (_, i) => `Bullet number ${i + 1} about the product and its use.`);
  const { plan, unused } = bulletPlan(listing({ bullets: extra }));
  assert.equal(plan.filter(s => s.status === "reworked").length, 5);
  assert.equal(unused.length, 2);
});

test("work areas rank by points recoverable and carry a measured headroom", () => {
  const item = listing();
  const areas = workAreas(auditListing(item), item);
  const names = areas.map(a => a.area);
  assert.ok(names.includes("Title"));
  assert.ok(names.includes("Backend search terms"));
  // Sorted by what is recoverable, so the first area is worth at least the last.
  assert.ok(areas[0].points >= areas[areas.length - 1].points);

  const title = areas.find(a => a.area === "Title");
  assert.match(title.headroom, /160 of 200 characters unused/);

  const images = areas.find(a => a.area === "Images");
  assert.match(images.headroom, /4 images, no video/);
});

test("everything is copyable as text", () => {
  const item = listing();
  const text = suggestionsToText(buildSuggestions(auditListing(item), item));
  assert.match(text, /WHERE THE ROOM IS/);
  assert.match(text, /TITLE — THREE WAYS TO REBUILD IT/);
  assert.match(text, /Feature-forward/);
  assert.match(text, /BULLET PLAN/);
  assert.match(text, /fact available — Target Audience: Men and Women/);
});
