# Listing Audit — Chrome extension

Scores the Amazon product page you are looking at and shows the fixes, in
order, on the page itself.

The panel appears on the right of any `/dp/` page across nineteen
marketplaces. It reads the page already open in your browser — nothing is
fetched, nothing is uploaded, and it works on any listing you can see,
whether it is yours or a competitor's.

## Installing it

There is no store listing; you load it from this folder.

1. Open **`chrome://extensions`**
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Choose the **`extension`** folder from this repository

Open any Amazon product page. The panel appears once the title and gallery
have rendered. If you have closed it, a small score chip sits under the
product title to bring it back.

After a `git pull` that changed the extension, press the reload arrow on the
card in `chrome://extensions`, then refresh the Amazon tab.

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
- **Title character limit** — blank uses the marketplace default (200
  characters, 128 in Japan). Some categories are stricter; your listing's edit
  page in Seller Central shows the real figure.

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
| Leaves the machine | three settings to your own Chrome sync — no ASINs, no listing content |

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
- refreshing anything on a timer against Amazon

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
src/scrape.js        reads the page — every field may return null
src/panel.js         the injected panel, in a shadow root
src/content.js       timing and plumbing only
src/popup.html/js    the toolbar popup
tools/make-icons.mjs regenerates the icons
```

`audit.js` and `suggest.js` are pure — no DOM, no network, no `chrome.*` —
which is why they can be unit-tested. Their tests live in
`web/tests/listing-audit.test.ts` and `web/tests/listing-suggest.test.ts` and
run with the rest of the suite:

```bash
cd web && npm test
```

Rules belong in `audit.js`, proposals in `suggest.js`, selectors in
`scrape.js`. Keeping them apart is what lets Amazon change its markup without
anyone having to re-reason about the scoring — and it is why `suggest.js` can
call `policyIssues()` to screen its own output against the same rules the
audit uses, instead of carrying a second, drifting copy of them.
