"""
Pure, deterministic synthetic-data generators (no database dependency).

The generated data is *synthetic* and designed to contain specific,
known statistical signals so that the analytics layer can be verified:

1. A regional bottleneck: BR-Santos and CN-Shanghai **mobile** users get a
   slow rate-quote API (log-normal latency, median ≈ 3.2 s) which causes a
   significant drop-off between ROUTE_SEARCH and RATE_QUOTE.
2. EXP-01: +14 % relative lift in booking conversion, p < 0.01.
3. EXP-02: +2.9 % relative lift, p ≈ 0.18 (underpowered, not significant).
4. AI evaluation runs for three assistant models across four maritime
   support categories with different accuracy / cost / latency profiles.

Experiment outcomes are generated with *exact* conversion counts (then
shuffled) so the headline p-values are reproducible regardless of RNG state.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

# --------------------------------------------------------------------------- #
# Reference data
# --------------------------------------------------------------------------- #
FUNNEL_STAGES: tuple[str, ...] = (
    "PORTAL_VISIT",
    "ROUTE_SEARCH",
    "RATE_QUOTE",
    "BOOKING_CONFIRMED",
)


@dataclass(frozen=True, slots=True)
class Region:
    code: str
    name: str
    traffic_share: float
    desktop_latency_median_ms: float
    mobile_latency_median_ms: float


REGIONS: tuple[Region, ...] = (
    Region("IL", "IL - Haifa", 0.14, 850, 1000),
    Region("US", "US - Norfolk", 0.20, 800, 950),
    Region("DE", "DE - Hamburg", 0.18, 780, 920),
    Region("CN", "CN - Shanghai", 0.20, 1120, 3200),  # injected bottleneck
    Region("SG", "SG - Singapore", 0.16, 820, 980),
    Region("BR", "BR - Santos", 0.12, 1150, 3300),  # injected bottleneck
)
REGION_NAMES = tuple(r.name for r in REGIONS)
DEVICE_TYPES: tuple[str, ...] = ("Desktop", "Mobile")
MOBILE_SHARE = 0.42

QUOTE_SLA_MS = 2500  # P95 rate-quote latency SLA


@dataclass(frozen=True, slots=True)
class ExperimentSpec:
    experiment_id: str
    name: str
    hypothesis: str
    control_label: str
    variant_label: str
    primary_metric: str
    n_control: int
    n_variant: int
    conv_control: int
    conv_variant: int
    duration_days: int
    ttq_median_control_s: float
    ttq_median_variant_s: float


EXPERIMENTS: tuple[ExperimentSpec, ...] = (
    ExperimentSpec(
        experiment_id="EXP-01",
        name="AI-Assisted Container Booking Flow",
        hypothesis=(
            "Replacing the classic multi-step booking form with a Smart Auto-Fill "
            "Assistant increases the booking confirmation rate."
        ),
        control_label="Classic Multi-Step Form",
        variant_label="Smart Auto-Fill Assistant",
        primary_metric="Booking confirmation rate",
        n_control=10_000,
        n_variant=10_000,
        conv_control=1_200,  # 12.00 %
        conv_variant=1_368,  # 13.68 %  (+14.0 % relative)
        duration_days=28,
        ttq_median_control_s=94.0,
        ttq_median_variant_s=71.0,
    ),
    ExperimentSpec(
        experiment_id="EXP-02",
        name="Real-Time Vessel Delay Proactive Alert",
        hypothesis=(
            "A Predictive ETA Banner on the tracking page increases 14-day "
            "customer return rate versus standard tracking."
        ),
        control_label="Standard Tracking",
        variant_label="Predictive ETA Banner",
        primary_metric="14-day return-visit rate",
        n_control=10_000,
        n_variant=10_000,
        conv_control=3_000,  # 30.00 %
        conv_variant=3_087,  # 30.87 %  (+2.9 % relative, p ≈ 0.18)
        duration_days=14,
        ttq_median_control_s=88.0,
        ttq_median_variant_s=88.0,
    ),
)
EXPERIMENTS_BY_ID = {e.experiment_id: e for e in EXPERIMENTS}


# --------------------------------------------------------------------------- #
# AI benchmark profiles (synthetic — not real vendor benchmarks)
# --------------------------------------------------------------------------- #
AI_CATEGORIES: tuple[str, ...] = (
    "Customs & Documentation",
    "Container Tracking & Delays",
    "Dangerous Goods Compliance",
    "Demurrage & Detention Fees",
)

# category difficulty: accuracy shift and hallucination multiplier
CATEGORY_DIFFICULTY = {
    "Customs & Documentation": (-2.0, 1.1),
    "Container Tracking & Delays": (+3.0, 0.7),
    "Dangerous Goods Compliance": (-7.0, 1.8),
    "Demurrage & Detention Fees": (-1.0, 1.0),
}


@dataclass(frozen=True, slots=True)
class ModelProfile:
    name: str
    vendor: str
    mean_accuracy: float
    accuracy_sd: float
    hallucination_rate: float
    latency_median_ms: float
    latency_sigma: float
    usd_per_m_input: float
    usd_per_m_output: float


MODEL_PROFILES: tuple[ModelProfile, ...] = (
    ModelProfile("Claude 3.5 Sonnet", "Anthropic", 88.0, 8.0, 0.030, 1850, 0.35, 3.00, 15.00),
    ModelProfile("GPT-4o", "OpenAI", 85.0, 9.5, 0.050, 1550, 0.40, 2.50, 10.00),
    ModelProfile("Gemini 1.5 Pro", "Google", 82.0, 10.5, 0.065, 1450, 0.45, 1.25, 5.00),
)
MODEL_NAMES = tuple(m.name for m in MODEL_PROFILES)


# --------------------------------------------------------------------------- #
# Generators
# --------------------------------------------------------------------------- #
def _uuid(rng: np.random.Generator) -> str:
    return str(uuid.UUID(bytes=rng.bytes(16), version=4))


def _quote_success_prob(latency_ms: np.ndarray) -> np.ndarray:
    """Users abandon slow quotes: logistic decay centred at 3.5 s."""
    return 0.70 / (1.0 + np.exp((latency_ms - 3500.0) / 900.0))


def generate_session_events(
    n_sessions: int = 50_000,
    days: int = 90,
    seed: int = 7,
    end: datetime | None = None,
) -> Iterator[dict]:
    """
    Yield one dict per funnel event. Every session has a PORTAL_VISIT; later
    stages are reached with region/device-dependent probabilities. The
    rate-quote API latency is recorded on the ROUTE_SEARCH event, i.e. the
    latency the user experienced while waiting for the quote.
    """
    rng = np.random.default_rng(seed)
    end = end or datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days)

    shares = np.array([r.traffic_share for r in REGIONS])
    region_idx = rng.choice(len(REGIONS), size=n_sessions, p=shares / shares.sum())
    is_mobile = rng.random(n_sessions) < MOBILE_SHARE

    # Timestamps: uniform over the window, with ~25 % less traffic at weekends
    offsets = rng.uniform(0, days * 86_400, size=n_sessions * 2)
    ts = np.array([start + timedelta(seconds=float(s)) for s in offsets])
    weekday_ok = np.array([t.weekday() < 5 or rng.random() < 0.75 for t in ts])
    ts = ts[weekday_ok][:n_sessions]
    if ts.size < n_sessions:  # extremely unlikely; top up
        ts = np.concatenate([ts, ts[: n_sessions - ts.size]])

    lat_median = np.where(
        is_mobile,
        [REGIONS[i].mobile_latency_median_ms for i in region_idx],
        [REGIONS[i].desktop_latency_median_ms for i in region_idx],
    )
    latency = rng.lognormal(np.log(lat_median), 0.45).round().astype(int)

    p_search = np.where(is_mobile, 0.62, 0.71)
    p_quote = _quote_success_prob(latency)
    p_book = np.where(is_mobile, 0.24, 0.31)

    reach_search = rng.random(n_sessions) < p_search
    reach_quote = reach_search & (rng.random(n_sessions) < p_quote)
    reach_book = reach_quote & (rng.random(n_sessions) < p_book)

    gaps = rng.exponential([25, 40, 180], size=(n_sessions, 3)) + 3

    for i in range(n_sessions):
        sid = _uuid(rng)
        region = REGIONS[region_idx[i]].name
        device = "Mobile" if is_mobile[i] else "Desktop"
        t = ts[i]
        base = {"session_id": sid, "region": region, "device_type": device}
        yield {**base, "stage": "PORTAL_VISIT", "event_ts": t, "quote_latency_ms": None}
        if not reach_search[i]:
            continue
        t = t + timedelta(seconds=float(gaps[i, 0]))
        yield {**base, "stage": "ROUTE_SEARCH", "event_ts": t, "quote_latency_ms": int(latency[i])}
        if not reach_quote[i]:
            continue
        t = t + timedelta(seconds=float(gaps[i, 1]) + latency[i] / 1000)
        yield {**base, "stage": "RATE_QUOTE", "event_ts": t, "quote_latency_ms": None}
        if not reach_book[i]:
            continue
        t = t + timedelta(seconds=float(gaps[i, 2]))
        yield {**base, "stage": "BOOKING_CONFIRMED", "event_ts": t, "quote_latency_ms": None}


def _exact_outcomes(rng: np.random.Generator, n: int, k: int) -> np.ndarray:
    out = np.zeros(n, dtype=bool)
    out[:k] = True
    rng.shuffle(out)
    return out


def generate_experiment_assignments(
    seed: int = 11, end: datetime | None = None
) -> list[dict]:
    """Assignment rows for every seeded experiment with exact conversion counts."""
    rng = np.random.default_rng(seed)
    end = end or datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    rows: list[dict] = []
    for spec in EXPERIMENTS:
        start = end - timedelta(days=spec.duration_days)
        for variant, n, k, ttq in (
            ("A", spec.n_control, spec.conv_control, spec.ttq_median_control_s),
            ("B", spec.n_variant, spec.conv_variant, spec.ttq_median_variant_s),
        ):
            converted = _exact_outcomes(rng, n, k)
            ttq_s = rng.lognormal(np.log(ttq), 0.55, size=n).round(1)
            secs = rng.uniform(0, spec.duration_days * 86_400, size=n)
            for j in range(n):
                rows.append(
                    {
                        "experiment_id": spec.experiment_id,
                        "session_id": _uuid(rng),
                        "variant": variant,
                        "assigned_at": start + timedelta(seconds=float(secs[j])),
                        "converted": bool(converted[j]),
                        "time_to_quote_s": float(ttq_s[j]),
                    }
                )
    return rows


def generate_ai_eval_runs(
    n_prompts: int = 300,
    seed: int = 23,
    batch_id: str = "seed",
    created_at: datetime | None = None,
    prompt_offset: int = 0,
) -> list[dict]:
    """
    ``n_prompts`` support prompts (balanced across categories), each answered
    by every model ⇒ ``n_prompts × len(MODEL_PROFILES)`` rows. A shared
    per-prompt difficulty term induces realistic within-prompt correlation.
    """
    rng = np.random.default_rng(seed)
    created_at = created_at or datetime.now(UTC)
    rows: list[dict] = []
    for p in range(n_prompts):
        category = AI_CATEGORIES[p % len(AI_CATEGORIES)]
        acc_shift, hall_mult = CATEGORY_DIFFICULTY[category]
        prompt_difficulty = rng.normal(0, 4.0)
        in_tokens = int(rng.integers(500, 1600))
        for m in MODEL_PROFILES:
            acc = rng.normal(m.mean_accuracy + acc_shift + prompt_difficulty, m.accuracy_sd)
            halluc = rng.random() < min(0.95, m.hallucination_rate * hall_mult)
            if halluc:
                acc -= rng.uniform(25, 45)  # hallucinated answers score poorly
            out_tokens = int(rng.integers(150, 600))
            cost = in_tokens / 1e6 * m.usd_per_m_input + out_tokens / 1e6 * m.usd_per_m_output
            rows.append(
                {
                    "batch_id": batch_id,
                    "prompt_id": f"MP-{prompt_offset + p + 1:05d}",
                    "category": category,
                    "model": m.name,
                    "accuracy_score": float(np.clip(acc, 0, 100).round(1)),
                    "hallucination": bool(halluc),
                    "latency_ms": int(rng.lognormal(np.log(m.latency_median_ms), m.latency_sigma)),
                    "input_tokens": in_tokens,
                    "output_tokens": out_tokens,
                    "cost_usd": round(cost, 6),
                    "created_at": created_at,
                }
            )
    return rows
