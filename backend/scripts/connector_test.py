"""
Live connector test against real PostgreSQL and MySQL servers (run in CI).

Proves three layers independently:
  1. Data round-trips correctly through each driver into Data Studio tables.
  2. The static SQL check rejects writes at the API (422).
  3. Even with the static check *disabled*, the READ ONLY transaction makes
     the database itself refuse a write — the real safety guarantee.

    PG_URL=postgresql://u:p@localhost:5432/db MYSQL_URL=mysql://u:p@localhost:3306/db \\
        python -m scripts.connector_test
"""

from __future__ import annotations

import asyncio
import os
import sys
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.connectors import service
from app.connectors.models import CsvUrlSource, MySqlSource, PostgresSource, QueryRequest
from app.main import app

ROWS = [("s1", "2026-01-01 10:00:00", "view", "IL", 1.25), ("s1", "2026-01-01 10:05:00", "buy", "IL", None),
        ("s2", "2026-01-02 09:00:00", "view", "US", 3.5)]


def src_from(url: str):
    u = urlparse(url)
    kind = "postgres" if u.scheme.startswith("postgres") else "mysql"
    cls = PostgresSource if kind == "postgres" else MySqlSource
    return cls(type=kind, host=u.hostname, port=u.port, database=u.path.lstrip("/"), user=u.username, password=u.password)


async def seed(url: str) -> None:
    driver = "postgresql+asyncpg" if url.startswith("postgres") else "mysql+aiomysql"
    eng = create_async_engine(driver + url[url.index("://"):])
    async with eng.begin() as c:
        await c.execute(text("DROP TABLE IF EXISTS studio_events"))
        await c.execute(text("CREATE TABLE studio_events (sid VARCHAR(10), ts TIMESTAMP, ev VARCHAR(20), country VARCHAR(5), amount DECIMAL(8,2))"))
        for r in ROWS:
            await c.execute(text("INSERT INTO studio_events VALUES (:a, :b, :c, :d, :e)"),
                            dict(zip("abcde", r, strict=True)) | {"b": __import__("datetime").datetime.fromisoformat(r[1])})
    await eng.dispose()


async def check(url: str, client: httpx.AsyncClient) -> None:
    src = src_from(url)
    await seed(url)
    out = await service.fetch(QueryRequest(source=src, query="SELECT sid, ts, ev, country, amount FROM studio_events ORDER BY ts"))
    assert out.headers == ["sid", "ts", "ev", "country", "amount"], out.headers
    assert out.rows[0] == ["s1", "2026-01-01 10:00:00", "view", "IL", "1.25"], out.rows[0]
    assert out.rows[1][4] == "" and out.row_count == 3 and not out.truncated
    capped = await service.fetch(QueryRequest(source=src, query="SELECT * FROM studio_events", max_rows=2))
    assert capped.row_count == 2 and capped.truncated

    # 2. static check at the API boundary
    body = {"source": src.model_dump(mode="json") | {"password": src.password.get_secret_value()}}
    r = await client.post("/api/connectors/query", json=body | {"query": "SELECT ev, COUNT(*) AS n FROM studio_events GROUP BY ev ORDER BY ev"})
    assert r.status_code == 200 and r.json()["rows"] == [["buy", "1"], ["view", "2"]], r.text
    r = await client.post("/api/connectors/query", json=body | {"query": "DELETE FROM studio_events"})
    assert r.status_code == 422, r.text
    r = await client.post("/api/connectors/test", json=body)
    assert r.status_code == 200 and r.json()["ok"], r.text

    # 3. database-level guarantee with the static check bypassed
    original = service.check_read_only_sql
    service.check_read_only_sql = lambda q: q  # type: ignore[assignment]
    try:
        await service.fetch(QueryRequest(source=src, query="INSERT INTO studio_events (sid) VALUES ('evil')"))
        raise AssertionError("write was not blocked by the READ ONLY transaction")
    except HTTPException as exc:
        assert exc.status_code == 502 and "read" in exc.detail.lower(), exc.detail
    finally:
        service.check_read_only_sql = original
    n = await service.fetch(QueryRequest(source=src, query="SELECT COUNT(*) FROM studio_events"))
    assert n.rows == [["3"]], n.rows
    print(f"✓ {src.type}: round-trip, row cap, API guard and READ ONLY transaction verified")


async def main() -> int:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        for var in ("PG_URL", "MYSQL_URL"):
            if os.getenv(var):
                await check(os.environ[var], client)
        info = (await client.get("/api/connectors")).json()
        assert "postgres" in info["types"] and info["adhoc_allowed"] is True
        if os.getenv("CSV_URL"):
            out = await service.fetch(QueryRequest(source=CsvUrlSource(type="csv_url", url=os.environ["CSV_URL"])))
            assert out.headers == ["variant", "users", "conversions"] and out.row_count == 2, out
            print("✓ csv_url: server-side fetch verified")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
