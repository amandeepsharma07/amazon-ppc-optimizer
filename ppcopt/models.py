"""Data models and configuration for PPC optimization."""

from __future__ import annotations

from dataclasses import dataclass, field


def safe_div(numerator: float, denominator: float) -> float:
    """Divide, returning 0.0 when the denominator is zero."""
    return numerator / denominator if denominator else 0.0


@dataclass
class SearchTermRow:
    """One row of an Amazon Ads search term report."""

    campaign: str = ""
    ad_group: str = ""
    targeting: str = ""
    match_type: str = ""
    search_term: str = ""
    impressions: int = 0
    clicks: int = 0
    spend: float = 0.0
    sales: float = 0.0
    orders: int = 0
    units: int = 0

    @property
    def acos(self) -> float:
        return safe_div(self.spend, self.sales)

    @property
    def cvr(self) -> float:
        return safe_div(self.orders, self.clicks)

    @property
    def rpc(self) -> float:
        """Revenue per click."""
        return safe_div(self.sales, self.clicks)

    @property
    def avg_cpc(self) -> float:
        return safe_div(self.spend, self.clicks)


# Targeting expressions used by auto campaigns; these are not real keywords.
AUTO_TARGETING_EXPRESSIONS = {
    "close-match",
    "loose-match",
    "complements",
    "substitutes",
    "*",
}


def is_auto_targeting(targeting: str) -> bool:
    return targeting.strip().lower() in AUTO_TARGETING_EXPRESSIONS


@dataclass
class Config:
    """Optimization thresholds. All monetary values are in the report currency."""

    # Target ACOS as a fraction (0.30 == 30%).
    target_acos: float = 0.30

    # Bids: minimum clicks before a target has enough data to act on.
    min_clicks: int = 5
    # Maximum relative bid change per run (0.30 == +/-30%).
    max_bid_change: float = 0.30
    # Never suggest a bid below this floor.
    min_bid: float = 0.10
    # Clicks without a sale before we suggest lowering the bid.
    no_sale_clicks: int = 8
    # Bid cut applied to targets with clicks but no sales.
    no_sale_bid_cut: float = 0.25

    # Negatives: clicks with zero orders before a search term is negated.
    negative_clicks: int = 10
    # Or: spend with zero orders exceeding this many times the value a
    # converting click may cost at target ACOS (uses account-average RPC).
    negative_spend_multiple: float = 2.0

    # Harvesting: minimum orders for a search term to graduate to exact.
    harvest_min_orders: int = 2
    # Harvested terms must have ACOS at or below target * this multiple.
    harvest_max_acos_multiple: float = 1.2

    # Currency symbol used in the output report.
    currency: str = "$"

    extra: dict = field(default_factory=dict)

    def validate(self) -> None:
        if not 0 < self.target_acos < 5:
            raise ValueError(f"target_acos must be between 0 and 5, got {self.target_acos}")
        if self.max_bid_change <= 0:
            raise ValueError("max_bid_change must be positive")
        if self.min_bid < 0:
            raise ValueError("min_bid cannot be negative")
