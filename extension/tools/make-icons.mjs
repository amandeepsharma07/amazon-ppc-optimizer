/**
 * Generates the extension icons.
 *
 * Committing binary PNGs without the thing that produced them makes them
 * impossible to change later, so the drawing lives here: a rounded navy tile
 * with three ascending bars. Run `node tools/make-icons.mjs` from the
 * extension folder after editing.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [35, 47, 62, 255];      // #232F3E
const BAR = [255, 153, 0, 255];    // #FF9900
const BAR_DIM = [255, 190, 105, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no per-row filter
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Coverage of the pixel by the shape, sampled 4×4 so edges are not jagged. */
function coverage(x, y, inside) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
    }
  }
  return hits / 16;
}

function blend(dst, offset, colour, alpha) {
  for (let i = 0; i < 3; i++) {
    dst[offset + i] = Math.round(dst[offset + i] * (1 - alpha) + colour[i] * alpha);
  }
  dst[offset + 3] = Math.max(dst[offset + 3], Math.round(colour[3] * alpha));
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;             // corner radius
  const inTile = (fx, fy) => {
    const cx = Math.min(Math.max(fx, r), size - r);
    const cy = Math.min(Math.max(fy, r), size - r);
    return (fx - cx) ** 2 + (fy - cy) ** 2 <= r * r;
  };

  // Three bars, ascending, sitting on a shared baseline.
  const pad = size * 0.22;
  const width = (size - pad * 2) / 5;   // three bars, two gaps of the same width
  const base = size - pad;
  const bars = [0.34, 0.58, 0.86].map((height, i) => ({
    x0: pad + i * width * 2,
    x1: pad + i * width * 2 + width,
    y0: base - (size - pad * 2) * height,
    y1: base,
    colour: i === 2 ? BAR : BAR_DIM,
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const tile = coverage(x, y, inTile);
      if (tile > 0) blend(px, off, BG, tile);
      for (const bar of bars) {
        const a = coverage(x, y, (fx, fy) => fx >= bar.x0 && fx <= bar.x1 && fy >= bar.y0 && fy <= bar.y1);
        if (a > 0) blend(px, off, bar.colour, a * tile);
      }
    }
  }
  return px;
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = new URL(`../icons/icon${size}.png`, import.meta.url);
  writeFileSync(file, png(size, draw(size)));
  console.log(`wrote icons/icon${size}.png`);
}
