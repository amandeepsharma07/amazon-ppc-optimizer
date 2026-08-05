# Amazon PPC Optimizer

Three ways to use one engine: turn the reports you download from Amazon Ads into concrete
optimization actions — no API credentials required.

1. **Web app** (`web/`) — the full version: real accounts an admin creates and revokes,
   a history of every run, and a team page. Deploys to Vercel with a Postgres database;
   see [`web/README.md`](web/README.md). Ad reports are still parsed in the browser and
   never uploaded.
2. **Single-file dashboard** (`dashboard/index.html`) — upload your **bulk sheet** and
   **search term report**, pick your marketplace (India, USA, Canada, and more),
   set a target ACOS or ROAS, and get bid changes, negative keywords, and harvest
   keywords, each with a plain-language explanation. Runs entirely in the browser —
   your ad data never leaves your machine. Open the file directly or serve it
   anywhere; it's a single self-contained HTML file. With a bulk sheet uploaded it
   also produces a ready-to-upload **bid-update bulk file**. Sample files to try it
   with are in `examples/`.
3. **CLI** (`ppcopt`) — the same engine as a scriptable command-line tool, below.

All three share the same optimisation rules. Start with the single file; move to the
web app when you need to grant and revoke access to other people.

## The CLI

A command-line tool that turns an **Amazon Ads search term report** into concrete
optimization actions. Download the report from the
Amazon Ads console, run one command, and get an Excel workbook with:

| Sheet | What it contains |
|---|---|
| **Campaign Summary** | Spend, sales, ACOS, ROAS, CTR, CVR, and CPC per campaign |
| **Bid Recommendations** | A suggested bid per target (keyword / auto expression), driven by your target ACOS |
| **Negative Keywords** | Search terms burning spend with zero orders — add as negative exact |
| **Keyword Harvest** | Converting search terms from auto/broad/phrase traffic worth promoting to exact-match keywords, with a suggested starting bid |

Works with reports from any marketplace (`.com`, `.in`, `.co.uk`, …) — currency
symbols and header variations are normalized automatically.

## Install

```bash
pip install .          # from a clone of this repo
# or for development:
pip install -e ".[dev]"
```

Requires Python 3.10+. The only runtime dependency is `openpyxl`.

## Quick start

```bash
# Try it with generated sample data:
ppcopt sample -o sample_report.csv
ppcopt optimize sample_report.csv --target-acos 30

# With a real report (Amazon Ads console → Measurement & Reporting →
# Sponsored Ads Reports → Search term report):
ppcopt optimize search_term_report.xlsx --target-acos 25 -o recommendations.xlsx
```

Example output:

```
Parsed 200 rows across 9 campaigns.
Account: spend $1,481.68, sales $4,073.34, ACOS 36.4% (target 30%)
  Bid recommendations : 18
  Negative keywords   : 7 (~$96.20 spend with zero orders)
  Harvest keywords    : 12
Wrote /path/to/recommendations.xlsx
```

## How the recommendations work

**Bids.** Rows are rolled up to the targeting (keyword or auto expression) level.
For converting targets, the affordable cost per click at your target ACOS is
`revenue-per-click × target ACOS`; the suggested bid moves toward that value but
is clamped to ±30% per run (`--max-bid-change`) so a single report window can't
whipsaw your bids. Targets with enough clicks (`--min-clicks`, default 5) but no
sales get a 25% bid cut. A configurable bid floor (`--min-bid`) is always respected.

**Negatives.** A search term is flagged as a negative-exact candidate when it has
zero orders and either ≥10 clicks (`--negative-clicks`) or spend beyond 2× the
affordable cost of a conversion at target ACOS (based on your account-average
revenue per click).

**Harvesting.** Search terms arriving via auto, broad, or phrase targeting with
≥2 orders (`--harvest-min-orders`) and ACOS within 1.2× of target are suggested
as new exact-match keywords, with a starting bid priced from that term's own
revenue per click. The report reminds you to add the term as a negative exact in
the source ad group so the old targeting stops competing with the new keyword.

## Options

```
ppcopt optimize REPORT [--target-acos 30] [-o OUT.xlsx] [--format xlsx|csv]
                       [--currency ₹] [--min-clicks 5] [--max-bid-change 0.30]
                       [--min-bid 0.10] [--negative-clicks 10]
                       [--harvest-min-orders 2]
```

`--target-acos` accepts `30`, `30%`, or `0.30`. Use `--format csv -o outdir/` to
get four CSV files instead of a workbook.

## Development

```bash
pip install -e ".[dev]"
pytest
```

## Roadmap ideas

- Bulk-operations file output for one-click upload of bid changes
- Placement and dayparting analysis
- Amazon Ads API integration for fully automated optimization runs
