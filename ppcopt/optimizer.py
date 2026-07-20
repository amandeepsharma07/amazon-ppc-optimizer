"""Bid recommendations and campaign summaries."""

from __future__ import annotations

from dataclasses import dataclass

from .models import Config, SearchTermRow, safe_div


@dataclass
class TargetStats:
    campaign: str
    ad_group: str
    targeting: str
    match_type: str
    impressions: int = 0
    clicks: int = 0
    spend: float = 0.0
    sales: float = 0.0
    orders: int = 0

    @property
    def acos(self) -> float:
        return safe_div(self.spend, self.sales)

    @property
    def rpc(self) -> float:
        return safe_div(self.sales, self.clicks)

    @property
    def avg_cpc(self) -> float:
        return safe_div(self.spend, self.clicks)


@dataclass
class BidRecommendation:
    campaign: str
    ad_group: str
    targeting: str
    match_type: str
    clicks: int
    spend: float
    sales: float
    orders: int
    acos: float
    avg_cpc: float
    suggested_bid: float
    action: str  # increase | decrease | keep
    reason: str


def aggregate_targets(rows: list[SearchTermRow]) -> list[TargetStats]:
    """Roll search-term rows up to their targeting (keyword/expression) level."""
    targets: dict[tuple, TargetStats] = {}
    for row in rows:
        key = (row.campaign, row.ad_group, row.targeting, row.match_type)
        stats = targets.get(key)
        if stats is None:
            stats = targets[key] = TargetStats(*key)
        stats.impressions += row.impressions
        stats.clicks += row.clicks
        stats.spend += row.spend
        stats.sales += row.sales
        stats.orders += row.orders
    return list(targets.values())


def _clamp_bid(suggested: float, current: float, config: Config) -> float:
    lo = current * (1 - config.max_bid_change)
    hi = current * (1 + config.max_bid_change)
    return max(config.min_bid, min(hi, max(lo, suggested)))


def recommend_bids(rows: list[SearchTermRow], config: Config) -> list[BidRecommendation]:
    """Suggest a bid per target so that spend converges on the target ACOS.

    The value of a click on a converting target is its revenue per click; at
    target ACOS the affordable CPC is rpc * target_acos. Changes are clamped
    to +/- max_bid_change per run so one report window can't whipsaw bids.
    """
    recommendations = []
    for stats in aggregate_targets(rows):
        current = stats.avg_cpc
        if stats.clicks < config.min_clicks or current <= 0:
            continue  # not enough data to act on

        if stats.sales > 0:
            ideal = stats.rpc * config.target_acos
            suggested = _clamp_bid(ideal, current, config)
            if suggested > current * 1.05:
                action, reason = "increase", (
                    f"ACOS {stats.acos:.0%} is below target {config.target_acos:.0%}; "
                    "room to bid up for more volume"
                )
            elif suggested < current * 0.95:
                action, reason = "decrease", (
                    f"ACOS {stats.acos:.0%} is above target {config.target_acos:.0%}"
                )
            else:
                action, reason = "keep", "ACOS is near target"
        elif stats.clicks >= config.no_sale_clicks:
            suggested = max(config.min_bid, current * (1 - config.no_sale_bid_cut))
            action = "decrease"
            reason = f"{stats.clicks} clicks without a sale"
        else:
            continue

        recommendations.append(
            BidRecommendation(
                campaign=stats.campaign,
                ad_group=stats.ad_group,
                targeting=stats.targeting,
                match_type=stats.match_type,
                clicks=stats.clicks,
                spend=round(stats.spend, 2),
                sales=round(stats.sales, 2),
                orders=stats.orders,
                acos=round(stats.acos, 4),
                avg_cpc=round(current, 2),
                suggested_bid=round(suggested, 2),
                action=action,
                reason=reason,
            )
        )
    recommendations.sort(key=lambda r: r.spend, reverse=True)
    return recommendations


@dataclass
class CampaignSummary:
    campaign: str
    impressions: int
    clicks: int
    spend: float
    sales: float
    orders: int
    ctr: float
    cvr: float
    avg_cpc: float
    acos: float
    roas: float


def campaign_summary(rows: list[SearchTermRow]) -> list[CampaignSummary]:
    totals: dict[str, dict] = {}
    for row in rows:
        t = totals.setdefault(
            row.campaign,
            {"impressions": 0, "clicks": 0, "spend": 0.0, "sales": 0.0, "orders": 0},
        )
        t["impressions"] += row.impressions
        t["clicks"] += row.clicks
        t["spend"] += row.spend
        t["sales"] += row.sales
        t["orders"] += row.orders

    summaries = [
        CampaignSummary(
            campaign=name,
            impressions=t["impressions"],
            clicks=t["clicks"],
            spend=round(t["spend"], 2),
            sales=round(t["sales"], 2),
            orders=t["orders"],
            ctr=round(safe_div(t["clicks"], t["impressions"]), 4),
            cvr=round(safe_div(t["orders"], t["clicks"]), 4),
            avg_cpc=round(safe_div(t["spend"], t["clicks"]), 2),
            acos=round(safe_div(t["spend"], t["sales"]), 4),
            roas=round(safe_div(t["sales"], t["spend"]), 2),
        )
        for name, t in totals.items()
    ]
    summaries.sort(key=lambda s: s.spend, reverse=True)
    return summaries
