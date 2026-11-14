"""
AI assistant benchmarking & governance.

Aggregates are computed in PostgreSQL (AVG, STDDEV_SAMP, PERCENTILE_CONT);
inferential statistics (t-intervals, Wilson intervals, Kruskal-Wallis,
Welch t, χ²) are computed in Python from those aggregates / raw scores.

NOTE: evaluation runs are *simulated* (see seed/generators.py). In a real
deployment ``run_batch`` would call each provider's API and grade the answer
against a ground-truth rubric; the storage and statistics layers are
unchanged.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..analytics import sql_queries as Q
from ..models import AiEvalRun
from ..seed.generators import AI_CATEGORIES, MODEL_PROFILES, generate_ai_eval_runs
from ..seed.maritime_seeder import AI_COLS, ai_records, copy_rows
from .metrics import compare_models, mean_ci_from_moments, wilson_ci

HALLUCINATION_GUARDRAIL = 0.05  # max acceptable hallucination rate for production


async def get_benchmark(session: AsyncSession, category: str | None = None) -> dict:
    params = {"category": category}
    agg = (await session.execute(Q.AI_MODEL_AGGREGATES, params)).mappings().all()
    raw = (await session.execute(Q.AI_RAW_SCORES, params)).mappings().all()
    matrix = (await session.execute(Q.AI_CATEGORY_MATRIX)).mappings().all()
    totals = (await session.execute(Q.AI_RUN_TOTALS)).mappings().one()

    vendors = {m.name: m.vendor for m in MODEL_PROFILES}
    models = []
    for r in agg:
        n, k = int(r["n"]), int(r["hallucinations"])
        mean, sd = float(r["mean_accuracy"]), float(r["sd_accuracy"] or 0.0)
        lo, hi = mean_ci_from_moments(mean, sd, n)
        h_lo, h_hi = wilson_ci(k, n)
        cost = float(r["cost_per_1k_usd"])
        models.append(
            {
                "model": r["model"],
                "vendor": vendors.get(r["model"], "—"),
                "n": n,
                "mean_accuracy": mean,
                "accuracy_ci_low": lo,
                "accuracy_ci_high": hi,
                "hallucination_rate": k / n,
                "hallucination_ci_low": h_lo,
                "hallucination_ci_high": h_hi,
                "p50_latency_ms": float(r["p50_latency_ms"]),
                "p95_latency_ms": float(r["p95_latency_ms"]),
                "cost_per_1k_usd": cost,
                "accuracy_per_dollar": mean / cost if cost else 0.0,
                "passes_guardrail": k / n <= HALLUCINATION_GUARDRAIL,
            }
        )

    scores: dict[str, list[float]] = defaultdict(list)
    for r in raw:
        scores[r["model"]].append(float(r["accuracy_score"]))
    tests = compare_models(
        scores, {m["model"]: (round(m["hallucination_rate"] * m["n"]), m["n"]) for m in models}
    )

    return {
        "category": category,
        "categories": list(AI_CATEGORIES),
        "guardrail_hallucination_rate": HALLUCINATION_GUARDRAIL,
        "models": models,
        "tests": tests,
        "category_matrix": [dict(r) for r in matrix],
        "totals": dict(totals),
        "simulated": True,
    }


async def run_batch(session: AsyncSession, n_prompts: int) -> dict:
    """Simulate a new evaluation batch, persist it with COPY, return fresh metrics."""
    existing = (await session.execute(select(func.count(func.distinct(AiEvalRun.prompt_id))))).scalar_one()
    batch_id = f"batch-{datetime.now(UTC):%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"
    rows = generate_ai_eval_runs(
        n_prompts=n_prompts,
        seed=uuid.uuid4().int % (2**32),
        batch_id=batch_id,
        prompt_offset=int(existing),
    )
    conn = await session.connection()
    await copy_rows(conn, "ai_eval_runs", AI_COLS, ai_records(rows))
    await session.commit()
    result = await get_benchmark(session)
    result["last_batch"] = {"batch_id": batch_id, "prompts": n_prompts, "runs": len(rows)}
    return result
