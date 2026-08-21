/**
 * Pulls every product visible on the current page into a table.
 *
 * Works on whatever is on screen: search results, a category page, the
 * carousels down a product page, the comparison table. Whatever Amazon has
 * already rendered, this reads.
 *
 * It reads *only* what is rendered. That constraint is the whole reason the
 * extension makes no requests, and it has one visible consequence worth being
 * straight about: **the browse node is per page, not per product.** A search
 * result card does not carry its own node — that lives on each product's own
 * page. Collecting it per ASIN would mean opening every listing, which is
 * exactly the request volume that gets an IP throttled. So the node reported
 * is the one governing the page you are on, labelled as such, and the column
 * is honest about repeating.
 */

const ASIN_RE = /^[A-Z0-9]{10}$/;
const ASIN_IN_HREF = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

const clean = text => String(text ?? "").replace(/\s+/g, " ").trim();

export function isAsin(value) {
  return typeof value === "string" && ASIN_RE.test(value.toUpperCase());
}

export function asinFromHref(href) {
  const m = String(href || "").match(ASIN_IN_HREF);
  return m ? m[1].toUpperCase() : null;
}

/**
 * A count written for humans: "1,204 ratings", "1,20,456", "2.3K".
 * Indian digit grouping is irregular, so every separator is simply dropped.
 */
export function parseCount(text) {
  const value = clean(text);
  if (!value) return null;
  const thousands = value.match(/([\d.]+)\s*[kK]\b/);
  if (thousands) return Math.round(parseFloat(thousands[1]) * 1000);
  const digits = value.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

/**
 * "4.3 out of 5 stars", "4,3 von 5 Sternen", "5つ星のうち4.3".
 *
 * The out-of-five phrasing is required rather than assumed. Without it,
 * "1,204 ratings" parses as a rating of 1.204, and a plausible wrong number is
 * worse in an export than an empty cell — nothing downstream would question it.
 */
export function parseRating(text) {
  const value = clean(text);
  if (!value) return null;
  const forms = [
    /(\d+[.,]\d+|\d+)\s*(?:out of|von|sur|su|de|di|su un totale di|\/)\s*5/i,  // 4.3 out of 5
    /5\D{0,12}?(\d+[.,]\d+|\d)\b/,                                              // 5つ星のうち4.3
    /^(\d(?:[.,]\d+)?)$/,                                                       // a bare number, alone
  ];
  for (const form of forms) {
    const m = value.match(form);
    if (!m) continue;
    const rating = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(rating) && rating >= 0 && rating <= 5) return rating;
  }
  return null;
}

/**
 * The number out of a price string, keeping the original for display.
 *
 * Which separator is the decimal point differs by marketplace and cannot be
 * assumed from the character: ₹1,499 is one thousand four hundred, and so is
 * German 1.499. The rule that settles every case is what follows the last
 * separator — three digits after it means it groups thousands, one or two
 * means it is the decimal point.
 */
export function parsePrice(text) {
  const value = clean(text);
  if (!value) return null;
  const bare = value.replace(/[^\d.,]/g, "");
  if (!bare) return null;

  const lastDot = bare.lastIndexOf(".");
  const lastComma = bare.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  if (last === -1) return finite(parseFloat(bare));

  const trailing = bare.length - last - 1;
  const bothPresent = lastDot !== -1 && lastComma !== -1;
  // Two different separators: the last one is the decimal, whatever it is.
  // One separator followed by exactly three digits: it groups thousands.
  const isDecimal = bothPresent ? true : trailing !== 3;
  if (!isDecimal) return finite(parseFloat(bare.replace(/[.,]/g, "")));
  return finite(parseFloat(bare.slice(0, last).replace(/[.,]/g, "") + "." + bare.slice(last + 1)));
}

const finite = n => (Number.isFinite(n) ? n : null);

/**
 * The browse node governing this page.
 *
 * Amazon states it in several places depending on the page type, and none of
 * them is present everywhere, so each is tried and the source is reported —
 * a node read from the URL is a harder fact than one inferred from a
 * breadcrumb, and the difference is worth showing.
 */
export function browseNodeFromUrl(url) {
  let params;
  try { params = new URL(url).searchParams; } catch { return null; }
  const direct = params.get("node");
  if (direct && /^\d+$/.test(direct)) return { id: direct, source: "URL node parameter" };
  // Refinements arrive as rh=n%3A1234%2Cn%3A5678 — the last is the narrowest.
  const rh = params.get("rh");
  if (rh) {
    const nodes = [...rh.matchAll(/n:(\d+)/g)].map(m => m[1]);
    if (nodes.length) return { id: nodes[nodes.length - 1], source: "URL refinement" };
  }
  return null;
}

function browseNode(doc = document) {
  const fromUrl = browseNodeFromUrl(location.href);
  const crumbs = [...doc.querySelectorAll(
    "#wayfinding-breadcrumbs_feature_div a, .s-breadcrumb .a-link-normal, #nav-subnav a.nav-a"
  )].map(a => clean(a.textContent)).filter(Boolean);
  const path = crumbs.length ? crumbs.join(" > ") : null;

  // The search dropdown names the department when nothing else does.
  const dropdown = doc.querySelector("#searchDropdownBox, #nav-search-dropdown-card select");
  const department = dropdown?.selectedOptions?.[0]
    ? clean(dropdown.selectedOptions[0].textContent) : null;

  if (fromUrl) return { ...fromUrl, path: path || department };
  if (path) return { id: null, path, source: "breadcrumb" };
  if (department && !/all departments/i.test(department)) {
    return { id: null, path: department, source: "search department" };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Reading one card
 * ------------------------------------------------------------------ */

const TITLE_SELECTORS = [
  "h2 a span", "h2 span", "h2",
  "[data-cy='title-recipe'] span",
  ".a-truncate-full", ".p13n-sc-truncate", ".p13n-sc-truncate-desktop-type2",
  "[class*='line-clamp']",
  ".a-size-medium.a-color-base", ".a-size-base-plus.a-color-base",
  "a.a-link-normal[title]",
];

/** Text that is definitely not a product title, however long it runs. */
const NOT_A_TITLE = [
  /^[₹$€£¥]/,                                       // a price
  /out of 5|\bratings?$|\breviews?$/i,
  /^(sponsored|best ?seller|amazon'?s choice|limited time deal|deal of the day)$/i,
  /^(add to cart|buy now|see options|view details|shop now|see all)/i,
  /^\d[\d,.]*$/,                                    // a bare number
  /^(free delivery|get it by|fastest delivery|in stock|currently unavailable|only \d+ left)/i,
  /^(save extra|coupon|\d+% off|m\.r\.p)/i,
];

const looksLikeTitle = (text) =>
  text.length >= 15 && text.length <= 400 && !NOT_A_TITLE.some(re => re.test(text));

/**
 * The longest sensible text in the card.
 *
 * Class names are the least stable thing on an Amazon page — several are
 * build-hashed, and sponsored carousels differ from organic results — so when
 * every named selector misses, the shape of the content is the better guide.
 * A product title is the longest run of text in a card that is not a price, a
 * rating, a badge or a button.
 */
function longestText(card) {
  let best = "";
  for (const el of card.querySelectorAll("span, div, a, p, h2, h3")) {
    // Leaf-ish only, or a wrapper's concatenated children would always win.
    if (el.querySelector("span, div, a, p, h2, h3")) continue;
    const value = clean(el.textContent);
    if (looksLikeTitle(value) && value.length > best.length) best = value;
  }
  return best || null;
}

function titleWithin(card) {
  for (const selector of TITLE_SELECTORS) {
    for (const el of card.querySelectorAll(selector)) {
      const value = clean(el.textContent) || clean(el.getAttribute?.("title"));
      if (value && looksLikeTitle(value)) return value;
    }
  }
  // Sponsored cards commonly carry the whole title on the link or the image,
  // for screen readers, even when the visible text is truncated away.
  for (const el of card.querySelectorAll("a[aria-label], a[title], img[alt]")) {
    const value = clean(
      el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt")
    );
    if (looksLikeTitle(value)) return value;
  }
  return longestText(card);
}

/**
 * The element that actually holds this product's details.
 *
 * The element carrying data-asin is frequently just the image wrapper, with
 * the title, price and rating as its *siblings* — which is why a carousel
 * yielded ASINs and nothing else. The scope widens until it contains a title,
 * and stops before it could swallow a neighbouring product.
 */
function resolveScope(card) {
  let scope = card;
  for (let up = 0; up < 4 && scope; up++) {
    if (titleWithin(scope)) return scope;
    const parent = scope.parentElement;
    if (!parent || parent.querySelectorAll("[data-asin]").length > 1) break;
    scope = parent;
  }
  return card;
}

const cardTitle = card => titleWithin(card);

function cardRating(card) {
  const alt = card.querySelector(".a-icon-alt");
  const rating = parseRating(alt?.textContent);
  if (rating !== null) return rating;
  for (const el of card.querySelectorAll("[aria-label]")) {
    const found = parseRating(el.getAttribute("aria-label"));
    if (found !== null) return found;
  }
  return null;
}

function cardReviews(card) {
  // The count is the link beside the stars; its aria-label spells out the noun.
  for (const el of card.querySelectorAll("[aria-label]")) {
    const label = el.getAttribute("aria-label") || "";
    if (/rating|review|bewertung|avis|reseñ|valoracion|समीक्ष/i.test(label) && /\d/.test(label)) {
      const count = parseCount(label);
      if (count !== null && !/out of|von|sur\s*5/i.test(label)) return count;
    }
  }
  for (const el of card.querySelectorAll("a .a-size-base, .s-underline-text, .a-size-small .a-link-normal")) {
    const text = clean(el.textContent);
    if (/^\(?[\d.,]+\)?[kK]?$/.test(text)) {
      const count = parseCount(text);
      if (count !== null && count > 0) return count;
    }
  }
  return null;
}

function cardPrice(card) {
  const offscreen = card.querySelector(".a-price .a-offscreen, .a-color-price .a-offscreen");
  if (offscreen) return clean(offscreen.textContent);
  // Some cards render the price as ordinary text with no price markup at all.
  const plain = [...card.querySelectorAll("span, div")]
    .filter(el => !el.querySelector("span, div"))
    .map(el => clean(el.textContent))
    .find(t => /^[₹$€£¥]\s?[\d,.]+$/.test(t));
  const whole = card.querySelector(".a-price-whole");
  if (!whole && plain) return plain;
  if (whole) {
    const symbol = clean(card.querySelector(".a-price-symbol")?.textContent);
    const fraction = clean(card.querySelector(".a-price-fraction")?.textContent);
    return `${symbol}${clean(whole.textContent).replace(/[.,]$/, "")}${fraction ? "." + fraction : ""}`;
  }
  return null;
}

function cardSponsored(card) {
  if (card.matches("[data-component-type='sp-sponsored-result']")) return true;
  if (card.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text, .sponsored-brand-label-info")) return true;
  for (const el of card.querySelectorAll("[aria-label], .a-color-secondary")) {
    const text = clean(el.getAttribute?.("aria-label")) || clean(el.textContent);
    if (/^sponsored$|^gesponsert$|^sponsorisé$|^प्रायोजित$/i.test(text)) return true;
  }
  return false;
}

function cardBadge(card) {
  const badge = card.querySelector(".a-badge-text, #acBadge_feature_div .ac-badge-text-primary");
  const text = clean(badge?.textContent);
  return text && text.length < 40 ? text : null;
}

/* ------------------------------------------------------------------ *
 * Finding the cards
 * ------------------------------------------------------------------ */

/**
 * Container elements that represent one product.
 *
 * Amazon marks most of them with data-asin, but not the comparison table or
 * some editorial modules, so links to /dp/ are swept up too and their nearest
 * card-shaped ancestor is used. Ordering follows the document, which is the
 * order the shopper sees — that is what makes the position column mean
 * something.
 */
function productCards(root = document) {
  const found = new Map();   // asin -> { element, asin }

  const consider = (asin, element) => {
    if (!asin || !isAsin(asin)) return;
    if (found.has(asin)) return;
    found.set(asin, { asin, element });
  };

  for (const el of root.querySelectorAll("[data-asin]")) {
    const asin = (el.getAttribute("data-asin") || "").toUpperCase();
    if (!asin) continue;
    consider(asin, el);
  }

  for (const link of root.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")) {
    const asin = asinFromHref(link.getAttribute("href"));
    if (!asin || found.has(asin)) continue;
    // Climb to something card-shaped so the price and rating come with it.
    const card = link.closest(
      "li, .a-carousel-card, [class*='faceout'], td, .a-section, div[data-index]"
    ) || link;
    consider(asin, card);
  }

  return [...found.values()];
}

/**
 * @param options.includeSelf  keep the ASIN of the page itself (a product page
 *                             lists its own ASIN, which is rarely wanted in an
 *                             export of what else is on the page)
 */
export function extractProducts(options = {}) {
  const node = browseNode();
  const selfAsin = asinFromHref(location.href);
  const rows = [];

  for (const { asin, element } of productCards()) {
    if (!options.includeSelf && asin === selfAsin) continue;
    // Widen once, then read every field from the same scope.
    const scope = resolveScope(element);
    const title = cardTitle(scope);
    // A data-asin with nothing readable in it is a placeholder, not a product.
    const price = cardPrice(scope);
    const rating = cardRating(scope);
    const reviews = cardReviews(scope);
    if (!title && price === null && rating === null) continue;

    rows.push({
      position: rows.length + 1,
      asin,
      title,
      price,
      priceValue: parsePrice(price),
      rating,
      reviews,
      sponsored: cardSponsored(scope),
      badge: cardBadge(scope),
      browseNodeId: node?.id ?? null,
      browseNodePath: node?.path ?? null,
      url: `https://${location.hostname}/dp/${asin}`,
    });
  }

  return {
    rows,
    context: {
      url: location.href.split(/[?#]/)[0],
      pageType: pageType(),
      browseNode: node,
      marketplace: location.hostname.replace(/^www\./, ""),
      searchTerm: new URLSearchParams(location.search).get("k"),
      capturedAt: new Date().toISOString(),
    },
    counts: {
      total: rows.length,
      sponsored: rows.filter(r => r.sponsored).length,
      withoutTitle: rows.filter(r => !r.title).length,
    },
  };
}

export function pageType() {
  const path = location.pathname;
  if (/\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/i.test(path)) return "product page";
  if (path.startsWith("/s") || new URLSearchParams(location.search).has("k")) return "search results";
  if (/^\/(?:b|gp\/browse)/.test(path) || new URLSearchParams(location.search).has("node")) return "category page";
  if (path.includes("/stores/")) return "brand store";
  return "page";
}

/* ------------------------------------------------------------------ *
 * Export formats
 * ------------------------------------------------------------------ */

const COLUMNS = [
  ["Position", r => r.position],
  ["ASIN", r => r.asin],
  ["Title", r => r.title ?? ""],
  ["Price", r => r.price ?? ""],
  ["Price value", r => (r.priceValue === null ? "" : r.priceValue)],
  ["Rating", r => (r.rating === null ? "" : r.rating)],
  ["Reviews", r => (r.reviews === null ? "" : r.reviews)],
  ["Sponsored", r => (r.sponsored ? "Yes" : "No")],
  ["Badge", r => r.badge ?? ""],
  ["Browse node ID (page)", r => r.browseNodeId ?? ""],
  ["Browse node path (page)", r => r.browseNodePath ?? ""],
  ["URL", r => r.url],
];

/** Tab-separated: what pastes straight into Excel or Sheets. */
export function rowsToTsv(rows) {
  const clip = v => String(v).replace(/[\t\r\n]+/g, " ");
  return [
    COLUMNS.map(c => c[0]).join("\t"),
    ...rows.map(row => COLUMNS.map(c => clip(c[1](row))).join("\t")),
  ].join("\n");
}

export function rowsToCsv(rows) {
  const quote = value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    COLUMNS.map(c => quote(c[0])).join(","),
    ...rows.map(row => COLUMNS.map(c => quote(c[1](row))).join(",")),
  ].join("\r\n");
}

/** Just the ASINs, one per line — the format every other tool takes. */
export function rowsToAsinList(rows) {
  return rows.map(r => r.asin).join("\n");
}
