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

## The corrected title

Where the panel offers a rewritten title it is a *mechanical* correction:
disallowed characters removed, prohibited claims cut, shouted words put into
title case, words repeated three or more times dropped, brand moved to the
front, trimmed to the limit on a word boundary. Nothing is written for you and
no word is invented. Read it before you paste it into Seller Central.

## Settings

Click the toolbar icon:

- **Open the panel automatically** — off if you would rather press the button
- **Title character limit** — blank uses the marketplace default (200
  characters, 128 in Japan). Some categories are stricter; your listing's edit
  page in Seller Central shows the real figure.

## What it does not do

It does not write copy, and it does not read your search term reports — the
words shoppers actually type live in the reports the web app in `web/` reads.
The two work together: this tells you what is wrong with the listing, that
tells you which words belong in it.

## For anyone changing it

```
manifest.json        permissions, matched domains
src/audit.js         the engine: rules, weights, scoring, the title rewrite
src/scrape.js        reads the page — every field may return null
src/panel.js         the injected panel, in a shadow root
src/content.js       timing and plumbing only
src/popup.html/js    the toolbar popup
tools/make-icons.mjs regenerates the icons
```

`audit.js` is pure — no DOM, no network, no `chrome.*` — which is why it can
be unit-tested. Its tests live in `web/tests/listing-audit.test.ts` and run
with the rest of the suite:

```bash
cd web && npm test
```

Rules belong in `audit.js` and selectors belong in `scrape.js`. Keeping them
apart is what lets Amazon change its markup without anyone having to re-reason
about the scoring.
