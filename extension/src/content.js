/**
 * The content script: the only file Chrome injects directly.
 *
 * Its job is timing and plumbing, not logic. The engine and the panel are ES
 * modules, which a manifest v3 content script cannot declare directly, so they
 * are pulled in with a dynamic import from the extension's own URL — that is
 * why they appear in web_accessible_resources.
 *
 * Two pieces of timing matter on Amazon:
 *
 *   - The page arrives in stages. Auditing at document_idle catches a listing
 *     with no bullets and no gallery, which would score it far too harshly, so
 *     the run waits until the title and one other block have rendered.
 *   - Choosing a variation (a different size or colour) swaps the whole listing
 *     without a page load. The URL changes, so watching it is enough to know
 *     the audit is now about a different product.
 */

if (!window.__ppcListingAuditLoaded) {
  window.__ppcListingAuditLoaded = true;

  (async () => {
    const [audit, scrape, panel, suggest, extract, track] = await Promise.all([
      import(chrome.runtime.getURL("src/audit.js")),
      import(chrome.runtime.getURL("src/scrape.js")),
      import(chrome.runtime.getURL("src/panel.js")),
      import(chrome.runtime.getURL("src/suggest.js")),
      import(chrome.runtime.getURL("src/extract.js")),
      import(chrome.runtime.getURL("src/track.js")),
    ]);

    const DEFAULTS = { autoOpen: true, titleLimit: 0, tracking: true };
    let current = null;   // { listing, report, suggestions }
    let lastUrl = location.href;

    const settings = () => new Promise(resolve => {
      chrome.storage.sync.get(DEFAULTS, value => resolve({ ...DEFAULTS, ...value }));
    });

    /** Resolves once enough of the page exists to judge it, or after a timeout. */
    function whenReady(timeoutMs = 12000) {
      const ready = () => document.querySelector("#productTitle")
        && (document.querySelector("#feature-bullets, #featurebullets_feature_div")
          || document.querySelector("#altImages, #main-image-container"));
      return new Promise(resolve => {
        if (ready()) return resolve(true);
        const observer = new MutationObserver(() => {
          if (!ready()) return;
          observer.disconnect();
          clearTimeout(timer);
          // One frame of grace: the block that just appeared is usually still filling.
          setTimeout(() => resolve(true), 250);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, timeoutMs);
      });
    }

    function copyReport() {
      if (!current?.report) return Promise.reject(new Error("nothing audited yet"));
      return navigator.clipboard.writeText(
        audit.reportToText(current.report, current.listing)
        + "\n" + suggest.suggestionsToText(current.suggestions)
      );
    }

    function show(state) {
      panel.renderPanel(state, {
        onCopy: copyReport,
        onRerun: () => (state.report ? run({ open: true }) : refreshProducts({ open: true })),
        onClose: () => { if (state.report) panel.renderTitleBadge(state.report, () => show(state), null); },
        onCollapse: collapsed => chrome.storage.sync.set({ collapsed }),
      });
    }

    /* ---------------- tracking ----------------
       History is kept in chrome.storage.local: it is per-device by design and
       far too large for sync, which caps items at 8KB. No extra permission is
       needed for it, so the extension still holds only "storage". */

    const local = {
      get: keys => new Promise(r => chrome.storage.local.get(keys, r)),
      set: value => new Promise(r => chrome.storage.local.set(value, r)),
      remove: keys => new Promise(r => chrome.storage.local.remove(keys, r)),
    };

    /**
     * Records this visit and works out what changed since the last one.
     * Returns what the Tracking tab needs, or null when tracking is off.
     */
    async function record(listing, enabled) {
      const asin = listing.asin;
      const marketplace = listing.marketplace?.code ?? "XX";
      if (!asin) return null;
      const key = track.keyFor(marketplace, asin);
      const stored = (await local.get(key))[key] ?? track.emptyRecord(asin, marketplace);

      const box = listing.buyBox ?? {};
      const observation = {
        at: Date.now(),
        price: extract.parsePrice(box.price ?? listing.price),
        currency: (box.price ?? listing.price ?? "").replace(/[\d.,\s]/g, "").slice(0, 3) || null,
        seller: box.seller ?? null,
        sellerId: box.sellerId ?? null,
        fulfilment: box.fulfilment ?? null,
        hasBuyBox: box.hasBuyBox ?? null,
        title: listing.title,
        marketplace,
        source: "product page",
      };

      const changes = track.whatChanged(stored, observation);

      if (!enabled) {
        // Still report on what is already stored, but add nothing to it.
        return { summary: track.summarise(stored), changes: null, paused: true, record: stored, key };
      }

      const updated = track.mergeObservation(stored, observation);
      await local.set({ [key]: updated });

      // Keep the log from growing without bound on a browser that sees a lot.
      const all = await local.get(null);
      const tracked = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("track:")));
      const { removed } = track.evictOldest(tracked);
      if (removed.length) await local.remove(removed);

      return { summary: track.summarise(updated), changes, paused: false, record: updated, key };
    }

    function trackingView(state) {
      if (!state) return null;
      return {
        summary: state.summary,
        changes: state.changes,
        paused: state.paused,
        tsv: () => track.historyToTsv(state.record, state.summary),
        onForget: () => local.remove(state.key),
      };
    }

    async function run({ open }) {
      if (!scrape.isProductPage()) return null;
      const config = await settings();
      const options = { titleLimit: config.titleLimit || undefined };
      const listing = scrape.scrapeListing();
      const report = audit.auditListing(listing, options);
      const suggestions = suggest.buildSuggestions(report, listing, options);
      // The carousels down a product page are products too, so the extractor
      // runs here as well — it just excludes the page's own ASIN.
      const extraction = extract.extractProducts();
      const tracked = await record(listing, config.tracking);
      current = { listing, report, suggestions, extraction, tracking: trackingView(tracked) };

      const changes = tracked?.changes;
      const alert = changes?.seller
        ? `Buy Box moved to ${changes.seller.to}`
        : changes?.lost ? "Buy Box lost"
          : changes?.price ? `Price ${changes.price.to > changes.price.from ? "up" : "down"} since your last visit`
            : null;

      panel.renderTitleBadge(report, () => show(current), alert);
      if (open || changes?.seller || changes?.lost) show(current);
      return report;
    }

    /**
     * Re-reads the products on the page, keeping any audit already made.
     * On a page with no listing to audit this is the whole of what runs.
     */
    function refreshProducts({ open }) {
      const extraction = extract.extractProducts();
      if (current?.report) current.extraction = extraction;
      else current = { listing: null, report: null, suggestions: null, extraction };
      if (open) show(current);
      return extraction;
    }

    const summarise = () => current?.report && {
      asin: current.report.asin, score: current.report.score, grade: current.report.grade,
      policyFailures: current.report.policyFailures,
      unreadable: current.report.unreadable.length,
      marketplace: current.report.marketplace?.label ?? null,
      products: current.extraction?.counts.total ?? 0,
    };

    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.type === "run-audit") {
        run({ open: true })
          .then(report => respond({ ok: Boolean(report), summary: summarise() }))
          .catch(error => respond({ ok: false, error: String(error) }));
        return true; // responding asynchronously
      }
      if (message?.type === "extract-products") {
        const extraction = refreshProducts({ open: true });
        respond({ ok: true, counts: extraction.counts, pageType: extraction.context.pageType });
        return false;
      }
      /* The popup asks what page this is rather than reading tab.url, which
         would cost a permission the extension deliberately does not hold. */
      if (message?.type === "page-info") {
        respond({
          ok: true,
          isProduct: scrape.isProductPage(),
          pageType: extract.pageType(),
          summary: summarise(),
          products: current?.extraction?.counts.total ?? null,
        });
        return false;
      }
      return false;
    });

    async function start() {
      if (!scrape.isProductPage()) return;
      const config = await settings();
      await whenReady();
      await run({ open: config.autoOpen });
    }

    // A variation click rewrites the page in place; the URL is what tells us.
    setInterval(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      document.getElementById("ppc-listing-audit-host")?.remove();
      document.getElementById("ppc-listing-audit-badge")?.remove();
      current = null;
      start();
    }, 1000);

    start();
  })();
}
