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
