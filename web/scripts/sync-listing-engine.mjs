/**
 * Copies the extension's listing engine into the web app.
 *
 * The rules that score a title — byte limits, prohibited claims, trademarked
 * names, the mechanical title correction — were written for the extension and
 * are tested there. The listing builder needs exactly the same rules: a title
 * the builder calls clean must be a title the extension's audit passes, or the
 * two tools contradict each other in front of the seller.
 *
 * Sharing by import is not available. Vercel builds with the root directory
 * set to `web`, so `../extension` may not exist at build time — the same
 * constraint that made the extension archive a committed artifact. So the file
 * is copied in, committed, and regenerated on every build from the original
 * when the original is present. One source of truth, mechanically enforced,
 * rather than two copies drifting quietly apart.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const SOURCE = new URL("../../extension/src/audit.js", import.meta.url).pathname;
const TARGET = new URL("../src/lib/listing-engine.js", import.meta.url).pathname;

const BANNER = `/* GENERATED FILE — DO NOT EDIT.
 *
 * Copied from extension/src/audit.js by scripts/sync-listing-engine.mjs, which
 * runs on every build. Edit the original; this copy is overwritten.
 *
 * It exists because the web app and the Chrome extension must apply identical
 * listing rules, and Vercel's build cannot see outside the web folder.
 */
`;

if (!existsSync(SOURCE)) {
  console.log("extension/src/audit.js is not in this checkout — keeping the committed copy");
  process.exit(0);
}

const source = readFileSync(SOURCE, "utf8");
const next = BANNER + source;
const current = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : null;

if (current === next) {
  console.log("listing engine is in step with the extension");
} else {
  mkdirSync(new URL("../src/lib/", import.meta.url).pathname, { recursive: true });
  writeFileSync(TARGET, next);
  console.log("synced src/lib/listing-engine.js from the extension");
}
