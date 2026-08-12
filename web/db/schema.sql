-- Schema for the PPC optimizer web app.
-- Ad reports are analysed in the browser and never uploaded, so nothing here
-- stores keyword-level data: only who has access and a summary of each run.

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

-- Sessions live in the database rather than in a self-contained token so that
-- disabling a user or deleting a session takes effect on the next request.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- One row per analysis, for the history view and the admin audit trail.
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
