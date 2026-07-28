"""Generate a realistic sample search term report for trying out the tool."""

from __future__ import annotations

import csv
import random
from pathlib import Path

_PRODUCTS = ["yoga mat", "resistance bands", "foam roller"]
_MODIFIERS = [
    "", "premium", "extra thick", "for women", "for men", "non slip", "6mm",
    "with carrying strap", "eco friendly", "for home gym", "travel", "kids",
    "large", "set", "under 500", "best", "cheap", "washable", "tpe", "cork",
]
_JUNK_TERMS = [
    "free yoga videos", "yoga pants", "gym membership", "yoga classes near me",
    "treadmill", "peloton bike", "how to do yoga",
]


def generate_sample(path: str | Path, rows: int = 150, seed: int = 7) -> Path:
    rng = random.Random(seed)
    headers = [
        "Campaign Name", "Ad Group Name", "Targeting", "Match Type",
        "Customer Search Term", "Impressions", "Clicks", "Spend",
        "7 Day Total Sales", "7 Day Total Orders (#)", "7 Day Total Units (#)",
    ]

    out: list[list] = []
    for _ in range(rows):
        product = rng.choice(_PRODUCTS)
        campaign_kind = rng.choice(["Auto", "Broad", "Exact"])
        campaign = f"SP | {product.title()} | {campaign_kind}"
        ad_group = f"{product.title()} AG1"

        if campaign_kind == "Auto":
            targeting = rng.choice(["close-match", "loose-match", "substitutes", "complements"])
            match_type = "-"
        elif campaign_kind == "Broad":
            targeting = product
            match_type = "broad"
        else:
            targeting = f"{product} {rng.choice(_MODIFIERS)}".strip()
            match_type = "exact"

        if campaign_kind == "Exact":
            term = targeting
        elif rng.random() < 0.12:
            term = rng.choice(_JUNK_TERMS)
        else:
            term = f"{rng.choice(_MODIFIERS)} {product} {rng.choice(_MODIFIERS)}".strip()
            term = " ".join(term.split())

        impressions = rng.randint(50, 8000)
        clicks = min(impressions, int(impressions * rng.uniform(0.002, 0.08)))
        cpc = rng.uniform(0.25, 1.60)
        spend = round(clicks * cpc, 2)
        is_junk = term in _JUNK_TERMS
        cvr = 0.0 if is_junk else rng.choice([0.0, 0.02, 0.05, 0.09, 0.14, 0.2])
        orders = int(clicks * cvr)
        price = rng.uniform(12, 35)
        sales = round(orders * price, 2)
        out.append(
            [campaign, ad_group, targeting, match_type, term,
             impressions, clicks, spend, sales, orders, orders]
        )

    path = Path(path)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(headers)
        writer.writerows(out)
    return path
