import { gunzipSync } from "node:zlib";
import { query, queryOne } from "./db";
import { ensureSchema } from "./setup";
import { decrypt, encrypt, fingerprint, hasEncryptionKey } from "./secrets";
import {
  MARKETPLACE_IDS, SEARCH_TERMS_REPORT, SpApiError, forgetTokens, reportDocument,
  reportStatus, requestReport, type ReportPeriod, type SpApiConfig,
} from "./spapi";
import { parseSearchTermsReport, type SearchTermRecord } from "./brand-analytics";

/**
 * The server side of keyword research: credentials, the pull, and the queries
 * the two screens run.
 *
 * A pull is deliberately a job rather than a request. Amazon takes minutes to
 * generate a Brand Analytics report, which is longer than a serverless
 * function is allowed to live, so waiting inside the request would work on a
 * laptop and time out in production — the worst kind of difference. Starting
 * and collecting are separate, and a scheduled run does the collecting.
 */

export interface AccountRow {
  marketplace: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  updated_at: string;
  updated_by: string;
  last_ok_at: string | null;
  last_error: string | null;
}

export interface AccountView {
  marketplace: string;
  label: string;
  clientId: string;
  secretHint: string;
  tokenHint: string;
  updatedAt: string;
  updatedBy: string;
  lastOkAt: string | null;
  lastError: string | null;
}

export async function saveCredentials(input: {
  marketplace: string; clientId: string; clientSecret: string; refreshToken: string; by: string;
}): Promise<void> {
  await ensureSchema();
  await query(
    `INSERT INTO spapi_accounts (marketplace, client_id, client_secret, refresh_token, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (marketplace) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       client_secret = EXCLUDED.client_secret,
       refresh_token = EXCLUDED.refresh_token,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW(),
       last_error = NULL`,
    [
      input.marketplace,
      input.clientId.trim(),
      encrypt(input.clientSecret.trim()),
      encrypt(input.refreshToken.trim()),
      input.by,
    ]
  );
  // Credentials changed, so any cached access token belongs to the old ones.
  forgetTokens();
}

export async function forgetCredentials(marketplace: string): Promise<void> {
  await ensureSchema();
  await query(`DELETE FROM spapi_accounts WHERE marketplace = $1`, [marketplace]);
  forgetTokens();
}

/** Everything the settings screen may show — never the secrets themselves. */
export async function listAccounts(): Promise<AccountView[]> {
  await ensureSchema();
  const rows = await query<AccountRow>(`SELECT * FROM spapi_accounts ORDER BY marketplace`);
  return rows.map(row => ({
    marketplace: row.marketplace,
    label: MARKETPLACE_IDS[row.marketplace]?.label ?? row.marketplace,
    clientId: row.client_id,
    secretHint: safeHint(row.client_secret),
    tokenHint: safeHint(row.refresh_token),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
  }));
}

/** A hint that still works when the key has changed and decryption fails. */
function safeHint(stored: string): string {
  try { return fingerprint(decrypt(stored)); } catch { return "unreadable"; }
}

export async function configFor(marketplace: string): Promise<SpApiConfig | null> {
  await ensureSchema();
  const row = await queryOne<AccountRow>(
    `SELECT * FROM spapi_accounts WHERE marketplace = $1`, [marketplace]
  );
  if (!row) return null;
  const place = MARKETPLACE_IDS[marketplace];
  if (!place) return null;
  return {
    clientId: row.client_id,
    clientSecret: decrypt(row.client_secret),
    refreshToken: decrypt(row.refresh_token),
    region: place.region,
    marketplaceId: place.id,
  };
}

async function noteResult(marketplace: string, error: string | null): Promise<void> {
  // $2 is cast explicitly: Postgres cannot infer a parameter's type when the
  // only thing it sees is NULL inside a CASE, and fails the whole statement.
  await query(
    `UPDATE spapi_accounts
        SET last_error = $2::text,
            last_ok_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE last_ok_at END
      WHERE marketplace = $1`,
    [marketplace, error]
  );
}

/* ------------------------------------------------------------------ *
 * Pulling
 * ------------------------------------------------------------------ */

export interface JobRow {
  id: string; marketplace: string; report_id: string; report_type: string;
  period: string; status: string; started_at: string; finished_at: string | null;
  rows_stored: number; detail: string;
}

/**
 * Asks Amazon to build the report and records the job. Returns quickly: the
 * report is not ready and will not be for minutes.
 */
export async function startPull(
  marketplace: string, period: ReportPeriod = "WEEK"
): Promise<{ jobId: string; reportId: string }> {
  const config = await configFor(marketplace);
  if (!config) throw new Error(`No Amazon credentials saved for ${marketplace}.`);

  try {
    const reportId = await requestReport(config, { period }, fetch);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO spapi_jobs (marketplace, report_id, report_type, period)
       VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [marketplace, reportId, SEARCH_TERMS_REPORT, period]
    );
    await noteResult(marketplace, null);
    return { jobId: row!.id, reportId };
  } catch (err) {
    const message = err instanceof SpApiError ? err.message : String(err);
    await noteResult(marketplace, message);
    throw err;
  }
}

/**
 * Moves every waiting job forward one step: still processing, or ready to
 * download and store. Safe to call as often as you like — a job already
 * collected is skipped.
 */
export async function advanceJobs(limit = 5): Promise<Array<{ jobId: string; status: string; detail: string; rows: number }>> {
  await ensureSchema();
  const jobs = await query<JobRow>(
    `SELECT * FROM spapi_jobs WHERE status = 'waiting' ORDER BY started_at LIMIT $1`, [limit]
  );
  const results: Array<{ jobId: string; status: string; detail: string; rows: number }> = [];

  for (const job of jobs) {
    try {
      const config = await configFor(job.marketplace);
      if (!config) throw new Error("The credentials for this marketplace have been removed.");

      const status = await reportStatus(config, job.report_id, fetch);
      if (status.processingStatus === "IN_QUEUE" || status.processingStatus === "IN_PROGRESS") {
        results.push({ jobId: job.id, status: "waiting", detail: "Amazon is still building it.", rows: 0 });
        continue;
      }
      if (status.processingStatus !== "DONE" || !status.reportDocumentId) {
        // Cancelled means the period holds no data — a fact, not a fault.
        const detail = status.processingStatus === "CANCELLED"
          ? "Amazon had no Brand Analytics data for that period."
          : "Amazon could not produce the report.";
        await finish(job.id, "empty", detail, 0);
        results.push({ jobId: job.id, status: "empty", detail, rows: 0 });
        continue;
      }

      const doc = await reportDocument(config, status.reportDocumentId, fetch);
      const stored = await importDocument(job.marketplace, doc.url, doc.compression);
      await finish(job.id, "done", stored.note, stored.rows);
      await noteResult(job.marketplace, null);
      results.push({ jobId: job.id, status: "done", detail: stored.note, rows: stored.rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finish(job.id, "failed", message, 0);
      await noteResult(job.marketplace, message);
      results.push({ jobId: job.id, status: "failed", detail: message, rows: 0 });
    }
  }
  return results;
}

async function finish(id: string, status: string, detail: string, rows: number): Promise<void> {
  await query(
    `UPDATE spapi_jobs SET status = $2, detail = $3, rows_stored = $4, finished_at = NOW() WHERE id = $1`,
    [id, status, detail.slice(0, 500), rows]
  );
}

/**
 * Downloads a finished report and stores it.
 *
 * The period the data belongs to is taken from the report where it says so,
 * and otherwise from today — a wrong-but-recorded date is recoverable, a
 * missing one is not.
 */
async function importDocument(
  marketplace: string, url: string, compression?: string
): Promise<{ rows: number; note: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the report document (${response.status}).`);
  const raw = Buffer.from(await response.arrayBuffer());
  const body = compression === "GZIP" ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return importText(marketplace, body);
}

/**
 * Stores a report, however it arrived.
 *
 * The automatic pull and a file somebody downloaded from Seller Central are
 * the same report in the same shapes, so they take the same path in. Nothing
 * downstream can tell which produced a row, which is the point: the screens
 * work identically either way.
 */
export async function importText(
  marketplace: string, body: string, periodOverride?: string
): Promise<{ rows: number; note: string; periodStart: string; shape: string; skipped: number }> {
  const parsed = parseSearchTermsReport(body);
  const periodStart = periodOverride || parsed.periodStart || periodFromBody(body)
    || new Date().toISOString().slice(0, 10);

  if (!parsed.rows.length) {
    return {
      rows: 0, periodStart, shape: parsed.shape, skipped: parsed.skipped,
      note: parsed.note ?? "The file held no search term rows.",
    };
  }

  await storeSearchTermRows(marketplace, periodStart, parsed.rows);

  const note = `Stored ${parsed.rows.length} search terms for the period starting ${periodStart}`
    + (parsed.skipped ? `, skipped ${parsed.skipped} incomplete rows` : "")
    + ` (${parsed.shape} format).`;
  return { rows: parsed.rows.length, note, periodStart, shape: parsed.shape, skipped: parsed.skipped };
}

/**
 * Writes parsed rows. Called by the scheduled pull and, in batches, by the
 * browser when somebody uploads the report by hand.
 *
 * Batched because a marketplace week runs to hundreds of thousands of terms
 * and one statement per row would exhaust the connection budget.
 */
export async function storeSearchTermRows(
  marketplace: string, periodStart: string, incoming: SearchTermRecord[]
): Promise<number> {
  await ensureSchema();

  /* Postgres refuses an INSERT whose ON CONFLICT target is hit twice by the
     same statement, so a term repeated inside one batch takes the whole batch
     down with it. Reports do repeat terms — the same search can be listed once
     per department — so the keys are made unique here rather than hoped about.
     The lower rank wins, being the more searched reading of the two. */
  const byTerm = new Map<string, SearchTermRecord>();
  for (const row of incoming) {
    const existing = byTerm.get(row.searchTerm);
    if (!existing) { byTerm.set(row.searchTerm, row); continue; }
    const keep = row.rank < existing.rank ? row : existing;
    const other = keep === row ? existing : row;
    // Keep every ASIN seen for the term, whichever copy named it.
    const asins = new Map(keep.asins.map(a => [a.asin, a]));
    for (const a of other.asins) if (!asins.has(a.asin)) asins.set(a.asin, a);
    byTerm.set(row.searchTerm, { ...keep, asins: [...asins.values()] });
  }

  const rows = [...byTerm.values()].map(row => {
    const seen = new Map<string, typeof row.asins[number]>();
    for (const a of row.asins) if (!seen.has(a.asin)) seen.set(a.asin, a);
    return seen.size === row.asins.length ? row : { ...row, asins: [...seen.values()] };
  });
  // Written in batches: a marketplace week can run to hundreds of thousands of
  // terms, and one statement per row would exhaust the connection budget.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const terms = slice.map((row, n) => {
      values.push(marketplace, periodStart, row.searchTerm, row.department, row.rank);
      const b = n * 5;
      // The first row carries the casts; a VALUES list takes its types from it.
      return n === 0
        ? `($${b + 1}::text, $${b + 2}::date, $${b + 3}::text, $${b + 4}::text, $${b + 5}::int)`
        : `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    /* DISTINCT ON rather than trusting the rows to be unique. Postgres refuses
       a statement whose ON CONFLICT target is hit twice, and a report repeats
       terms freely — the same search listed under several departments. The
       rows are deduplicated in JavaScript above too, but only this is enforced
       by the database, and only the database's opinion of "the same row"
       actually matters. The lower rank wins, being the more searched reading. */
    await query(
      `INSERT INTO search_terms (marketplace, period_start, search_term, department, rank)
       SELECT DISTINCT ON (marketplace, period_start, search_term)
              marketplace, period_start, search_term, department, rank
         FROM (VALUES ${terms.join(",")})
           AS v(marketplace, period_start, search_term, department, rank)
        ORDER BY marketplace, period_start, search_term, rank ASC
       ON CONFLICT (marketplace, period_start, search_term)
       DO UPDATE SET rank = EXCLUDED.rank, department = EXCLUDED.department`,
      values
    );

    const asinValues: unknown[] = [];
    const asinRows: string[] = [];
    for (const row of slice) {
      for (const asin of row.asins) {
        const b = asinValues.length;
        asinValues.push(
          marketplace, periodStart, row.searchTerm, asin.asin,
          asin.position, asin.title ?? null, asin.clickShare ?? null, asin.conversionShare ?? null
        );
        asinRows.push(asinRows.length === 0
          ? `($${b + 1}::text, $${b + 2}::date, $${b + 3}::text, $${b + 4}::text, $${b + 5}::int, $${b + 6}::text, $${b + 7}::float8, $${b + 8}::float8)`
          : `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`);
      }
    }
    if (asinRows.length) {
      await query(
        `INSERT INTO search_term_asins
           (marketplace, period_start, search_term, asin, position, title, click_share, conversion_share)
         SELECT DISTINCT ON (marketplace, period_start, search_term, asin)
                marketplace, period_start, search_term, asin, position, title, click_share, conversion_share
           FROM (VALUES ${asinRows.join(",")})
             AS v(marketplace, period_start, search_term, asin, position, title, click_share, conversion_share)
          ORDER BY marketplace, period_start, search_term, asin, position ASC
         ON CONFLICT (marketplace, period_start, search_term, asin)
         DO UPDATE SET position = EXCLUDED.position, title = COALESCE(EXCLUDED.title, search_term_asins.title),
                       click_share = EXCLUDED.click_share, conversion_share = EXCLUDED.conversion_share`,
        asinValues
      );
    }
  }

  return rows.length;
}

/** Amazon states the period in the report specification when it is present. */
function periodFromBody(body: string): string | null {
  const match = body.match(/"dataStartTime"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/* ------------------------------------------------------------------ *
 * The queries the screens run
 * ------------------------------------------------------------------ */

export interface TermRow {
  search_term: string;
  rank: number;
  period_start: string;
  department: string | null;
  asins: string | null;
}

/** Magnet: terms containing the seed, most searched first. */
export async function searchTerms(
  marketplace: string, seed: string, limit = 100
): Promise<TermRow[]> {
  await ensureSchema();
  const words = seed.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (!words.length) return [];
  // Every word must appear, which is what a seller means by "related to".
  const conditions = words.map((_, i) => `t.search_term LIKE $${i + 2}`).join(" AND ");
  return query<TermRow>(
    `SELECT t.search_term, t.rank, t.period_start, t.department,
            (SELECT string_agg(a.asin, ' ' ORDER BY a.position)
               FROM search_term_asins a
              WHERE a.marketplace = t.marketplace AND a.period_start = t.period_start
                AND a.search_term = t.search_term) AS asins
       FROM search_terms t
      WHERE t.marketplace = $1 AND ${conditions}
        AND t.period_start = (SELECT MAX(period_start) FROM search_terms WHERE marketplace = $1)
      ORDER BY t.rank ASC
      LIMIT ${Number(limit) || 100}`,
    [marketplace, ...words.map(w => `%${w}%`)]
  );
}

export interface AsinTermRow {
  search_term: string;
  rank: number;
  position: number;
  click_share: number | null;
  conversion_share: number | null;
  period_start: string;
  /** How many of the stored weeks this ASIN was named for the term. */
  weeks: number;
  weeks_held: number;
}

/**
 * Cerebro: the terms this ASIN takes clicks on.
 *
 * One row per term, not per term and week. Amazon names only the three most
 * clicked ASINs for each search, so a product drifts in and out of the report
 * week to week — and listing the same term once per week would bury the fact
 * that it is the same term. The count of weeks it held is the more useful
 * number anyway: appearing in four weeks of four is a position, appearing in
 * one of four is a visit.
 *
 * The figures shown are the most recent week's, since that is what is true now.
 */
export async function termsForAsin(
  marketplace: string, asin: string, limit = 200
): Promise<AsinTermRow[]> {
  await ensureSchema();
  return query<AsinTermRow>(
    `WITH weeks AS (
       SELECT COUNT(DISTINCT period_start)::int AS n
         FROM search_terms WHERE marketplace = $1
     ),
     hits AS (
       SELECT a.search_term,
              COUNT(*)::int AS weeks_held,
              MAX(a.period_start) AS latest
         FROM search_term_asins a
        WHERE a.marketplace = $1 AND a.asin = $2
        GROUP BY a.search_term
     )
     SELECT h.search_term, t.rank, a.position, a.click_share, a.conversion_share,
            t.period_start, h.weeks_held, (SELECT n FROM weeks) AS weeks
       FROM hits h
       JOIN search_term_asins a
         ON a.marketplace = $1 AND a.asin = $2
        AND a.search_term = h.search_term AND a.period_start = h.latest
       JOIN search_terms t
         ON t.marketplace = $1 AND t.period_start = h.latest AND t.search_term = h.search_term
      ORDER BY t.rank ASC
      LIMIT ${Number(limit) || 200}`,
    [marketplace, asin.trim().toUpperCase()]
  );
}

export interface Coverage {
  marketplace: string;
  periods: number;
  latest: string | null;
  terms: number;
  asins: number;
}

/** What is actually in the database, so a screen never implies data it lacks. */
export async function coverage(): Promise<Coverage[]> {
  await ensureSchema();
  return query<Coverage>(
    `SELECT marketplace,
            COUNT(DISTINCT period_start)::int AS periods,
            MAX(period_start)::text AS latest,
            COUNT(*)::int AS terms,
            (SELECT COUNT(DISTINCT asin)::int FROM search_term_asins a
              WHERE a.marketplace = t.marketplace) AS asins
       FROM search_terms t
      GROUP BY marketplace`
  );
}

export async function recentJobs(limit = 10): Promise<JobRow[]> {
  await ensureSchema();
  return query<JobRow>(
    `SELECT id::text, marketplace, report_id, report_type, period, status,
            started_at, finished_at, rows_stored, detail
       FROM spapi_jobs ORDER BY started_at DESC LIMIT $1`, [limit]
  );
}

export { hasEncryptionKey };

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

export interface ClientRow {
  id: string;
  name: string;
  marketplace: string;
  notes: string;
  asins: number;
}

export interface ClientAsinRow {
  asin: string;
  label: string;
  /** Terms this ASIN is named for, across every stored week. */
  terms: number;
  best_rank: number | null;
}

export async function listClients(): Promise<ClientRow[]> {
  await ensureSchema();
  return query<ClientRow>(
    `SELECT c.id::text, c.name, c.marketplace, c.notes,
            (SELECT COUNT(*)::int FROM client_asins a WHERE a.client_id = c.id) AS asins
       FROM clients c ORDER BY lower(c.name)`
  );
}

export async function createClient(
  name: string, marketplace: string, by: string
): Promise<string> {
  await ensureSchema();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO clients (name, marketplace, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (lower(name), marketplace) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`,
    [name.trim().slice(0, 120), marketplace, by]
  );
  return row!.id;
}

export async function deleteClient(id: string): Promise<void> {
  await ensureSchema();
  await query(`DELETE FROM clients WHERE id = $1`, [id]);
}

/**
 * Adds ASINs to a client, accepting whatever shape they were pasted in —
 * a column from a spreadsheet, a comma-separated line, a list with titles
 * beside them. Anything that is not an ASIN is reported rather than dropped
 * silently, because a mistyped ASIN looks exactly like a product with no data.
 */
export async function addAsins(
  clientId: string, text: string
): Promise<{ added: number; rejected: string[] }> {
  await ensureSchema();
  const tokens = String(text).split(/[\s,;|]+/).map(t => t.trim()).filter(Boolean);
  const good: string[] = [];
  const rejected: string[] = [];
  for (const token of tokens) {
    const asin = token.toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(asin)) good.push(asin);
    else rejected.push(token.slice(0, 40));
  }
  if (!good.length) return { added: 0, rejected };

  const values: unknown[] = [];
  const rows = [...new Set(good)].map((asin, i) => {
    values.push(clientId, asin);
    return `($${i * 2 + 1}, $${i * 2 + 2})`;
  });
  await query(
    `INSERT INTO client_asins (client_id, asin) VALUES ${rows.join(",")}
     ON CONFLICT (client_id, asin) DO NOTHING`,
    values
  );
  return { added: rows.length, rejected };
}

export async function removeAsin(clientId: string, asin: string): Promise<void> {
  await ensureSchema();
  await query(`DELETE FROM client_asins WHERE client_id = $1 AND asin = $2`,
    [clientId, asin.toUpperCase()]);
}

/** A client's ASINs, with how much search term data exists for each. */
export async function clientAsins(clientId: string, marketplace: string): Promise<ClientAsinRow[]> {
  await ensureSchema();
  return query<ClientAsinRow>(
    `SELECT ca.asin, ca.label,
            COUNT(DISTINCT sa.search_term)::int AS terms,
            MIN(st.rank)::int AS best_rank
       FROM client_asins ca
       LEFT JOIN search_term_asins sa
         ON sa.asin = ca.asin AND sa.marketplace = $2
       LEFT JOIN search_terms st
         ON st.marketplace = sa.marketplace AND st.period_start = sa.period_start
        AND st.search_term = sa.search_term
      WHERE ca.client_id = $1
      GROUP BY ca.asin, ca.label
      ORDER BY terms DESC, ca.asin`,
    [clientId, marketplace]
  );
}

export interface ClientTermRow {
  search_term: string;
  rank: number;
  asin: string;
  position: number;
  click_share: number | null;
  weeks_held: number;
}

/**
 * Every term any of a client's products is named for — the portfolio view.
 *
 * One row per term and ASIN, because two of a client's products competing for
 * the same search is itself worth seeing, not something to collapse away.
 */
export async function termsForClient(
  clientId: string, marketplace: string, limit = 300
): Promise<ClientTermRow[]> {
  await ensureSchema();
  return query<ClientTermRow>(
    `WITH hits AS (
       SELECT sa.search_term, sa.asin,
              COUNT(*)::int AS weeks_held,
              MAX(sa.period_start) AS latest
         FROM search_term_asins sa
         JOIN client_asins ca ON ca.asin = sa.asin AND ca.client_id = $1
        WHERE sa.marketplace = $2
        GROUP BY sa.search_term, sa.asin
     )
     SELECT h.search_term, t.rank, h.asin, sa.position, sa.click_share, h.weeks_held
       FROM hits h
       JOIN search_term_asins sa
         ON sa.marketplace = $2 AND sa.asin = h.asin
        AND sa.search_term = h.search_term AND sa.period_start = h.latest
       JOIN search_terms t
         ON t.marketplace = $2 AND t.period_start = h.latest AND t.search_term = h.search_term
      ORDER BY t.rank ASC
      LIMIT ${Number(limit) || 300}`,
    [clientId, marketplace]
  );
}
