from pathlib import Path

from ppcopt.parser import map_headers, normalize_header, read_report

AMAZON_HEADERS = [
    "Campaign Name", "Ad Group Name", "Targeting", "Match Type",
    "Customer Search Term", "Impressions", "Clicks", "Click-Thru Rate (CTR)",
    "Cost Per Click (CPC)", "Spend", "7 Day Total Sales (₹)",
    "Total Advertising Cost of Sales (ACOS)", "7 Day Total Orders (#)",
    "7 Day Total Units (#)",
]


def test_normalize_header_strips_currency_and_brackets():
    assert normalize_header("7 Day Total Sales (₹)") == "7 day total sales"
    assert normalize_header("Spend") == "spend"
    assert normalize_header("7 Day Total Orders (#)") == "7 day total orders"


def test_map_headers_finds_all_core_fields():
    mapping = map_headers(AMAZON_HEADERS)
    assert set(mapping.values()) >= {
        "campaign", "ad_group", "targeting", "match_type", "search_term",
        "impressions", "clicks", "spend", "sales", "orders", "units",
    }


def test_read_csv_report(tmp_path: Path):
    csv_path = tmp_path / "report.csv"
    csv_path.write_text(
        "Campaign Name,Ad Group Name,Targeting,Match Type,Customer Search Term,"
        "Impressions,Clicks,Spend,7 Day Total Sales,7 Day Total Orders (#)\n"
        'SP Auto,AG1,close-match,-,yoga mat,"1,200",30,"₹450.50","₹1,500.00",5\n',
        encoding="utf-8",
    )
    rows = read_report(csv_path)
    assert len(rows) == 1
    row = rows[0]
    assert row.campaign == "SP Auto"
    assert row.search_term == "yoga mat"
    assert row.impressions == 1200
    assert row.spend == 450.50
    assert row.sales == 1500.0
    assert row.orders == 5


def test_read_report_missing_columns(tmp_path: Path):
    bad = tmp_path / "bad.csv"
    bad.write_text("Foo,Bar\n1,2\n", encoding="utf-8")
    try:
        read_report(bad)
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "missing required columns" in str(exc)


def test_read_xlsx_report(tmp_path: Path):
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Campaign Name", "Ad Group Name", "Targeting", "Match Type",
                  "Customer Search Term", "Impressions", "Clicks", "Spend",
                  "7 Day Total Sales", "7 Day Total Orders (#)"])
    sheet.append(["SP Broad", "AG1", "yoga mat", "broad", "thick yoga mat",
                  500, 12, 18.6, 55.0, 2])
    xlsx_path = tmp_path / "report.xlsx"
    workbook.save(xlsx_path)

    rows = read_report(xlsx_path)
    assert len(rows) == 1
    assert rows[0].match_type == "broad"
    assert rows[0].clicks == 12
