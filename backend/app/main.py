"""PulsePort Analytics — FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import schemas as S
from .ai_benchmark import evaluator
from .config import get_settings
from .database import Base, engine, get_session
from .seed.generators import AI_CATEGORIES, DEVICE_TYPES, EXPERIMENTS, REGION_NAMES
from .seed.maritime_seeder import seed_if_empty
from .services import analytics
from .services.executive_brief import build_brief
from .services.experiments import analyze_experiment, list_experiments
from .stats_engine.frequentist import power_analysis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    if settings.seed_on_startup:
        await seed_if_empty(engine)
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Digital-experience analytics, statistical A/B testing and AI evaluation "
                "for a maritime shipping customer portal.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"]
)

DB = Annotated[AsyncSession, Depends(get_session)]
Region = Literal[REGION_NAMES]  # type: ignore[valid-type]
Device = Literal[DEVICE_TYPES]  # type: ignore[valid-type]
Category = Literal[AI_CATEGORIES]  # type: ignore[valid-type]


def filters(
    region: Annotated[Region | None, Query()] = None,
    device_type: Annotated[Device | None, Query()] = None,
    date_from: Annotated[datetime | None, Query(description="ISO-8601, inclusive")] = None,
    date_to: Annotated[datetime | None, Query(description="ISO-8601, exclusive")] = None,
) -> dict:
    return analytics.filter_params(region, device_type, date_from, date_to)


Filters = Annotated[dict, Depends(filters)]


# ------------------------------------------------------------------ system
@app.get("/api/health", tags=["system"])
async def health(db: DB) -> dict:
    await db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/meta", response_model=S.Meta, tags=["system"])
async def meta() -> dict:
    return {
        "regions": list(REGION_NAMES),
        "device_types": list(DEVICE_TYPES),
        "experiments": [e.experiment_id for e in EXPERIMENTS],
        "ai_categories": list(AI_CATEGORIES),
        "quote_sla_ms": settings.quote_sla_ms,
    }


# --------------------------------------------------------------- analytics
@app.get("/api/kpis", response_model=S.Kpis, tags=["analytics"])
async def get_kpis(db: DB, f: Filters):
    return await analytics.kpis(db, f)


@app.get("/api/funnel", response_model=list[S.FunnelStep], tags=["analytics"])
async def get_funnel(db: DB, f: Filters):
    return await analytics.funnel(db, f)


@app.get("/api/analytics/regions", response_model=list[S.RegionRow], tags=["analytics"])
async def get_regions(db: DB, f: Filters):
    return await analytics.regions(db, f)


@app.get("/api/analytics/bottlenecks", response_model=list[S.BottleneckRow], tags=["analytics"])
async def get_bottlenecks(db: DB, f: Filters):
    return await analytics.bottlenecks(db, f)


@app.get("/api/analytics/trend", response_model=list[S.TrendPoint], tags=["analytics"])
async def get_trend(db: DB, f: Filters):
    return await analytics.trend(db, f)


# ------------------------------------------------------------- experiments
@app.get("/api/experiments", response_model=list[S.ExperimentSummary], tags=["experiments"])
async def get_experiments(db: DB):
    return await list_experiments(db)


@app.get("/api/experiments/{experiment_id}", response_model=S.ExperimentAnalysis, tags=["experiments"])
async def get_experiment(experiment_id: str, db: DB):
    return await analyze_experiment(db, experiment_id)


@app.post("/api/stats/power-analysis", response_model=S.PowerAnalysisOut, tags=["experiments"])
async def post_power_analysis(req: S.PowerAnalysisRequest):
    return power_analysis(
        req.baseline_rate, req.mde_relative, req.alpha, req.power, req.daily_traffic
    ).to_dict()


# ------------------------------------------------------------ AI benchmark
@app.get("/api/ai-benchmark", response_model=S.BenchmarkOut, tags=["ai-benchmark"])
async def get_ai_benchmark(db: DB, category: Annotated[Category | None, Query()] = None):
    return await evaluator.get_benchmark(db, category)


@app.post("/api/ai-benchmark/run", response_model=S.BenchmarkOut, tags=["ai-benchmark"])
async def post_ai_benchmark_run(db: DB, req: S.BenchmarkRunRequest | None = None):
    return await evaluator.run_batch(db, (req or S.BenchmarkRunRequest()).n_prompts)


# --------------------------------------------------------------- reporting
@app.get("/api/executive-brief", response_model=S.ExecutiveBrief, tags=["reporting"])
async def get_executive_brief(db: DB):
    return await build_brief(db)
