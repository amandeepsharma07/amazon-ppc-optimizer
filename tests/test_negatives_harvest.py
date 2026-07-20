from ppcopt.harvest import recommend_harvest
from ppcopt.models import Config, SearchTermRow
from ppcopt.negatives import recommend_negatives


def row(**kwargs) -> SearchTermRow:
    base = dict(campaign="C1", ad_group="AG1", targeting="yoga mat", match_type="broad",
                search_term="thick yoga mat", impressions=1000, clicks=0, spend=0.0,
                sales=0.0, orders=0, units=0)
    base.update(kwargs)
    return SearchTermRow(**base)


def test_negative_on_clicks_with_zero_orders():
    rows = [
        row(search_term="yoga pants", clicks=12, spend=8.0),
        row(search_term="yoga mat 6mm", clicks=12, spend=8.0, sales=40.0, orders=2),
    ]
    recs = recommend_negatives(rows, Config(negative_clicks=10))
    assert [r.search_term for r in recs] == ["yoga pants"]
    assert recs[0].negative_type == "negative exact"


def test_negative_on_excess_spend_without_orders():
    # Account rpc = 100/20 = 5; ceiling = 5 * 0.3 * 2 = 3.0. Junk term
    # spent 4.0 over only 4 clicks (below click threshold) -> still negated.
    rows = [
        row(search_term="winner", clicks=16, spend=10.0, sales=100.0, orders=5),
        row(search_term="junk", clicks=4, spend=4.0),
    ]
    recs = recommend_negatives(rows, Config(target_acos=0.30, negative_clicks=10))
    assert [r.search_term for r in recs] == ["junk"]


def test_negative_aggregates_same_term_across_targetings():
    rows = [
        row(targeting="close-match", search_term="yoga pants", clicks=6, spend=3.0),
        row(targeting="loose-match", search_term="yoga pants", clicks=6, spend=3.0),
    ]
    recs = recommend_negatives(rows, Config(negative_clicks=10))
    assert len(recs) == 1
    assert recs[0].clicks == 12


def test_harvest_promotes_converting_term():
    rows = [row(search_term="thick yoga mat", clicks=20, spend=12.0, sales=80.0, orders=4)]
    recs = recommend_harvest(rows, Config(target_acos=0.30, harvest_min_orders=2))
    assert len(recs) == 1
    rec = recs[0]
    assert rec.search_term == "thick yoga mat"
    # rpc = 80/20 = 4.0 -> suggested bid = 4.0 * 0.30 = 1.20
    assert rec.suggested_bid == 1.20


def test_harvest_skips_terms_already_exact():
    rows = [row(targeting="thick yoga mat", match_type="exact",
                search_term="thick yoga mat", clicks=20, spend=12.0,
                sales=80.0, orders=4)]
    assert recommend_harvest(rows, Config()) == []


def test_harvest_skips_high_acos_terms():
    # ACOS = 30/40 = 75%; cap = 0.30 * 1.2 = 36%.
    rows = [row(clicks=20, spend=30.0, sales=40.0, orders=3)]
    assert recommend_harvest(rows, Config(target_acos=0.30)) == []


def test_harvest_requires_min_orders():
    rows = [row(clicks=10, spend=3.0, sales=30.0, orders=1)]
    assert recommend_harvest(rows, Config(harvest_min_orders=2)) == []
