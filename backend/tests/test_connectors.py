"""Connector safety and data-shaping tests (DB-free; live DB tests run in CI)."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.connectors.safety import UnsafeQuery, cell, check_read_only_sql


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM events",
        "  select a, b from t where x = 'a;b' ;",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "-- comment\nSELECT updated_at, created_at, offset_ms FROM t /* block; */",
        "(SELECT 1) UNION (SELECT 2)",
    ],
)
def test_read_only_sql_accepted(sql):
    assert check_read_only_sql(sql)


@pytest.mark.parametrize(
    "sql,msg",
    [
        ("", "empty"),
        ("DELETE FROM events", "read-only"),
        ("SELECT 1; DROP TABLE events", "single statement"),
        ("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "DELETE"),
        ("SELECT * INTO OUTFILE '/tmp/x' FROM t", "OUTFILE"),
        ("SELECT pg_sleep(1); SELECT 1", "single statement"),
        ("UPDATE t SET a = 1", "read-only"),
        ("SELECT 1 /* ; */ ; INSERT INTO t VALUES (1)", "single statement"),
    ],
)
def test_unsafe_sql_rejected(sql, msg):
    with pytest.raises(UnsafeQuery, match=msg):
        check_read_only_sql(sql)


def test_cell_rendering():
    assert cell(None) == ""
    assert cell(True) == "1"
    assert cell(Decimal("12.50")) == "12.50"
    assert cell(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02 03:04:05"
    assert cell(date(2026, 1, 2)) == "2026-01-02"
    assert cell(0.1) == "0.1"


class _V:
    def __init__(self, v):
        self.value = v


class _Row:
    def __init__(self, dims, mets):
        self.dimension_values = [_V(d) for d in dims]
        self.metric_values = [_V(m) for m in mets]


class _Resp:
    def __init__(self, rows, total):
        self.rows = rows
        self.row_count = total


class FakeGa4:
    """Mimics BetaAnalyticsDataClient.run_report pagination."""

    def __init__(self, data):
        self.data = data
        self.requests = []

    def run_report(self, req):
        self.requests.append(req)
        page = self.data[req.offset : req.offset + req.limit]
        return _Resp([_Row(d, m) for d, m in page], len(self.data))


def test_ga4_flattening_and_pagination():
    pytest.importorskip("fastapi")
    pytest.importorskip("google.analytics.data_v1beta")
    from app.connectors.models import Ga4Source
    from app.connectors.service import run_ga4

    data = [((ev, c), (str(u),)) for ev, c, u in [
        ("page_view", "IL", 1000), ("add_to_cart", "IL", 300), ("purchase", "IL", 90),
        ("page_view", "US", 2000), ("add_to_cart", "US", 700), ("purchase", "US", 250),
    ]]
    src = Ga4Source(type="ga4", property_id="properties/123", dimensions=["eventName", "country"],
                    metrics=["totalUsers"], event_names=["page_view", "add_to_cart", "purchase"])
    client = FakeGa4(data)
    headers, rows, truncated = run_ga4(src, max_rows=10, client=client)
    assert headers == ["eventName", "country", "totalUsers"]
    assert rows[0] == ["page_view", "IL", "1000"] and len(rows) == 6 and not truncated
    req = client.requests[0]
    assert req.property == "properties/123"
    assert list(req.dimension_filter.filter.in_list_filter.values) == ["page_view", "add_to_cart", "purchase"]
    headers, rows, truncated = run_ga4(src, max_rows=4, client=FakeGa4(data))
    assert len(rows) == 4 and truncated


def test_ga4_validation():
    pytest.importorskip("fastapi")
    from pydantic import ValidationError

    from app.connectors.models import Ga4Source

    with pytest.raises(ValidationError):
        Ga4Source(type="ga4", property_id="abc")
    with pytest.raises(ValidationError):
        Ga4Source(type="ga4", property_id="1", dimensions=["drop table"])


async def _sqlite_roundtrip(tmp_path, monkeypatch):
    import sqlite3

    from app.config import get_settings
    from app.connectors.models import QueryRequest, SqliteSource
    from app.connectors.service import fetch

    db = tmp_path / "shop.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE ev (sid TEXT, ts TEXT, ev TEXT, amount NUMERIC)")
    con.executemany("INSERT INTO ev VALUES (?,?,?,?)", [("s1", "2026-01-01 10:00:00", "view", 1.5), ("s1", "2026-01-01 10:01:00", "buy", None)])
    con.commit()
    con.close()
    monkeypatch.setattr(get_settings(), "sqlite_dir", str(tmp_path))
    out = await fetch(QueryRequest(source=SqliteSource(type="sqlite", path="shop.db"), query="SELECT * FROM ev ORDER BY ts"))
    assert out.headers == ["sid", "ts", "ev", "amount"]
    assert out.rows == [["s1", "2026-01-01 10:00:00", "view", "1.5"], ["s1", "2026-01-01 10:01:00", "buy", ""]]
    from fastapi import HTTPException

    with pytest.raises(HTTPException):  # path traversal outside the sqlite dir
        await fetch(QueryRequest(source=SqliteSource(type="sqlite", path="../etc/passwd"), query="SELECT 1"))


def test_sqlite_connector(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("aiosqlite")
    import asyncio

    asyncio.run(_sqlite_roundtrip(tmp_path, monkeypatch))
