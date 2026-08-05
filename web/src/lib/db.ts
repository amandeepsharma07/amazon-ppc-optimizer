import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __ppcPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  // Hosted Postgres (Neon, Supabase, Vercel) requires TLS; a local dev server
  // usually has none, so only ask for it when the URL says so.
  const wantsSsl = /sslmode=require/.test(connectionString);
  return new Pool({
    connectionString,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
}

/** Reused across hot reloads and serverless invocations in the same container. */
export function pool(): Pool {
  if (!global.__ppcPool) global.__ppcPool = makePool();
  return global.__ppcPool;
}

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length ? rows[0] : null;
}
