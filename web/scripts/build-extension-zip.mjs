/**
 * Packs ../extension into assets/listing-audit-extension.zip so the web app
 * can hand it to anyone on the team.
 *
 * Three things shape this script.
 *
 * **It writes a committed artifact, not a build output.** Vercel deploys with
 * the root directory set to `web`, and whether files above it reach the build
 * depends on a project setting that is off by default. Relying on it would
 * mean the download silently 404s after a deploy nobody thought to check. So
 * the zip is committed, and this script regenerates it whenever the extension
 * changes.
 *
 * **It lives in `assets/`, not `public/`.** Anything in `public/` is served to
 * the world by URL with no session involved, and this download is behind the
 * sign-in. A route handler reads it from here instead, and next.config traces
 * it into the deployed function.
 *
 * **The output is deterministic.** Entries are sorted and every timestamp is
 * fixed, so identical sources produce byte-identical zips. Without that, a
 * committed binary would churn on every run and every diff would be noise.
 *
 * **It runs as part of the build, and regenerates rather than verifies.** An
 * earlier version failed the build when the committed archive had drifted.
 * That was the wrong trade: it blocked deploying unrelated fixes because a
 * download artifact was stale, and it did exactly that here — two commits
 * shipped an archive packed moments before the extension's README changed, so
 * every deploy after them failed and the new page never went live. Rebuilding
 * costs milliseconds and makes drift impossible. `--check` is still available
 * for a pre-commit sanity check; it just no longer gates a deploy.
 *
 * No archiver dependency: a zip is a handful of documented records, and
 * zlib is already in Node.
 */
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const EXTENSION = new URL("../../extension/", import.meta.url).pathname;
const ASSETS = new URL("../assets/", import.meta.url).pathname;
const ZIP = join(ASSETS, "listing-audit-extension.zip");
const INFO = join(ASSETS, "extension-build.json");

/** The folder name the zip extracts to — what Chrome is then pointed at. */
const ROOT = "listing-audit";

/** Development-only files that would only confuse someone loading it. */
const SKIP = [/(^|\/)\.git/, /(^|\/)tools\//, /\.DS_Store$/];

function collect(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = relative(base, full).split(sep).join("/");
    if (SKIP.some(re => re.test(rel))) continue;
    if (statSync(full).isDirectory()) out.push(...collect(full, base));
    else out.push({ path: rel, data: readFileSync(full) });
  }
  // Sorted by path so the archive is reproducible whatever the filesystem does.
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return ~crc >>> 0;
}

// A fixed DOS timestamp: 1 January 2020, 00:00. Any constant will do; what
// matters is that it never varies, so the bytes depend only on the content.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(`${ROOT}/${file.path}`, "utf8");
    const deflated = deflateRawSync(file.data, { level: 9 });
    // Storing beats deflating when deflating made it bigger — tiny files do this.
    const stored = deflated.length >= file.data.length;
    const body = stored ? file.data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);            // extra field length
    locals.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);            // version made by
    entry.writeUInt16LE(20, 6);            // version needed
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);            // extra
    entry.writeUInt16LE(0, 32);            // comment
    entry.writeUInt16LE(0, 34);            // disk number
    entry.writeUInt16LE(0, 36);            // internal attributes
    entry.writeUInt32LE(0o644 << 16, 38);  // external attributes
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

/* ------------------------------------------------------------------ */

const mode = process.argv.includes("--check") ? "check" : "write";

if (!existsSync(EXTENSION)) {
  // A deploy built from the web folder alone still ships the committed zip.
  console.log("extension/ is not in this checkout — keeping the committed archive");
  process.exit(0);
}

const files = collect(EXTENSION);
const manifest = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8"));
const archive = zip(files);
const sha256 = createHash("sha256").update(archive).digest("hex");

const info = {
  name: manifest.name,
  version: manifest.version,
  files: files.length,
  bytes: archive.length,
  sha256,
  folder: ROOT,
  // Not the build time: that would change on every run and defeat the point
  // of a reproducible archive. This is what the archive contains.
  sourceHash: createHash("sha256")
    .update(files.map(f => `${f.path}:${createHash("sha256").update(f.data).digest("hex")}`).join("\n"))
    .digest("hex")
    .slice(0, 16),
};

if (mode === "check") {
  /* Compared on the *source* hash, never on the archive's bytes.
     zlib's output is not guaranteed identical across versions, so a build
     machine running a different Node than the one that wrote the archive would
     produce different compressed bytes from identical sources — and a check on
     those bytes would fail a deploy over nothing at all. Which files with
     which contents went in is the thing that actually matters, and it is
     stable everywhere. */
  const recorded = existsSync(INFO) ? JSON.parse(readFileSync(INFO, "utf8")) : null;
  if (!existsSync(ZIP) || !recorded) {
    console.error(
      "The extension archive is missing.\n"
      + "Run:  npm run build:extension\n"
      + "then commit web/assets/listing-audit-extension.zip and extension-build.json."
    );
    process.exit(1);
  }
  if (recorded.sourceHash === info.sourceHash) {
    console.log(`extension archive is current (v${info.version}, ${files.length} files)`);
    process.exit(0);
  }
  console.error(
    "The committed extension archive is out of date — extension/ has changed since it was packed.\n"
    + `  packed:  ${recorded.sourceHash} (${recorded.files} files)\n`
    + `  current: ${info.sourceHash} (${files.length} files)\n`
    + "Run:  npm run build:extension\n"
    + "then commit web/assets/listing-audit-extension.zip and extension-build.json."
  );
  process.exit(1);
}

mkdirSync(ASSETS, { recursive: true });
writeFileSync(ZIP, archive);
writeFileSync(INFO, JSON.stringify(info, null, 2) + "\n");
console.log(`wrote assets/listing-audit-extension.zip — v${info.version}, ${files.length} files, ${(archive.length / 1024).toFixed(1)} kB`);
