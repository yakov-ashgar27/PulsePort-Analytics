"""
End-to-end smoke test against a real PostgreSQL: runs the app lifespan
(create tables + seed), then calls every endpoint in-process and asserts the
seeded statistical signals surface through the full SQL → stats → API path.

    PULSEPORT_DATABASE_URL=... python -m scripts.smoke_test
"""

from __future__ import annotations

import asyncio
import sys

import httpx

from app.main import app


async def main() -> int:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:

            async def get(path: str, **kw):
                r = await c.get(path, **kw)
                assert r.status_code == 200, (path, r.status_code, r.text[:500])
                return r.json()

            assert (await get("/api/health"))["status"] == "ok"
            meta = await get("/api/meta")

            kpis = await get("/api/kpis")
            assert kpis["total_sessions"] == 50_000, kpis
            assert kpis["active_experiments"] == 2

            funnel = await get("/api/funnel")
            assert [s["stage"] for s in funnel] == [
                "PORTAL_VISIT", "ROUTE_SEARCH", "RATE_QUOTE", "BOOKING_CONFIRMED"
            ]
            filtered = await get("/api/funnel", params={"region": "BR - Santos", "device_type": "Mobile"})
            assert filtered[0]["sessions"] < funnel[0]["sessions"]

            regions = await get("/api/analytics/regions")
            assert len(regions) == len(meta["regions"]) * len(meta["device_types"])

            bn = await get("/api/analytics/bottlenecks")
            flagged = {r["region"] for r in bn if r["is_bottleneck"]}
            assert flagged == {"BR - Santos", "CN - Shanghai"}, flagged

            assert len(await get("/api/analytics/trend")) >= 85

            e1 = await get("/api/experiments/EXP-01")
            assert e1["frequentist"]["p_value_z"] < 0.01 and e1["decision"]["verdict"] == "GO"
            assert len(e1["bayesian"]["pdf_curve"]) == 100
            e2 = await get("/api/experiments/EXP-02")
            assert 0.15 < e2["frequentist"]["p_value_z"] < 0.21
            assert e2["decision"]["verdict"] == "KEEP RUNNING"
            assert (await c.get("/api/experiments/NOPE")).status_code == 404

            pa = await c.post("/api/stats/power-analysis",
                              json={"baseline_rate": 0.10, "mde_relative": 0.20, "daily_traffic": 1000})
            assert pa.status_code == 200 and pa.json()["sample_size_per_variant"] == 3841, pa.text
            assert (await c.post("/api/stats/power-analysis", json={"baseline_rate": 1.5})).status_code == 422

            bench = await get("/api/ai-benchmark")
            assert len(bench["models"]) == 3 and bench["totals"]["runs"] == 900
            await get("/api/ai-benchmark", params={"category": "Dangerous Goods Compliance"})
            run = await c.post("/api/ai-benchmark/run", json={"n_prompts": 20})
            assert run.status_code == 200 and run.json()["totals"]["runs"] == 960, run.text

            brief = await get("/api/executive-brief")
            verdicts = [s["verdict"] for s in brief["sections"]]
            assert verdicts == ["GO", "KEEP RUNNING", "GO", "ACTION REQUIRED"], verdicts
            assert "Statistical evidence" in brief["markdown"]

    print("✓ smoke test passed: all endpoints healthy and seeded signals verified")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
