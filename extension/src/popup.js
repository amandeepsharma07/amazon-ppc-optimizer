/**
 * The toolbar popup. It holds the two settings and a way to re-run the audit;
 * the report itself belongs on the product page, not in a 300px window.
 */
const DEFAULTS = { autoOpen: true, titleLimit: 0 };

const el = id => document.getElementById(id);

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
  const status = el("status");
  status.textContent = parts.join(" · ");
  status.className = summary.policyFailures ? "note bad" : "note";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

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
  const onAmazon = /^https?:\/\/(?:www\.)?amazon\./i.test(tab?.url || "");
  const onProduct = onAmazon && /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/i.test(tab.url);

  if (!onProduct) {
    el("sub").textContent = onAmazon
      ? "Not a product page — open one to audit it"
      : "Open an Amazon product page";
    return;
  }

  el("run").disabled = false;
  el("run").addEventListener("click", async () => {
    el("run").disabled = true;
    el("status").textContent = "Reading the page…";
    const reply = await ask(tab.id, { type: "run-audit" });
    el("run").disabled = false;
    if (!reply?.ok) {
      el("status").textContent = "Could not read the page. Reload it and try again.";
      el("status").className = "note bad";
      return;
    }
    paint(reply.summary);
  });

  const existing = await ask(tab.id, { type: "get-summary" });
  if (existing?.ok) paint(existing.summary);
  else el("sub").textContent = "Not audited yet — press the button";
})();
