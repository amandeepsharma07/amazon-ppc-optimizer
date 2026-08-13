/**
 * The keyword processor: turns pasted keyword lists into something usable.
 *
 * Keyword research arrives as a mess — exported from one tool, copied out of a
 * report, typed from memory — with different delimiters, duplicated phrases,
 * plurals of the same word, and other people's brands scattered through it.
 * This does the mechanical part: pull it apart, count what is actually there,
 * and hand back both the phrases worth targeting and the unique words worth
 * spending title and backend bytes on.
 *
 * It shares its vocabulary with the backend keyword builder deliberately.
 * A word this tool calls a brand must be a word that tool refuses to put in
 * the Search Terms field, or the two contradict each other in front of the
 * seller.
 */

/**
 * Bytes, not characters — the Search Terms field is measured in bytes and an
 * accented or non-Latin character costs more than one. Defined here rather
 * than imported so this module has no runtime dependencies and can be tested
 * on its own.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
/* Delimiters people actually paste: newlines, commas, semicolons, tabs, and
   pipes. Spaces are NOT a delimiter — "laptop bag" is one phrase. */
const SPLIT = /[\n\r;,|\t]+/;

export interface KeywordPhrase {
  phrase: string;
  /** How many times it appeared in the input, before deduplication. */
  count: number;
  words: number;
  chars: number;
  bytes: number;
}

export interface KeywordWord {
  word: string;
  /** Number of distinct phrases the word appears in. */
  phrases: number;
  /** Total appearances across the input. */
  count: number;
  bytes: number;
  /** Set when the word is being held out, with the reason. */
  excluded?: string;
}

export interface ProcessOptions {
  /** Words to drop — your own brand, a product type already in the title. */
  exclude?: string;
  /** Drop phrases containing a competitor or licensed brand. */
  removeBrands?: boolean;
  /** Drop the words Amazon's index ignores. */
  removeStopWords?: boolean;
  /** Fold plurals into the singular, as Amazon's stemmer does. */
  stem?: boolean;
  /** Phrases shorter than this many characters are noise. */
  minChars?: number;
}

export interface ProcessResult {
  phrases: KeywordPhrase[];
  words: KeywordWord[];
  excludedWords: KeywordWord[];
  stats: {
    linesIn: number;
    phrasesIn: number;
    phrasesOut: number;
    duplicatesRemoved: number;
    wordsOut: number;
    charsIn: number;
    charsOut: number;
  };
}

/** Words Amazon's index discards. Kept in step with the backend builder. */
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
 * Names that belong to somebody else. Only words with no ordinary meaning —
 * anything that is also normal vocabulary would do more harm removed than
 * left, so it stays and the seller decides.
 */
const BRANDS = new Set([
  "spiderman", "batman", "superman", "ironman", "avengers", "marvel",
  "captainamerica", "disney", "mickey", "minnie", "elsa", "barbie", "pokemon",
  "pikachu", "doraemon", "chhotabheem", "motupatlu", "shinchan", "ben10",
  "peppa", "minions", "hellokitty", "starwars", "harrypotter", "hogwarts",
  "naruto", "nintendo", "hotwheels", "adidas", "gucci", "prada", "chanel",
  "rolex", "samsonite", "skybag", "hilfiger", "levis", "wildcraft",
  "aristocrat", "reebok", "fastrack", "tourister", "decathlon", "quechua",
]);

/** Subjective or temporary claims Amazon rejects. */
const CLAIMS = new Set([
  "best", "bestseller", "bestselling", "cheapest", "cheap", "amazing",
  "perfect", "ultimate", "top", "toprated", "number1", "no1", "guaranteed",
  "genuine", "original", "new", "latest", "sale", "discount", "offer", "deal",
  "free", "freeshipping", "fast", "limited", "exclusive", "hot", "trending",
  "popular", "famous",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Singular form for simple English plurals, matching Amazon's stemming. */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && (word.endsWith("ses") || word.endsWith("xes")
    || word.endsWith("zes") || word.endsWith("ches") || word.endsWith("shes"))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Squashed form, so "hello kitty" matches the single-token brand entry. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** True when the phrase names a brand that is not the seller's. */
export function namesABrand(phrase: string): string | null {
  const words = normalise(phrase).split(" ").filter(Boolean);
  for (const word of words) {
    if (BRANDS.has(singular(word))) return word;
  }
  for (let i = 0; i < words.length - 1; i++) {
    const joined = squash(words[i] + words[i + 1]);
    if (BRANDS.has(joined)) return `${words[i]} ${words[i + 1]}`;
  }
  return null;
}

export function processKeywords(input: string, options: ProcessOptions = {}): ProcessResult {
  const {
    removeBrands = true, removeStopWords = true, stem = true, minChars = 3,
  } = options;

  const rawLines = input.split(/\r?\n/);
  const chunks = input.split(SPLIT).map(s => s.trim()).filter(Boolean);
  const charsIn = input.length;

  const banned = new Set(
    normalise(options.exclude ?? "").split(" ").filter(Boolean).map(w => (stem ? singular(w) : w))
  );

  // Phrases first: the same phrase written twice, or with different casing or
  // punctuation, is one phrase that appeared twice.
  const phraseMap = new Map<string, KeywordPhrase>();
  let phrasesIn = 0;
  for (const chunk of chunks) {
    const phrase = normalise(chunk);
    if (!phrase) continue;
    phrasesIn += 1;
    if (phrase.length < minChars) continue;
    if (removeBrands && namesABrand(phrase)) continue;
    const existing = phraseMap.get(phrase);
    if (existing) { existing.count += 1; continue; }
    phraseMap.set(phrase, {
      phrase,
      count: 1,
      words: phrase.split(" ").length,
      chars: phrase.length,
      bytes: byteLength(phrase),
    });
  }

  const phrases = [...phraseMap.values()]
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));

  // Then words, counted across the phrases that survived.
  const wordMap = new Map<string, KeywordWord & { excluded?: string }>();
  for (const entry of phrases) {
    const seen = new Set<string>();   // a word twice in one phrase counts once for reach
    for (const raw of entry.phrase.split(" ")) {
      const key = stem ? singular(raw) : raw;
      if (!key) continue;
      const bucket = wordMap.get(key) ?? { word: key, phrases: 0, count: 0, bytes: byteLength(key) };
      bucket.count += entry.count;
      if (!seen.has(key)) { bucket.phrases += 1; seen.add(key); }
      wordMap.set(key, bucket);
    }
  }

  const kept: KeywordWord[] = [];
  const excludedWords: KeywordWord[] = [];
  for (const word of wordMap.values()) {
    let reason: string | null = null;
    if (word.word.length < 2) reason = "Single character";
    else if (banned.has(word.word)) reason = "You excluded it";
    else if (removeStopWords && STOP_WORDS.has(word.word)) reason = "Stop word — the index ignores it";
    else if (removeBrands && BRANDS.has(word.word)) reason = "Another brand";
    else if (CLAIMS.has(word.word)) reason = "Subjective claim — against policy";
    else if (/^\d+$/.test(word.word) && word.word.length > 4) reason = "Long bare number";

    if (reason) excludedWords.push({ ...word, excluded: reason });
    else kept.push(word);
  }

  kept.sort((a, b) => b.phrases - a.phrases || b.count - a.count || a.word.localeCompare(b.word));
  excludedWords.sort((a, b) => b.count - a.count);

  const charsOut = phrases.reduce((s, p) => s + p.chars, 0);

  return {
    phrases,
    words: kept,
    excludedWords,
    stats: {
      linesIn: rawLines.filter(l => l.trim()).length,
      phrasesIn,
      phrasesOut: phrases.length,
      duplicatesRemoved: phrasesIn - phrases.length,
      wordsOut: kept.length,
      charsIn,
      charsOut,
    },
  };
}

/**
 * Packs unique words into a byte budget, highest reach first — the same
 * greedy fill the backend Search Terms builder uses, so the two agree.
 */
export function packToBytes(words: KeywordWord[], limit: number): {
  text: string; bytes: number; used: KeywordWord[]; left: KeywordWord[];
} {
  const used: KeywordWord[] = [];
  const left: KeywordWord[] = [];
  let bytes = 0;
  for (const word of words) {
    const cost = used.length === 0 ? word.bytes : word.bytes + 1;
    if (bytes + cost <= limit) { bytes += cost; used.push(word); }
    else left.push(word);
  }
  return { text: used.map(w => w.word).join(" "), bytes, used, left };
}

/**
 * Which of a keyword list appears in a piece of copy — the check the listing
 * builder runs as you type.
 *
 * Matching is on stems, because Amazon's index is: a title carrying "bags"
 * covers the keyword "bag", and telling the seller otherwise would have them
 * stuff a word they already have.
 */
export function coverageOf(copy: string, phrases: string[], stem = true): {
  covered: string[]; missing: string[]; percent: number;
} {
  const words = new Set(
    normalise(copy).split(" ").filter(Boolean).map(w => (stem ? singular(w) : w))
  );
  const covered: string[] = [];
  const missing: string[] = [];
  for (const phrase of phrases) {
    const parts = normalise(phrase).split(" ").filter(Boolean).map(w => (stem ? singular(w) : w));
    // A phrase counts as covered when every one of its words is present. Word
    // order does not matter: Amazon indexes the field as a bag of words.
    if (parts.length && parts.every(part => words.has(part))) covered.push(phrase);
    else missing.push(phrase);
  }
  return {
    covered,
    missing,
    percent: phrases.length ? Math.round((covered.length / phrases.length) * 100) : 0,
  };
}
