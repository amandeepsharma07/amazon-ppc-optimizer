# Listing Audit — Chrome extension

Scores the Amazon product page you are looking at and shows the fixes, in
order, on the page itself.

The panel appears on the right of any `/dp/` page across nineteen
marketplaces. It reads the page already open in your browser — nothing is
fetched, nothing is uploaded, and it works on any listing you can see,
whether it is yours or a competitor's.

## Installing it

There is no store listing; it is loaded from a folder.

**If you have the repository** — open **`chrome://extensions`**, turn on
**Developer mode** (top right), click **Load unpacked**, and choose this
**`extension`** folder.

**If you do not** — sign in to the web app and open **Chrome extension** in the
menu. It offers a zip of exactly this folder, with the install steps beside it.
That is the route for anyone on the team who does not use git; it needs an
account, so access follows the Team page.

Open any Amazon product page. The panel appears once the title and gallery
have rendered. If you have closed it, a small score chip sits under the
product title to bring it back.

After updating — a `git pull`, or a fresh download from the web app — press the
reload arrow on the card in `chrome://extensions`, then refresh the Amazon tab.
Chrome runs the old copy until told otherwise, and skipping this looks exactly
like the extension being broken.

## What it scores

100 points across six areas:

| Area | Points | What it looks at |
|---|---|---|
| Title | 25 | Length against the marketplace limit, shouted words, promotional claims, disallowed characters, brand position, repetition |
| Bullet points | 20 | Five present, enough detail in each, claims, contact details, capitals |
| Images and video | 15 | Gallery count, whether a video is published |
| Description and A+ | 15 | A+ published, description substantial enough to index |
| Policy compliance | 15 | Restricted claims, other people's brands, routes off Amazon |
| Conversion signals | 10 | Rating, review volume, buyable |

Two distinctions run through all of it.

**Policy against style.** A policy failure risks the listing being suppressed;
a style failure just costs you sales. They are tagged separately and the fix
list always puts policy first, however few points it is worth.

**Failed against unreadable.** Amazon's markup differs by marketplace,
category and whatever test it is running that hour. When a field cannot be
read, its check is dropped from the score rather than counted as zero — the
panel says how many were dropped. A scraping gap must never look like a
listing problem. If several checks come back unreadable, scroll the whole page
so everything has loaded and press **Re-run**.

## What to write

The panel's second tab answers a different question from the first. **What's
wrong** is the audit. **What to write** is where the work is.

### Where the room is

Every area with the points still recoverable and, more usefully, a measured
figure for the space going unused: characters left in the title, characters
used across the bullet block against roughly 1,250 available, images against
a full gallery, attributes filled against attributes usable. A title can pass
every policy check and still be spending 90 of its 200 characters, which no
check fails and no score reflects.

### Three rebuilt titles

Following `[Brand] + [Product type] + [Attributes]`, differing in what leads:

| Variant | Leads with | Use when |
|---|---|---|
| Feature-forward | Material, then size | The buyer is comparing specifications |
| Use-case-forward | Who it is for, attached to the product name | The buyer is choosing by occasion |
| Keyword-heavy | Words your own copy uses that the title does not | Indexing matters more than reading |

### A five-slot bullet plan

Your existing bullets are sorted into the five jobs a bullet block has to do —
headline feature, second feature in a situation, material and certification,
who it fits, what sets it apart — given a lead phrase taken from their own
words, and flagged where they are too thin. Empty slots list the facts the
page already states, so there is something to build the sentence from.

## What is and is not generated

There is no model behind this. Every word it proposes comes off the page it is
looking at: the attribute table, the breadcrumb, your own copy. That is a
narrower job than writing, and the panel says so where it matters — a missing
fact is named as missing rather than filled in with something plausible. A
tool that quietly invents a material or a capacity is worse than no tool,
because the seller publishes it.

So the titles read like assembly, because that is what they are. Use them as
the skeleton and put your sentence around it.

Two consequences worth knowing:

- **The corrected title** on the first tab is your title with its violations
  removed — not a rewrite. The rebuilt titles on the second tab are the
  rewrites. They are deliberately kept apart.
- **Copy that breaks policy is never offered back.** A bullet naming a
  competitor or carrying a phone number is not given a copy button, however
  well it fits its slot. The slot names what has to come out instead. Handing
  back the violation the other tab is telling you to remove would make the
  whole thing untrustworthy.

## Settings

Click the toolbar icon:

- **Open the panel automatically** — off if you would rather press the button
- **Record Buy Box and price** — on by default; builds the 90-day history
  below from the listings you open
- **Title character limit** — blank uses the marketplace default (200
  characters, 128 in Japan). Some categories are stricter; your listing's edit
  page in Seller Central shows the real figure.

## Buy Box and price tracking

Every time you open a listing, the extension records the Buy Box holder, the
price, the fulfilment and whether there is a Buy Box at all. The **Tracking**
tab then shows, over the last 90 days:

- price now, the lowest and highest observed with the dates they happened, and
  how many times it moved
- a chart of the observed price, spaced by date so a gap in your visits shows
  as a gap rather than a flat line
- who has held the Buy Box, with a percentage each, how many times it changed
  hands, and any days when nobody held it

When the Buy Box has moved since your last visit, the panel opens on that tab
by itself and the chip under the product title says so instead of showing the
score. A price move does the same, more quietly.

History lives in `chrome.storage.local` — this browser only. Nothing is
uploaded; there is nowhere for it to go. **Forget this ASIN** clears one
listing, and the whole log is capped at 400 listings and 180 days, dropping
the least recently seen.

### What the percentage actually means

**It is the share of days you looked, not the share of time.** This is the
honest limit of a tool with no server, and it is stated beside every figure in
the panel rather than buried here.

The extension sees a listing when you open the listing. It cannot poll in the
background — that would mean requesting product pages on a timer, which is the
one thing that puts a household IP in front of a CAPTCHA. So:

- Open the listing once a day and you get a genuine daily series.
- Open it twice in a morning and that is still one day: shares are weighted by
  day, so a burst of refreshes cannot inflate a seller's ownership.
- Miss a fortnight and the panel says so — the coverage line reads "observed
  on 27 of the last 90 days", and under seven days it warns that the
  percentages are not yet worth reading.

"Held it 80% of the time" and "held it on 80% of the days you checked" diverge
badly if you always look at the same hour and a competitor undercuts
overnight. The panel never claims the first.

If you need true continuous coverage, that is a server polling the Amazon
Product Advertising API or SP-API on credentials — a different tool, and the
web app in `web/` is where it would belong. Do not add it here.

## Extracting the products on a page

Works on any Amazon page showing products — search results, a category, a
brand store, the carousels down a product page. Click the toolbar icon →
**Extract products on this page**.

You get a table of everything rendered, and three ways out:

| Button | Format | For |
|---|---|---|
| **Copy for Excel** | Tab-separated, 12 columns | Paste straight into a sheet; it lands in columns |
| **CSV** | Comma-separated, RFC-quoted | Anything that wants a `.csv` |
| **ASINs only** | One per line | Pasting into another tool |

Columns: position, ASIN, title, price (as shown and as a number), rating,
reviews, sponsored, badge, browse node ID and path, URL. Sponsored placements
are marked, and position is document order — the order the shopper sees them.

Prices and ratings are parsed per marketplace, so `₹1,499`, `$24.99` and
German `1.299,00 €` all come out as numbers you can sort. A review count is
never mistaken for a rating: an empty cell is better in an export than a
plausible wrong number, because nothing downstream would question it.

### The browse node is per page, not per product

The node shown is the one governing the page you are on — read from the URL
where the URL states one, otherwise inferred from the breadcrumb, and the
source is named either way. Every row repeats it.

That is a real limit, not an oversight. A search result card does not state
its own node; that lives on each product's own page. Collecting it per ASIN
would mean opening every listing, which is exactly the request volume that
gets an IP throttled — see below. If you need true per-ASIN nodes, open the
handful you care about and read the panel on each.

### It only sees what has loaded

Amazon loads results as you scroll. The extractor reads what is rendered at
the moment you press the button, so scroll to the bottom of the page first,
then extract. It will not page through results for you, deliberately.

## Why this cannot get you rate-limited or blocked

The extension **makes no network requests at all**. Not to Amazon, not
anywhere. It reads the page your browser has already downloaded and rendered,
and that is the whole of its interaction with the outside world.

Concretely, and verifiable by grepping this folder:

| | |
|---|---|
| `fetch`, `XMLHttpRequest`, WebSocket, `sendBeacon` | none |
| Remote images, fonts, stylesheets, `@import` | none — every asset is local |
| `host_permissions` | none declared |
| Background service worker | none |
| Clicks, navigation, form submission, synthetic events | none |
| Cookies, `localStorage`, login state | never read |
| Declared permissions | `storage`, and nothing else |
| Leaves the machine | four settings to your own Chrome sync; the tracking history stays in local storage and is never synced or uploaded |

What triggers Amazon's throttling and CAPTCHA is **request volume**: tools that
pull hundreds of pages a minute. Zero requests cannot be rate-limited. And
nothing here touches Seller Central, logs in, or modifies a listing, so there
is no path from it to a seller account either.

Amazon's Conditions of Use prohibit "data mining, robots, or similar data
gathering and extraction tools" — a clause aimed at automated extraction at
scale, not at reading the page in front of you at human pace. Every mainstream
seller tool works this way. That is context, not a guarantee on Amazon's
behalf; the point is that the mechanisms which actually cause blocks are
absent.

### The line, for whoever changes this next

All of the above holds because the extension only ever looks at the page the
user opened themselves. **The moment it requests a page instead, this section
stops being true.** Anything of the following shape needs deliberate design —
pacing, back-off, and the user's explicit consent — rather than being added as
a convenience:

- auditing a list of ASINs in one run
- fetching competitor listings in the background
- walking search results or a catalogue
- refreshing anything on a timer against Amazon — including "just keep the
  Buy Box history up to date while I am not looking", which is the most
  tempting one and exactly why the tracking is observation-based

If you are adding one of those, that is a different tool with a different risk
profile. Do not let it arrive by accident.

## What it does not do

It does not read your search term reports — the words shoppers actually type
live in the reports the web app in `web/` reads, and the hidden Search Terms
field cannot be seen from a product page at all. The two work together: this
tells you what is wrong with the listing and hands you the skeleton to rebuild
it, that tells you which words belong in it.

## For anyone changing it

```
manifest.json        permissions, matched domains
src/audit.js         the engine: rules, weights, scoring, the title correction
src/suggest.js       the proposals: work areas, title variants, bullet plan
src/extract.js       the product table: cards, parsing, export formats
src/track.js         Buy Box and price history: merging, summarising, export
src/scrape.js        reads the page — every field may return null
src/panel.js         the injected panel, in a shadow root
src/content.js       timing and plumbing only
src/popup.html/js    the toolbar popup
tools/make-icons.mjs regenerates the icons
```

The popup asks the content script what page it is on rather than reading
`tab.url`, which would need the `tabs` or a host permission. `storage` stays
the only permission the extension holds, and that is worth keeping.

`audit.js` and `suggest.js` are pure — no DOM, no network, no `chrome.*` —
which is why they can be unit-tested. `extract.js` walks the DOM, so its
parsing and export formats are unit-tested and its card-finding is exercised
in a real browser against a fixture page. The tests live in
`web/tests/listing-{audit,suggest,extract}.test.ts` and run with the rest of
the suite:

```bash
cd web && npm test
```

Rules belong in `audit.js`, proposals in `suggest.js`, selectors in
`scrape.js`. Keeping them apart is what lets Amazon change its markup without
anyone having to re-reason about the scoring — and it is why `suggest.js` can
call `policyIssues()` to screen its own output against the same rules the
audit uses, instead of carrying a second, drifting copy of them.
