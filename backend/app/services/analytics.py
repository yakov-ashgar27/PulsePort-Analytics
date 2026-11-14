"""Funnel / regional analytics service: SQL results + significance testing."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..analytics import sql_queries as Q
from ..config import get_settings
from ..stats_engine.frequentist import two_proportion_test


def _rows(result) -> list[dict[str, Any]]:
    return [dict(r) for r in result.mappings().all()]


def filter_params(
    region: str | None, device_type: str | None,
    date_from: datetime | None, date_to: datetime | None,
) -> dict:
    return {
        "region": region,
        "device_type": device_type,
        "date_from": date_from,
        "date_to": date_to,
        "sla_ms": get_settings().quote_sla_ms,
    }


async def kpis(session: AsyncSession, params: dict) -> dict:
    return dict((await session.execute(Q.KPI_OVERVIEW, params)).mappings().one())


async def funnel(session: AsyncSession, params: dict) -> list[dict]:
    return _rows(await session.execute(Q.FUNNEL, params))


async def regions(session: AsyncSession, params: dict) -> list[dict]:
    return _rows(await session.execute(Q.REGIONAL_BREAKDOWN, params))


async def trend(session: AsyncSession, params: dict) -> list[dict]:
    return _rows(await session.execute(Q.DAILY_TREND, params))


async def bottlenecks(session: AsyncSession, params: dict) -> list[dict]:
    """
    Enrich each region from the SQL detector with a two-proportion test of
    its search→quote rate against *all other regions combined*.
    """
    rows = _rows(await session.execute(Q.BOTTLENECK_DETECTOR, params))
    tot_s = sum(r["searches"] for r in rows)
    tot_q = sum(r["quotes"] for r in rows)
    for r in rows:
        rest_s, rest_q = tot_s - r["searches"], tot_q - r["quotes"]
        if r["searches"] and rest_s:
            t = two_proportion_test(rest_q, rest_s, r["quotes"], r["searches"])
            r["p_value_vs_rest"] = t.p_value_z
            r["rate_diff_vs_rest_pp"] = t.absolute_diff * 100
            r["significant"] = t.significant
        else:
            r["p_value_vs_rest"], r["rate_diff_vs_rest_pp"], r["significant"] = None, None, False
    return rows
