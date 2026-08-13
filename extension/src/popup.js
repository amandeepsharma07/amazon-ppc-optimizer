/**
 * The toolbar popup: the two settings, and the two things you can ask for.
 * The report itself belongs on the product page, not in a 300px window.
 *
 * What page you are on is asked of the content script rather than read from
 * `tab.url`. Reading the URL would need the "tabs" or a host permission, and
 * the content script already knows its own address — so the extension keeps
 * `storage` as its only permission. If nothing answers, there is no content
 * script there, which is itself the answer: not an Amazon page.
 */
const DEFAULTS = { autoOpen: true, titleLimit: 0 };

const el = id => document.getElementById(id);

function say(text, bad = false) {
  el("status").textContent = text;
  el("status").className = bad ? "note bad" : "note";
}

function paint(summary) {
  if (!summary) return;
  const score = summary.score;
  const tone = score === null ? "#565959" : score >= 75 ? "#067d62" : score >= 50 ? "#8a6116" : "#c7511f";
  el("ring").style.setProperty("--pct", score ?? 0);
  el("ring").style.setProperty("--tone", tone);
  el("score").textContent = score === null ? "?" : String(score);
  el("headline").textContent = `${score ?? "—"}/100 · ${summary.grade ?? "—"}`;
  el("sub").textContent = [summary.asin, summary.marketplace].filter(Boolean).join(" · ");

  const parts = [];
  if (summary.policyFailures) parts.push(`${summary.policyFailures} policy check${summary.policyFailures > 1 ? "s" : ""} failing`);
  if (summary.unreadable) parts.push(`${summary.unreadable} check${summary.unreadable > 1 ? "s" : ""} unreadable`);
  say(parts.join(" · "), Boolean(summary.policyFailures));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Resolves to null when no content script is listening. */
function ask(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

(async () => {
  const config = { ...DEFAULTS, ...await chrome.storage.sync.get(DEFAULTS) };
  el("autoOpen").checked = config.autoOpen;
  el("titleLimit").value = config.titleLimit || "";

  el("autoOpen").addEventListener("change", e => {
    chrome.storage.sync.set({ autoOpen: e.target.checked });
  });
  el("titleLimit").addEventListener("change", e => {
    const value = parseInt(e.target.value, 10);
    chrome.storage.sync.set({ titleLimit: Number.isFinite(value) && value > 0 ? value : 0 });
  });

  const tab = await activeTab();
  const info = tab ? await ask(tab.id, { type: "page-info" }) : null;

  if (!info?.ok) {
    el("sub").textContent = "Open an Amazon page";
    return;
  }

  /* The extractor works anywhere Amazon renders products — search results, a
     category, a brand store, the carousels down a product page. */
  el("extract").disabled = false;
  el("extract").addEventListener("click", async () => {
    el("extract").disabled = true;
    say("Reading the page…");
    const reply = await ask(tab.id, { type: "extract-products" });
    el("extract").disabled = false;
    if (!reply?.ok) return say("Could not read the page. Reload it and try again.", true);
    const { total, sponsored } = reply.counts;
    say(total
      ? `${total} product${total === 1 ? "" : "s"} on this ${reply.pageType}${sponsored ? `, ${sponsored} sponsored` : ""} — see the panel`
      : "No products found. Scroll the page so the results load, then try again.");
  });

  if (info.summary) paint(info.summary);

  if (!info.isProduct) {
    el("headline").textContent = `On a ${info.pageType}`;
    el("sub").textContent = info.products
      ? `${info.products} products read`
      : "No listing to audit here — the extractor still works";
    el("score").textContent = info.products ? String(info.products) : "—";
    el("ring").style.setProperty("--pct", info.products ? 100 : 0);
    el("ring").style.setProperty("--tone", "#24506b");
    return;
  }

  el("run").disabled = false;
  el("run").addEventListener("click", async () => {
    el("run").disabled = true;
    say("Reading the page…");
    const reply = await ask(tab.id, { type: "run-audit" });
    el("run").disabled = false;
    if (!reply?.ok) return say("Could not read the page. Reload it and try again.", true);
    paint(reply.summary);
  });

  if (!info.summary) el("sub").textContent = "Not audited yet — press the button";
})();
