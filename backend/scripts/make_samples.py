"""
Generate the downloadable sample CSVs used by the Data Studio
("Try a sample") and by frontend/src/lib/data/analyze.test.ts.

    python -m scripts.make_samples ../frontend/public/samples
"""

from __future__ import annotations

import csv
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

from app.seed.generators import (
    generate_ai_eval_runs,
    generate_experiment_assignments,
    generate_session_events,
)

END = datetime(2026, 11, 1, tzinfo=UTC)


def write(path: Path, header: list[str], rows) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"  {path.name}: {path.stat().st_size / 1024:.0f} KB")


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(99)

    # 1. Maritime portal event log (funnel + regional latency bottleneck)
    ev = generate_session_events(n_sessions=6000, days=60, seed=3, end=END)
    write(out / "maritime_portal_events.csv",
          ["session_id", "timestamp", "event", "region", "device", "quote_latency_ms"],
          ([e["session_id"][:13], e["event_ts"].strftime("%Y-%m-%d %H:%M:%S"), e["stage"].lower(),
            e["region"], e["device_type"], e["quote_latency_ms"] or ""] for e in ev))

    # 2. Row-level A/B test (EXP-01) with a segment column
    rows = [a for a in generate_experiment_assignments(end=END) if a["experiment_id"] == "EXP-01"]
    devices = rng.choice(["Desktop", "Mobile"], size=len(rows), p=[0.58, 0.42])
    write(out / "ab_test_booking_flow.csv",
          ["user_id", "variant", "assigned_at", "converted", "time_to_quote_s", "device"],
          ([r["session_id"][:13], "control" if r["variant"] == "A" else "smart_autofill",
            r["assigned_at"].strftime("%Y-%m-%d %H:%M:%S"), int(r["converted"]), r["time_to_quote_s"], d]
           for r, d in zip(rows, devices, strict=True)))

    # 3. Aggregated A/B summary (EXP-02)
    write(out / "ab_test_summary_eta_banner.csv", ["variant", "users", "conversions"],
          [["Standard tracking", 10000, 3000], ["Predictive ETA banner", 10000, 3087]])

    # 4. AI support-assistant evaluation log
    ai = generate_ai_eval_runs(300, created_at=END)
    write(out / "ai_assistant_eval.csv",
          ["prompt_id", "model", "category", "accuracy_score", "hallucination", "latency_ms", "cost_usd"],
          ([r["prompt_id"], r["model"], r["category"], r["accuracy_score"], int(r["hallucination"]),
            r["latency_ms"], r["cost_usd"]] for r in ai))

    # 5. Non-maritime example: e-commerce checkout funnel (proves the Studio is domain-agnostic)
    steps = ["product_view", "add_to_cart", "checkout_start", "payment", "order_confirmed"]
    countries = ["US", "UK", "DE", "FR", "IL", "BR"]
    shares = np.array([0.32, 0.18, 0.16, 0.12, 0.10, 0.12])
    out_rows = []
    start = END - timedelta(days=45)
    for i in range(7000):
        country = rng.choice(countries, p=shares)
        device = "mobile" if rng.random() < 0.55 else "desktop"
        load = float(rng.lognormal(np.log(2600 if (device == "mobile" and country == "BR") else 900), 0.5))
        p = [0.34, 0.62, 0.70 / (1 + np.exp((load - 3000) / 700)), 0.83]
        if device == "mobile":
            p[0] *= 0.9
        t = start + timedelta(seconds=float(rng.uniform(0, 45 * 86400)))
        sid = f"s{i:05d}"
        out_rows.append([sid, t.isoformat(timespec="seconds"), steps[0], country, device, ""])
        for k in range(1, len(steps)):
            if rng.random() >= p[k - 1]:
                break
            t += timedelta(seconds=float(rng.exponential(60)) + 5)
            out_rows.append([sid, t.isoformat(timespec="seconds"), steps[k], country, device,
                             round(load) if steps[k] == "checkout_start" else ""])
    write(out / "ecommerce_checkout_events.csv",
          ["session_id", "event_time", "event_name", "country", "device", "checkout_load_ms"], out_rows)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "samples"))
