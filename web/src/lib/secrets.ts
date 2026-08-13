import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Encryption for the Amazon credentials.
 *
 * The refresh token is a bearer credential to a live Selling Partner account:
 * anyone holding it can pull reports, and it does not expire on its own. It
 * therefore cannot sit in the database in plain text, and it cannot be
 * encrypted with a key that also sits in the database — that is obfuscation,
 * not encryption, because whoever reads one row reads the other.
 *
 * So the key comes from the environment, where the database has no reach.
 * AES-256-GCM, which authenticates as well as encrypts: a tampered ciphertext
 * fails to decrypt rather than yielding plausible rubbish.
 */

const ALGORITHM = "aes-256-gcm";

export class MissingKeyError extends Error {
  constructor() {
    super("SPAPI_ENCRYPTION_KEY is not set, so Amazon credentials cannot be stored safely.");
    this.name = "MissingKeyError";
  }
}

/**
 * A 32-byte key from the environment variable.
 *
 * Accepts a 64-character hex string, which is what the settings screen
 * generates. Anything else is hashed to 32 bytes rather than rejected, so a
 * passphrase someone types by hand still works instead of failing at the point
 * they try to save credentials.
 */
function key(): Buffer {
  const raw = process.env.SPAPI_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) throw new MissingKeyError();
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export function hasEncryptionKey(): boolean {
  try { key(); return true; } catch { return false; }
}

/** Suggests a key for the operator to paste into their hosting settings. */
export function suggestKey(): string {
  return randomBytes(32).toString("hex");
}

/** iv.tag.ciphertext, all base64url, so it survives any column type. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map(b => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const parts = String(payload || "").split(".");
  if (parts.length !== 3) throw new Error("Stored credential is not in the expected format.");
  const [iv, tag, body] = parts.map(p => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * The last four characters, for showing which credential is stored without
 * revealing it. Never show more: a refresh token is long enough that a
 * generous "preview" would be most of the secret.
 */
export function fingerprint(secret: string): string {
  if (!secret) return "";
  return `…${secret.slice(-4)}`;
}
