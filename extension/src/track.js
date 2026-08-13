/**
 * Buy Box and price history, built out of what you happen to look at.
 *
 * The honest description of this file matters more than the code in it. The
 * extension has no server and makes no requests: it sees a listing only when
 * you open the listing. So this is not a crawler's history, it is a log of
 * observations, and every number it reports is phrased against the days you
 * actually looked rather than against the calendar.
 *
 * That distinction is not pedantry. "Held the Buy Box 80% of the time" and
 * "held it on 80% of the days you checked" differ enormously if you check on
 * weekday mornings and the competitor undercuts at weekends. Tools that
 * quote a true time-share — Keepa and the rest — poll from server fleets on a
 * schedule. Doing that from your browser means requesting product pages on a
 * timer, which is the one thing that puts a household IP in front of a
 * CAPTCHA. So the coverage figure is reported beside every percentage, and
 * the panel says how many of the last 90 days it is speaking for.
 *
 * Everything here is pure: records in, summary out. The storage lives in
 * content.js, which keeps this testable.
 */

/** The window the seller asked to see, and how long raw events are kept. */
export const WINDOW_DAYS = 90;
const RETAIN_DAYS = 180;

/** Guards against a long-lived install growing without bound. */
const MAX_EVENTS = 1500;
export const MAX_TRACKED = 400;

const DAY = 24 * 60 * 60 * 1000;

/** Local calendar day, so "daily" means the seller's day, not UTC's. */
export function dayKey(timestamp) {
  const d = new Date(timestamp);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function emptyRecord(asin, marketplace) {
  return { asin, marketplace, title: null, events: [] };
}

/**
 * Adds an observation, if it says anything the last one did not.
 *
 * A refresh five minutes later with the same price and the same seller is not
 * new information, and storing it would quietly weight that day more heavily
 * in every average. So an event is kept when the state changed, or when the
 * day changed — one heartbeat a day, plus every change within it.
 */
export function mergeObservation(record, observation) {
  const events = record.events.slice();
  const last = events[events.length - 1];
  const at = observation.at ?? Date.now();

  const changed = !last
    || last.price !== observation.price
    || last.seller !== observation.seller
    || last.hasBuyBox !== observation.hasBuyBox
    || dayKey(last.at) !== dayKey(at);

  if (changed) {
    events.push({
      at,
      price: observation.price ?? null,
      currency: observation.currency ?? null,
      seller: observation.seller ?? null,
      sellerId: observation.sellerId ?? null,
      fulfilment: observation.fulfilment ?? null,
      hasBuyBox: observation.hasBuyBox ?? null,
      source: observation.source ?? "product page",
    });
  }

  const cutoff = at - RETAIN_DAYS * DAY;
  const kept = events.filter(e => e.at >= cutoff).slice(-MAX_EVENTS);

  return {
    ...record,
    title: observation.title ?? record.title,
    marketplace: observation.marketplace ?? record.marketplace,
    events: kept,
    lastSeen: at,
    firstSeen: record.firstSeen ?? kept[0]?.at ?? at,
  };
}

/** True when this observation differs from the one before it. */
export function whatChanged(record, observation) {
  const last = record.events[record.events.length - 1];
  if (!last) return { first: true, price: null, seller: null };
  return {
    first: false,
    price: last.price !== observation.price && last.price !== null && observation.price !== null
      ? { from: last.price, to: observation.price, at: last.at }
      : null,
    seller: last.seller !== observation.seller && last.seller && observation.seller
      ? { from: last.seller, to: observation.seller, at: last.at }
      : null,
    lost: last.hasBuyBox && observation.hasBuyBox === false,
    regained: last.hasBuyBox === false && observation.hasBuyBox === true,
  };
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function inWindow(events, now, windowDays) {
  const cutoff = now - windowDays * DAY;
  return events.filter(e => e.at >= cutoff);
}

/** The state at the end of each observed day — one row per day, most recent last. */
function dailySeries(events) {
  const byDay = new Map();
  for (const event of events) byDay.set(dayKey(event.at), event);
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, event]) => ({ day, ...event }));
}

/**
 * @param record  as stored
 * @param options { windowDays, now }
 */
export function summarise(record, options = {}) {
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const now = options.now ?? Date.now();
  const events = inWindow(record.events ?? [], now, windowDays);
  const series = dailySeries(events);

  if (!events.length) {
    return {
      windowDays, observations: 0, daysObserved: 0, series: [],
      coverage: { daysObserved: 0, windowDays, percent: 0, spanDays: 0 },
      price: null, buyBox: null, empty: true,
    };
  }

  /* ---- price ---- */
  const priced = events.filter(e => typeof e.price === "number");
  const dailyPriced = series.filter(d => typeof d.price === "number");
  let price = null;
  if (priced.length) {
    // Highest and lowest come from every observation, not only the daily
    // close: a price that was cut and restored inside one day still happened.
    let min = priced[0];
    let max = priced[0];
    for (const event of priced) {
      if (event.price < min.price) min = event;
      if (event.price > max.price) max = event;
    }
    // Counted across every observation, not across daily closes: a price that
    // moved twice before lunch moved twice, and reporting "0 changes" beside a
    // low and a high that differ reads as a bug even when the day-close
    // reasoning behind it is sound.
    let changes = 0;
    for (let i = 1; i < priced.length; i++) {
      if (priced[i].price !== priced[i - 1].price) changes += 1;
    }
    let dailyChanges = 0;
    for (let i = 1; i < dailyPriced.length; i++) {
      if (dailyPriced[i].price !== dailyPriced[i - 1].price) dailyChanges += 1;
    }
    const current = priced[priced.length - 1];
    const values = priced.map(e => e.price).sort((a, b) => a - b);
    price = {
      current: current.price,
      currency: current.currency,
      at: current.at,
      min: { value: min.price, at: min.at },
      max: { value: max.price, at: max.at },
      median: values[Math.floor(values.length / 2)],
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      changes,
      dailyChanges,
      // Where today's price sits between the observed floor and ceiling.
      position: max.price === min.price ? null
        : (current.price - min.price) / (max.price - min.price),
      observations: priced.length,
    };
  }

  /* ---- Buy Box ---- */
  // Day-weighted deliberately: refreshing a page twenty times in one morning
  // must not make that morning count for twenty days of Buy Box ownership.
  const holders = new Map();
  let daysWithoutBuyBox = 0;
  for (const day of series) {
    if (day.hasBuyBox === false) { daysWithoutBuyBox += 1; continue; }
    const name = day.seller;
    if (!name) continue;
    const entry = holders.get(name) ?? { seller: name, sellerId: day.sellerId ?? null, days: 0, lastAt: 0 };
    entry.days += 1;
    entry.lastAt = Math.max(entry.lastAt, day.at);
    holders.set(name, entry);
  }
  const namedDays = [...holders.values()].reduce((s, h) => s + h.days, 0);
  const denominator = namedDays + daysWithoutBuyBox;

  let switches = 0;
  const named = series.filter(d => d.seller);
  for (let i = 1; i < named.length; i++) {
    if (named[i].seller !== named[i - 1].seller) switches += 1;
  }

  const latest = events[events.length - 1];
  const buyBox = {
    current: latest.hasBuyBox === false ? null : latest.seller,
    currentId: latest.sellerId ?? null,
    fulfilment: latest.fulfilment ?? null,
    hasBuyBox: latest.hasBuyBox,
    holders: [...holders.values()]
      .map(h => ({ ...h, share: denominator ? h.days / denominator : 0 }))
      .sort((a, b) => b.days - a.days || b.lastAt - a.lastAt),
    switches,
    daysWithoutBuyBox,
    daysWithBuyBox: namedDays,
    contested: holders.size > 1,
  };

  const spanDays = Math.max(1, Math.round((events[events.length - 1].at - events[0].at) / DAY) + 1);

  return {
    windowDays,
    observations: events.length,
    daysObserved: series.length,
    series,
    coverage: {
      daysObserved: series.length,
      windowDays,
      percent: Math.round((series.length / windowDays) * 100),
      spanDays,
      // Below this the percentages are being asked to carry more than they can.
      thin: series.length < 7,
    },
    price,
    buyBox,
    empty: false,
  };
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function historyToTsv(record, summary) {
  const header = ["Date", "Time", "ASIN", "Price", "Currency", "Buy Box seller", "Seller ID", "Fulfilment", "Buy Box present", "Source"];
  const lines = [header.join("\t")];
  for (const event of record.events ?? []) {
    const when = new Date(event.at);
    lines.push([
      dayKey(event.at),
      when.toTimeString().slice(0, 5),
      record.asin,
      event.price ?? "",
      event.currency ?? "",
      (event.seller ?? "").replace(/\t/g, " "),
      event.sellerId ?? "",
      event.fulfilment ?? "",
      event.hasBuyBox === null ? "" : event.hasBuyBox ? "Yes" : "No",
      event.source ?? "",
    ].join("\t"));
  }
  if (summary && !summary.empty) {
    lines.push("");
    lines.push(`Observed on ${summary.daysObserved} of the last ${summary.windowDays} days — every percentage below is of days observed, not of elapsed time.`);
    if (summary.price) {
      lines.push(`Price now ${summary.price.current}, lowest ${summary.price.min.value} on ${dayKey(summary.price.min.at)}, highest ${summary.price.max.value} on ${dayKey(summary.price.max.at)}, ${summary.price.changes} change(s).`);
    }
    for (const holder of summary.buyBox?.holders ?? []) {
      lines.push(`Buy Box ${holder.seller}: ${holder.days} day(s), ${Math.round(holder.share * 100)}% of days observed.`);
    }
  }
  return lines.join("\n");
}

/** Storage key for one tracked listing. */
export const keyFor = (marketplace, asin) => `track:${marketplace}:${asin}`;

/**
 * Drops the least recently seen listings once the cap is passed, so the log
 * cannot grow forever on a browser that visits thousands of pages.
 */
export function evictOldest(records, max = MAX_TRACKED) {
  const entries = Object.entries(records);
  if (entries.length <= max) return { kept: records, removed: [] };
  entries.sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0));
  const kept = Object.fromEntries(entries.slice(0, max));
  return { kept, removed: entries.slice(max).map(e => e[0]) };
}
