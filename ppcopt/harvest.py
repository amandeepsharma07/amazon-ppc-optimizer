"""Keyword harvesting: promote converting search terms to exact-match keywords."""

from __future__ import annotations

from dataclasses import dataclass

from .models import Config, SearchTermRow, is_auto_targeting, safe_div


@dataclass
class HarvestRecommendation:
    search_term: str
    source_campaign: str
    source_ad_group: str
    source_targeting: str
    source_match_type: str
    clicks: int
    spend: float
    sales: float
    orders: int
    acos: float
    cvr: float
    suggested_bid: float
    note: str


def recommend_harvest(rows: list[SearchTermRow], config: Config) -> list[HarvestRecommendation]:
    """Find search terms worth graduating to their own exact-match keyword.

    Candidates come from auto, broad, or phrase traffic (a term already
    targeted as exact has nothing to graduate to). A term qualifies with
    enough orders and an ACOS within harvest_max_acos_multiple of target.
    The suggested starting bid prices its own revenue per click at target
    ACOS. Add the term as negative exact in the source ad group so the
    original targeting stops competing with the new keyword.
    """
    max_acos = config.target_acos * config.harvest_max_acos_multiple

    # Aggregate per search term within its source ad group.
    terms: dict[tuple, dict] = {}
    for row in rows:
        if not row.search_term:
            continue
        already_exact = (
            row.match_type.strip().lower() == "exact"
            and row.search_term.strip().lower() == row.targeting.strip().lower()
        )
        if already_exact:
            continue
        key = (row.campaign, row.ad_group, row.search_term.strip().lower())
        t = terms.setdefault(
            key,
            {
                "clicks": 0,
                "spend": 0.0,
                "sales": 0.0,
                "orders": 0,
                "targeting": row.targeting,
                "match_type": row.match_type,
                "term": row.search_term,
            },
        )
        t["clicks"] += row.clicks
        t["spend"] += row.spend
        t["sales"] += row.sales
        t["orders"] += row.orders

    recommendations = []
    for (campaign, ad_group, _), t in terms.items():
        if t["orders"] < config.harvest_min_orders:
            continue
        acos = safe_div(t["spend"], t["sales"])
        if acos > max_acos:
            continue
        rpc = safe_div(t["sales"], t["clicks"])
        suggested_bid = max(config.min_bid, rpc * config.target_acos)
        source = "auto" if is_auto_targeting(t["targeting"]) else t["match_type"] or "unknown"
        recommendations.append(
            HarvestRecommendation(
                search_term=t["term"],
                source_campaign=campaign,
                source_ad_group=ad_group,
                source_targeting=t["targeting"],
                source_match_type=source,
                clicks=t["clicks"],
                spend=round(t["spend"], 2),
                sales=round(t["sales"], 2),
                orders=t["orders"],
                acos=round(acos, 4),
                cvr=round(safe_div(t["orders"], t["clicks"]), 4),
                suggested_bid=round(suggested_bid, 2),
                note="Add as exact match; add negative exact in source ad group",
            )
        )
    recommendations.sort(key=lambda r: r.sales, reverse=True)
    return recommendations
