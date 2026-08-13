import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseSearchTermsReport, relatedTerms, termsForAsin,
} from "../src/lib/brand-analytics.ts";
import {
  MARKETPLACE_IDS, accessToken, explain, forgetTokens, reportDocument,
  requestReport, waitForReport, type SpApiConfig,
} from "../src/lib/spapi.ts";
import { decrypt, encrypt, fingerprint } from "../src/lib/secrets.ts";

process.env.SPAPI_ENCRYPTION_KEY ??= "a".repeat(64);

const config: SpApiConfig = {
  clientId: "amzn1.application-oa2-client.test",
  clientSecret: "secret",
  refreshToken: "Atzr|test-refresh-token-value-0001",
  region: "eu",
  marketplaceId: MARKETPLACE_IDS.IN.id,
};

/** A fetch that answers from a script and records what it was asked. */
function scripted(responses: Array<{ status?: number; body: string }>) {
  const calls: Array<{ url: string; init?: any }> = [];
  let i = 0;
  const impl = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      text: async () => next.body,
    } as any;
  }) as typeof fetch;
  return { impl, calls };
}

const tokenResponse = { body: JSON.stringify({ access_token: "Atza|access", expires_in: 3600 }) };

/* ---------------- credentials ---------------- */

test("credentials survive a round trip and change shape every time", () => {
  const secret = "Atzr|a-very-long-refresh-token-value";
  const once = encrypt(secret);
  const twice = encrypt(secret);
  assert.notEqual(once, twice, "a fresh IV each time, so the ciphertext never repeats");
  assert.equal(decrypt(once), secret);
  assert.equal(decrypt(twice), secret);
  assert.ok(!once.includes(secret));
});

test("a tampered credential fails to decrypt rather than returning rubbish", () => {
  const payload = encrypt("Atzr|token");
  const [iv, tag, body] = payload.split(".");
  const flipped = body.slice(0, -2) + (body.slice(-2) === "AA" ? "AB" : "AA");
  assert.throws(() => decrypt([iv, tag, flipped].join(".")));
  assert.throws(() => decrypt("not-a-payload"));
});

test("only the last four characters are ever shown", () => {
  assert.equal(fingerprint("Atzr|abcdefghijklmnop"), "…mnop");
  assert.equal(fingerprint(""), "");
});

/* ---------------- token handling ---------------- */

test("an access token is minted once and reused until it nears expiry", async () => {
  forgetTokens();
  const { impl, calls } = scripted([tokenResponse]);
  const first = await accessToken(config, impl);
  const second = await accessToken(config, impl);
  assert.equal(first, "Atza|access");
  assert.equal(second, "Atza|access");
  assert.equal(calls.length, 1, "the second call came from the cache");
  assert.match(calls[0].url, /api\.amazon\.com\/auth\/o2\/token/);
  assert.match(calls[0].init.body, /grant_type=refresh_token/);
});

test("Amazon's setup failures are explained in terms of what to do", () => {
  assert.match(explain(401, '{"error":"invalid_grant"}'), /re-authorise/i);
  assert.match(explain(400, '{"error":"invalid_client"}'), /client ID or secret/i);
  assert.match(explain(403, "Access to requested resource is denied"), /Brand Analytics role/i);
  assert.match(explain(429, ""), /rate limiting/i);
  assert.match(explain(503, ""), /Amazon's API/i);
});

test("a rejected refresh token surfaces as a readable error, not a JSON dump", async () => {
  forgetTokens();
  const { impl } = scripted([{ status: 400, body: '{"error":"invalid_grant"}' }]);
  await assert.rejects(
    () => accessToken({ ...config, refreshToken: "wrong" }, impl),
    (err: Error) => /re-authorise/i.test(err.message)
  );
});

/* ---------------- the reports flow ---------------- */

test("a report is requested against the right region and marketplace", async () => {
  forgetTokens();
  const { impl, calls } = scripted([tokenResponse, { body: JSON.stringify({ reportId: "REP1" }) }]);
  const id = await requestReport(config, { period: "WEEK" }, impl);
  assert.equal(id, "REP1");
  const request = calls[1];
  // India is served by the European endpoint, which is easy to get wrong.
  assert.match(request.url, /sellingpartnerapi-eu\.amazon\.com\/reports\/2021-06-30\/reports/);
  const body = JSON.parse(request.init.body);
  assert.equal(body.reportType, "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT");
  assert.deepEqual(body.marketplaceIds, ["A21TJRUUN4KGV"]);
  assert.equal(body.reportOptions.reportPeriod, "WEEK");
  assert.equal(request.init.headers["x-amz-access-token"], "Atza|access");
});

test("waiting polls until the report is done", async () => {
  forgetTokens();
  const { impl } = scripted([
    tokenResponse,
    { body: JSON.stringify({ processingStatus: "IN_QUEUE" }) },
    { body: JSON.stringify({ processingStatus: "IN_PROGRESS" }) },
    { body: JSON.stringify({ processingStatus: "DONE", reportDocumentId: "DOC1" }) },
  ]);
  const slept: number[] = [];
  const documentId = await waitForReport(config, "REP1", {
    delayMs: 15000, sleep: async ms => { slept.push(ms); },
  }, impl);
  assert.equal(documentId, "DOC1");
  assert.equal(slept.length, 2, "waited between polls rather than hammering");
});

test("a cancelled report is explained as missing data, not as a failure", async () => {
  forgetTokens();
  const { impl } = scripted([tokenResponse, { body: JSON.stringify({ processingStatus: "CANCELLED" }) }]);
  await assert.rejects(
    () => waitForReport(config, "REP1", { sleep: async () => {} }, impl),
    (err: Error) => /no Brand Analytics data/i.test(err.message)
  );
});

test("the document call returns the url and how it is compressed", async () => {
  forgetTokens();
  const { impl } = scripted([
    tokenResponse,
    { body: JSON.stringify({ url: "https://example.com/doc", compressionAlgorithm: "GZIP" }) },
  ]);
  const doc = await reportDocument(config, "DOC1", impl);
  assert.equal(doc.url, "https://example.com/doc");
  assert.equal(doc.compression, "GZIP");
});

/* ---------------- the report itself ---------------- */

const jsonPerTerm = JSON.stringify({
  dataByDepartmentAndSearchTerm: [
    {
      departmentName: "Luggage", searchTerm: "laptop bag", searchFrequencyRank: 412,
      clickedAsin1: "B0AAAA1111", clickedItemName1: "Packster Laptop Backpack", clickShare1: 0.21, conversionShare1: 0.18,
      clickedAsin2: "B0BBBB2222", clickShare2: 0.11,
      clickedAsin3: "B0CCCC3333",
    },
    {
      departmentName: "Luggage", searchTerm: "school bag", searchFrequencyRank: 88,
      clickedAsin1: "B0DDDD4444",
    },
  ],
});

const jsonPerAsin = JSON.stringify({
  dataByDepartmentAndSearchTerm: [
    { searchTerm: "laptop bag", searchFrequencyRank: 412, clickedAsin: "B0AAAA1111", clickShareRank: 1, clickShare: 0.21 },
    { searchTerm: "laptop bag", searchFrequencyRank: 412, clickedAsin: "B0BBBB2222", clickShareRank: 2, clickShare: 0.11 },
    { searchTerm: "school bag", searchFrequencyRank: 88, clickedAsin: "B0DDDD4444", clickShareRank: 1 },
  ],
});

const tsv = [
  ["Department", "Search Term", "Search Frequency Rank", "#1 Clicked ASIN", "#1 Product Title", "#1 Click Share", "#2 Clicked ASIN"].join("\t"),
  ["Luggage", "laptop bag", "412", "B0AAAA1111", "Packster Laptop Backpack", "0.21", "B0BBBB2222"].join("\t"),
  ["Luggage", "school bag", "88", "B0DDDD4444", "Some Bag", "0.30", ""].join("\t"),
].join("\n");

test("all three shapes Amazon returns are parsed to the same thing", () => {
  for (const [name, body] of [["per-term", jsonPerTerm], ["per-asin", jsonPerAsin], ["tsv", tsv]] as const) {
    const out = parseSearchTermsReport(body);
    assert.equal(out.rows.length, 2, name);
    const laptop = out.rows.find(r => r.searchTerm === "laptop bag")!;
    assert.equal(laptop.rank, 412, name);
    assert.equal(laptop.asins[0].asin, "B0AAAA1111", name);
    assert.equal(laptop.asins[0].position, 1, name);
    assert.equal(laptop.asins[1].asin, "B0BBBB2222", name);
  }
  assert.equal(parseSearchTermsReport(jsonPerTerm).shape, "json-per-term");
  assert.equal(parseSearchTermsReport(jsonPerAsin).shape, "json-per-asin");
  assert.equal(parseSearchTermsReport(tsv).shape, "delimited");
});

test("the search term is lower-cased so the same term is one term", () => {
  const out = parseSearchTermsReport(JSON.stringify({
    dataByDepartmentAndSearchTerm: [
      { searchTerm: "Laptop Bag", searchFrequencyRank: 412, clickedAsin: "B0AAAA1111", clickShareRank: 1 },
      { searchTerm: "laptop bag", searchFrequencyRank: 412, clickedAsin: "B0BBBB2222", clickShareRank: 2 },
    ],
  }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].asins.length, 2);
});

test("rows without a term or a rank are skipped and counted, not guessed at", () => {
  const out = parseSearchTermsReport(JSON.stringify({
    dataByDepartmentAndSearchTerm: [
      { searchTerm: "good term", searchFrequencyRank: 5 },
      { searchTerm: "", searchFrequencyRank: 6 },
      { searchTerm: "no rank" },
    ],
  }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 2);
});

test("junk in an ASIN column is ignored rather than stored", () => {
  const out = parseSearchTermsReport(JSON.stringify({
    dataByDepartmentAndSearchTerm: [
      { searchTerm: "bag", searchFrequencyRank: 5, clickedAsin1: "n/a", clickedAsin2: "B0AAAA1111" },
    ],
  }));
  assert.deepEqual(out.rows[0].asins.map(a => a.asin), ["B0AAAA1111"]);
});

test("an empty or unrecognised document reports why rather than importing nothing quietly", () => {
  assert.match(parseSearchTermsReport("").note!, /empty/i);
  assert.match(parseSearchTermsReport("{not json").note!, /would not parse/i);
  assert.match(parseSearchTermsReport("a,b,c\n1,2,3").note!, /No search term and rank columns/i);
});

/* ---------------- Magnet and Cerebro ---------------- */

const corpus = parseSearchTermsReport(JSON.stringify({
  dataByDepartmentAndSearchTerm: [
    { searchTerm: "laptop bag", searchFrequencyRank: 412, clickedAsin1: "B0AAAA1111", clickShare1: 0.21 },
    { searchTerm: "laptop backpack", searchFrequencyRank: 120, clickedAsin1: "B0AAAA1111", clickShare1: 0.14 },
    { searchTerm: "school bag", searchFrequencyRank: 88, clickedAsin1: "B0DDDD4444" },
    { searchTerm: "office laptop sleeve", searchFrequencyRank: 900, clickedAsin1: "B0BBBB2222" },
  ],
})).rows;

test("Magnet returns terms sharing a word with the seed, most searched first", () => {
  const found = relatedTerms(corpus, "laptop");
  assert.deepEqual(found.map(r => r.searchTerm), ["laptop backpack", "laptop bag", "office laptop sleeve"]);
  // Rank 120 is searched more than rank 412 — lower is bigger.
  assert.equal(found[0].rank, 120);
  assert.deepEqual(relatedTerms(corpus, "a"), [], "a seed too short to mean anything returns nothing");
});

test("Cerebro returns the terms an ASIN actually takes clicks on", () => {
  const found = termsForAsin(corpus, "b0aaaa1111");
  assert.deepEqual(found.map(r => r.searchTerm), ["laptop backpack", "laptop bag"]);
  assert.equal(found[0].position, 1);
  assert.equal(found[1].clickShare, 0.21);
  assert.deepEqual(termsForAsin(corpus, "B0NOTHERE99"), []);
});
