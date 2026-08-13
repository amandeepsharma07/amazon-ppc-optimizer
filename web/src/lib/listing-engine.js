/* GENERATED FILE — DO NOT EDIT.
 *
 * Copied from extension/src/audit.js by scripts/sync-listing-engine.mjs, which
 * runs on every build. Edit the original; this copy is overwritten.
 *
 * It exists because the web app and the Chrome extension must apply identical
 * listing rules, and Vercel's build cannot see outside the web folder.
 */
/**
 * Scores an Amazon product detail page against Amazon's own listing rules.
 *
 * The engine is deliberately pure: it takes a plain object describing a
 * listing and returns a report. Nothing here touches the DOM, the network or
 * chrome.* APIs, so the same code runs in the extension, in a unit test, and
 * (later) anywhere else the same numbers are wanted.
 *
 * Two design rules matter more than the individual checks:
 *
 *   1. **Never penalise what could not be read.** Amazon's markup differs by
 *      marketplace, category and A/B test. A check whose input is missing is
 *      reported as unreadable and dropped from the denominator, so a scraping
 *      gap shows up as "6 checks couldn't be read" rather than a bad score.
 *
 *   2. **Separate policy from opinion.** Failing a policy check means the
 *      listing risks suppression; failing a style check means it converts
 *      worse than it could. They are weighted differently and labelled
 *      differently, because only one of them gets a listing taken down.
 */

/** Amazon domains this understands, and the marketplace each one is. */
export const MARKETPLACE_HOSTS = {
  "amazon.com": { code: "US", label: "United States", currency: "$" },
  "amazon.in": { code: "IN", label: "India", currency: "₹" },
  "amazon.ca": { code: "CA", label: "Canada", currency: "$" },
  "amazon.com.mx": { code: "MX", label: "Mexico", currency: "$" },
  "amazon.com.br": { code: "BR", label: "Brazil", currency: "R$" },
  "amazon.co.uk": { code: "UK", label: "United Kingdom", currency: "£" },
  "amazon.de": { code: "DE", label: "Germany", currency: "€" },
  "amazon.fr": { code: "FR", label: "France", currency: "€" },
  "amazon.it": { code: "IT", label: "Italy", currency: "€" },
  "amazon.es": { code: "ES", label: "Spain", currency: "€" },
  "amazon.nl": { code: "NL", label: "Netherlands", currency: "€" },
  "amazon.se": { code: "SE", label: "Sweden", currency: "kr" },
  "amazon.pl": { code: "PL", label: "Poland", currency: "zł" },
  "amazon.com.tr": { code: "TR", label: "Turkey", currency: "₺" },
  "amazon.ae": { code: "AE", label: "United Arab Emirates", currency: "AED" },
  "amazon.sa": { code: "SA", label: "Saudi Arabia", currency: "SAR" },
  "amazon.sg": { code: "SG", label: "Singapore", currency: "$" },
  "amazon.com.au": { code: "AU", label: "Australia", currency: "$" },
  "amazon.co.jp": { code: "JP", label: "Japan", currency: "¥" },
};

/**
 * Longest title Amazon accepts before suppression risk, per marketplace.
 *
 * 200 characters is the general limit and the one Amazon states most often.
 * A number of categories are stricter, so the popup lets it be overridden;
 * the check reports which figure it used.
 */
export const TITLE_LIMITS = { JP: 128 };
export const DEFAULT_TITLE_LIMIT = 200;

/** Below this a title is leaving indexable words on the table. */
const TITLE_MIN = 60;

export function titleLimitFor(code) {
  return TITLE_LIMITS[code] ?? DEFAULT_TITLE_LIMIT;
}

export function marketplaceFromHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  for (const [domain, mk] of Object.entries(MARKETPLACE_HOSTS)) {
    if (host === domain || host.endsWith("." + domain)) return { domain, ...mk };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Policy vocabulary
 * ------------------------------------------------------------------ */

/**
 * Phrases Amazon disallows in listing copy. These are matched as phrases
 * rather than single words on purpose: the word list used for backend search
 * terms is far broader, and applying it here would flag "free of BPA" or
 * "natural leather", which are ordinary product copy rather than violations.
 */
const PROHIBITED_PHRASES = [
  { re: /\bbest[\s-]*sell(?:er|ing)\b/i, why: "Ranking claim Amazon reserves for its own badges" },
  { re: /\b(?:#\s*1|no\.?\s*1|number\s+one)\b/i, why: "Unverifiable ranking claim" },
  { re: /\btop[\s-]*rated\b/i, why: "Unverifiable ranking claim" },
  { re: /\bfree\s+ship(?:ping|ment)\b/i, why: "Shipping and fulfilment claims are not allowed in listing copy" },
  { re: /\bfast\s+delivery\b/i, why: "Delivery claims are not allowed in listing copy" },
  { re: /\bon\s+sale\b|\bsale\s+price\b|\bclearance\b/i, why: "Pricing and promotional language is not allowed" },
  { re: /\b(?:\d{1,3}\s*%\s*off|discount(?:ed)?)\b/i, why: "Pricing and promotional language is not allowed" },
  { re: /\blimited\s+(?:time|period|offer)\b/i, why: "Time-limited promotional language is not allowed" },
  { re: /\bmoney[\s-]*back\s+guarantee\b/i, why: "Guarantee claims belong in your returns policy, not the listing" },
  { re: /\b100\s*%\s*(?:guarantee|satisfaction)/i, why: "Unverifiable satisfaction claim" },
  { re: /\blifetime\s+(?:warranty|guarantee)\b/i, why: "Warranty claims in copy need to match your registered terms" },
  { re: /\bfda[\s-]*approved\b/i, why: "Regulatory approval claim — needs documentation Amazon will ask for" },
  { re: /\bclinically\s+(?:proven|tested)\b/i, why: "Medical claim — needs documentation Amazon will ask for" },
  // Deliberately narrow: "treats" on its own is a pet-food product, not a claim.
  { re: /\b(?:cures?|heals|healing|treats)\s+(?:acne|pain|cancer|covid|infections?|diseases?|illness|arthritis|allergies|diabetes|asthma|eczema|dandruff|wrinkles|hair\s*fall)\b/i, why: "Medical claim — a common suppression trigger" },
  { re: /\b(?:cure|remedy)\s+for\b/i, why: "Medical claim — a common suppression trigger" },
  { re: /\banti[\s-]*(?:bacterial|microbial|viral)\b/i, why: "Biocidal claim — restricted in most marketplaces without registration" },
  { re: /\beco[\s-]*friendly\b|\b100\s*%\s*(?:natural|organic)\b/i, why: "Environmental claim — restricted without certification" },
];

/** Somebody else's name. Matched word by word after tokenising. */
const TRADEMARKED = new Set([
  "spiderman", "batman", "superman", "ironman", "avengers", "marvel",
  "captainamerica", "disney", "mickey", "minnie", "elsa", "barbie", "pokemon",
  "pikachu", "doraemon", "chhotabheem", "motupatlu", "shinchan", "ben10",
  "peppa", "minions", "hellokitty", "starwars", "harrypotter", "hogwarts",
  "naruto", "nintendo", "hotwheels", "adidas", "gucci", "prada", "chanel",
  "rolex", "samsonite", "skybag", "hilfiger", "levis", "wildcraft",
  "aristocrat", "reebok", "fastrack", "tourister", "decathlon", "quechua",
  "nike", "puma", "apple", "samsung", "sony", "lego",
]);

/** Characters Amazon names explicitly as not allowed in a title. */
const BANNED_TITLE_CHARS = /[!*$?_{}^¬¦~<>|™®©]/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]/u;

/** Short words Amazon's style guide says stay lower case mid-title. */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
  "of", "on", "onto", "or", "over", "per", "the", "to", "up", "via", "with",
]);

/** Upper-case tokens that are units or acronyms, not shouting. */
const ACRONYM = /^(?:[A-Z]{1,3}|XXL|XXXL|USB|LED|LCD|OLED|HDMI|HDPE|ABS|PVC|EVA|TPU|UPF|SPF|IPX\d|BPA|LDPE|RFID|GSM|MAH|WIFI)\d*$/;

/**
 * Routes off Amazon. The phone pattern is validated rather than trusted:
 * "Fits sizes 40 41 42 43 44 45" matches any loose digit-and-space regex, and
 * flagging a size chart as a phone number would make the whole check ignorable.
 */
const CONTACT = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, what: "an email address" },
  { re: /\b(?:https?:\/\/|www\.)\S+/i, what: "a web address" },
  {
    re: /\+?\d[\d\s()-]{7,}\d/,
    what: "a phone number",
    valid: found => {
      const digits = found.replace(/\D/g, "").length;
      const groups = found.trim().split(/[\s()-]+/).filter(Boolean).length;
      return digits >= 10 && digits <= 15 && groups <= 4;
    },
  },
  { re: /\b(?:whatsapp|telegram|instagram|facebook)\b/i, what: "a social media handle" },
];

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "at", "by",
  "with", "from", "is", "are", "it", "its", "this", "that", "your", "you",
]);

/**
 * Ordinary English that carries no product meaning. Used only when suggesting
 * keywords: a listing repeats "does", "each" and "first" as often as it
 * repeats "compartment", and offering those as title candidates would make the
 * suggestion worth ignoring.
 */
const GENERIC = new Set([
  "about", "above", "across", "after", "again", "against", "almost", "along",
  "already", "also", "although", "always", "among", "another", "anything",
  "around", "away", "back", "because", "become", "been", "before", "being",
  "below", "better", "between", "both", "bring", "came", "come", "comes",
  "could", "does", "doing", "done", "down", "during", "each", "either", "else",
  "enough", "especially", "even", "ever", "every", "everything", "few",
  "first", "four", "further", "gets", "getting", "give", "gives", "going",
  "gone", "half", "have", "having", "here", "however", "into", "itself",
  "just", "keep", "keeps", "kept", "know", "last", "later", "least", "left",
  "less", "like", "little", "look", "make", "makes", "making", "many", "more",
  "most", "much", "must", "near", "need", "needs", "never", "next", "nothing",
  "often", "once", "only", "other", "others", "over", "perhaps", "quite",
  "rather", "really", "right", "same", "seen", "several", "shall", "should",
  "since", "some", "something", "soon", "still", "such", "sure", "take",
  "taken", "takes", "taking", "than", "that", "their", "them", "then", "there",
  "these", "they", "thing", "things", "think", "this", "those", "though",
  "three", "through", "thus", "together", "toward", "under", "until", "upon",
  "used", "uses", "using", "usually", "very", "want", "well", "went", "were",
  "what", "when", "where", "whether", "which", "while", "will", "with",
  "within", "without", "work", "works", "would", "your", "yours",
]);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function tokens(text) {
  return String(text || "").split(/\s+/).filter(Boolean);
}

/** Turns "American Tourister" into the single token a title match produces. */
function squash(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function findPhrases(text, list) {
  const hits = [];
  if (!text) return hits;
  for (const entry of list) {
    const m = text.match(entry.re);
    if (m) hits.push({ phrase: m[0].trim(), why: entry.why });
  }
  return hits;
}

function findContact(text) {
  const hits = [];
  if (!text) return hits;
  for (const entry of CONTACT) {
    const all = text.match(new RegExp(entry.re.source, entry.re.flags.includes("g") ? entry.re.flags : entry.re.flags + "g")) || [];
    const found = all.map(m => m.trim()).find(m => !entry.valid || entry.valid(m));
    if (found) hits.push({ found, what: entry.what });
  }
  return hits;
}

/** Names in the text that belong to somebody other than the seller. */
function foundTrademarks(text, ownBrand) {
  const own = new Set(words(ownBrand || ""));
  const found = new Set();
  const seq = words(text);
  for (const w of seq) {
    if (!own.has(w) && TRADEMARKED.has(w)) found.add(w);
  }
  // Adjacent pairs catch two-word brands like "american tourister".
  for (let i = 0; i < seq.length - 1; i++) {
    const joined = seq[i] + seq[i + 1];
    if (TRADEMARKED.has(joined) && !own.has(joined)) found.add(`${seq[i]} ${seq[i + 1]}`);
  }
  return [...found];
}

/**
 * Every policy problem in a piece of listing copy, in one call.
 *
 * Exported because the audit is not the only thing that needs it: anything
 * proposing copy back to the seller has to screen it first. Handing back a
 * sentence the audit would fail — with a copy button next to it — would be
 * worse than saying nothing.
 */
export function policyIssues(text, ownBrand = "") {
  const issues = [];
  if (!text) return issues;
  for (const hit of findPhrases(text, PROHIBITED_PHRASES)) {
    issues.push({ kind: "claim", found: hit.phrase, why: hit.why });
  }
  for (const name of foundTrademarks(text, ownBrand)) {
    issues.push({ kind: "trademark", found: name, why: "Another brand's name — remove unless you hold a licence" });
  }
  for (const hit of findContact(text)) {
    issues.push({ kind: "contact", found: hit.found, why: `Contains ${hit.what} — enforced at account level, not listing level` });
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

/**
 * A check is scored out of `weight`. Returning `null` for `earned` marks the
 * check unreadable, which removes its weight from the total rather than
 * counting it as a failure.
 */
function check(id, label, weight, kind, result) {
  const unreadable = result.earned === null || result.earned === undefined;
  const earned = unreadable ? null : Math.max(0, Math.min(weight, result.earned));
  let status = "unknown";
  if (!unreadable) {
    status = earned >= weight ? "pass" : earned <= 0 ? "fail" : "warn";
  }
  return {
    id, label, weight, kind, status, earned,
    detail: result.detail || "",
    fix: result.fix || "",
    evidence: result.evidence || [],
  };
}

function titleChecks(listing, titleLimit) {
  const title = listing.title;
  const out = [];
  const missing = { earned: null, detail: "The title could not be read from this page." };

  out.push(check("title-length", `Title length within ${titleLimit} characters`, 8, "policy",
    title === null || title === undefined ? missing : (() => {
      const len = title.length;
      if (len > titleLimit) {
        return {
          earned: 0,
          detail: `${len} characters — ${len - titleLimit} over the limit.`,
          fix: `Cut ${len - titleLimit} characters. Over-length titles are a standard suppression trigger.`,
        };
      }
      if (len < TITLE_MIN) {
        return {
          earned: 4,
          detail: `${len} characters — short enough that indexable words are being left unused.`,
          fix: `Add material detail up to about ${titleLimit} characters: size, material, quantity, compatibility.`,
        };
      }
      return { earned: 8, detail: `${len} of ${titleLimit} characters.` };
    })()));

  out.push(check("title-caps", "No shouted words in the title", 3, "policy",
    title == null ? missing : (() => {
      const shouted = tokens(title).filter(t => {
        const bare = t.replace(/[^A-Za-z]/g, "");
        return bare.length >= 4 && bare === bare.toUpperCase() && !ACRONYM.test(t.replace(/[^\w]/g, ""));
      });
      if (!shouted.length) return { earned: 3, detail: "No all-capitals words." };
      return {
        earned: 0,
        detail: `${shouted.length} word${shouted.length > 1 ? "s" : ""} in all capitals.`,
        fix: "Amazon's style guide forbids all-capitals words. Use Title Case.",
        evidence: shouted.slice(0, 8),
      };
    })()));

  out.push(check("title-promo", "No promotional or unverifiable claims in the title", 4, "policy",
    title == null ? missing : (() => {
      const hits = findPhrases(title, PROHIBITED_PHRASES);
      if (!hits.length) return { earned: 4, detail: "No prohibited claims found." };
      return {
        earned: 0,
        detail: `${hits.length} prohibited phrase${hits.length > 1 ? "s" : ""} in the title.`,
        fix: "Remove these. Claims in the title are the fastest route to suppression.",
        evidence: hits.map(h => `"${h.phrase}" — ${h.why}`),
      };
    })()));

  out.push(check("title-chars", "No disallowed characters or emoji", 3, "policy",
    title == null ? missing : (() => {
      const bad = [...new Set(title.match(BANNED_TITLE_CHARS) || [])];
      const emoji = EMOJI.test(title);
      if (!bad.length && !emoji) return { earned: 3, detail: "Characters are all allowed." };
      const found = [...bad];
      if (emoji) found.push("emoji");
      return {
        earned: 0,
        detail: `Disallowed characters present: ${found.join(" ")}`,
        fix: "Amazon names these explicitly as not permitted in titles. Remove them.",
        evidence: found,
      };
    })()));

  out.push(check("title-brand", "Brand leads the title", 3, "style",
    title == null || !listing.brand ? { earned: null, detail: "Brand or title could not be read." } : (() => {
      const brand = squash(listing.brand);
      const start = squash(title.slice(0, Math.max(brand.length + 6, 24)));
      if (brand && start.startsWith(brand)) return { earned: 3, detail: `Title opens with "${listing.brand}".` };
      if (squash(title).includes(brand)) {
        return {
          earned: 1,
          detail: `"${listing.brand}" appears in the title but not at the start.`,
          fix: "Amazon's style guide puts the brand first. It also anchors the mobile truncation.",
        };
      }
      return {
        earned: 0,
        detail: `"${listing.brand}" is missing from the title.`,
        fix: "Start the title with the brand.",
      };
    })()));

  out.push(check("title-repeats", "No repeated words in the title", 4, "policy",
    title == null ? missing : (() => {
      const counts = new Map();
      for (const w of words(title)) {
        if (STOP_WORDS.has(w) || w.length < 3) continue;
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      const repeated = [...counts.entries()].filter(([, n]) => n >= 3);
      const twice = [...counts.entries()].filter(([, n]) => n === 2);
      if (repeated.length) {
        return {
          earned: 0,
          detail: `${repeated.length} word${repeated.length > 1 ? "s" : ""} repeated three or more times.`,
          fix: "Amazon indexes a word once however often it appears. Repetition reads as keyword stuffing and buys nothing.",
          evidence: repeated.map(([w, n]) => `${w} (${n}×)`),
        };
      }
      if (twice.length > 2) {
        return {
          earned: 2,
          detail: `${twice.length} words appear twice.`,
          fix: "Replace the duplicates with words the title does not have yet — each one is free indexing.",
          evidence: twice.map(([w]) => w).slice(0, 8),
        };
      }
      return { earned: 4, detail: "No wasteful repetition." };
    })()));

  return out;
}

function bulletChecks(listing) {
  const bullets = listing.bullets;
  const missing = { earned: null, detail: "Bullet points could not be read from this page." };
  const out = [];

  out.push(check("bullet-count", "Five bullet points present", 6, "style",
    bullets === null || bullets === undefined ? missing : (() => {
      const n = bullets.length;
      if (n >= 5) return { earned: 6, detail: `${n} bullet points.` };
      if (n === 0) {
        return { earned: 0, detail: "No bullet points at all.", fix: "Add five. This is the block shoppers read before anything else." };
      }
      return {
        earned: Math.round((n / 5) * 6),
        detail: `${n} of 5 bullet points.`,
        fix: `Add ${5 - n} more. Amazon shows five and every one is indexed.`,
      };
    })()));

  out.push(check("bullet-length", "Bullets carry enough detail", 5, "style",
    bullets == null ? missing : bullets.length === 0
      ? { earned: 0, detail: "No bullets to measure.", fix: "Write five bullets of roughly 150-250 characters." }
      : (() => {
        const thin = bullets.map((b, i) => ({ i: i + 1, len: b.length })).filter(b => b.len < 80);
        const bloated = bullets.map((b, i) => ({ i: i + 1, len: b.length })).filter(b => b.len > 500);
        if (!thin.length && !bloated.length) {
          const avg = Math.round(bullets.reduce((s, b) => s + b.length, 0) / bullets.length);
          return { earned: 5, detail: `Averaging ${avg} characters each.` };
        }
        const evidence = [
          ...thin.map(b => `Bullet ${b.i}: ${b.len} characters — too thin`),
          ...bloated.map(b => `Bullet ${b.i}: ${b.len} characters — over the 500 limit`),
        ];
        return {
          earned: bloated.length ? 0 : 2,
          detail: `${evidence.length} bullet${evidence.length > 1 ? "s" : ""} outside the useful range.`,
          fix: "Aim for 150-250 characters: one benefit, then the fact that proves it.",
          evidence,
        };
      })()));

  out.push(check("bullet-promo", "No prohibited claims in the bullets", 3, "policy",
    bullets == null ? missing : (() => {
      const hits = [];
      bullets.forEach((b, i) => {
        for (const h of findPhrases(b, PROHIBITED_PHRASES)) hits.push(`Bullet ${i + 1}: "${h.phrase}" — ${h.why}`);
      });
      if (!hits.length) return { earned: 3, detail: "No prohibited claims found." };
      return { earned: 0, detail: `${hits.length} prohibited phrase${hits.length > 1 ? "s" : ""}.`, fix: "Rewrite these as verifiable product facts.", evidence: hits };
    })()));

  out.push(check("bullet-contact", "No contact details in the bullets", 3, "policy",
    bullets == null ? missing : (() => {
      const hits = [];
      bullets.forEach((b, i) => {
        for (const h of findContact(b)) hits.push(`Bullet ${i + 1} contains ${h.what}: ${h.found}`);
      });
      if (!hits.length) return { earned: 3, detail: "No contact details." };
      return {
        earned: 0,
        detail: "Contact details in listing copy breach Amazon's off-Amazon selling policy.",
        fix: "Remove them. This is an account-level risk, not just a listing one.",
        evidence: hits,
      };
    })()));

  out.push(check("bullet-caps", "Bullets are not shouted", 3, "style",
    bullets == null ? missing : (() => {
      const shouted = [];
      bullets.forEach((b, i) => {
        const letters = b.replace(/[^A-Za-z]/g, "");
        if (letters.length > 20 && letters === letters.toUpperCase()) shouted.push(`Bullet ${i + 1} is entirely upper case`);
      });
      if (!shouted.length) return { earned: 3, detail: "Sentence case throughout." };
      return {
        earned: 0,
        detail: `${shouted.length} bullet${shouted.length > 1 ? "s" : ""} in capitals.`,
        fix: "Capitalise the opening phrase only. Full capitals measurably reduce reading.",
        evidence: shouted,
      };
    })()));

  return out;
}

function mediaChecks(listing) {
  const out = [];

  out.push(check("image-count", "Enough images", 10, "style",
    listing.images === null || listing.images === undefined
      ? { earned: null, detail: "The image gallery could not be read." }
      : (() => {
        const n = listing.images;
        if (n >= 7) return { earned: 10, detail: `${n} images.` };
        if (n >= 5) return { earned: 7, detail: `${n} images.`, fix: "Seven or more fills the gallery on both mobile and desktop." };
        if (n >= 3) return { earned: 4, detail: `${n} images.`, fix: "Add lifestyle, scale, detail and an in-use shot. Images move conversion more than copy." };
        return { earned: 0, detail: `${n} image${n === 1 ? "" : "s"}.`, fix: "This is the single biggest conversion gap on the page. Get to at least seven." };
      })()));

  out.push(check("video", "Product video present", 5, "style",
    listing.hasVideo === null || listing.hasVideo === undefined
      ? { earned: null, detail: "Video presence could not be read." }
      : listing.hasVideo
        ? { earned: 5, detail: "A video is on the listing." }
        : { earned: 0, detail: "No video.", fix: "Brand-registered sellers can add one free. It is the highest-yield unused slot on most listings." }));

  return out;
}

function contentChecks(listing) {
  const out = [];

  out.push(check("aplus", "A+ content present", 8, "style",
    listing.aplus === null || listing.aplus === undefined
      ? { earned: null, detail: "A+ content could not be detected." }
      : listing.aplus
        ? { earned: 8, detail: "A+ content is published." }
        : {
          earned: 0,
          detail: "No A+ content.",
          fix: "Brand Registry includes it at no cost. It replaces the plain description and is the largest single block on the page.",
        }));

  out.push(check("description", "Description carries substance", 7, "style",
    listing.description === null || listing.description === undefined
      ? (listing.aplus
        ? { earned: 7, detail: "A+ content is standing in for the description, which is how Amazon renders it." }
        : { earned: null, detail: "The description could not be read." })
      : (() => {
        const n = words(listing.description).length;
        if (n >= 120) return { earned: 7, detail: `${n} words.` };
        if (n >= 40) return { earned: 4, detail: `${n} words — thin.`, fix: "Work up to 120+ words. It is indexed, unlike A+ content." };
        if (listing.aplus) {
          return { earned: 4, detail: `${n} words, with A+ content above it.`, fix: "A+ content is not indexed for search. Keep a written description underneath it carrying the keywords." };
        }
        return { earned: 0, detail: `${n} words.`, fix: "Write at least 120 words. This is indexed text you are currently not using." };
      })()));

  return out;
}

function policyChecks(listing) {
  const all = [listing.title, ...(listing.bullets || []), listing.description]
    .filter(Boolean).join("\n");
  const readable = Boolean(all.trim());
  const out = [];

  out.push(check("policy-claims", "No restricted claims anywhere on the listing", 6, "policy",
    !readable ? { earned: null, detail: "No listing copy could be read." } : (() => {
      const hits = findPhrases(all, PROHIBITED_PHRASES);
      if (!hits.length) return { earned: 6, detail: "No restricted claims across title, bullets and description." };
      return {
        earned: hits.length >= 3 ? 0 : 2,
        detail: `${hits.length} restricted claim${hits.length > 1 ? "s" : ""} across the listing.`,
        fix: "Each of these can trigger a suppression on review. Replace with a fact you can evidence.",
        evidence: hits.map(h => `"${h.phrase}" — ${h.why}`),
      };
    })()));

  out.push(check("policy-trademarks", "No other brands named", 5, "policy",
    !readable ? { earned: null, detail: "No listing copy could be read." } : (() => {
      const found = foundTrademarks(all, listing.brand);
      if (!found.length) return { earned: 5, detail: "No competitor or licensed names found." };
      return {
        earned: 0,
        detail: found.length === 1
          ? "A name that belongs to someone else."
          : `${found.length} names that belong to someone else.`,
        fix: "Naming another brand — even as \"compatible with\" — is the most common cause of a listing being pulled. Remove unless you hold a licence.",
        evidence: found,
      };
    })()));

  out.push(check("policy-contact", "No contact or off-Amazon routes anywhere", 4, "policy",
    !readable ? { earned: null, detail: "No listing copy could be read." } : (() => {
      const hits = findContact(all);
      if (!hits.length) return { earned: 4, detail: "Nothing pointing off Amazon." };
      return {
        earned: 0,
        detail: `${hits.length} contact detail${hits.length > 1 ? "s" : ""} in the copy.`,
        fix: "Remove immediately — this is enforced at account level, not listing level.",
        evidence: hits.map(h => `${h.what}: ${h.found}`),
      };
    })()));

  return out;
}

function conversionChecks(listing) {
  const out = [];

  out.push(check("rating", "Star rating", 4, "style",
    listing.rating === null || listing.rating === undefined
      ? { earned: null, detail: "No rating on the page yet." }
      : listing.rating >= 4.3
        ? { earned: 4, detail: `${listing.rating.toFixed(1)} stars.` }
        : listing.rating >= 4.0
          ? { earned: 2, detail: `${listing.rating.toFixed(1)} stars.`, fix: "Below 4.3 the conversion cost is real. Read the 1- and 2-star reviews for the recurring complaint." }
          : { earned: 0, detail: `${listing.rating.toFixed(1)} stars.`, fix: "Fix the product or listing expectation before spending more on ads — traffic to this page converts against you." }));

  out.push(check("reviews", "Review volume", 3, "style",
    listing.reviewCount === null || listing.reviewCount === undefined
      ? { earned: null, detail: "Review count could not be read." }
      : listing.reviewCount >= 50
        ? { earned: 3, detail: `${listing.reviewCount} reviews.` }
        : listing.reviewCount >= 15
          ? { earned: 2, detail: `${listing.reviewCount} reviews.`, fix: "Under 50 reviews still suppresses conversion. Vine or the Request a Review button are the compliant routes." }
          : { earned: 0, detail: `${listing.reviewCount} review${listing.reviewCount === 1 ? "" : "s"}.`, fix: "Too few to carry a shopper. Vine is the fastest compliant way to build the first 30." }));

  out.push(check("buyable", "In stock and buyable", 3, "style",
    listing.inStock === null || listing.inStock === undefined
      ? { earned: null, detail: "Availability could not be read." }
      : listing.inStock
        ? { earned: 3, detail: "In stock." }
        : { earned: 0, detail: "Not currently buyable.", fix: "Out of stock loses ranking daily and no listing work will show while it lasts." }));

  return out;
}

/* ------------------------------------------------------------------ *
 * Title rewrite
 * ------------------------------------------------------------------ */

/**
 * A mechanically corrected title — nothing invented, only the things a rule
 * can fix with certainty removed or normalised. Anything requiring judgement
 * is left alone and reported instead.
 */
export function cleanTitle(title, brand, limit) {
  const notes = [];
  if (!title) return { text: "", notes: ["No title to work from."], changed: false };
  let text = title;

  const bad = [...new Set(text.match(BANNED_TITLE_CHARS) || [])];
  if (bad.length) {
    text = text.replace(BANNED_TITLE_CHARS, " ");
    notes.push(`Removed disallowed characters: ${bad.join(" ")}`);
  }
  if (EMOJI.test(text)) {
    text = text.replace(new RegExp(EMOJI.source, "gu"), " ");
    notes.push("Removed emoji.");
  }

  for (const entry of PROHIBITED_PHRASES) {
    const re = new RegExp(entry.re.source, "gi");
    if (re.test(text)) {
      text = text.replace(re, " ");
      notes.push(`Removed a prohibited claim (${entry.why.toLowerCase()}).`);
    }
  }

  // Shouted words become Title Case; genuine acronyms and units are left alone.
  text = text.split(/(\s+)/).map(tok => {
    const bare = tok.replace(/[^A-Za-z]/g, "");
    if (bare.length >= 4 && bare === bare.toUpperCase() && !ACRONYM.test(tok.replace(/[^\w]/g, ""))) {
      return tok.charAt(0) + tok.slice(1).toLowerCase();
    }
    return tok;
  }).join("");

  // Drop the third and later occurrence of any word — the index only counts one.
  const seen = new Map();
  const kept = [];
  for (const tok of tokens(text)) {
    const key = squash(tok);
    if (!key || key.length < 3 || STOP_WORDS.has(key) || /^\d+$/.test(key)) { kept.push(tok); continue; }
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) continue;
    kept.push(tok);
  }
  if (kept.length !== tokens(text).length) notes.push("Dropped words repeated three or more times.");
  text = kept.join(" ");

  // Removing a phrase leaves its punctuation behind: "Backpack, Free Shipping,
  // 30L" becomes "Backpack, , 30L" unless the orphaned separators are collapsed.
  text = text.replace(/\s*,\s*/g, ", ").replace(/(?:,\s*){2,}/g, ", ");
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
  text = text.replace(/^[,\s-]+|[,\s-]+$/g, "");

  if (brand && !squash(text).startsWith(squash(brand))) {
    if (squash(text).includes(squash(brand))) {
      notes.push(`"${brand}" appears mid-title — move it to the front.`);
    } else {
      text = `${brand} ${text}`;
      notes.push(`Put "${brand}" at the front.`);
    }
  }

  if (text.length > limit) {
    const cut = text.slice(0, limit + 1);
    const at = cut.lastIndexOf(" ");
    text = (at > limit * 0.6 ? cut.slice(0, at) : text.slice(0, limit)).replace(/[,\s-]+$/, "");
    notes.push(`Trimmed to ${text.length} characters, inside the ${limit} limit.`);
  }

  return { text, notes, changed: text !== title };
}

/* ------------------------------------------------------------------ *
 * Keyword coverage — reported, never scored
 * ------------------------------------------------------------------ */

/**
 * Words the listing uses in its bullets or description but not in the title.
 *
 * Not scored: whether a word deserves the title is a judgement about the
 * product, not something a rule can settle. It is shown because the title is
 * the strongest-weighted field on the page and these are the candidates.
 */
export function keywordGaps(listing, take = 12) {
  const inTitle = new Set(words(listing.title || ""));
  const body = [...(listing.bullets || []), listing.description || ""].join(" ");
  const counts = new Map();
  for (const w of words(body)) {
    if (w.length < 4 || STOP_WORDS.has(w) || GENERIC.has(w) || TRADEMARKED.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (inTitle.has(w) || inTitle.has(w.replace(/s$/, "")) || inTitle.has(w + "s")) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  // Ties on count are broken by length: the longer word is the more specific
  // one, and specific is what a title is short of.
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, take)
    .map(([word, count]) => ({ word, count }));
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "title", label: "Title", build: (l, o) => titleChecks(l, o.titleLimit) },
  { id: "bullets", label: "Bullet points", build: l => bulletChecks(l) },
  { id: "media", label: "Images and video", build: l => mediaChecks(l) },
  { id: "content", label: "Description and A+", build: l => contentChecks(l) },
  { id: "policy", label: "Policy compliance", build: l => policyChecks(l) },
  { id: "conversion", label: "Conversion signals", build: l => conversionChecks(l) },
];

export function gradeFor(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "E";
}

/**
 * @param listing  the scraped page, with null for anything unreadable
 * @param options  { titleLimit } — overrides the marketplace default
 */
export function auditListing(listing, options = {}) {
  const code = listing.marketplace?.code || "US";
  const titleLimit = options.titleLimit || titleLimitFor(code);

  const sections = SECTIONS.map(def => {
    const checks = def.build(listing, { titleLimit });
    const scored = checks.filter(c => c.earned !== null);
    const available = scored.reduce((s, c) => s + c.weight, 0);
    const earned = scored.reduce((s, c) => s + c.earned, 0);
    return {
      id: def.id,
      label: def.label,
      checks,
      available,
      earned,
      weight: checks.reduce((s, c) => s + c.weight, 0),
      percent: available ? Math.round((earned / available) * 100) : null,
    };
  });

  const available = sections.reduce((s, x) => s + x.available, 0);
  const earned = sections.reduce((s, x) => s + x.earned, 0);
  const score = available ? Math.round((earned / available) * 100) : null;

  const allChecks = sections.flatMap(s => s.checks.map(c => ({ ...c, section: s.label })));
  const unreadable = allChecks.filter(c => c.earned === null);

  // Policy failures first — those risk the listing coming down — then whatever
  // is costing the most points.
  const fixes = allChecks
    .filter(c => c.earned !== null && c.earned < c.weight)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "policy" ? -1 : 1;
      return (b.weight - b.earned) - (a.weight - a.earned);
    });

  return {
    asin: listing.asin || null,
    marketplace: listing.marketplace || null,
    titleLimit,
    score,
    grade: score === null ? null : gradeFor(score),
    earned,
    available,
    sections,
    fixes,
    unreadable,
    policyFailures: fixes.filter(c => c.kind === "policy" && c.status === "fail").length,
    titleRewrite: cleanTitle(listing.title, listing.brand, titleLimit),
    keywordGaps: keywordGaps(listing),
    generatedAt: new Date().toISOString(),
  };
}

/** A plain-text version of the report, for pasting into a brief or an email. */
export function reportToText(report, listing) {
  const lines = [];
  lines.push(`Listing audit — ${listing.asin || "unknown ASIN"} (${report.marketplace?.label || "unknown marketplace"})`);
  lines.push(listing.url || "");
  lines.push(`Score: ${report.score ?? "n/a"}/100 (${report.grade ?? "-"})`);
  if (report.policyFailures) lines.push(`Policy failures: ${report.policyFailures}`);
  lines.push("");
  for (const section of report.sections) {
    lines.push(`${section.label} — ${section.earned}/${section.available}`);
    for (const c of section.checks) {
      const mark = c.status === "pass" ? "OK  " : c.status === "warn" ? "WARN" : c.status === "fail" ? "FAIL" : "??  ";
      lines.push(`  ${mark} ${c.label}: ${c.detail}`);
      if (c.fix) lines.push(`       -> ${c.fix}`);
      for (const e of c.evidence) lines.push(`       - ${e}`);
    }
    lines.push("");
  }
  if (report.titleRewrite.changed) {
    lines.push("Corrected title:");
    lines.push(report.titleRewrite.text);
    for (const n of report.titleRewrite.notes) lines.push(`  - ${n}`);
    lines.push("");
  }
  if (report.keywordGaps.length) {
    lines.push(`Words used further down but missing from the title: ${report.keywordGaps.map(k => k.word).join(", ")}`);
  }
  return lines.join("\n");
}
