"""
Data-source connectors for the Data Studio (self-hosted deployment).

The server only *fetches* tabular data; all analysis still happens in the
browser with the same engine used for uploaded files.

Safety model
------------
* SQL runs in a READ ONLY transaction with a statement timeout, after a
  static single-statement / read-only keyword check (safety.py).
* SQLite files are opened read-only and only from PULSEPORT_SQLITE_DIR.
* Credentials for saved connections live in server env (PULSEPORT_CONNECTIONS)
  and are never returned to the client.
* Ad-hoc connections can be disabled (PULSEPORT_ALLOW_ADHOC_CONNECTIONS=false).
* Every fetch is row-capped (PULSEPORT_CONNECTOR_MAX_ROWS).
"""

from __future__ import annotations

import os
import ssl
import time
from pathlib import Path

import httpx
from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from .models import (
    ConnectorsInfo,
    CsvUrlSource,
    Ga4Source,
    MySqlSource,
    PostgresSource,
    QueryRequest,
    SavedConnection,
    Source,
    SqliteSource,
    TableOut,
)
from .safety import UnsafeQuery, cell, check_read_only_sql

_SOURCE = TypeAdapter(Source)
SQL_TYPES = (PostgresSource, MySqlSource, SqliteSource)


# --------------------------------------------------------------- registry
def saved_connections() -> dict[str, Source]:
    raw = get_settings().connections
    out: dict[str, Source] = {}
    for name, cfg in raw.items():
        try:
            out[name] = _SOURCE.validate_python(cfg)
        except ValidationError as exc:  # misconfiguration should be loud but not fatal
            raise RuntimeError(f"Invalid saved connection '{name}': {exc}") from exc
    return out


def _label(src: Source) -> str:
    match src:
        case PostgresSource() | MySqlSource():
            return f"{src.type}://{src.host}:{src.port}/{src.database}"
        case SqliteSource():
            return f"sqlite:{src.path}"
        case CsvUrlSource():
            return src.url
        case Ga4Source():
            return f"GA4 property {src.property_id}"
    return "source"


def ga4_configured() -> bool:
    cred = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    return bool(cred and Path(cred).is_file())


def info() -> ConnectorsInfo:
    s = get_settings()
    return ConnectorsInfo(
        saved=[SavedConnection(name=n, type=src.type, label=_label(src)) for n, src in saved_connections().items()],
        adhoc_allowed=s.allow_adhoc_connections,
        ga4_configured=ga4_configured(),
        max_rows=s.connector_max_rows,
        sqlite_dir=s.sqlite_dir if Path(s.sqlite_dir).is_dir() else None,
        types=["postgres", "mysql", "sqlite", "csv_url", "ga4"],
    )


def resolve(req: QueryRequest) -> Source:
    if req.connection:
        src = saved_connections().get(req.connection)
        if src is None:
            raise HTTPException(404, f"No saved connection named '{req.connection}'")
        return src
    if req.source is None:
        raise HTTPException(422, "Provide either 'connection' or 'source'")
    if not get_settings().allow_adhoc_connections:
        raise HTTPException(403, "Ad-hoc connections are disabled on this server; use a saved connection")
    return req.source


# --------------------------------------------------------------------- SQL
def _sql_url(src: PostgresSource | MySqlSource | SqliteSource) -> tuple[URL | str, dict]:
    if isinstance(src, SqliteSource):
        base = Path(get_settings().sqlite_dir).resolve()
        path = (base / src.path).resolve()
        if base not in path.parents or not path.is_file():
            raise HTTPException(400, f"SQLite file must exist inside {base}")
        return f"sqlite+aiosqlite:///file:{path}?mode=ro&uri=true", {}
    pwd = src.password.get_secret_value() if src.password else None
    if isinstance(src, PostgresSource):
        url = URL.create("postgresql+asyncpg", src.user, pwd, src.host, src.port, src.database)
        return url, ({"ssl": "require"} if src.ssl else {})
    url = URL.create("mysql+aiomysql", src.user, pwd, src.host, src.port, src.database)
    return url, ({"ssl": ssl.create_default_context()} if src.ssl else {})


async def _run_sql(src: PostgresSource | MySqlSource | SqliteSource, query: str, max_rows: int) -> tuple[list[str], list[list[str]], bool]:
    timeout_ms = get_settings().connector_timeout_s * 1000
    stmt = check_read_only_sql(query)
    url, connect_args = _sql_url(src)
    engine = create_async_engine(url, connect_args=connect_args, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            if isinstance(src, PostgresSource):
                await conn.execute(text("SET TRANSACTION READ ONLY"))
                await conn.execute(text(f"SET LOCAL statement_timeout = {int(timeout_ms)}"))
            elif isinstance(src, MySqlSource):
                await conn.execute(text(f"SET SESSION MAX_EXECUTION_TIME = {int(timeout_ms)}"))
                await conn.execute(text("SET SESSION TRANSACTION READ ONLY"))
            result = await conn.stream(text(stmt))
            headers = list(result.keys())
            rows: list[list[str]] = []
            async for part in result.partitions(5000):
                for r in part:
                    if len(rows) >= max_rows:
                        await result.close()
                        return headers, rows, True
                    rows.append([cell(v) for v in r])
            await conn.rollback()
            return headers, rows, False
    finally:
        await engine.dispose()


# --------------------------------------------------------------------- GA4
def _ga4_client():
    from google.analytics.data_v1beta import BetaAnalyticsDataClient  # lazy: optional dependency

    return BetaAnalyticsDataClient()


def _ga4_request(src: Ga4Source, limit: int, offset: int):
    from google.analytics.data_v1beta.types import (
        DateRange,
        Dimension,
        Filter,
        FilterExpression,
        Metric,
        RunReportRequest,
    )

    flt = None
    if src.event_names:
        flt = FilterExpression(
            filter=Filter(field_name="eventName", in_list_filter=Filter.InListFilter(values=src.event_names))
        )
    return RunReportRequest(
        property=f"properties/{src.property_id}",
        dimensions=[Dimension(name=d) for d in src.dimensions],
        metrics=[Metric(name=m) for m in src.metrics],
        date_ranges=[DateRange(start_date=src.start_date, end_date=src.end_date)],
        dimension_filter=flt,
        limit=limit,
        offset=offset,
    )


def run_ga4(src: Ga4Source, max_rows: int, client=None) -> tuple[list[str], list[list[str]], bool]:
    """Page through runReport (100k rows / page) and flatten to a table."""
    if client is None and not ga4_configured():
        raise HTTPException(
            400,
            "GA4 is not configured: mount a service-account JSON and set GOOGLE_APPLICATION_CREDENTIALS "
            "(see README → Connect Google Analytics 4).",
        )
    client = client or _ga4_client()
    headers = [*src.dimensions, *src.metrics]
    rows: list[list[str]] = []
    offset = 0
    page = min(100_000, max_rows + 1)
    while True:
        resp = client.run_report(_ga4_request(src, page, offset))
        for r in resp.rows:
            rows.append([v.value for v in r.dimension_values] + [v.value for v in r.metric_values])
        offset += len(resp.rows)
        if len(rows) > max_rows:
            return headers, rows[:max_rows], True
        if not resp.rows or offset >= resp.row_count:
            return headers, rows, False


# --------------------------------------------------------------------- CSV
async def _fetch_csv(src: CsvUrlSource, max_rows: int) -> tuple[list[str], list[list[str]], bool]:
    import csv
    import io

    async with httpx.AsyncClient(timeout=get_settings().connector_timeout_s, follow_redirects=True) as c:
        r = await c.get(src.url, headers={"Accept": "text/csv,text/plain,*/*"})
    if r.status_code != 200:
        raise HTTPException(502, f"Source returned HTTP {r.status_code}")
    text_body = r.text.lstrip("﻿")
    if text_body.lstrip().lower().startswith(("<!doctype", "<html")):
        raise HTTPException(422, "The URL returned a web page, not CSV")
    try:
        dialect = csv.Sniffer().sniff(text_body[:20_000], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text_body), dialect)
    headers = next(reader, [])
    rows: list[list[str]] = []
    for row in reader:
        if len(rows) >= max_rows:
            return headers, rows, True
        rows.append(row)
    return headers, rows, False


# ------------------------------------------------------------------ facade
async def fetch(req: QueryRequest) -> TableOut:
    src = resolve(req)
    max_rows = min(req.max_rows, get_settings().connector_max_rows)
    t0 = time.perf_counter()
    try:
        if isinstance(src, SQL_TYPES):
            if not req.query:
                raise HTTPException(422, "A SQL query is required for database sources")
            headers, rows, truncated = await _run_sql(src, req.query, max_rows)
        elif isinstance(src, Ga4Source):
            headers, rows, truncated = await run_in_threadpool(run_ga4, src, max_rows)
        else:
            headers, rows, truncated = await _fetch_csv(src, max_rows)
    except UnsafeQuery as exc:
        raise HTTPException(422, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # surface driver / API errors without leaking secrets
        msg = str(exc).splitlines()[0][:300]
        raise HTTPException(502, f"{type(exc).__name__}: {msg}") from exc
    if not headers:
        raise HTTPException(422, "The source returned no columns")
    return TableOut(
        headers=headers,
        rows=rows,
        row_count=len(rows),
        truncated=truncated,
        elapsed_ms=int((time.perf_counter() - t0) * 1000),
        source_label=_label(src),
    )


async def test(req: QueryRequest) -> dict:
    src = resolve(req)
    if isinstance(src, SQL_TYPES):
        req = req.model_copy(update={"query": "SELECT 1 AS ok", "max_rows": 1})
    elif isinstance(src, Ga4Source):
        req = req.model_copy(update={"max_rows": 1})
    out = await fetch(req)
    return {"ok": True, "source_label": out.source_label, "elapsed_ms": out.elapsed_ms}
