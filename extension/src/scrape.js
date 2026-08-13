/**
 * Reads a listing out of the product page currently open in the browser.
 *
 * Everything here is defensive. Amazon's markup varies by marketplace, by
 * category, and between A/B tests running at the same moment, so each field is
 * tried through a list of selectors and returns `null` when none of them
 * matched. `null` means "could not be read" and the audit drops the check
 * rather than scoring it zero — a scraping gap must never look like a listing
 * problem.
 *
 * The one thing that is *not* guessed is whether this is a product page at
 * all: that is decided from the URL, which is stable.
 */
import { marketplaceFromHost } from "./audit.js";

const ASIN_IN_URL = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

export function asinFromUrl(url = location.href) {
  const m = String(url).match(ASIN_IN_URL);
  return m ? m[1].toUpperCase() : null;
}

export function isProductPage(url = location.href) {
  return Boolean(asinFromUrl(url)) && Boolean(marketplaceFromHost(location.hostname));
}

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** First selector that yields non-empty text, or null. */
function text(selectors, root = document) {
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      const value = clean(el.textContent);
      if (value) return value;
    }
  }
  return null;
}

function exists(selectors, root = document) {
  return selectors.some(sel => root.querySelector(sel));
}

/**
 * The byline reads "Visit the Packster Store", "Brand: Packster" or just the
 * brand, and the wording is localised. Strip whatever wraps it.
 */
function parseByline(value) {
  if (!value) return null;
  let out = value;
  // "Visit the X Store" / "Marca: X" / "Brand: X" / "de la marque X"
  out = out.replace(/^(?:visit|besuchen sie|visita|visitez|訪問)\s+(?:the|den|la|le|il)?\s*/i, "");
  out = out.replace(/\s+(?:store|shop|storefront|ストア)\s*$/i, "");
  out = out.replace(/^[^:：]{0,24}[:：]\s*/, "");
  out = out.replace(/^(?:by|von|de|par|di)\s+/i, "");
  out = clean(out);
  return out && out.length <= 60 ? out : null;
}

/**
 * The attribute tables — "Material: Canvas", "Capacity: 30 litres".
 *
 * These matter more than they look: they are the only place on the page where
 * a product's facts are stated as facts rather than buried in prose, which
 * makes them the raw material for rebuilding a title. Read as label/value
 * pairs and classified later, so a marketplace whose labels are not English
 * still yields the pairs even when nothing can be made of them.
 */
function readAttributes() {
  const pairs = [];
  const seen = new Set();
  const add = (label, value) => {
    if (!label || !value) return;
    if (value.length > 120 || label.length > 40) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ label, value });
  };

  const rows = document.querySelectorAll(
    "#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr,"
    + " #productDetails_detailBullets_sections1 tr, .a-normal.a-spacing-micro tr"
  );
  for (const row of rows) {
    const cells = row.querySelectorAll("td, th");
    if (cells.length !== 2) continue;
    add(clean(cells[0].textContent), clean(cells[1].textContent));
  }

  for (const li of document.querySelectorAll("#detailBullets_feature_div li")) {
    const bold = li.querySelector("span.a-text-bold");
    if (!bold) continue;
    // Amazon separates the two halves with directional marks, not a plain colon.
    const label = clean(bold.textContent).replace(/[‎‏‏‎:：\s]+$/g, "");
    const spans = li.querySelectorAll("span span");
    add(label, clean(spans[spans.length - 1]?.textContent));
  }

  return pairs.length ? pairs : null;
}

function brandFromAttributes(pairs) {
  // The label is localised, so it is matched in the languages the marketplaces use.
  for (const { label, value } of pairs || []) {
    if (/^(brand|marca|marque|marke|märke|marka|ブランド|品牌|العلامة)/i.test(label)) return value;
  }
  return null;
}

function readBullets() {
  const container = document.querySelector("#feature-bullets, #featurebullets_feature_div");
  if (!container) return null;
  const items = [];
  for (const li of container.querySelectorAll("li")) {
    if (li.closest(".aok-hidden, .a-hidden")) continue;
    const value = clean(li.textContent);
    if (!value) continue;
    // Amazon's own fitment widget, not seller copy.
    if (/^make sure this fits by entering your model number/i.test(value)) continue;
    if (/^see more product details$/i.test(value)) continue;
    items.push(value);
  }
  return items;
}

function readDescription() {
  const el = document.querySelector(
    "#productDescription, #bookDescription_feature_div, #product-description-iframe"
  );
  if (!el) return null;
  return clean(el.textContent) || "";
}

function readAplus() {
  // These containers only exist when A+ has been published, so their absence
  // on a page that otherwise parsed is a genuine "no", not a read failure.
  const el = document.querySelector(
    "#aplus, #aplus_feature_div, #aplus3p_feature_div, #dpx-aplus-product-description_feature_div, .aplus-v2"
  );
  if (!el) return false;
  const hasContent = clean(el.textContent).length > 40 || el.querySelector("img");
  return Boolean(hasContent);
}

function readImages() {
  const gallery = document.querySelector("#altImages, #imageBlockThumbs, #main-image-container");
  if (!gallery) return { images: null, hasVideo: null };

  const thumbs = document.querySelectorAll("#altImages li.imageThumbnail, #altImages li.item");
  let images = 0;
  let hasVideo = false;
  for (const li of thumbs) {
    if (li.classList.contains("aok-hidden") || li.classList.contains("a-hidden")) continue;
    if (li.classList.contains("videoThumbnail") || li.querySelector(".videoBlockIngress, .a-button-thumbnail-video")) {
      hasVideo = true;
      continue;
    }
    images += 1;
  }

  if (!images) {
    // Some layouts hold the whole gallery in one attribute on the main image.
    const raw = document.querySelector("#landingImage, #imgBlkFront")?.getAttribute("data-a-dynamic-image");
    if (raw) {
      try { images = Object.keys(JSON.parse(raw)).length; } catch { /* leave at zero */ }
    }
    if (!images && document.querySelector("#landingImage, #imgTagWrapperId img")) images = 1;
  }

  if (!hasVideo) {
    hasVideo = exists([
      "#vse-related-videos-container", ".vse-video-block", "#videoCount",
      "#altImages .videoThumbnail", "[data-video-url]",
    ]);
  }

  return { images: images || null, hasVideo };
}

function readRating() {
  const widget = document.querySelector("#averageCustomerReviews, #acrPopover, #reviewsMedley");
  if (!widget) return { rating: null, reviewCount: null };

  const raw = document.querySelector("#acrPopover")?.getAttribute("title")
    || text(["#acrPopover .a-icon-alt", "#averageCustomerReviews .a-icon-alt", "[data-hook='rating-out-of-text']"])
    || "";
  // "4.3 out of 5 stars", "4,3 von 5 Sternen", "4.3 सितारों में से 5"
  const num = raw.match(/(\d+[.,]\d+|\d+)/);
  const rating = num ? parseFloat(num[1].replace(",", ".")) : null;

  const countRaw = text(["#acrCustomerReviewText", "[data-hook='total-review-count']"]) || "";
  const digits = countRaw.replace(/[^\d]/g, "");
  const reviewCount = digits ? parseInt(digits, 10) : (rating === null ? null : 0);

  return { rating: rating !== null && rating <= 5 ? rating : null, reviewCount };
}

function readAvailability() {
  const el = document.querySelector("#availability, #availabilityInsideBuyBox_feature_div, #outOfStock");
  if (!el) {
    // No availability block at all: fall back to whether the page offers a way to buy.
    if (document.querySelector("#add-to-cart-button, #buy-now-button")) return true;
    return null;
  }
  const value = clean(el.textContent).toLowerCase();
  if (!value) return Boolean(document.querySelector("#add-to-cart-button"));
  if (/(currently unavailable|out of stock|temporarily out|nicht verfügbar|no disponible|非表示|अनुपलब्ध)/i.test(value)) return false;
  return Boolean(document.querySelector("#add-to-cart-button, #buy-now-button")) || /in stock|auf lager|en stock|disponible/i.test(value);
}

/** Reads the whole listing. Any field may come back null. */
export function scrapeListing() {
  const marketplace = marketplaceFromHost(location.hostname);
  const { images, hasVideo } = readImages();
  const { rating, reviewCount } = readRating();
  const attributes = readAttributes();

  const brand = parseByline(text(["#bylineInfo", "#brand", "a#bylineInfo"]))
    || brandFromAttributes(attributes)
    || null;

  return {
    asin: asinFromUrl(),
    url: location.href.split(/[?#]/)[0],
    marketplace,
    title: text(["#productTitle", "#title span#productTitle", "[data-feature-name='title'] h1"]),
    brand,
    bullets: readBullets(),
    description: readDescription(),
    aplus: readAplus(),
    images,
    hasVideo,
    rating,
    reviewCount,
    price: text([".a-price .a-offscreen", "#corePrice_feature_div .a-offscreen", "#priceblock_ourprice"]),
    inStock: readAvailability(),
    attributes,
    category: text(["#wayfinding-breadcrumbs_feature_div"]),
    // The last crumb is the category Amazon itself files this under, which is
    // usually the plainest available name for what the product is.
    categoryLeaf: (() => {
      const crumbs = [...document.querySelectorAll("#wayfinding-breadcrumbs_feature_div a")]
        .map(a => clean(a.textContent)).filter(Boolean);
      return crumbs.length ? crumbs[crumbs.length - 1] : null;
    })(),
  };
}
