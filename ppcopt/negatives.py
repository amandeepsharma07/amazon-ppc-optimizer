"""Negative keyword candidates: search terms burning spend without converting."""

from __future__ import annotations

from dataclasses import dataclass

from .models import Config, SearchTermRow, safe_div


@dataclass
class NegativeRecommendation:
    campaign: str
    ad_group: str
    search_term: str
    clicks: int
    spend: float
    orders: int
    negative_type: str  # "negative exact"
    reason: str


def recommend_negatives(rows: list[SearchTermRow], config: Config) -> list[NegativeRecommendation]:
    """Flag search terms to add as negative exact.

    A term qualifies when it has zero orders and either enough clicks to be
    statistically hopeless, or spend well past what a converting click may
    cost at target ACOS (based on the account-average revenue per click).
    """
    total_sales = sum(r.sales for r in rows)
    total_clicks = sum(r.clicks for r in rows)
    account_rpc = safe_div(total_sales, total_clicks)
    # Affordable cost per converting search term at target ACOS.
    spend_ceiling = account_rpc * config.target_acos * config.negative_spend_multiple

    # Aggregate per (campaign, ad_group, search_term); the same term can
    # appear once per targeting that matched it.
    terms: dict[tuple, dict] = {}
    for row in rows:
        if not row.search_term:
            continue
        key = (row.campaign, row.ad_group, row.search_term)
        t = terms.setdefault(key, {"clicks": 0, "spend": 0.0, "orders": 0})
        t["clicks"] += row.clicks
        t["spend"] += row.spend
        t["orders"] += row.orders

    recommendations = []
    for (campaign, ad_group, search_term), t in terms.items():
        if t["orders"] > 0:
            continue
        if t["clicks"] >= config.negative_clicks:
            reason = f"{t['clicks']} clicks with zero orders"
        elif spend_ceiling > 0 and t["spend"] >= spend_ceiling and t["clicks"] > 0:
            reason = (
                f"spent {config.currency}{t['spend']:.2f} with zero orders "
                f"(> {config.negative_spend_multiple:g}x affordable cost per conversion)"
            )
        else:
            continue
        recommendations.append(
            NegativeRecommendation(
                campaign=campaign,
                ad_group=ad_group,
                search_term=search_term,
                clicks=t["clicks"],
                spend=round(t["spend"], 2),
                orders=0,
                negative_type="negative exact",
                reason=reason,
            )
        )
    recommendations.sort(key=lambda r: r.spend, reverse=True)
    return recommendations
