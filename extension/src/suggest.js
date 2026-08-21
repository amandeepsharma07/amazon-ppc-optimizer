/**
 * Turns an audit into something to actually do: where the room is, three ways
 * to rebuild the title, and a five-slot plan for the bullets.
 *
 * The hard constraint this module works under is that **nothing may be
 * invented**. It has no model behind it — every word it proposes comes off the
 * page it is looking at: the attribute table, the existing copy, the category
 * Amazon files the product under. That is a narrower job than writing, and
 * saying so plainly is part of the output: where a fact is missing, the plan
 * names the gap rather than filling it with something plausible. A listing
 * tool that quietly makes up a material or a capacity is worse than no tool,
 * because the seller publishes it.
 *
 * What that leaves is still most of the work. The title formula, the five
 * bullet roles and the order they go in are structure, not prose, and
 * structure is exactly what a rule can carry.
 */
import { cleanTitle, keywordGaps, policyIssues, titleLimitFor } from "./audit.js";

/* ------------------------------------------------------------------ *
 * Attributes
 * ------------------------------------------------------------------ */

/**
 * Attribute-table labels grouped by the job the value does in a title.
 *
 * Matched in English only. Amazon localises these labels, so on a non-English
 * marketplace the pairs are still read and shown, they simply arrive
 * unclassified — which is reported rather than papered over.
 */
const ROLES = [
  { role: "material", re: /^(material|outer material|inner material|fabric|fabric type|material type|composition)/i },
  { role: "capacity", re: /^(capacity|volume|storage capacity)/i },
  { role: "size", re: /^(size|dimensions|product dimensions|item dimensions|length|width|height)/i },
  { role: "colour", re: /^(colou?r|shade)/i },
  { role: "quantity", re: /^(number of items|number of pieces|pack|package quantity|unit count|quantity)/i },
  { role: "weight", re: /^(weight|item weight|net quantity)/i },
  { role: "audience", re: /^(target audience|department|age range|gender|recommended uses|suitable for)/i },
  { role: "compatibility", re: /^(compatible|compatible devices|compatible phone models|fits|screen size)/i },
  { role: "style", re: /^(style|pattern|shape|design|theme|finish|type)/i },
  { role: "feature", re: /^(special feature|features|specific uses|closure|water resistance|occasion)/i },
  { role: "power", re: /^(voltage|wattage|power source|battery|input)/i },
  { role: "care", re: /^(care instruction|wash|cleaning)/i },
];

/** Values that are on the page but say nothing. */
const EMPTY_VALUE = /^(n\/?a|na|none|not applicable|-{1,}|see below|—)$/i;

export function classifyAttributes(pairs) {
  const byRole = new Map();
  const unclassified = [];
  for (const pair of pairs || []) {
    if (!pair.value || EMPTY_VALUE.test(pair.value)) continue;
    const hit = ROLES.find(r => r.re.test(pair.label));
    if (!hit) { unclassified.push(pair); continue; }
    if (!byRole.has(hit.role)) byRole.set(hit.role, pair);
  }
  return { byRole, unclassified };
}

const value = (byRole, role) => byRole.get(role)?.value ?? null;

/* ------------------------------------------------------------------ *
 * Wording
 * ------------------------------------------------------------------ */

/** Spellings amazon.in shoppers type. Applied only on the India marketplace. */
const INDIAN_ENGLISH = [
  [/\bcolor(s|ed|ing)?\b/gi, m => m.replace(/color/i, "colour")],
  [/\bflavor(s|ed|ing)?\b/gi, m => m.replace(/flavor/i, "flavour")],
  [/\bliter(s)?\b/gi, m => m.replace(/liter/i, "litre")],
  [/\bfiber(s)?\b/gi, m => m.replace(/fiber/i, "fibre")],
  [/\bgray\b/gi, "grey"],
  [/\bjewelry\b/gi, "jewellery"],
  [/\baluminum\b/gi, "aluminium"],
  [/\btraveling\b/gi, "travelling"],
  [/\bmeter(s)?\b/gi, m => m.replace(/meter/i, "metre")],
];

export function localiseSpelling(text, marketplaceCode) {
  if (marketplaceCode !== "IN" || !text) return text;
  let out = text;
  for (const [re, to] of INDIAN_ENGLISH) out = out.replace(re, to);
  return out;
}

function normal(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function wordsOf(text) {
  return normal(text).split(" ").filter(Boolean);
}

/** Title Case, leaving acronyms and anything with a digit alone. */
function titleCase(text) {
  const small = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return String(text || "").split(/\s+/).map((word, i) => {
    if (/\d/.test(word) || word === word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    if (i > 0 && small.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

/* ------------------------------------------------------------------ *
 * What the product is
 * ------------------------------------------------------------------ */

const SINGULAR = text => String(text || "")
  .replace(/\b(\w{4,})ies\b/gi, "$1y")
  .replace(/\b(\w{4,})(ches|shes|xes|ses)\b/gi, "$1$2".slice(0, -2))
  .replace(/\b(\w{3,}[^s])s\b/gi, "$1");

/**
 * The product type: the plainest name for the thing.
 *
 * Amazon's own breadcrumb is preferred when its words appear in the title,
 * because that is the category the listing is actually filed under. Otherwise
 * the head of the title is used — the run of words after the brand and before
 * the first comma or qualifier, which is where the noun phrase sits in every
 * title Amazon's own style guide produces.
 */
export function productType(listing) {
  const title = listing.title || "";
  const titleWords = new Set(wordsOf(title).map(w => SINGULAR(w)));

  const leaf = listing.categoryLeaf;
  if (leaf) {
    const leafWords = wordsOf(leaf).map(w => SINGULAR(w));
    if (leafWords.length && leafWords.every(w => titleWords.has(w))) return titleCase(SINGULAR(leaf));
  }

  if (!title) return leaf ? titleCase(SINGULAR(leaf)) : null;

  let head = title.split(/[,|(–—]/)[0];
  head = head.split(/\s+(?:for|with|by|in|to|-)\s+/i)[0];
  const brandWords = new Set(wordsOf(listing.brand || ""));
  const kept = head.split(/\s+/).filter(w => w && !brandWords.has(normal(w)));
  // Four words is the length of a product name; beyond that it is a description.
  const phrase = kept.slice(0, 4).join(" ").replace(/[^\p{L}\p{N}\s-]/gu, "").trim();
  return phrase ? titleCase(phrase) : (leaf ? titleCase(SINGULAR(leaf)) : null);
}

/* ------------------------------------------------------------------ *
 * Title variants
 * ------------------------------------------------------------------ */

/**
 * Joins the pieces the way a real title is punctuated: the brand, the product
 * type and anything qualifying the noun run together with spaces, and the
 * facts after them are separated by commas. A part whose words have all been
 * said already is dropped — repeating a word buys no extra indexing and costs
 * characters that another fact could have used.
 */
function assemble(head, tail, limit) {
  const used = new Set();
  const take = part => {
    if (!part) return null;
    const cleaned = String(part).replace(/\s+/g, " ").trim().replace(/[,;]+$/, "");
    if (!cleaned) return null;
    const ws = wordsOf(cleaned).map(SINGULAR).filter(w => w.length > 2);
    if (ws.length && ws.every(w => used.has(w))) return null;
    for (const w of ws) used.add(w);
    return cleaned;
  };

  const headParts = head.map(take).filter(Boolean);
  const tailParts = tail.map(take).filter(Boolean);
  const render = () => [headParts.join(" "), ...tailParts].filter(Boolean).join(", ");

  // Over the limit, whole facts come off the end — never half of one.
  while (tailParts.length && render().length > limit) tailParts.pop();
  return render().replace(/\s{2,}/g, " ");
}

/** Words too ordinary to anchor a title fragment. */
const WEAK = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
  "are", "was", "has", "have", "not", "but", "its", "it", "of", "to", "in",
  "on", "at", "by", "so", "if", "or", "as", "is", "be", "them", "they", "does",
  "each", "when", "where", "which", "while", "than", "then", "there", "here",
  "keeps", "keep", "make", "makes", "take", "takes", "get", "gets", "one",
  "two", "more", "most", "very", "just", "also", "even", "still", "over",
  // Verbs and connectives. A fragment ending in one reads as a clipped
  // sentence — "Coated Backing Sheds" — not as a title segment.
  "sheds", "shed", "gives", "give", "holds", "hold", "spread", "spreads",
  "sits", "sit", "adds", "add", "fits", "fit", "works", "work", "helps",
  "help", "lets", "let", "both", "away", "across", "between", "without",
  "rather", "instead", "before", "after", "under", "around", "through",
  // Units are meaningless detached from their number: "15.6 inch" is a fact,
  // "Inch" on its own is noise in a title.
  "inch", "inches", "cm", "mm", "litre", "litres", "liter", "liters", "kg",
  "gram", "grams", "ltr", "ml", "size", "sizes",
]);

/**
 * Two- and three-word fragments the listing's own copy uses and its title does
 * not.
 *
 * Titles are topped up from these rather than from loose words, because
 * "Padded Laptop Sleeve" reads as a title and "padded sleeve organiser
 * ventilated" reads as stuffing. Each fragment is the seller's own phrasing
 * lifted whole out of their bullets or description — nothing is composed.
 */
export function phraseGaps(listing, take = 12) {
  const inTitle = new Set(wordsOf(listing.title || "").map(SINGULAR));
  const source = [...(listing.bullets || []), listing.description || ""].join(". ");
  const counts = new Map();

  for (const clause of source.split(/[.,;:!?()—]+/)) {
    const words = wordsOf(clause);
    for (let n = 3; n >= 2; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const slice = words.slice(i, i + n);
        // Substantial at both ends, and saying something the title does not.
        if (slice.some(w => w.length < 3 || WEAK.has(w))) continue;
        if (slice.every(w => inTitle.has(SINGULAR(w)))) continue;
        const key = slice.join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));

  // Drop a fragment contained in one already kept, so a title cannot carry
  // both "laptop sleeve" and "padded laptop sleeve".
  const kept = [];
  for (const [phrase] of ranked) {
    if (kept.some(k => k.includes(phrase) || phrase.includes(k))) continue;
    kept.push(phrase);
    if (kept.length >= take) break;
  }
  return kept;
}

/**
 * Fills the space a title leaves unused.
 *
 * Assembled from three attributes, a title lands near 90 characters against a
 * 200-character field, and the missing 110 are the cheapest indexing on the
 * page. Fragments go in only while they fit whole, and the colour — last by
 * convention — keeps its place at the end.
 */
function topUp(head, tail, pool, limit) {
  const spoken = new Set([...head, ...tail].flatMap(part => wordsOf(part).map(SINGULAR)));
  const width = parts => head.join(" ").length + (parts.length ? 2 : 0) + parts.join(", ").length;

  const trailing = tail.length > 1 ? tail.slice(-1) : [];
  const body = tail.length > 1 ? tail.slice(0, -1) : tail.slice();

  // Four is the ceiling. A real title runs to five or six comma-separated
  // segments; past that it stops reading as a description of a product and
  // starts reading as a list of words, which is what shoppers skip.
  let added = 0;
  for (const phrase of pool) {
    if (added >= 4) break;
    const words = wordsOf(phrase).map(SINGULAR);
    if (words.every(w => spoken.has(w))) continue;
    const candidate = titleCase(phrase);
    if (width([...body, candidate, ...trailing]) > limit) continue;
    body.push(candidate);
    for (const w of words) spoken.add(w);
    added += 1;
  }
  return [...body, ...trailing];
}

const VARIANTS = [
  {
    id: "feature",
    label: "Feature-forward",
    note: "Leads with what the product is made of and how big it is. The safest default, and the one that reads best when the buyer is comparing specifications.",
    head: [],
    order: ["material", "capacity", "size", "feature", "style", "audience", "compatibility", "quantity", "colour"],
  },
  {
    id: "use-case",
    label: "Use-case-forward",
    note: "Puts who it is for straight after the product name, where Amazon's own style guide puts it. Stronger where the buyer chooses by occasion rather than by specification.",
    head: ["audience", "compatibility"],
    order: ["feature", "material", "capacity", "style", "size", "quantity", "colour"],
  },
  {
    id: "keyword",
    label: "Keyword-heavy",
    note: "Packs the words your own bullets and description use that the title currently does not. Widest indexing, at some cost to how it reads.",
    head: [],
    gapsFirst: true,
    order: ["material", "feature", "capacity", "style", "audience", "size", "quantity", "colour"],
  },
];

/**
 * Three rebuilt titles, following [Brand] + [Product type] + [Attributes] and
 * differing in which attribute leads.
 *
 * Every variant is put through the same policy filter the audit uses, so a
 * suggestion can never contain something the audit would then fail.
 */
export function titleVariants(listing, options = {}) {
  const code = listing.marketplace?.code || "US";
  const limit = options.titleLimit || titleLimitFor(code);
  const { byRole } = classifyAttributes(listing.attributes);
  const type = productType(listing);
  const brand = listing.brand;

  const gaps = keywordGaps(listing, 8).map(g => g.word);
  // The pool every variant fills its unused characters from.
  const pool = phraseGaps(listing);
  const missing = [];
  if (!brand) missing.push("the brand — it could not be read from the page");
  if (!type) missing.push("a product type — neither the title nor the breadcrumb gave one");
  for (const role of ["material", "capacity", "size", "colour"]) {
    if (!value(byRole, role)) missing.push(`a ${role} attribute — add it to the listing and every title below gets stronger`);
  }

  const phrase = (role, raw) => {
    if (role === "audience") return `for ${raw}`;
    if (role === "compatibility") return `fits ${raw}`;
    return raw;
  };

  return VARIANTS.map(variant => {
    const head = [brand, type];
    for (const role of variant.head) {
      const raw = value(byRole, role);
      if (raw) head.push(phrase(role, raw));
    }
    const tail = [];
    for (const role of variant.order) {
      const raw = value(byRole, role);
      if (raw) tail.push(phrase(role, raw));
    }
    if (variant.gapsFirst && gaps.length) {
      // The keyword variant leads with them; every variant is topped up below.
      // Built after the attributes so a word the attributes already supply is
      // not spent twice — "Canvas Sleeve" beside a "Canvas" material is the
      // repetition the audit itself penalises.
      const spoken = new Set([...head, ...tail].flatMap(part => wordsOf(part).map(SINGULAR)));
      const fresh = gaps.filter(word => !spoken.has(SINGULAR(word))).slice(0, 4);
      if (fresh.length) tail.unshift(titleCase(fresh.join(" ")));
    }

    // A title short of the field is indexing left on the table, so the room is
    // filled from the listing's own phrasing rather than left empty.
    const filled = topUp(head, tail, pool, limit);
    const assembled = localiseSpelling(assemble(head, filled, limit), code);
    // The same corrections the audit would demand, applied before it is shown.
    const corrected = cleanTitle(assembled, brand, limit);
    const text = corrected.text;

    return {
      id: variant.id,
      label: variant.label,
      note: variant.note,
      text,
      length: text.length,
      limit,
      // Under 150 characters on a 200-character field is indexing left unused.
      thin: text.length < Math.min(150, limit * 0.75),
      usedRoles: variant.order.filter(role => value(byRole, role)),
      missing,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Bullet plan
 * ------------------------------------------------------------------ */

/**
 * The five jobs a bullet block has to do, in the order Amazon's own layout
 * rewards: the strongest claim first, because on mobile the rest is behind a
 * tap.
 */
const SLOTS = [
  {
    slot: 1, brief: "Headline feature and the benefit it buys",
    roles: ["feature", "material", "capacity"],
    match: /\b(holds?|fits?|carries|capacity|litre|liter|inch|cm|padded|protects?)\b/i,
  },
  {
    slot: 2, brief: "Second feature, tied to a concrete situation it is used in",
    roles: ["feature", "style", "capacity"],
    match: /\b(commute|travel|office|college|school|daily|outdoor|monsoon|gym|kitchen|use|using)\b/i,
  },
  {
    slot: 3, brief: "Material, measurements and any certification",
    roles: ["material", "size", "weight", "power"],
    match: /\b(material|canvas|leather|steel|cotton|polyester|nylon|bis|isi|fssai|certified|grade|gsm|waterproof|water resistant)\b/i,
  },
  {
    slot: 4, brief: "Who it fits, or what it is compatible with",
    roles: ["audience", "compatibility", "size", "quantity"],
    match: /\b(men|women|kids|boys|girls|unisex|compatible|suitable|adults|fits|size)\b/i,
  },
  {
    slot: 5, brief: "What sets the product apart — construction, testing, or what is in the box",
    roles: ["care", "quantity", "feature"],
    match: /\b(stitch|stitching|reinforced|tested|includes?|box|pack|warranty|care|wash|clean)\b/i,
  },
];

/** A short upper-case lead phrase, taken from the bullet's own words. */
function leadLabel(text, byRole, roles) {
  for (const role of roles) {
    const v = value(byRole, role);
    if (v && wordsOf(text).includes(wordsOf(v)[0])) return v.toUpperCase().slice(0, 32);
  }
  const skip = new Set([
    "with", "that", "this", "from", "your", "have", "into", "when", "them", "they",
    "keeps", "does", "than", "each", "also", "will", "which", "while", "here",
  ]);
  const candidates = wordsOf(text).filter(w => w.length > 3 && !skip.has(w));
  if (!candidates.length) return null;
  // The two longest words in the sentence are, near enough, what it is about.
  const best = [...candidates].sort((a, b) => b.length - a.length).slice(0, 2);
  const ordered = candidates.filter(w => best.includes(w)).slice(0, 2);
  return ordered.join(" ").toUpperCase();
}

const IDEAL_BULLET = { min: 150, max: 250, hard: 500 };

/**
 * Maps the bullets that exist onto the five roles and states what is missing.
 *
 * Existing copy is re-labelled and re-ordered, never rewritten: the sentences
 * are the seller's own facts about their own product, and this has no basis on
 * which to improve them. Empty slots come back as a brief plus whatever
 * attributes the page can supply for them.
 */
export function bulletPlan(listing) {
  const code = listing.marketplace?.code || "US";
  const { byRole } = classifyAttributes(listing.attributes);
  const bullets = (listing.bullets || []).map(b => b.trim()).filter(Boolean);

  /* Bullets are matched to slots by strength of evidence, not by walking the
     slots in order. A bullet about stitching mentions "college" in passing and
     would otherwise be claimed by the use-case slot simply because that slot
     was asked first. Every pairing is scored, the strongest is taken, and ties
     go to the slot that matches fewest bullets overall — the one where this
     bullet is distinctive rather than merely acceptable. */
  const hits = (slot, text) => {
    const found = text.match(new RegExp(slot.match.source, "gi")) || [];
    return new Set(found.map(m => m.toLowerCase())).size;
  };
  const reach = new Map(SLOTS.map(slot => [slot.slot, bullets.reduce((n, b) => n + (hits(slot, b) ? 1 : 0), 0)]));

  const pairs = [];
  for (const slot of SLOTS) {
    bullets.forEach((text, i) => {
      const score = hits(slot, text);
      if (score) pairs.push({ slot: slot.slot, i, score, reach: reach.get(slot.slot) });
    });
  }
  pairs.sort((a, b) => b.score - a.score || a.reach - b.reach || a.slot - b.slot);

  const taken = new Set();
  const assigned = new Map();
  for (const pair of pairs) {
    if (taken.has(pair.i) || assigned.has(pair.slot)) continue;
    taken.add(pair.i);
    assigned.set(pair.slot, bullets[pair.i]);
  }

  // Anything left over fills the remaining slots in the order it was written.
  const leftovers = bullets.map((b, i) => ({ b, i })).filter(x => !taken.has(x.i));
  for (const slot of SLOTS) {
    if (assigned.has(slot.slot) || !leftovers.length) continue;
    const next = leftovers.shift();
    taken.add(next.i);
    assigned.set(slot.slot, next.b);
  }

  const plan = SLOTS.map(slot => {
    const text = assigned.get(slot.slot) || null;
    const facts = slot.roles
      .map(role => byRole.get(role))
      .filter(Boolean)
      .map(p => `${p.label}: ${p.value}`);

    if (!text) {
      return {
        slot: slot.slot, brief: slot.brief, status: "missing", label: null, text: null,
        facts, violations: [],
        note: facts.length
          ? "Nothing on the page covers this. The attributes above are what the listing already states — write the sentence around them."
          : "Nothing on the page covers this, and no attribute supports it either. This one needs a fact only you have.",
      };
    }

    /* A sentence the audit fails is not offered back as copy, however well it
       fits the slot. Putting a copy button beside a competitor's brand name or
       a phone number would hand the seller the violation the other tab is
       telling them to remove. */
    const violations = policyIssues(text, listing.brand);
    if (violations.length) {
      return {
        slot: slot.slot, brief: slot.brief, status: "blocked", label: null, text: null,
        facts,
        violations: violations.map(v => `${v.found} — ${v.why}`),
        note: "Your bullet for this slot cannot be reused as it stands: it breaks policy. Rewrite it around the facts, leaving out what is listed above.",
      };
    }

    const label = leadLabel(text, byRole, slot.roles);
    const body = localiseSpelling(text, code);
    const composed = label ? `${label} — ${body}` : body;
    const notes = [];
    if (body.length < IDEAL_BULLET.min) {
      notes.push(`${body.length} characters — around ${IDEAL_BULLET.min} to ${IDEAL_BULLET.max} is where a bullet earns its place. Add the proof behind the claim.`);
    } else if (body.length > IDEAL_BULLET.hard) {
      notes.push(`${body.length} characters — over the ${IDEAL_BULLET.hard} limit and at risk of being cut.`);
    }
    if (!label) notes.push("No lead phrase could be taken from this sentence. Open it with the feature in capitals.");
    if (leftovers.length === 0 && assigned.get(slot.slot) !== text) notes.push("Moved from another position.");

    return {
      slot: slot.slot, brief: slot.brief, status: "reworked", label, text: composed,
      facts, violations: [], note: notes.join(" "),
    };
  });

  return {
    plan,
    covered: plan.filter(p => p.status === "reworked").length,
    blocked: plan.filter(p => p.status === "blocked").length,
    // More than five bullets, or ones no slot claimed. Worth showing: they are
    // the seller's own copy and may be better than what a slot ended up with.
    unused: leftovers.map(x => x.b),
  };
}

/* ------------------------------------------------------------------ *
 * Where the room is
 * ------------------------------------------------------------------ */

/**
 * The audit says what is wrong; this says where the unused space is.
 *
 * The two are different questions. A title can pass every policy check and
 * still be using 90 of its 200 characters, which no check fails but is half
 * the indexable field sitting empty. Points recoverable come from the audit;
 * the headroom figures are measured here.
 */
export function workAreas(report, listing) {
  const areas = [];
  const limit = report.titleLimit;
  const { byRole, unclassified } = classifyAttributes(listing.attributes);

  const recoverable = id => {
    const section = report.sections.find(s => s.id === id);
    return section ? section.available - section.earned : 0;
  };

  if (listing.title !== null && listing.title !== undefined) {
    const spare = limit - listing.title.length;
    areas.push({
      area: "Title", points: recoverable("title"),
      headroom: spare > 20 ? `${spare} of ${limit} characters unused` : `${listing.title.length} of ${limit} characters used`,
      detail: spare > 20
        ? "Every character here is indexed and weighted more heavily than anywhere else on the page. This is the cheapest ranking you will ever buy."
        : "The title is close to full. Improving it now means replacing weak words, not adding more.",
    });
  }

  const bullets = listing.bullets;
  if (bullets) {
    const used = bullets.reduce((s, b) => s + b.length, 0);
    const capacity = 5 * IDEAL_BULLET.max;
    areas.push({
      area: "Bullet points", points: recoverable("bullets"),
      headroom: `${used} characters across ${bullets.length} bullet${bullets.length === 1 ? "" : "s"}, against roughly ${capacity} available`,
      detail: used < capacity * 0.6
        ? "Under two-thirds of the block is in use. Bullets are indexed and they are what a shopper reads before deciding."
        : "The block is substantially used. Work on what the sentences say rather than their length.",
    });
  }

  if (listing.images !== null && listing.images !== undefined) {
    areas.push({
      area: "Images", points: recoverable("media"),
      headroom: `${listing.images} image${listing.images === 1 ? "" : "s"}${listing.hasVideo ? " and a video" : ", no video"}`,
      detail: listing.images < 7
        ? `${7 - listing.images} more would fill the gallery. Images move conversion further than any wording change.`
        : "The gallery is full. The remaining gain is in what the images show, not how many there are.",
    });
  }

  const descWords = listing.description ? wordsOf(listing.description).length : 0;
  areas.push({
    area: "Description and A+", points: recoverable("content"),
    headroom: listing.aplus
      ? `A+ published, ${descWords} words of indexed description beneath it`
      : `No A+ content, ${descWords} words of description`,
    detail: listing.aplus && descWords < 120
      ? "A+ content is not indexed for search. The written description underneath it is, and it is nearly empty."
      : listing.aplus
        ? "Both blocks are doing their job."
        : "A+ content is free with Brand Registry and occupies the largest block on the page.",
  });

  const attrCount = (listing.attributes || []).length;
  const classified = byRole.size;
  areas.push({
    area: "Attributes", points: 0,
    headroom: attrCount ? `${attrCount} filled, ${classified} usable for a rebuilt title` : "No attribute table found",
    detail: classified < 4
      ? "Attributes are what a rebuilt title is assembled from, and they drive Amazon's own filters in the left sidebar. Filling them is back-office work with front-of-page effect."
      : "Enough attributes to rebuild the title from. Filling the remaining ones adds filter coverage.",
    unclassified: unclassified.length,
  });

  areas.push({
    area: "Backend search terms", points: 0,
    headroom: "not visible on a product page",
    detail: "The hidden Search Terms field cannot be read from here. Build it from your search term report in the web app, where the words shoppers actually typed are.",
  });

  return areas.sort((a, b) => b.points - a.points);
}

/** Everything the panel adds below the audit, in one call. */
/* ------------------------------------------------------------------ *
 * Backend search terms
 * ------------------------------------------------------------------ */

/** Size of the hidden Search Terms field, in bytes, per marketplace. */
const BYTE_LIMITS = { IN: 200, JP: 500 };
const DEFAULT_BYTES = 250;

const byteLength = text => new TextEncoder().encode(text).length;

/**
 * The hidden Search Terms field, built from what the page itself is missing.
 *
 * The rule that governs this field is that a word already in the title,
 * bullets or description is *already indexed* — spending bytes on it again
 * buys nothing. So the candidates are the opposite of what the title should
 * carry: words the product plainly relates to that the visible copy never
 * says. On a product page, that means the attribute values and the category,
 * which sellers routinely leave out of their prose.
 *
 * This is narrower than the web app's version, which reads the search term
 * report and therefore knows the words shoppers actually typed. What that one
 * has and this cannot is demand data; what this has is that it works on any
 * listing, including a competitor's, with nothing to upload.
 */
export function backendKeywords(listing, options = {}) {
  const code = listing.marketplace?.code || "US";
  const limit = options.byteLimit || BYTE_LIMITS[code] || DEFAULT_BYTES;

  // Everything the page already says, and therefore already indexes.
  const indexed = new Set(
    [listing.title, ...(listing.bullets || []), listing.description, listing.brand]
      .flatMap(part => wordsOf(part || ""))
      .map(SINGULAR)
  );

  const { byRole, unclassified } = classifyAttributes(listing.attributes);
  const candidates = new Map();
  const add = (word, source) => {
    const key = SINGULAR(word.toLowerCase());
    if (key.length < 3 || WEAK.has(key) || indexed.has(key)) return;
    if (/^\d+$/.test(key)) return;
    if (!candidates.has(key)) candidates.set(key, { word: key, source });
  };

  // Attribute values first: stated facts the prose usually skips.
  for (const [role, pair] of byRole) {
    for (const word of wordsOf(pair.value)) add(word, `${role} attribute`);
  }
  for (const pair of unclassified) {
    for (const word of wordsOf(pair.value)) add(word, "attribute");
  }
  // Then the category Amazon files it under.
  for (const word of wordsOf(listing.categoryLeaf || "")) add(word, "category");
  for (const word of wordsOf(listing.category || "")) add(word, "breadcrumb");

  // Anything policy would refuse must never reach the field.
  const kept = [];
  const refused = [];
  for (const entry of candidates.values()) {
    const issues = policyIssues(entry.word, listing.brand);
    if (issues.length) refused.push({ ...entry, reason: issues[0].why });
    else kept.push(entry);
  }

  // Pack greedily; a space is only needed between words.
  const included = [];
  const noRoom = [];
  let bytes = 0;
  for (const entry of kept) {
    const cost = byteLength(entry.word) + (included.length ? 1 : 0);
    if (bytes + cost <= limit) { bytes += cost; included.push(entry); }
    else noRoom.push(entry);
  }

  return {
    text: included.map(e => e.word).join(" "),
    bytes,
    limit,
    included,
    refused,
    noRoom,
    // Said plainly, because a nearly-empty field here is a finding, not a fault.
    note: included.length
      ? "Built from attribute values and the category — words this listing relates to that its own copy never says, and which are therefore not indexed yet."
      : "Nothing to add: every word the page states is already in the visible copy, so it is already indexed. The words worth adding are the ones shoppers type, which live in your search term report — build the field in the web app.",
  };
}

export function buildSuggestions(report, listing, options = {}) {
  return {
    areas: workAreas(report, listing),
    titles: titleVariants(listing, options),
    bullets: bulletPlan(listing),
    backend: backendKeywords(listing, options),
  };
}

/** The suggestions as text, appended to the copied report. */
export function suggestionsToText(suggestions) {
  const lines = ["", "WHERE THE ROOM IS", ""];
  for (const area of suggestions.areas) {
    lines.push(`${area.area}${area.points ? ` (${area.points} points recoverable)` : ""}`);
    lines.push(`  ${area.headroom}`);
    lines.push(`  ${area.detail}`);
    lines.push("");
  }

  lines.push("TITLE — THREE WAYS TO REBUILD IT", "");
  for (const variant of suggestions.titles) {
    lines.push(`--- ${variant.label} (${variant.length}/${variant.limit} characters) ---`);
    lines.push(variant.text || "(nothing on the page to build from)");
    lines.push(`  ${variant.note}`);
    lines.push("");
  }
  const missing = suggestions.titles[0]?.missing ?? [];
  if (missing.length) {
    lines.push("Assembled from the page only — nothing invented. Still missing:");
    for (const m of missing) lines.push(`  - ${m}`);
    lines.push("");
  }

  if (suggestions.backend?.text) {
    lines.push("BACKEND SEARCH TERMS", "");
    lines.push(suggestions.backend.text);
    lines.push(`  ${suggestions.backend.bytes} of ${suggestions.backend.limit} bytes`);
    lines.push("");
  }

  lines.push("BULLET PLAN", "");
  for (const slot of suggestions.bullets.plan) {
    lines.push(`${slot.slot}. ${slot.brief}`);
    if (slot.text) lines.push(`   ${slot.text}`);
    for (const bad of slot.violations || []) lines.push(`   must come out — ${bad}`);
    for (const fact of slot.facts) lines.push(`   fact available — ${fact}`);
    if (slot.note) lines.push(`   note: ${slot.note}`);
    lines.push("");
  }
  if (suggestions.bullets.unused.length) {
    lines.push(`${suggestions.bullets.unused.length} bullet(s) did not fit the five roles:`);
    for (const b of suggestions.bullets.unused) lines.push(`  - ${b}`);
  }
  return lines.join("\n");
}
