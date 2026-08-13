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
    const [audit, scrape, panel, suggest] = await Promise.all([
      import(chrome.runtime.getURL("src/audit.js")),
      import(chrome.runtime.getURL("src/scrape.js")),
      import(chrome.runtime.getURL("src/panel.js")),
      import(chrome.runtime.getURL("src/suggest.js")),
    ]);

    const DEFAULTS = { autoOpen: true, titleLimit: 0 };
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
      if (!current) return Promise.reject(new Error("nothing audited yet"));
      return navigator.clipboard.writeText(
        audit.reportToText(current.report, current.listing)
        + "\n" + suggest.suggestionsToText(current.suggestions)
      );
    }

    function show(report, listing, suggestions) {
      panel.renderPanel(report, listing, suggestions, {
        onCopy: copyReport,
        onRerun: () => run({ open: true }),
        onClose: () => panel.renderTitleBadge(report, () => show(report, listing, suggestions)),
        onCollapse: collapsed => chrome.storage.sync.set({ collapsed }),
      });
    }

    async function run({ open }) {
      if (!scrape.isProductPage()) return null;
      const config = await settings();
      const options = { titleLimit: config.titleLimit || undefined };
      const listing = scrape.scrapeListing();
      const report = audit.auditListing(listing, options);
      const suggestions = suggest.buildSuggestions(report, listing, options);
      current = { listing, report, suggestions };

      panel.renderTitleBadge(report, () => show(report, listing, suggestions));
      if (open) show(report, listing, suggestions);
      return report;
    }

    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.type === "run-audit") {
        run({ open: true }).then(report => respond({
          ok: Boolean(report),
          summary: report && {
            asin: report.asin, score: report.score, grade: report.grade,
            policyFailures: report.policyFailures, unreadable: report.unreadable.length,
            marketplace: report.marketplace?.label ?? null,
          },
        })).catch(error => respond({ ok: false, error: String(error) }));
        return true; // responding asynchronously
      }
      if (message?.type === "get-summary") {
        respond({
          ok: Boolean(current),
          summary: current && {
            asin: current.listing.asin, score: current.report.score, grade: current.report.grade,
            policyFailures: current.report.policyFailures,
            unreadable: current.report.unreadable.length,
            marketplace: current.report.marketplace?.label ?? null,
          },
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
