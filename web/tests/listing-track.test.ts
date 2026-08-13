import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  dayKey, emptyRecord, evictOldest, historyToTsv, mergeObservation, summarise, whatChanged,
} from "../../extension/src/track.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-05-01T10:00:00").getTime();   // local time on purpose

function obs(over: Record<string, unknown> = {}) {
  return {
    at: T0, price: 1499, currency: "₹", seller: "Packster", sellerId: "A1SELLER",
    fulfilment: "Amazon", hasBuyBox: true, title: "Packster Backpack",
    marketplace: "IN", source: "product page", ...over,
  };
}

/** Applies a series of observations in order, as repeated visits would. */
function build(observations: Array<Record<string, unknown>>) {
  let record = emptyRecord("B0TEST1234", "IN");
  for (const o of observations) record = mergeObservation(record, obs(o));
  return record;
}

test("a repeat visit with nothing changed is not recorded twice", () => {
  const record = build([
    { at: T0 },
    { at: T0 + 60 * 1000 },          // a refresh a minute later
    { at: T0 + 5 * 60 * 1000 },      // and another
  ]);
  assert.equal(record.events.length, 1);
});

test("a change within the same day is recorded", () => {
  const record = build([
    { at: T0 },
    { at: T0 + 60 * 1000, price: 1399 },
    { at: T0 + 120 * 1000, seller: "Bagworld" },
  ]);
  assert.equal(record.events.length, 3);
});

test("a new day is recorded even when nothing changed", () => {
  const record = build([{ at: T0 }, { at: T0 + DAY }, { at: T0 + 2 * DAY }]);
  assert.equal(record.events.length, 3);
  assert.equal(new Set(record.events.map(e => dayKey(e.at))).size, 3);
});

test("highest and lowest come back with the day they happened", () => {
  const record = build([
    { at: T0, price: 1499 },
    { at: T0 + DAY, price: 1199 },
    { at: T0 + 2 * DAY, price: 1799 },
    { at: T0 + 3 * DAY, price: 1299 },
  ]);
  const s = summarise(record, { now: T0 + 3 * DAY });
  assert.equal(s.price.min.value, 1199);
  assert.equal(dayKey(s.price.min.at), dayKey(T0 + DAY));
  assert.equal(s.price.max.value, 1799);
  assert.equal(dayKey(s.price.max.at), dayKey(T0 + 2 * DAY));
  assert.equal(s.price.current, 1299);
  assert.equal(s.price.changes, 3);
  assert.equal(s.price.dailyChanges, 3);
});

test("changes count every observed move, not only day-to-day ones", () => {
  // Three looks in one morning as the price is cut and partly restored.
  const record = build([
    { at: T0, price: 1499 },
    { at: T0 + 60 * 60 * 1000, price: 1299 },
    { at: T0 + 2 * 60 * 60 * 1000, price: 1399 },
  ]);
  const s = summarise(record, { now: T0 + DAY });
  assert.equal(s.price.changes, 2, "two moves were seen");
  assert.equal(s.price.dailyChanges, 0, "but the day closed once");
  assert.equal(s.price.min.value, 1299);
  assert.equal(s.price.max.value, 1499);
});

test("a price cut and restored inside one day still counts as the low", () => {
  const record = build([
    { at: T0, price: 1499 },
    { at: T0 + 60 * 60 * 1000, price: 999 },      // a flash cut
    { at: T0 + 2 * 60 * 60 * 1000, price: 1499 }, // put back the same day
  ]);
  const s = summarise(record, { now: T0 + DAY });
  assert.equal(s.price.min.value, 999);
  // The daily series takes the day's last state, so the day closes at 1499.
  assert.equal(s.series.length, 1);
  assert.equal(s.series[0].price, 1499);
});

test("Buy Box share is weighted by day, not by how often you refreshed", () => {
  const record = build([
    // Day one: looked at five times, all Packster.
    { at: T0 }, { at: T0 + 1000, price: 1498 }, { at: T0 + 2000, price: 1497 },
    { at: T0 + 3000, price: 1496 }, { at: T0 + 4000, price: 1495 },
    // Day two: a competitor holds it.
    { at: T0 + DAY, seller: "Bagworld", sellerId: "A2OTHER" },
  ]);
  const s = summarise(record, { now: T0 + DAY });
  assert.equal(s.daysObserved, 2);
  const packster = s.buyBox.holders.find(h => h.seller === "Packster")!;
  const bagworld = s.buyBox.holders.find(h => h.seller === "Bagworld")!;
  // Five looks on one day is one day, not five.
  assert.equal(packster.days, 1);
  assert.equal(bagworld.days, 1);
  assert.equal(Math.round(packster.share * 100), 50);
  assert.equal(Math.round(bagworld.share * 100), 50);
});

test("the share reflects who held it, across a longer run", () => {
  const days = Array.from({ length: 10 }, (_, i) => ({
    at: T0 + i * DAY,
    seller: i < 8 ? "Packster" : "Bagworld",
    sellerId: i < 8 ? "A1SELLER" : "A2OTHER",
  }));
  const s = summarise(build(days), { now: T0 + 9 * DAY });
  const holders = s.buyBox.holders;
  assert.equal(holders[0].seller, "Packster");
  assert.equal(Math.round(holders[0].share * 100), 80);
  assert.equal(Math.round(holders[1].share * 100), 20);
  assert.equal(s.buyBox.current, "Bagworld");
  assert.equal(s.buyBox.switches, 1);
  assert.equal(s.buyBox.contested, true);
});

test("days with no Buy Box at all count against everyone's share", () => {
  const s = summarise(build([
    { at: T0 }, { at: T0 + DAY },
    { at: T0 + 2 * DAY, hasBuyBox: false, seller: null },
    { at: T0 + 3 * DAY, hasBuyBox: false, seller: null },
  ]), { now: T0 + 3 * DAY });
  assert.equal(s.buyBox.daysWithoutBuyBox, 2);
  assert.equal(s.buyBox.holders[0].days, 2);
  // Two of four observed days, not two of the two days somebody held it.
  assert.equal(Math.round(s.buyBox.holders[0].share * 100), 50);
  assert.equal(s.buyBox.hasBuyBox, false);
});

test("observations older than the window are excluded from the figures", () => {
  const s = summarise(build([
    { at: T0, price: 500 },                  // 100 days before "now"
    { at: T0 + 95 * DAY, price: 1499 },
    { at: T0 + 100 * DAY, price: 1299 },
  ]), { now: T0 + 100 * DAY });
  assert.equal(s.daysObserved, 2);
  assert.equal(s.price.min.value, 1299, "the 500 was outside the 90-day window");
});

test("coverage is reported, and thin coverage is flagged", () => {
  const thin = summarise(build([{ at: T0 }, { at: T0 + DAY }]), { now: T0 + DAY });
  assert.equal(thin.coverage.daysObserved, 2);
  assert.equal(thin.coverage.windowDays, 90);
  assert.equal(thin.coverage.thin, true);

  const solid = summarise(build(
    Array.from({ length: 30 }, (_, i) => ({ at: T0 + i * DAY }))
  ), { now: T0 + 29 * DAY });
  assert.equal(solid.coverage.daysObserved, 30);
  assert.equal(solid.coverage.percent, 33);
  assert.equal(solid.coverage.thin, false);
});

test("an empty record summarises to nothing rather than to zeroes", () => {
  const s = summarise(emptyRecord("B0TEST1234", "IN"), { now: T0 });
  assert.equal(s.empty, true);
  assert.equal(s.price, null);
  assert.equal(s.buyBox, null);
  assert.equal(s.daysObserved, 0);
});

test("what changed since the last visit is reported for the alert", () => {
  const record = build([{ at: T0, price: 1499, seller: "Packster" }]);

  const sellerMoved = whatChanged(record, obs({ at: T0 + DAY, seller: "Bagworld" }));
  assert.equal(sellerMoved.seller.from, "Packster");
  assert.equal(sellerMoved.seller.to, "Bagworld");
  assert.equal(sellerMoved.price, null);

  const priceMoved = whatChanged(record, obs({ at: T0 + DAY, price: 1299 }));
  assert.deepEqual(
    { from: priceMoved.price.from, to: priceMoved.price.to },
    { from: 1499, to: 1299 },
  );

  const lost = whatChanged(record, obs({ at: T0 + DAY, hasBuyBox: false }));
  assert.equal(lost.lost, true);

  const nothing = whatChanged(record, obs({ at: T0 + DAY }));
  assert.equal(nothing.price, null);
  assert.equal(nothing.seller, null);
  assert.equal(nothing.lost, false);
});

test("the first observation is marked as first, not as a change", () => {
  const change = whatChanged(emptyRecord("B0TEST1234", "IN"), obs());
  assert.equal(change.first, true);
  assert.equal(change.seller, null);
  assert.equal(change.price, null);
});

test("the exported history carries every observation and states its own limits", () => {
  const record = build([
    { at: T0, price: 1499 },
    { at: T0 + DAY, price: 1299, seller: "Bagworld" },
  ]);
  const text = historyToTsv(record, summarise(record, { now: T0 + DAY }));
  const lines = text.split("\n");
  assert.equal(lines[0].split("\t").length, 10);
  assert.equal(lines[1].split("\t").length, 10);
  assert.ok(text.includes("B0TEST1234"));
  assert.ok(text.includes("Bagworld"));
  // The caveat travels with the data, so a pasted sheet cannot lose it.
  assert.match(text, /Observed on 2 of the last 90 days/);
  assert.match(text, /of days observed, not of elapsed time/);
});

test("the oldest listings are dropped once the cap is passed", () => {
  const records: Record<string, { lastSeen: number }> = {};
  for (let i = 0; i < 405; i++) records[`track:IN:B0${i}`] = { lastSeen: T0 + i * 1000 };
  const { kept, removed } = evictOldest(records, 400);
  assert.equal(Object.keys(kept).length, 400);
  assert.equal(removed.length, 5);
  // The five least recently seen go.
  assert.ok(removed.includes("track:IN:B00"));
  assert.ok(!removed.includes("track:IN:B0404"));
});
