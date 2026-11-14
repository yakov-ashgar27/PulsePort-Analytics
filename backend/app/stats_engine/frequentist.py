"""
Frequentist inference for A/B experiments.

All functions are pure (no I/O) and operate on primitive counts / arrays so
they can be unit-tested against closed-form results.

Conventions
-----------
* "A" is always the control, "B" the variant.
* ``alpha`` is the two-sided significance level.
* Relative uplift is defined as ``(p_B - p_A) / p_A``.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats

__all__ = [
    "ProportionTestResult",
    "ContinuousTestResult",
    "PowerAnalysisResult",
    "two_proportion_test",
    "mann_whitney_test",
    "cohens_h",
    "cohens_d",
    "relative_uplift_ci",
    "required_sample_size",
    "achieved_power",
    "power_analysis",
]


# --------------------------------------------------------------------------- #
# Result containers
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class ProportionTestResult:
    n_a: int
    n_b: int
    conv_a: int
    conv_b: int
    rate_a: float
    rate_b: float
    absolute_diff: float
    relative_uplift: float
    z_stat: float
    p_value_z: float
    chi2_stat: float
    p_value_chi2: float
    abs_diff_ci_low: float
    abs_diff_ci_high: float
    uplift_ci_low: float
    uplift_ci_high: float
    cohens_h: float
    achieved_power: float
    significant: bool
    alpha: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ContinuousTestResult:
    n_a: int
    n_b: int
    median_a: float
    median_b: float
    mean_a: float
    mean_b: float
    u_stat: float
    p_value: float
    rank_biserial: float
    cohens_d: float
    significant: bool
    alpha: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class PowerAnalysisResult:
    baseline_rate: float
    target_rate: float
    mde_relative: float
    alpha: float
    power: float
    sample_size_per_variant: int
    total_sample_size: int
    daily_traffic: float
    estimated_days: float
    cohens_h: float

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------- #
# Effect sizes
# --------------------------------------------------------------------------- #
def cohens_h(p1: float, p2: float) -> float:
    """Cohen's h for two proportions: ``2·asin(√p2) − 2·asin(√p1)``."""
    _check_rate(p1, "p1")
    _check_rate(p2, "p2")
    return 2.0 * math.asin(math.sqrt(p2)) - 2.0 * math.asin(math.sqrt(p1))


def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    """Cohen's d using the pooled (n-1) standard deviation. Positive ⇒ B > A."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or b.size < 2:
        raise ValueError("Each group needs at least two observations")
    pooled_var = ((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (
        a.size + b.size - 2
    )
    if pooled_var == 0:
        return 0.0
    return float((b.mean() - a.mean()) / math.sqrt(pooled_var))


# --------------------------------------------------------------------------- #
# Proportions
# --------------------------------------------------------------------------- #
def relative_uplift_ci(
    conv_a: int, n_a: int, conv_b: int, n_b: int, alpha: float = 0.05
) -> tuple[float, float]:
    """
    CI for the relative uplift ``p_B / p_A − 1`` using the Katz log-ratio
    (delta-method) interval, which is asymmetric and respects that a risk
    ratio is strictly positive:

        log(RR) ± z · sqrt( (1−p_A)/(n_A·p_A) + (1−p_B)/(n_B·p_B) )
    """
    if conv_a == 0 or conv_b == 0:
        return (float("-inf"), float("inf"))
    p_a, p_b = conv_a / n_a, conv_b / n_b
    log_rr = math.log(p_b / p_a)
    se = math.sqrt((1 - p_a) / (n_a * p_a) + (1 - p_b) / (n_b * p_b))
    z = stats.norm.ppf(1 - alpha / 2)
    return (math.exp(log_rr - z * se) - 1.0, math.exp(log_rr + z * se) - 1.0)


def two_proportion_test(
    conv_a: int, n_a: int, conv_b: int, n_b: int, alpha: float = 0.05
) -> ProportionTestResult:
    """
    Pooled two-proportion Z-test + Pearson χ² test (no Yates correction, so
    χ² = z² exactly for a 2×2 table), Wald CI on the absolute difference,
    Katz CI on the relative uplift, Cohen's h and achieved power.
    """
    _check_counts(conv_a, n_a)
    _check_counts(conv_b, n_b)
    p_a, p_b = conv_a / n_a, conv_b / n_b
    diff = p_b - p_a

    pooled = (conv_a + conv_b) / (n_a + n_b)
    se_pooled = math.sqrt(pooled * (1 - pooled) * (1 / n_a + 1 / n_b))
    if se_pooled == 0:
        z_stat, p_z = 0.0, 1.0
    else:
        z_stat = diff / se_pooled
        p_z = float(2 * stats.norm.sf(abs(z_stat)))

    table = np.array([[conv_a, n_a - conv_a], [conv_b, n_b - conv_b]])
    if (table.sum(axis=0) == 0).any():
        chi2_stat, p_chi2 = 0.0, 1.0
    else:
        chi2_stat, p_chi2, _, _ = stats.chi2_contingency(table, correction=False)

    z_crit = stats.norm.ppf(1 - alpha / 2)
    se_unpooled = math.sqrt(p_a * (1 - p_a) / n_a + p_b * (1 - p_b) / n_b)
    ci = (diff - z_crit * se_unpooled, diff + z_crit * se_unpooled)

    uplift = diff / p_a if p_a > 0 else float("inf")
    up_lo, up_hi = relative_uplift_ci(conv_a, n_a, conv_b, n_b, alpha)
    h = cohens_h(p_a, p_b)

    return ProportionTestResult(
        n_a=n_a,
        n_b=n_b,
        conv_a=conv_a,
        conv_b=conv_b,
        rate_a=p_a,
        rate_b=p_b,
        absolute_diff=diff,
        relative_uplift=uplift,
        z_stat=float(z_stat),
        p_value_z=p_z,
        chi2_stat=float(chi2_stat),
        p_value_chi2=float(p_chi2),
        abs_diff_ci_low=ci[0],
        abs_diff_ci_high=ci[1],
        uplift_ci_low=up_lo,
        uplift_ci_high=up_hi,
        cohens_h=h,
        achieved_power=achieved_power(p_a, p_b, n_a, n_b, alpha),
        significant=p_z < alpha,
        alpha=alpha,
    )


# --------------------------------------------------------------------------- #
# Continuous / skewed metrics
# --------------------------------------------------------------------------- #
def mann_whitney_test(
    a: np.ndarray, b: np.ndarray, alpha: float = 0.05
) -> ContinuousTestResult:
    """
    Two-sided Mann-Whitney U for skewed metrics (e.g. time-to-quote).
    Reports the rank-biserial correlation r = 2·U_A/(n_A·n_B) − 1 — positive
    means B tends to be *smaller* than A (the desirable direction for
    latency-type metrics).
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or b.size < 2:
        raise ValueError("Each group needs at least two observations")
    res = stats.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic")
    u = float(res.statistic)
    rbc = 2.0 * u / (a.size * b.size) - 1.0
    return ContinuousTestResult(
        n_a=int(a.size),
        n_b=int(b.size),
        median_a=float(np.median(a)),
        median_b=float(np.median(b)),
        mean_a=float(a.mean()),
        mean_b=float(b.mean()),
        u_stat=u,
        p_value=float(res.pvalue),
        rank_biserial=rbc,
        cohens_d=cohens_d(a, b),
        significant=bool(res.pvalue < alpha),
        alpha=alpha,
    )


# --------------------------------------------------------------------------- #
# Power & sample size
# --------------------------------------------------------------------------- #
def required_sample_size(
    baseline: float, target: float, alpha: float = 0.05, power: float = 0.80
) -> int:
    """
    Per-variant n for a two-sided two-proportion Z-test (Fleiss, 1981):

        n = [ z_{1-α/2}·√(2·p̄·q̄) + z_{1-β}·√(p₁q₁ + p₂q₂) ]² / (p₂ − p₁)²
    """
    _check_rate(baseline, "baseline", open_interval=True)
    _check_rate(target, "target", open_interval=True)
    if baseline == target:
        raise ValueError("baseline and target must differ")
    if not (0 < alpha < 1 and 0 < power < 1):
        raise ValueError("alpha and power must be in (0, 1)")
    z_a = stats.norm.ppf(1 - alpha / 2)
    z_b = stats.norm.ppf(power)
    p_bar = (baseline + target) / 2
    num = (
        z_a * math.sqrt(2 * p_bar * (1 - p_bar))
        + z_b * math.sqrt(baseline * (1 - baseline) + target * (1 - target))
    ) ** 2
    return int(math.ceil(num / (target - baseline) ** 2))


def achieved_power(
    p_a: float, p_b: float, n_a: int, n_b: int, alpha: float = 0.05
) -> float:
    """
    Power of a two-sided two-proportion Z-test to detect the true difference
    ``p_b − p_a`` at the given sample sizes (normal approximation, both tails).
    """
    if p_a == p_b:
        return alpha  # under H0 the rejection rate equals alpha
    z_a = stats.norm.ppf(1 - alpha / 2)
    p_bar = (p_a * n_a + p_b * n_b) / (n_a + n_b)
    se0 = math.sqrt(p_bar * (1 - p_bar) * (1 / n_a + 1 / n_b))
    se1 = math.sqrt(p_a * (1 - p_a) / n_a + p_b * (1 - p_b) / n_b)
    delta = abs(p_b - p_a)
    upper = stats.norm.sf((z_a * se0 - delta) / se1)
    lower = stats.norm.cdf((-z_a * se0 - delta) / se1)
    return float(min(1.0, upper + lower))


def power_analysis(
    baseline_rate: float,
    mde_relative: float,
    alpha: float = 0.05,
    power: float = 0.80,
    daily_traffic: float = 1000.0,
    n_variants: int = 2,
) -> PowerAnalysisResult:
    """Sample size + calendar estimate for a relative Minimum Detectable Effect."""
    if mde_relative == 0:
        raise ValueError("mde_relative must be non-zero")
    if daily_traffic <= 0:
        raise ValueError("daily_traffic must be positive")
    target = baseline_rate * (1 + mde_relative)
    n = required_sample_size(baseline_rate, target, alpha, power)
    total = n * n_variants
    return PowerAnalysisResult(
        baseline_rate=baseline_rate,
        target_rate=target,
        mde_relative=mde_relative,
        alpha=alpha,
        power=power,
        sample_size_per_variant=n,
        total_sample_size=total,
        daily_traffic=daily_traffic,
        estimated_days=math.ceil(total / daily_traffic * 10) / 10,
        cohens_h=cohens_h(baseline_rate, target),
    )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _check_rate(p: float, name: str, open_interval: bool = False) -> None:
    if open_interval:
        if not 0 < p < 1:
            raise ValueError(f"{name} must be in (0, 1), got {p}")
    elif not 0 <= p <= 1:
        raise ValueError(f"{name} must be in [0, 1], got {p}")


def _check_counts(conv: int, n: int) -> None:
    if n <= 0:
        raise ValueError("Sample size must be positive")
    if not 0 <= conv <= n:
        raise ValueError("Conversions must be between 0 and n")
