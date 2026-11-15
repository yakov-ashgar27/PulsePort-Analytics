"""
Export a static snapshot of every read-only API response for the zero-cost
GitHub Pages demo.

The numbers are produced by the *real* pipeline (seeded PostgreSQL → analytical
SQL → SciPy engine → Pydantic schemas) inside CI, then written as JSON files the
frontend reads in demo mode. Nothing is hand-written or approximated.

    PULSEPORT_DATABASE_URL=... python -m scripts.export_static ../frontend/public/data
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.main import app
from app.seed.generators import AI_CATEGORIES, DEVICE_TYPES, EXPERIMENTS, REGION_NAMES

# Power-analysis cases the frontend's in-browser calculator is checked against.
POWER_FIXTURES = [
    {"baseline_rate": b, "mde_relative": m, "alpha": a, "power": p, "daily_traffic": 1500}
    for b in (0.03, 0.12, 0.30)
    for m in (0.02, 0.05, 0.10, 0.20, -0.10)
    for a, p in ((0.05, 0.80), (0.01, 0.90))
]


def slug(value: str | None) -> str:
    return "all" if value is None else re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def filter_key(region: str | None, device: str | None) -> str:
    return f"{slug(region)}__{slug(device)}"


async def main(out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    files = 0

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://x", timeout=120) as c:

            async def dump(path: str, name: str, params: dict | None = None) -> None:
                nonlocal files
                r = await c.get(path, params={k: v for k, v in (params or {}).items() if v})
                r.raise_for_status()
                target = out / f"{name}.json"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(r.json(), separators=(",", ":")))
                files += 1

            await dump("/api/meta", "meta")
            for region in (None, *REGION_NAMES):
                for device in (None, *DEVICE_TYPES):
                    p = {"region": region, "device_type": device}
                    key = filter_key(region, device)
                    for ep, name in (
                        ("/api/kpis", "kpis"),
                        ("/api/funnel", "funnel"),
                        ("/api/analytics/regions", "regions"),
                        ("/api/analytics/bottlenecks", "bottlenecks"),
                        ("/api/analytics/trend", "trend"),
                    ):
                        await dump(ep, f"{name}/{key}", p)

            await dump("/api/experiments", "experiments")
            for e in EXPERIMENTS:
                await dump(f"/api/experiments/{e.experiment_id}", f"experiment/{e.experiment_id}")

            for cat in (None, *AI_CATEGORIES):
                await dump("/api/ai-benchmark", f"ai-benchmark/{slug(cat)}", {"category": cat})

            await dump("/api/executive-brief", "executive-brief")

            fixtures = []
            for case in POWER_FIXTURES:
                r = await c.post("/api/stats/power-analysis", json=case)
                r.raise_for_status()
                fixtures.append(r.json())
            (out / "power-fixtures.json").write_text(json.dumps(fixtures, indent=1))
            files += 1

    (out / "snapshot.json").write_text(
        json.dumps({"generated_at": datetime.now(UTC).isoformat(timespec="seconds"), "files": files})
    )
    print(f"✓ exported {files} JSON snapshots to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(Path(sys.argv[1] if len(sys.argv) > 1 else "static-data"))))
