"""
Bayesian A/B analysis with a conjugate Beta-Binomial model.

    Prior:      p ~ Beta(α₀, β₀)                (default Beta(1, 1) = Uniform)
    Likelihood: k | p ~ Binomial(n, p)
    Posterior:  p | k ~ Beta(α₀ + k, β₀ + n − k)

Two estimates are produced for P(B > A):

* **Numerical integration** (exact up to quadrature error)
      P(B > A) = ∫₀¹ f_B(x) · F_A(x) dx
* **Monte Carlo** with a fixed seed (used also for Expected Loss and the
  credible interval of the relative uplift).

Expected loss of shipping B:   E[max(p_A − p_B, 0)]
Expected loss of keeping A:    E[max(p_B − p_A, 0)]
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import integrate, stats

__all__ = [
    "BayesianResult",
    "posterior_params",
    "prob_b_beats_a_exact",
    "bayesian_ab_test",
    "posterior_pdf_curve",
]

DEFAULT_PRIOR = (1.0, 1.0)


@dataclass(frozen=True, slots=True)
class BayesianResult:
    alpha_a: float
    beta_a: float
    alpha_b: float
    beta_b: float
    mean_a: float
    mean_b: float
    cred_int_a: tuple[float, float]
    cred_int_b: tuple[float, float]
    prob_b_beats_a: float
    prob_b_beats_a_mc: float
    expected_loss_b: float
    expected_loss_a: float
    uplift_mean: float
    uplift_cred_low: float
    uplift_cred_high: float
    n_samples: int
    pdf_curve: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def posterior_params(
    conversions: int, n: int, prior: tuple[float, float] = DEFAULT_PRIOR
) -> tuple[float, float]:
    if n < 0 or not 0 <= conversions <= n:
        raise ValueError("Invalid counts")
    a0, b0 = prior
    if a0 <= 0 or b0 <= 0:
        raise ValueError("Prior parameters must be positive")
    return a0 + conversions, b0 + n - conversions


def prob_b_beats_a_exact(a_a: float, b_a: float, a_b: float, b_b: float) -> float:
    """P(p_B > p_A) = ∫ f_B(x) F_A(x) dx via adaptive quadrature.

    Integration is restricted to the region where f_B has mass (±12 sd) so
    that very peaked posteriors (large n) are resolved accurately.
    """
    dist_a = stats.beta(a_a, b_a)
    dist_b = stats.beta(a_b, b_b)
    lo = max(0.0, dist_b.mean() - 12 * dist_b.std())
    hi = min(1.0, dist_b.mean() + 12 * dist_b.std())
    val, _ = integrate.quad(
        lambda x: dist_b.pdf(x) * dist_a.cdf(x), lo, hi, limit=200, epsabs=1e-10
    )
    return float(np.clip(val, 0.0, 1.0))


def posterior_pdf_curve(
    a_a: float, b_a: float, a_b: float, b_b: float, points: int = 100
) -> list[dict]:
    """
    ``points`` evenly spaced (x, control_pdf, variant_pdf) coordinates over
    the union of both 99.98 % posterior ranges — ready for Recharts.
    """
    dist_a, dist_b = stats.beta(a_a, b_a), stats.beta(a_b, b_b)
    lo = min(dist_a.ppf(1e-4), dist_b.ppf(1e-4))
    hi = max(dist_a.ppf(1 - 1e-4), dist_b.ppf(1 - 1e-4))
    pad = (hi - lo) * 0.05
    xs = np.linspace(max(0.0, lo - pad), min(1.0, hi + pad), points)
    pa, pb = dist_a.pdf(xs), dist_b.pdf(xs)
    return [
        {"x": round(float(x), 6), "control_pdf": round(float(a), 4), "variant_pdf": round(float(b), 4)}
        for x, a, b in zip(xs, pa, pb, strict=True)
    ]


def bayesian_ab_test(
    conv_a: int,
    n_a: int,
    conv_b: int,
    n_b: int,
    prior: tuple[float, float] = DEFAULT_PRIOR,
    n_samples: int = 200_000,
    credible_mass: float = 0.95,
    seed: int = 42,
    curve_points: int = 100,
) -> BayesianResult:
    a_a, b_a = posterior_params(conv_a, n_a, prior)
    a_b, b_b = posterior_params(conv_b, n_b, prior)

    rng = np.random.default_rng(seed)
    s_a = rng.beta(a_a, b_a, n_samples)
    s_b = rng.beta(a_b, b_b, n_samples)

    tail = (1 - credible_mass) / 2
    uplift = s_b / s_a - 1.0
    dist_a, dist_b = stats.beta(a_a, b_a), stats.beta(a_b, b_b)

    return BayesianResult(
        alpha_a=a_a,
        beta_a=b_a,
        alpha_b=a_b,
        beta_b=b_b,
        mean_a=float(dist_a.mean()),
        mean_b=float(dist_b.mean()),
        cred_int_a=(float(dist_a.ppf(tail)), float(dist_a.ppf(1 - tail))),
        cred_int_b=(float(dist_b.ppf(tail)), float(dist_b.ppf(1 - tail))),
        prob_b_beats_a=prob_b_beats_a_exact(a_a, b_a, a_b, b_b),
        prob_b_beats_a_mc=float((s_b > s_a).mean()),
        expected_loss_b=float(np.maximum(s_a - s_b, 0).mean()),
        expected_loss_a=float(np.maximum(s_b - s_a, 0).mean()),
        uplift_mean=float(uplift.mean()),
        uplift_cred_low=float(np.quantile(uplift, tail)),
        uplift_cred_high=float(np.quantile(uplift, 1 - tail)),
        n_samples=n_samples,
        pdf_curve=posterior_pdf_curve(a_a, b_a, a_b, b_b, curve_points),
    )
