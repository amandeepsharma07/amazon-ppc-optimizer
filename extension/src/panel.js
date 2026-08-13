/**
 * Draws the audit onto the product page.
 *
 * The panel lives inside a shadow root. Amazon ships a very large stylesheet
 * and rewrites parts of the page as you interact with it; a shadow root means
 * none of that reaches the panel and none of the panel's styling leaks back
 * onto the listing.
 *
 * Everything is built with createElement and textContent rather than innerHTML.
 * The content being rendered is somebody's listing copy, which is arbitrary
 * text from a third party — assembling it as markup would be the one way this
 * extension could hurt the page it is inspecting.
 */

const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.panel {
  position: fixed; top: 92px; right: 16px; width: 380px;
  max-height: calc(100vh - 120px); display: flex; flex-direction: column;
  background: #fff; color: #0f1111; z-index: 2147483000;
  font: 13px/1.5 "Amazon Ember", Arial, sans-serif;
  border: 1px solid #d5d9d9; border-radius: 10px;
  box-shadow: 0 6px 24px rgba(15, 17, 17, .22);
}
.panel.collapsed { max-height: none; }
.panel.collapsed .body, .panel.collapsed .foot { display: none; }

.head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #eaeded; }
.ring {
  --pct: 0; --tone: #565959;
  flex: none; width: 52px; height: 52px; border-radius: 50%;
  background: conic-gradient(var(--tone) calc(var(--pct) * 1%), #eaeded 0);
  display: grid; place-items: center; position: relative;
}
.ring::after { content: ""; position: absolute; inset: 5px; border-radius: 50%; background: #fff; }
.ring b { position: relative; z-index: 1; font-size: 16px; font-weight: 700; }
.headline { flex: 1; min-width: 0; }
.headline h2 { margin: 0; font-size: 14px; font-weight: 700; }
.headline p { margin: 2px 0 0; font-size: 11px; color: #565959; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iconbtn {
  flex: none; border: 1px solid #d5d9d9; background: #fff; border-radius: 6px;
  width: 26px; height: 26px; cursor: pointer; font-size: 14px; line-height: 1; color: #0f1111;
}
.iconbtn:hover { background: #f7fafa; }

.body { overflow-y: auto; padding: 0 14px 4px; }
.foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #eaeded; }
button.act {
  flex: 1; padding: 7px 8px; font-size: 12px; cursor: pointer;
  border: 1px solid #d5d9d9; border-radius: 8px; background: #f7fafa; color: #0f1111;
}
button.act:hover { background: #eef3f3; }
button.act.primary { background: #ffd814; border-color: #fcd200; }
button.act.primary:hover { background: #f7ca00; }

.alert { margin: 12px 0 0; padding: 9px 11px; border-radius: 8px; font-size: 12px; }
.alert.bad { background: #fdf0ed; border: 1px solid #f4c9bd; color: #7a2e12; }
.alert.info { background: #f0f7fb; border: 1px solid #cfe3ef; color: #24506b; }

h3.sec { margin: 16px 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #565959; }

ol.fixes { margin: 0; padding: 0; list-style: none; }
ol.fixes li { padding: 9px 0; border-bottom: 1px solid #f2f4f4; }
ol.fixes li:last-child { border-bottom: 0; }
.fixhead { display: flex; gap: 8px; align-items: baseline; }
.fixhead strong { flex: 1; font-size: 12.5px; font-weight: 600; }
.cost { flex: none; font-size: 11px; color: #565959; font-variant-numeric: tabular-nums; }
.tag { flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; }
.tag.policy { background: #fdf0ed; color: #a03614; }
.tag.style { background: #f0f4f8; color: #46586b; }
.detail { margin: 3px 0 0; color: #333; font-size: 12px; }
.fixnote { margin: 3px 0 0; color: #0f5132; font-size: 12px; }
ul.ev { margin: 4px 0 0; padding-left: 16px; color: #565959; font-size: 11.5px; }
ul.ev li { margin: 1px 0; word-break: break-word; }

details.group { border-bottom: 1px solid #f2f4f4; }
details.group > summary {
  cursor: pointer; padding: 9px 0; display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 600; list-style: none;
}
details.group > summary::-webkit-details-marker { display: none; }
summary .chev { flex: none; width: 10px; color: #565959; transition: transform .12s; }
details[open] > summary .chev { transform: rotate(90deg); }
summary .grow { flex: 1; }
.bar { flex: none; width: 54px; height: 5px; border-radius: 3px; background: #eaeded; overflow: hidden; }
.bar span { display: block; height: 100%; }
.pts { flex: none; font-size: 11px; color: #565959; font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
.checks { margin: 0 0 8px; padding: 0; list-style: none; }
.checks li { display: flex; gap: 8px; padding: 5px 0 5px 18px; }
.mark { flex: none; font-size: 11px; font-weight: 700; width: 12px; }
.mark.pass { color: #067d62; }
.mark.warn { color: #8a6116; }
.mark.fail { color: #c7511f; }
.mark.unknown { color: #999; }
.checks .what { flex: 1; }
.checks .what b { font-weight: 600; font-size: 12px; display: block; }

.rewrite { background: #f7fafa; border: 1px solid #eaeded; border-radius: 8px; padding: 10px; margin-top: 6px; }
.rewrite p.txt { margin: 0; font-size: 12.5px; word-break: break-word; }
.rewrite .meta { margin: 6px 0 0; font-size: 11px; color: #565959; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0 10px; }
.chip { background: #f0f4f8; border-radius: 12px; padding: 2px 9px; font-size: 11.5px; color: #24506b; }
.muted { color: #565959; font-size: 11.5px; margin: 4px 0 10px; }

.tabs { display: flex; gap: 4px; padding: 8px 0 0; }
.tab {
  flex: 1; padding: 6px 4px; font: inherit; font-size: 11.5px; cursor: pointer;
  border: 1px solid #d5d9d9; border-radius: 7px; background: #fff; color: #565959;
}
.tab:hover { background: #f7fafa; }
.tab[aria-selected="true"] { background: #0f1111; border-color: #0f1111; color: #fff; font-weight: 600; }

ul.areas { margin: 0; padding: 0; list-style: none; }
ul.areas li { padding: 9px 0; border-bottom: 1px solid #f2f4f4; }
ul.areas li:last-child { border-bottom: 0; }
.areahead { display: flex; gap: 8px; align-items: baseline; }
.areahead strong { flex: 1; font-size: 12.5px; }
.headroom { margin: 2px 0 0; font-size: 11.5px; color: #24506b; font-weight: 600; }

.variant { border: 1px solid #eaeded; border-radius: 8px; padding: 10px; margin: 0 0 8px; }
.variant h4 { margin: 0 0 2px; font-size: 12px; }
.variant .txt { margin: 4px 0 0; font-size: 12.5px; word-break: break-word; }
.variant .meta { margin: 5px 0 0; font-size: 11px; color: #565959; }
.variant.thin { border-color: #f0dcc0; background: #fffbf5; }
.rowbtns { display: flex; gap: 6px; margin-top: 8px; }
.rowbtns button { flex: 1; }

ol.slots { margin: 0; padding: 0; list-style: none; counter-reset: slot; }
ol.slots > li { padding: 10px 0; border-bottom: 1px solid #f2f4f4; }
ol.slots > li:last-child { border-bottom: 0; }
.slothead { display: flex; gap: 8px; align-items: baseline; }
.slotno {
  flex: none; width: 17px; height: 17px; border-radius: 50%; background: #eaeded;
  color: #565959; font-size: 10px; font-weight: 700; display: grid; place-items: center;
}
.slotno.missing { background: #fdf0ed; color: #a03614; }
.slothead b { flex: 1; font-size: 12px; font-weight: 600; }
.slotbody { margin: 5px 0 0 25px; }
.slotbody .txt { font-size: 12.5px; word-break: break-word; }
.slotbody .txt em { font-style: normal; font-weight: 700; }

.badge {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font: 12px/1 "Amazon Ember", Arial, sans-serif; color: #0f1111;
  border: 1px solid #d5d9d9; border-radius: 16px; padding: 5px 11px 5px 6px; background: #fff;
}
.badge:hover { background: #f7fafa; }
.badge i { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
  color: #fff; font-style: normal; font-size: 10px; font-weight: 700; }
`;

const TONE = { good: "#067d62", ok: "#8a6116", bad: "#c7511f", none: "#565959" };

function toneFor(score) {
  if (score === null || score === undefined) return TONE.none;
  if (score >= 75) return TONE.good;
  if (score >= 50) return TONE.ok;
  return TONE.bad;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "style") el.setAttribute("style", value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const MARKS = { pass: "OK", warn: "!", fail: "×", unknown: "?" };

function checkRow(c) {
  return h("li", {},
    h("span", { class: `mark ${c.status}`, text: MARKS[c.status] || "?" }),
    h("span", { class: "what" },
      h("b", { text: c.label }),
      h("span", { class: "detail", text: c.detail }),
      c.fix ? h("p", { class: "fixnote", text: c.fix }) : null,
      c.evidence?.length
        ? h("ul", { class: "ev" }, c.evidence.slice(0, 6).map(e => h("li", { text: e })))
        : null,
    ),
  );
}

function fixRow(c) {
  return h("li", {},
    h("div", { class: "fixhead" },
      h("span", { class: `tag ${c.kind}`, text: c.kind }),
      h("strong", { text: c.label }),
      h("span", { class: "cost", text: `−${c.weight - c.earned}` }),
    ),
    h("p", { class: "detail", text: c.detail }),
    c.fix ? h("p", { class: "fixnote", text: c.fix }) : null,
    c.evidence?.length
      ? h("ul", { class: "ev" }, c.evidence.slice(0, 5).map(e => h("li", { text: e })))
      : null,
  );
}

function sectionGroup(section) {
  const tone = toneFor(section.percent);
  return h("details", { class: "group" },
    h("summary", {},
      h("span", { class: "chev", text: "›" }),
      h("span", { class: "grow", text: section.label }),
      h("span", { class: "bar" },
        h("span", { style: `width:${section.percent ?? 0}%;background:${tone}` })),
      h("span", { class: "pts", text: section.available ? `${section.earned}/${section.available}` : "n/a" }),
    ),
    h("ul", { class: "checks" }, section.checks.map(checkRow)),
  );
}

/** A button that copies text and says so, then goes back to its label. */
function copyButton(label, getText, extraClass = "act") {
  const button = h("button", {
    class: extraClass, text: label,
    onclick: () => {
      navigator.clipboard.writeText(getText())
        .then(() => { button.textContent = "Copied"; })
        .catch(() => { button.textContent = "Copy failed"; })
        .finally(() => setTimeout(() => { button.textContent = label; }, 1500));
    },
  });
  return button;
}

function areaRow(area) {
  return h("li", {},
    h("div", { class: "areahead" },
      h("strong", { text: area.area }),
      area.points ? h("span", { class: "cost", text: `${area.points} pts` }) : null,
    ),
    h("p", { class: "headroom", text: area.headroom }),
    h("p", { class: "detail", text: area.detail }),
  );
}

function variantCard(variant) {
  const card = h("div", { class: `variant${variant.thin ? " thin" : ""}` },
    h("h4", { text: variant.label }),
    h("p", { class: "detail", text: variant.note }),
    h("p", { class: "txt", text: variant.text || "Nothing on the page to build a title from." }),
    h("p", {
      class: "meta",
      text: `${variant.length} of ${variant.limit} characters`
        + (variant.thin ? " — short. The gaps below are what would lengthen it honestly." : ""),
    }),
  );
  if (variant.text) card.append(copyButton("Copy", () => variant.text));
  return card;
}

function slotRow(slot) {
  const missing = slot.status !== "reworked";
  const lead = slot.label ? `${slot.label} — ` : "";
  const body = slot.text && lead && slot.text.startsWith(lead) ? slot.text.slice(lead.length) : slot.text;
  return h("li", {},
    h("div", { class: "slothead" },
      h("span", { class: `slotno${missing ? " missing" : ""}`, text: String(slot.slot) }),
      h("b", { text: slot.brief }),
    ),
    h("div", { class: "slotbody" },
      slot.text
        ? h("p", { class: "txt" }, lead ? h("em", { text: lead }) : null, body)
        : null,
      slot.violations?.length
        ? h("p", { class: "detail" },
          h("em", { text: "Cannot be reused: " }),
          slot.violations.join("; "))
        : null,
      slot.facts.length
        ? h("ul", { class: "ev" }, slot.facts.map(f => h("li", { text: f })))
        : null,
      slot.note ? h("p", { class: slot.status === "reworked" ? "fixnote" : "detail", text: slot.note }) : null,
      slot.text ? copyButton("Copy this bullet", () => slot.text) : null,
    ),
  );
}

/**
 * @param report       output of auditListing
 * @param listing      the scrape it was built from
 * @param suggestions  output of buildSuggestions
 * @param handlers     { onCopy, onRerun, onClose, onCollapse }
 * @returns the host element, already attached to the document
 */
export function renderPanel(report, listing, suggestions, handlers = {}) {
  document.getElementById("ppc-listing-audit-host")?.remove();

  const host = h("div", { id: "ppc-listing-audit-host" });
  // The host itself must not lay anything out — the panel inside is fixed to
  // the viewport, and a host box would otherwise push Amazon's own content.
  host.style.setProperty("display", "contents");
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", { text: CSS }));

  const tone = toneFor(report.score);
  const body = h("div", { class: "body" });
  const panel = h("div", { class: "panel" });

  const ring = h("div", { class: "ring", style: `--pct:${report.score ?? 0};--tone:${tone}` },
    h("b", { text: report.score === null ? "?" : String(report.score) }));

  const collapseBtn = h("button", {
    class: "iconbtn", title: "Collapse", text: "–",
    onclick: () => {
      const collapsed = panel.classList.toggle("collapsed");
      collapseBtn.textContent = collapsed ? "+" : "–";
      handlers.onCollapse?.(collapsed);
    },
  });

  panel.append(
    h("div", { class: "head" },
      ring,
      h("div", { class: "headline" },
        h("h2", { text: `Listing score ${report.score ?? "—"}/100 · ${report.grade ?? "—"}` }),
        h("p", {
          text: [listing.asin, report.marketplace?.label, listing.brand].filter(Boolean).join(" · ") || "Listing audit",
        }),
      ),
      collapseBtn,
      h("button", { class: "iconbtn", title: "Close", text: "×", onclick: () => { host.remove(); handlers.onClose?.(); } }),
    ),
    body,
  );

  /* The panel answers two different questions and they do not belong in one
     scroll: what is wrong with the listing, and what to write instead. */
  const audit = h("div");
  const rebuild = h("div", { style: "display:none" });
  const tabs = h("div", { class: "tabs" });
  const views = [
    { label: "What's wrong", view: audit },
    { label: "What to write", view: rebuild },
  ];
  const buttons = views.map((entry, i) => h("button", {
    class: "tab", role: "tab", "aria-selected": i === 0 ? "true" : "false", text: entry.label,
    onclick: () => {
      views.forEach((other, j) => {
        other.view.style.display = i === j ? "" : "none";
        buttons[j].setAttribute("aria-selected", i === j ? "true" : "false");
      });
      body.scrollTop = 0;
    },
  }));
  tabs.append(...buttons);
  body.append(tabs, audit, rebuild);

  /* ================= what's wrong ================= */

  if (report.policyFailures) {
    audit.append(h("div", {
      class: "alert bad",
      text: `${report.policyFailures} policy check${report.policyFailures > 1 ? "s" : ""} failing. These risk suppression, not just ranking — fix them before anything else.`,
    }));
  }

  audit.append(h("h3", { class: "sec", text: "Fix in this order" }));
  if (report.fixes.length) {
    audit.append(h("ol", { class: "fixes" }, report.fixes.slice(0, 6).map(fixRow)));
    if (report.fixes.length > 6) {
      audit.append(h("p", { class: "muted", text: `${report.fixes.length - 6} more below, grouped by area.` }));
    }
  } else {
    audit.append(h("p", { class: "muted", text: "Nothing failing. Every readable check passed." }));
  }

  if (report.titleRewrite.changed) {
    audit.append(h("h3", { class: "sec", text: "Corrected title" }));
    const box = h("div", { class: "rewrite" },
      h("p", { class: "txt", text: report.titleRewrite.text }),
      h("p", { class: "meta", text: `${report.titleRewrite.text.length} of ${report.titleLimit} characters` }),
      h("ul", { class: "ev" }, report.titleRewrite.notes.map(n => h("li", { text: n }))),
      copyButton("Copy corrected title", () => report.titleRewrite.text),
    );
    audit.append(box);
    audit.append(h("p", { class: "muted", text: "Your title with the violations taken out — not a rewrite. For rebuilt titles, see What to write." }));
  }

  audit.append(h("h3", { class: "sec", text: "Every check" }));
  for (const section of report.sections) audit.append(sectionGroup(section));

  if (report.unreadable.length) {
    audit.append(h("div", {
      class: "alert info",
      text: `${report.unreadable.length} check${report.unreadable.length > 1 ? "s" : ""} could not be read from this page and ${report.unreadable.length > 1 ? "were" : "was"} left out of the score. Scroll the page fully, then re-run.`,
    }));
  }

  /* ================= what to write ================= */

  rebuild.append(h("h3", { class: "sec", text: "Where the room is" }));
  rebuild.append(h("ul", { class: "areas" }, suggestions.areas.map(areaRow)));

  rebuild.append(h("h3", { class: "sec", text: "Title — three ways to rebuild it" }));
  for (const variant of suggestions.titles) rebuild.append(variantCard(variant));

  const missing = suggestions.titles[0]?.missing ?? [];
  rebuild.append(h("p", { class: "muted" },
    "Assembled from this page only — the attribute table, the breadcrumb and your own copy. "
    + "No word here was written for you, which is why they read like assembly rather than prose. "
    + "Use them as the skeleton and put your sentence around it."));
  if (missing.length) {
    rebuild.append(h("div", { class: "alert info" },
      h("div", { style: "font-weight:700;margin-bottom:4px" }, "What would make these stronger"),
      h("ul", { class: "ev", style: "color:inherit" }, missing.map(m => h("li", { text: m })))));
  }

  if (report.keywordGaps.length) {
    rebuild.append(h("h3", { class: "sec", text: "Words your page uses that the title does not" }));
    rebuild.append(h("div", { class: "chips" }, report.keywordGaps.map(k => h("span", { class: "chip", text: k.word }))));
    rebuild.append(h("p", { class: "muted", text: "Candidates, not instructions — whether one belongs in the title is a judgement about the product. The keyword-heavy variant above already uses the strongest few." }));
  }

  rebuild.append(h("h3", { class: "sec", text: `Bullet plan — ${suggestions.bullets.covered} of 5 slots filled` }));
  if (suggestions.bullets.blocked) {
    rebuild.append(h("div", {
      class: "alert bad",
      text: `${suggestions.bullets.blocked} of your bullets breaks policy, so ${suggestions.bullets.blocked > 1 ? "they are" : "it is"} not offered back to copy. The slot below says what has to come out.`,
    }));
  }
  rebuild.append(h("ol", { class: "slots" }, suggestions.bullets.plan.map(slotRow)));
  rebuild.append(h("p", { class: "muted", text: "Your own sentences, sorted into the five jobs a bullet block has to do and given a lead phrase. Empty slots list the facts the page already states, so the sentence has something to be built from." }));

  if (suggestions.bullets.unused.length) {
    rebuild.append(h("h3", { class: "sec", text: "Did not fit a slot" }));
    rebuild.append(h("ul", { class: "ev" }, suggestions.bullets.unused.map(b => h("li", { text: b }))));
  }

  const copyBtn = h("button", {
    class: "act primary", text: "Copy everything",
    onclick: () => {
      handlers.onCopy?.()
        ?.then(() => { copyBtn.textContent = "Copied"; setTimeout(() => { copyBtn.textContent = "Copy everything"; }, 1500); })
        ?.catch(() => { copyBtn.textContent = "Copy failed"; });
    },
  });

  panel.append(h("div", { class: "foot" },
    copyBtn,
    h("button", { class: "act", text: "Re-run", onclick: () => handlers.onRerun?.() }),
  ));

  root.append(panel);
  document.body.append(host);
  return host;
}

/**
 * A small score chip under the product title, for when the panel is closed.
 * The panel is the report; this is only the way back to it.
 */
export function renderTitleBadge(report, onOpen) {
  document.getElementById("ppc-listing-audit-badge")?.remove();
  const anchor = document.querySelector("#productTitle")?.parentElement;
  if (!anchor) return null;

  const host = h("span", { id: "ppc-listing-audit-badge" });
  host.style.setProperty("display", "inline-block");
  host.style.setProperty("margin", "6px 0");
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", { text: CSS }));
  root.append(h("span", { class: "badge", onclick: onOpen },
    h("i", { style: `background:${toneFor(report.score)}`, text: report.score === null ? "?" : String(report.score) }),
    `Listing score · ${report.policyFailures ? `${report.policyFailures} policy issue${report.policyFailures > 1 ? "s" : ""}` : "open audit"}`,
  ));

  anchor.append(host);
  return host;
}
