"""
Idempotent database seeder.

Uses PostgreSQL ``COPY`` through asyncpg's ``copy_records_to_table`` (≈10×
faster than batched INSERTs for ~170k rows) and a transaction-scoped
advisory lock so that several API replicas starting together seed only once.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine

from ..config import get_settings
from ..models import SessionEvent
from .generators import (
    generate_ai_eval_runs,
    generate_experiment_assignments,
    generate_session_events,
)

log = logging.getLogger("pulseport.seed")

_SEED_LOCK_KEY = 0x50554C5345  # "PULSE"

EVENT_COLS = ("session_id", "event_ts", "stage", "region", "device_type", "quote_latency_ms")
ASSIGN_COLS = ("experiment_id", "session_id", "variant", "assigned_at", "converted", "time_to_quote_s")
AI_COLS = (
    "batch_id", "prompt_id", "category", "model", "accuracy_score", "hallucination",
    "latency_ms", "input_tokens", "output_tokens", "cost_usd", "created_at",
)


def ai_records(rows: list[dict]) -> list[tuple]:
    return [
        tuple(Decimal(str(r[c])) if c == "cost_usd" else r[c] for c in AI_COLS) for r in rows
    ]


async def copy_rows(conn, table: str, columns: tuple[str, ...], records: list[tuple]) -> None:
    """Bulk-load via the asyncpg driver connection underneath SQLAlchemy."""
    raw = await conn.get_raw_connection()
    await raw.driver_connection.copy_records_to_table(table, records=records, columns=columns)


async def seed_if_empty(engine: AsyncEngine) -> bool:
    settings = get_settings()
    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _SEED_LOCK_KEY})
        existing = (await conn.execute(select(func.count()).select_from(SessionEvent))).scalar_one()
        if existing:
            log.info("Database already seeded (%s events) — skipping", existing)
            return False

        t0 = time.perf_counter()
        events = [tuple(e[c] for c in EVENT_COLS)
                  for e in generate_session_events(settings.seed_sessions)]
        await copy_rows(conn, "session_events", EVENT_COLS, events)

        assignments = [tuple(a[c] for c in ASSIGN_COLS) for a in generate_experiment_assignments()]
        await copy_rows(conn, "experiment_assignments", ASSIGN_COLS, assignments)

        ai = ai_records(generate_ai_eval_runs(settings.seed_ai_prompts))
        await copy_rows(conn, "ai_eval_runs", AI_COLS, ai)

        await conn.execute(text("ANALYZE session_events"))
        log.info(
            "Seeded %s events, %s assignments, %s AI runs in %.1fs",
            len(events), len(assignments), len(ai), time.perf_counter() - t0,
        )
        return True
