/**
 * Creates the tables and the first admin account.
 * Safe to run more than once: tables use IF NOT EXISTS and an existing admin
 * is left alone rather than having its password reset.
 *
 *   node --experimental-strip-types scripts/init-db.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// pg ships as CommonJS, so take the default export when running under plain node.
import pg from "pg";
const { Pool } = pg;
import { hashPassword, passwordProblem } from "../src/lib/password.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.");
  }
  const problem = passwordProblem(ADMIN_PASSWORD);
  if (problem) throw new Error(`ADMIN_PASSWORD is too weak. ${problem}`);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });

  const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Tables ready.");

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rowCount) {
    console.log(`Admin ${email} already exists — leaving its password unchanged.`);
  } else {
    await pool.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
      [email, "Administrator", await hashPassword(ADMIN_PASSWORD)]
    );
    console.log(`Created admin ${email}.`);
  }

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
  console.log(`Users in database: ${rows[0].n}`);
  await pool.end();
}

main().catch(err => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
