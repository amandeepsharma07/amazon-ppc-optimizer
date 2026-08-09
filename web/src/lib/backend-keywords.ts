/**
 * Builds the hidden "Search Terms" field from real customer search queries.
 *
 * Amazon indexes that field as a bag of words, not phrases: word order is
 * ignored, and any combination can match. So the job is not to write sentences
 * but to fit the most valuable *unique* words inside a byte budget, having
 * removed everything Amazon either ignores or forbids.
 *
 * Rules applied (Amazon's own guidance for the Generic Keywords / Search Terms
 * attribute — see the note on BYTE_LIMITS about verifying the size):
 *   - a byte budget, not a character budget: accented and non-Latin
 *     characters cost more than one byte each
 *   - no commas or punctuation; words are separated by single spaces
 *   - no word repeated, since repetition adds nothing and wastes budget
 *   - nothing already in the title, brand or product type, which are indexed
 *     already
 *   - no competitor brand names and no ASINs, both of which breach policy
 *   - no subjective or temporary claims ("best", "new", "on sale")
 *   - no stop words, which the index discards
 *   - one form of a word only: Amazon stems, so "bag" covers "bags"
 */
import type { Marketplace, SearchTermRow } from "./analyze";

/**
 * Size of the Search Terms field per marketplace, in bytes.
 *
 * Amazon has changed these before and a few categories differ, so the figure
 * is shown in the interface and can be overridden. Check yours under
 * Seller Central -> Inventory -> Manage Inventory -> Edit -> Keywords.
 */
export const BYTE_LIMITS: Record<string, number> = {
  IN: 200,
  JP: 500,
  US: 250, CA: 250, MX: 250, BR: 250,
  UK: 250, DE: 250, FR: 250, IT: 250, ES: 250, NL: 250, SE: 250, PL: 250, TR: 250,
  AE: 250, SA: 250, SG: 250, AU: 250,
};
export const DEFAULT_BYTE_LIMIT = 250;

export function byteLimitFor(marketplaceCode: string): number {
  return BYTE_LIMITS[marketplaceCode] ?? DEFAULT_BYTE_LIMIT;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Words the index discards, so spending bytes on them is pure waste. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "of", "for", "to", "in", "on", "at", "by", "with", "from",
  "into", "onto", "up", "down", "out", "over", "under", "is", "are", "was",
  "were", "be", "been", "being", "am", "do", "does", "did", "have", "has",
  "had", "can", "could", "will", "would", "shall", "should", "may", "might",
  "it", "its", "as", "so", "such", "no", "not", "you", "your", "yours", "i",
  "me", "my", "we", "our", "us", "he", "she", "they", "them", "their", "there",
  "here", "what", "which", "who", "whom", "when", "where", "why", "how",
]);

/**
 * Subjective or time-limited claims. Amazon rejects these in search terms
 * because they assert things the listing cannot guarantee.
 */
const PROHIBITED_CLAIMS = new Set([
  "best", "best-seller", "bestseller", "bestselling", "cheapest", "cheap",
  "lowest", "amazing", "awesome", "wonderful", "fantastic", "perfect",
  "excellent", "superior", "ultimate", "finest", "greatest", "top", "toprated",
  "topselling", "number1", "no1", "#1", "leading", "unbeatable", "incredible",
  "guaranteed", "guarantee", "warranty", "certified", "approved", "authentic",
  "genuine", "original", "new", "newest", "latest", "sale", "onsale",
  "discount", "discounted", "offer", "deal", "deals", "clearance", "free",
  "freeshipping", "shipping", "delivery", "fast", "instant", "limited",
  "exclusive", "hot", "trending", "viral", "popular", "famous", "recommended",
  "professional-grade", "medical-grade", "hypoallergenic", "eco", "organic",
  "natural", "safe", "nontoxic", "cure", "cures", "treat", "treats", "heal",
  "prevents", "prevent",
]);

/**
 * Names that are unambiguously somebody else's. Sellers pick these up from
 * search reports constantly — shoppers really do search "spiderman school bag"
 * — but using them unlicensed gets listings suppressed, so they are refused.
 *
 * Only words with no ordinary meaning belong here. Anything that is also a
 * normal English word goes in NEEDS_REVIEW instead, because silently deleting
 * "apple" from a fruit seller's keywords would be worse than the risk it
 * guards against.
 */
const TRADEMARKED = new Set([
  "spiderman", "batman", "superman", "ironman", "avengers", "marvel",
  "captainamerica", "disney", "mickey", "minnie", "elsa", "barbie", "pokemon",
  "pikachu", "doraemon", "chhotabheem", "motupatlu", "shinchan", "ben10",
  "peppa", "minions", "hellokitty", "starwars", "harrypotter", "hogwarts",
  "naruto", "nintendo", "hotwheels", "adidas", "gucci", "prada", "chanel",
  "rolex", "samsonite", "americantourister", "skybag", "hilfiger", "levis",
  "wildcraft", "aristocrat", "reebok", "fastrack", "titan",
]);

/**
 * Words that are both ordinary vocabulary and a well-known brand. Keeping them
 * may be perfectly legitimate — or may be trademark infringement — and only
 * the seller knows which. They stay in the output and are listed separately so
 * you can decide, rather than being dropped behind your back.
 */
const NEEDS_REVIEW = new Set([
  "apple", "boat", "safari", "genie", "frozen", "anna", "thor", "hulk",
  "spider", "sonic", "mario", "patrol", "paw", "vip", "puma", "nike", "sony",
  "samsung", "jbl", "lego", "unicorn", "avenger", "champion", "polo", "coach",
  "guess", "monsoon", "next", "gap", "diesel", "fossil",
]);

/** Rough ASIN shape: B followed by nine alphanumerics. */
const ASIN_RE = /^b0[a-z0-9]{8}$/i;

export interface BackendKeywordOptions {
  marketplace: Marketplace;
  /** Product title as it appears on the listing — its words are already indexed. */
  title: string;
  /** Your own brand — already indexed, and wasted here. */
  brand: string;
  /** What the product is, e.g. "school backpack". Also already indexed. */
  productType: string;
  /** Brands you must not target. Policy violation, and Amazon suppresses them. */
  competitorBrands?: string;
  /** Override when your category's field size differs. */
  byteLimit?: number;
}

export interface IncludedWord {
  word: string;
  /** Set when the word is also a known brand and only you can judge it. */
  review?: string;
  score: number;
  orders: number;
  clicks: number;
  termCount: number;
  bytes: number;
}

export interface ExcludedWord {
  word: string;
  reason: string;
  score: number;
}

export interface BackendKeywordResult {
  searchTerms: string;
  bytes: number;
  byteLimit: number;
  bytesFree: number;
  included: IncludedWord[];
  excluded: ExcludedWord[];
  droppedForSpace: ExcludedWord[];
  /** Included words that are also brand names — check before you paste. */
  needsReview: IncludedWord[];
  sourceTerms: number;
  sourceWords: number;
}

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    // Keep letters, digits and non-Latin scripts; everything else separates words.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** Singular form for simple English plurals, so "bags" folds into "bag". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes")
      || word.endsWith("ches") || word.endsWith("shes"))) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * A search term's worth. Orders dominate because a query that converted is
 * proven demand; clicks show interest without proof, so they count for far less.
 */
function termScore(row: { orders: number; clicks: number; impressions: number }): number {
  return row.orders * 50 + row.clicks * 2 + row.impressions * 0.001;
}

export function buildBackendKeywords(
  rows: SearchTermRow[], options: BackendKeywordOptions
): BackendKeywordResult {
  const byteLimit = options.byteLimit ?? byteLimitFor(options.marketplace.code);

  // Words already indexed elsewhere on the listing — spending bytes again is waste.
  const alreadyIndexed = new Set<string>();
  for (const source of [options.title, options.brand, options.productType]) {
    for (const word of normalise(source ?? "")) {
      alreadyIndexed.add(word);
      alreadyIndexed.add(singular(word));
    }
  }
  const competitors = new Set<string>();
  for (const word of normalise(options.competitorBrands ?? "")) {
    competitors.add(word);
    competitors.add(singular(word));
  }

  // Aggregate identical queries first: the same term appears once per targeting
  // that matched it, and counting it twice would inflate its words.
  const terms = new Map<string, { orders: number; clicks: number; impressions: number }>();
  for (const row of rows) {
    if (!row.term) continue;
    const key = row.term.trim().toLowerCase();
    const t = terms.get(key) ?? { orders: 0, clicks: 0, impressions: 0 };
    t.orders += row.orders; t.clicks += row.clicks; t.impressions += row.impressions;
    terms.set(key, t);
  }

  // Score each word by the queries it appears in, folding plurals together.
  interface Bucket { word: string; score: number; orders: number; clicks: number; termCount: number; }
  const words = new Map<string, Bucket>();
  for (const [term, stats] of terms) {
    const score = termScore(stats);
    const seen = new Set<string>(); // a word repeated within one query counts once
    for (const raw of normalise(term)) {
      const key = singular(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = words.get(key) ?? { word: key, score: 0, orders: 0, clicks: 0, termCount: 0 };
      bucket.score += score;
      bucket.orders += stats.orders;
      bucket.clicks += stats.clicks;
      bucket.termCount += 1;
      words.set(key, bucket);
    }
  }

  const excluded: ExcludedWord[] = [];
  const candidates: Bucket[] = [];
  for (const bucket of words.values()) {
    const w = bucket.word;
    let reason: string | null = null;
    if (w.length < 2) reason = "Single character — carries no meaning";
    else if (STOP_WORDS.has(w)) reason = "Stop word — Amazon's index ignores it";
    else if (ASIN_RE.test(w)) reason = "Looks like an ASIN — not allowed in search terms";
    else if (competitors.has(w)) reason = "Competitor brand — against Amazon policy";
    else if (TRADEMARKED.has(w)) {
      reason = "Trademarked name — using it without a licence gets listings suppressed";
    }
    else if (PROHIBITED_CLAIMS.has(w)) reason = "Subjective or temporary claim — against Amazon policy";
    else if (alreadyIndexed.has(w)) reason = "Already in your title, brand or product type — indexed already";
    else if (/^\d+$/.test(w) && w.length > 4) reason = "Long bare number — unlikely to be searched";

    if (reason) excluded.push({ word: w, reason, score: bucket.score });
    else candidates.push(bucket);
  }

  candidates.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  excluded.sort((a, b) => b.score - a.score);

  // Pack greedily by value. A space is only needed between words, so the first
  // word costs its own bytes and each later one costs a byte more.
  const included: IncludedWord[] = [];
  const droppedForSpace: ExcludedWord[] = [];
  let bytes = 0;
  for (const bucket of candidates) {
    const wordBytes = byteLength(bucket.word);
    const cost = included.length === 0 ? wordBytes : wordBytes + 1;
    if (bytes + cost <= byteLimit) {
      bytes += cost;
      included.push({
        word: bucket.word, score: bucket.score, orders: bucket.orders,
        clicks: bucket.clicks, termCount: bucket.termCount, bytes: wordBytes,
        review: NEEDS_REVIEW.has(bucket.word)
          ? "Also a well-known brand — keep it only if it genuinely describes your product"
          : undefined,
      });
    } else {
      droppedForSpace.push({
        word: bucket.word, score: bucket.score,
        reason: `No room — ${byteLimit} bytes already used by higher-value words`,
      });
    }
  }

  return {
    searchTerms: included.map(i => i.word).join(" "),
    bytes,
    byteLimit,
    bytesFree: byteLimit - bytes,
    included,
    excluded,
    droppedForSpace,
    needsReview: included.filter(i => i.review),
    sourceTerms: terms.size,
    sourceWords: words.size,
  };
}
