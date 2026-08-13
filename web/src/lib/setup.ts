/**
 * First-run setup.
 *
 * The app creates its own tables and walks you through making the first admin
 * in the browser, so a deployment can't end up in the state where it looks
 * live but nobody can sign in because a setup command was never run.
 */
import { query, queryOne } from "./db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS runs (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  marketplace    TEXT NOT NULL,
  currency       TEXT NOT NULL,
  target_acos    DOUBLE PRECISION NOT NULL,
  sensitivity    TEXT NOT NULL,
  file_names     TEXT NOT NULL DEFAULT '',
  spend          DOUBLE PRECISION NOT NULL DEFAULT 0,
  sales          DOUBLE PRECISION NOT NULL DEFAULT 0,
  clicks         BIGINT NOT NULL DEFAULT 0,
  orders         BIGINT NOT NULL DEFAULT 0,
  bid_changes    INTEGER NOT NULL DEFAULT 0,
  negatives      INTEGER NOT NULL DEFAULT 0,
  harvest        INTEGER NOT NULL DEFAULT 0,
  wasted_spend   DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_user_id_ran_at_idx ON runs (user_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS runs_ran_at_idx ON runs (ran_at DESC);

/* Selling Partner API credentials. One row per marketplace: the secrets are
   encrypted with a key from the environment, never stored as they arrive. */
CREATE TABLE IF NOT EXISTS spapi_accounts (
  marketplace   TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT NOT NULL DEFAULT '',
  last_ok_at    TIMESTAMPTZ,
  last_error    TEXT
);

/* A report takes minutes to generate, which is longer than any serverless
   function may run. So a pull is a job: one request starts it, later runs
   collect it. */
CREATE TABLE IF NOT EXISTS spapi_jobs (
  id           BIGSERIAL PRIMARY KEY,
  marketplace  TEXT NOT NULL,
  report_id    TEXT NOT NULL,
  report_type  TEXT NOT NULL,
  period       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'waiting',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  rows_stored  INTEGER NOT NULL DEFAULT 0,
  detail       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS spapi_jobs_status_idx ON spapi_jobs (status, started_at DESC);

/* Search Frequency Rank per term, per reporting period. */
CREATE TABLE IF NOT EXISTS search_terms (
  marketplace  TEXT NOT NULL,
  period_start DATE NOT NULL,
  search_term  TEXT NOT NULL,
  department   TEXT,
  rank         INTEGER NOT NULL,
  PRIMARY KEY (marketplace, period_start, search_term)
);
CREATE INDEX IF NOT EXISTS search_terms_rank_idx ON search_terms (marketplace, rank);
CREATE INDEX IF NOT EXISTS search_terms_term_idx ON search_terms (marketplace, search_term);

/* Which ASINs took the clicks for each term — what makes a reverse lookup
   from an ASIN back to its terms a fact rather than an estimate. */
CREATE TABLE IF NOT EXISTS search_term_asins (
  marketplace      TEXT NOT NULL,
  period_start     DATE NOT NULL,
  search_term      TEXT NOT NULL,
  asin             TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 1,
  title            TEXT,
  click_share      DOUBLE PRECISION,
  conversion_share DOUBLE PRECISION,
  PRIMARY KEY (marketplace, period_start, search_term, asin)
);
CREATE INDEX IF NOT EXISTS search_term_asins_asin_idx ON search_term_asins (marketplace, asin);
`;

let schemaReady = false;

/** Creates the tables if they aren't there yet. Cheap after the first call. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await query(SCHEMA);
  schemaReady = true;
}

export type SetupState =
  | { state: "no-database"; detail: string }
  | { state: "needs-admin" }
  | { state: "ready" };

/**
 * Distinguishes "the database isn't reachable" from "nobody has signed up yet",
 * so the screen can say which one it is instead of a generic failure.
 */
export async function setupState(): Promise<SetupState> {
  try {
    await ensureSchema();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { state: "no-database", detail };
  }
  const row = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
  return (row?.n ?? 0) === 0 ? { state: "needs-admin" } : { state: "ready" };
}
