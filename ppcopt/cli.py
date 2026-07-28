"""Command-line interface: ppcopt optimize / ppcopt sample."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .harvest import recommend_harvest
from .models import Config
from .negatives import recommend_negatives
from .optimizer import campaign_summary, recommend_bids
from .parser import read_report
from .report import write_csvs, write_xlsx
from .sample import generate_sample


def _parse_acos(value: str) -> float:
    """Accept 30, 30%, or 0.30 — all meaning 30%."""
    acos = float(value.rstrip("%"))
    return acos / 100 if acos > 1 else acos


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ppcopt",
        description="Amazon PPC optimizer: turn a search term report into "
        "bid changes, negative keywords, and harvest keywords.",
    )
    parser.add_argument("--version", action="version", version=f"ppcopt {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    opt = sub.add_parser("optimize", help="Analyze a search term report")
    opt.add_argument("report", help="Path to the report (.csv, .tsv, or .xlsx)")
    opt.add_argument(
        "--target-acos", type=_parse_acos, default="30",
        help="Target ACOS, e.g. 30, 30%%, or 0.30 (default: 30%%)",
    )
    opt.add_argument("-o", "--output", default="ppc_recommendations.xlsx",
                     help="Output file (.xlsx) or directory with --format csv")
    opt.add_argument("--format", choices=["xlsx", "csv"], default="xlsx")
    opt.add_argument("--currency", default="$", help="Currency symbol for messages")
    opt.add_argument("--min-clicks", type=int, default=Config.min_clicks,
                     help="Clicks required before a bid change is suggested")
    opt.add_argument("--max-bid-change", type=float, default=Config.max_bid_change,
                     help="Max relative bid change per run (0.30 = 30%%)")
    opt.add_argument("--min-bid", type=float, default=Config.min_bid,
                     help="Bid floor")
    opt.add_argument("--negative-clicks", type=int, default=Config.negative_clicks,
                     help="Clicks with zero orders before a term is negated")
    opt.add_argument("--harvest-min-orders", type=int, default=Config.harvest_min_orders,
                     help="Orders required to harvest a search term")

    smp = sub.add_parser("sample", help="Generate a sample search term report")
    smp.add_argument("-o", "--output", default="sample_search_term_report.csv")
    smp.add_argument("--rows", type=int, default=150)
    return parser


def run_optimize(args: argparse.Namespace) -> int:
    config = Config(
        target_acos=args.target_acos,
        min_clicks=args.min_clicks,
        max_bid_change=args.max_bid_change,
        min_bid=args.min_bid,
        negative_clicks=args.negative_clicks,
        harvest_min_orders=args.harvest_min_orders,
        currency=args.currency,
    )
    config.validate()

    rows = read_report(args.report)
    if not rows:
        print("No data rows found in the report.", file=sys.stderr)
        return 1

    summary = campaign_summary(rows)
    bids = recommend_bids(rows, config)
    negatives = recommend_negatives(rows, config)
    harvest = recommend_harvest(rows, config)

    total_spend = sum(s.spend for s in summary)
    total_sales = sum(s.sales for s in summary)
    acos = total_spend / total_sales if total_sales else 0.0
    wasted = sum(n.spend for n in negatives)
    cur = config.currency

    print(f"Parsed {len(rows)} rows across {len(summary)} campaigns.")
    print(f"Account: spend {cur}{total_spend:,.2f}, sales {cur}{total_sales:,.2f}, "
          f"ACOS {acos:.1%} (target {config.target_acos:.0%})")
    print(f"  Bid recommendations : {len(bids)}")
    print(f"  Negative keywords   : {len(negatives)} "
          f"(~{cur}{wasted:,.2f} spend with zero orders)")
    print(f"  Harvest keywords    : {len(harvest)}")

    if args.format == "csv":
        paths = write_csvs(args.output, summary, bids, negatives, harvest)
        print(f"Wrote {len(paths)} CSV files to {Path(args.output).resolve()}")
    else:
        path = write_xlsx(args.output, summary, bids, negatives, harvest)
        print(f"Wrote {path.resolve()}")
    return 0


def run_sample(args: argparse.Namespace) -> int:
    path = generate_sample(args.output, rows=args.rows)
    print(f"Wrote sample report to {path.resolve()}")
    print(f"Try: ppcopt optimize {path} --target-acos 30")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "optimize":
        return run_optimize(args)
    if args.command == "sample":
        return run_sample(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
