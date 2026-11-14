"""
Pure statistical aggregation for AI-assistant benchmark runs.

Inputs are plain sequences so the maths can be unit-tested without a DB.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from scipy import stats

__all__ = [
    "mean_ci_t",
    "wilson_ci",
    "model_summary",
    "compare_models",
]


def mean_ci_t(values: Sequence[float], conf: float = 0.95) -> tuple[float, float, float]:
    """Mean and Student-t confidence interval."""
    x = np.asarray(values, dtype=float)
    if x.size == 0:
        return (math.nan, math.nan, math.nan)
    mean = float(x.mean())
    if x.size == 1:
        return (mean, mean, mean)
    sem = float(x.std(ddof=1) / math.sqrt(x.size))
    h = float(stats.t.ppf((1 + conf) / 2, df=x.size - 1)) * sem
    return (mean, mean - h, mean + h)


def mean_ci_from_moments(
    mean: float, sd: float, n: int, conf: float = 0.95
) -> tuple[float, float]:
    """t-interval from pre-aggregated moments (e.g. SQL AVG / STDDEV_SAMP)."""
    if n < 2 or sd is None:
        return (mean, mean)
    h = float(stats.t.ppf((1 + conf) / 2, df=n - 1)) * sd / math.sqrt(n)
    return (mean - h, mean + h)


def wilson_ci(k: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    """Wilson score interval — well behaved for small / extreme proportions."""
    if n == 0:
        return (0.0, 1.0)
    z = float(stats.norm.ppf((1 + conf) / 2))
    p = k / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    lo = 0.0 if k == 0 else max(0.0, centre - half)
    hi = 1.0 if k == n else min(1.0, centre + half)
    return (lo, hi)


def model_summary(
    accuracy: Sequence[float],
    hallucination: Sequence[bool],
    latency_ms: Sequence[float],
    cost_usd: Sequence[float],
) -> dict:
    acc = np.asarray(accuracy, dtype=float)
    hal = np.asarray(hallucination, dtype=bool)
    lat = np.asarray(latency_ms, dtype=float)
    cost = np.asarray(cost_usd, dtype=float)
    mean, lo, hi = mean_ci_t(acc)
    k = int(hal.sum())
    h_lo, h_hi = wilson_ci(k, hal.size)
    cost_1k = float(cost.mean() * 1000) if cost.size else math.nan
    return {
        "n": int(acc.size),
        "mean_accuracy": mean,
        "accuracy_ci_low": lo,
        "accuracy_ci_high": hi,
        "hallucination_rate": k / hal.size if hal.size else math.nan,
        "hallucination_ci_low": h_lo,
        "hallucination_ci_high": h_hi,
        "p50_latency_ms": float(np.percentile(lat, 50)) if lat.size else math.nan,
        "p95_latency_ms": float(np.percentile(lat, 95)) if lat.size else math.nan,
        "cost_per_1k_usd": cost_1k,
        "accuracy_per_dollar": mean / cost_1k if cost_1k else math.nan,
    }


def compare_models(accuracy_by_model: dict[str, Sequence[float]],
                   halluc_by_model: dict[str, tuple[int, int]]) -> dict:
    """
    Omnibus + pairwise tests:

    * Kruskal-Wallis H across all models' accuracy distributions
    * Welch t-test between the top-2 models by mean accuracy
    * χ² test of independence on hallucination counts (model × flag)
    """
    names = [m for m, v in accuracy_by_model.items() if len(v) >= 2]
    out: dict = {"kruskal_h": None, "kruskal_p": None, "top_two": None,
                 "welch_t": None, "welch_p": None, "halluc_chi2": None, "halluc_p": None}
    if len(names) >= 2:
        h, p = stats.kruskal(*[accuracy_by_model[m] for m in names])
        out["kruskal_h"], out["kruskal_p"] = float(h), float(p)
        ranked = sorted(names, key=lambda m: float(np.mean(accuracy_by_model[m])), reverse=True)
        a, b = ranked[0], ranked[1]
        t, pt = stats.ttest_ind(accuracy_by_model[a], accuracy_by_model[b], equal_var=False)
        out["top_two"] = [a, b]
        out["welch_t"], out["welch_p"] = float(t), float(pt)
    table = np.array([[k, n - k] for k, n in halluc_by_model.values() if n > 0])
    if table.shape[0] >= 2 and (table.sum(axis=0) > 0).all():
        chi2, p, _, _ = stats.chi2_contingency(table)
        out["halluc_chi2"], out["halluc_p"] = float(chi2), float(p)
    return out
