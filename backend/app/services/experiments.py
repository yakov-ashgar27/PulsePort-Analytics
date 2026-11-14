"""Experiment analysis: frequentist + Bayesian + power, and a decision rule."""

from __future__ import annotations

import math

import numpy as np
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..analytics import sql_queries as Q
from ..config import get_settings
from ..seed.generators import EXPERIMENTS, EXPERIMENTS_BY_ID
from ..stats_engine.bayesian import bayesian_ab_test
from ..stats_engine.frequentist import (
    achieved_power,
    mann_whitney_test,
    required_sample_size,
    two_proportion_test,
)


def decide(
    freq: dict, bayes: dict, days_remaining: float | None, power_at_mde: float | None = None
) -> dict:
    """
    Decision rule combining both paradigms (all thresholds from settings):

    GO            p < α, uplift > 0, P(B>A) ≥ 95 %, expected loss < threshold
    NO-GO         p < α and uplift < 0  (variant is significantly worse)
    KEEP RUNNING  not significant and power to detect the pre-registered MDE
                  is below target (underpowered)
    STOP          not significant although the test could reliably detect the
                  MDE ⇒ any real effect is smaller than worth shipping
    """
    s = get_settings()
    sig, uplift = freq["significant"], freq["relative_uplift"]
    p_beat, loss = bayes["prob_b_beats_a"], bayes["expected_loss_b"]

    if sig and uplift > 0 and p_beat >= 0.95 and loss < s.expected_loss_threshold:
        return {
            "verdict": "GO",
            "headline": "Roll out Variant B",
            "rationale": (
                f"Statistically significant lift (p = {freq['p_value_z']:.2g} < α = {s.alpha}), "
                f"{'>99.9%' if p_beat > 0.999 else f'{p_beat:.1%}'} probability that B beats A "
                f"and negligible expected loss ({'<0.001' if loss * 100 < 0.001 else f'{loss * 100:.3f}'} pp)."
            ),
        }
    if sig and uplift < 0:
        return {
            "verdict": "NO-GO",
            "headline": "Do not ship — variant is significantly worse",
            "rationale": f"B underperforms A (p = {freq['p_value_z']:.2g}).",
        }
    if power_at_mde is None:
        power_at_mde = freq["achieved_power"]
    if power_at_mde < s.target_power:
        eta = f" ≈ {days_remaining:.0f} more days at current traffic" if days_remaining else ""
        return {
            "verdict": "KEEP RUNNING",
            "headline": "Inconclusive — do not roll out yet",
            "rationale": (
                f"p = {freq['p_value_z']:.2f} ≥ α and the test has only {power_at_mde:.0%} power "
                f"to detect a {s.mde_relative:+.0%} effect (target {s.target_power:.0%}). "
                f"P(B>A) = {p_beat:.1%} is suggestive but shipping now risks a false positive; "
                f"collect more data{eta}."
            ),
        }
    return {
        "verdict": "STOP",
        "headline": "No meaningful effect detected",
        "rationale": (
            f"The test had {power_at_mde:.0%} power to detect a {s.mde_relative:+.0%} effect and found "
            f"none (p = {freq['p_value_z']:.2f}); keep control and reallocate traffic."
        ),
    }


async def analyze_experiment(session: AsyncSession, experiment_id: str) -> dict:
    spec = EXPERIMENTS_BY_ID.get(experiment_id)
    if spec is None:
        raise HTTPException(404, f"Unknown experiment {experiment_id}")
    s = get_settings()

    arms = {r["variant"]: r for r in
            (await session.execute(Q.EXPERIMENT_ARM_COUNTS, {"experiment_id": experiment_id})).mappings()}
    if set(arms) != {"A", "B"}:
        raise HTTPException(409, f"Experiment {experiment_id} has no data for both arms")
    a, b = arms["A"], arms["B"]

    freq = two_proportion_test(a["conversions"], a["n"], b["conversions"], b["n"], s.alpha).to_dict()
    bayes = bayesian_ab_test(a["conversions"], a["n"], b["conversions"], b["n"]).to_dict()

    ttq = (await session.execute(Q.EXPERIMENT_TIME_TO_QUOTE, {"experiment_id": experiment_id})).all()
    ttq_a = np.array([t for v, t in ttq if v == "A"])
    ttq_b = np.array([t for v, t in ttq if v == "B"])
    mw = mann_whitney_test(ttq_a, ttq_b, s.alpha).to_dict()

    first = min(a["first_assigned"], b["first_assigned"])
    last = max(a["last_assigned"], b["last_assigned"])
    days_running = max((last - first).total_seconds() / 86_400, 1.0)
    daily_traffic = (a["n"] + b["n"]) / days_running

    # How many users per arm would detect the *observed* effect at target power?
    days_remaining = None
    required_n = None
    if freq["rate_a"] != freq["rate_b"] and 0 < freq["rate_b"] < 1:
        required_n = required_sample_size(freq["rate_a"], freq["rate_b"], s.alpha, s.target_power)
        remaining = max(0, 2 * required_n - (a["n"] + b["n"]))
        days_remaining = math.ceil(remaining / daily_traffic) if remaining else 0

    power_at_mde = achieved_power(
        freq["rate_a"], min(0.999, freq["rate_a"] * (1 + s.mde_relative)), a["n"], b["n"], s.alpha
    )

    return {
        "experiment_id": spec.experiment_id,
        "name": spec.name,
        "hypothesis": spec.hypothesis,
        "control_label": spec.control_label,
        "variant_label": spec.variant_label,
        "primary_metric": spec.primary_metric,
        "days_running": round(days_running, 1),
        "daily_traffic": round(daily_traffic, 1),
        "required_n_per_arm_observed_effect": required_n,
        "days_remaining_for_power": days_remaining,
        "mde_relative": s.mde_relative,
        "power_at_mde": power_at_mde,
        "frequentist": freq,
        "bayesian": bayes,
        "time_to_quote": mw,
        "decision": decide(freq, bayes, days_remaining, power_at_mde),
    }


async def list_experiments(session: AsyncSession) -> list[dict]:
    out = []
    for spec in EXPERIMENTS:
        res = await analyze_experiment(session, spec.experiment_id)
        f = res["frequentist"]
        out.append({
            "experiment_id": spec.experiment_id,
            "name": spec.name,
            "primary_metric": spec.primary_metric,
            "relative_uplift": f["relative_uplift"],
            "p_value": f["p_value_z"],
            "prob_b_beats_a": res["bayesian"]["prob_b_beats_a"],
            "verdict": res["decision"]["verdict"],
        })
    return out
