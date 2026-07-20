from ppcopt.models import Config, SearchTermRow
from ppcopt.optimizer import aggregate_targets, campaign_summary, recommend_bids


def row(**kwargs) -> SearchTermRow:
    base = dict(campaign="C1", ad_group="AG1", targeting="kw", match_type="broad",
                search_term="term", impressions=1000, clicks=0, spend=0.0,
                sales=0.0, orders=0, units=0)
    base.update(kwargs)
    return SearchTermRow(**base)


def test_aggregate_targets_rolls_up_search_terms():
    rows = [
        row(search_term="a", clicks=5, spend=5.0, sales=20.0, orders=1),
        row(search_term="b", clicks=5, spend=5.0, sales=0.0, orders=0),
    ]
    targets = aggregate_targets(rows)
    assert len(targets) == 1
    assert targets[0].clicks == 10
    assert targets[0].spend == 10.0
    assert targets[0].sales == 20.0


def test_bid_decrease_when_acos_above_target():
    # ACOS = 30/60 = 50%, target 30%. rpc = 60/20 = 3.0 → ideal bid 0.90,
    # current cpc 1.50 → clamped to 1.50 * 0.7 = 1.05 (max 30% cut).
    rows = [row(clicks=20, spend=30.0, sales=60.0, orders=4)]
    recs = recommend_bids(rows, Config(target_acos=0.30))
    assert len(recs) == 1
    rec = recs[0]
    assert rec.action == "decrease"
    assert rec.avg_cpc == 1.50
    assert rec.suggested_bid == 1.05


def test_bid_increase_when_acos_below_target():
    # ACOS = 10/200 = 5%, target 30%. rpc = 20 → ideal 6.0, clamped to +30%.
    rows = [row(clicks=10, spend=10.0, sales=200.0, orders=5)]
    recs = recommend_bids(rows, Config(target_acos=0.30))
    assert recs[0].action == "increase"
    assert recs[0].suggested_bid == 1.30


def test_no_recommendation_below_min_clicks():
    rows = [row(clicks=3, spend=3.0, sales=50.0, orders=1)]
    assert recommend_bids(rows, Config()) == []


def test_no_sale_clicks_triggers_cut():
    rows = [row(clicks=10, spend=10.0, sales=0.0, orders=0)]
    recs = recommend_bids(rows, Config(no_sale_clicks=8, no_sale_bid_cut=0.25))
    assert len(recs) == 1
    assert recs[0].action == "decrease"
    assert recs[0].suggested_bid == 0.75


def test_bid_never_below_floor():
    rows = [row(clicks=10, spend=1.0, sales=0.0, orders=0)]
    recs = recommend_bids(rows, Config(min_bid=0.10))
    assert recs[0].suggested_bid == 0.10


def test_campaign_summary_metrics():
    rows = [
        row(campaign="C1", impressions=1000, clicks=50, spend=25.0, sales=100.0, orders=5),
        row(campaign="C2", impressions=500, clicks=10, spend=10.0, sales=0.0, orders=0),
    ]
    summaries = {s.campaign: s for s in campaign_summary(rows)}
    assert summaries["C1"].ctr == 0.05
    assert summaries["C1"].cvr == 0.1
    assert summaries["C1"].acos == 0.25
    assert summaries["C1"].roas == 4.0
    assert summaries["C2"].acos == 0.0  # no sales -> 0, not division error
