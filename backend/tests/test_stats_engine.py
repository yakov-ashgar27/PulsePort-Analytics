"""
Mathematical verification of the PulsePort statistical engine.

Reference values are derived from closed-form formulas or from independent
SciPy routines so that the engine is checked against first principles rather
than against itself.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy import stats

from app.ai_benchmark.metrics import compare_models, mean_ci_t, model_summary, wilson_ci
from app.seed.generators import (
    EXPERIMENTS_BY_ID,
    FUNNEL_STAGES,
    generate_ai_eval_runs,
    generate_experiment_assignments,
    generate_session_events,
)
from app.stats_engine.bayesian import (
    bayesian_ab_test,
    posterior_params,
    posterior_pdf_curve,
    prob_b_beats_a_exact,
)
from app.stats_engine.frequentist import (
    achieved_power,
    cohens_d,
    cohens_h,
    mann_whitney_test,
    power_analysis,
    relative_uplift_ci,
    required_sample_size,
    two_proportion_test,
)


# =========================================================================== #
# Two-proportion Z / χ²
# =========================================================================== #
class TestTwoProportion:
    def test_zero_uplift_gives_p_one(self):
        r = two_proportion_test(500, 5000, 500, 5000)
        assert r.absolute_diff == 0
        assert r.relative_uplift == 0
        assert r.z_stat == pytest.approx(0.0)
        assert r.p_value_z == pytest.approx(1.0)
        assert r.p_value_chi2 == pytest.approx(1.0)
        assert not r.significant
        assert r.abs_diff_ci_low < 0 < r.abs_diff_ci_high
        assert r.uplift_ci_low < 0 < r.uplift_ci_high

    def test_chi2_equals_z_squared(self):
        r = two_proportion_test(120, 1000, 150, 1000)
        assert r.chi2_stat == pytest.approx(r.z_stat**2, rel=1e-9)
        assert r.p_value_chi2 == pytest.approx(r.p_value_z, rel=1e-9)

    def test_matches_hand_computed_z(self):
        # p_A = .10, p_B = .12, n = 2000 each
        r = two_proportion_test(200, 2000, 240, 2000)
        p = 440 / 4000
        se = math.sqrt(p * (1 - p) * (2 / 2000))
        z = 0.02 / se
        assert r.z_stat == pytest.approx(z, rel=1e-12)
        assert r.p_value_z == pytest.approx(2 * stats.norm.sf(z), rel=1e-12)

    def test_significant_uplift(self):
        r = two_proportion_test(1000, 10_000, 1200, 10_000)
        assert r.significant
        assert r.p_value_z < 1e-4
        assert r.relative_uplift == pytest.approx(0.20)
        assert r.uplift_ci_low > 0
        assert r.uplift_ci_low < 0.20 < r.uplift_ci_high

    def test_direction_symmetry(self):
        up = two_proportion_test(100, 1000, 130, 1000)
        down = two_proportion_test(130, 1000, 100, 1000)
        assert up.z_stat == pytest.approx(-down.z_stat)
        assert up.p_value_z == pytest.approx(down.p_value_z)

    def test_uplift_ci_is_log_symmetric(self):
        lo, hi = relative_uplift_ci(100, 1000, 150, 1000)
        rr = 1.5
        assert math.log(1 + lo) + math.log(1 + hi) == pytest.approx(2 * math.log(rr))

    def test_invalid_counts_raise(self):
        with pytest.raises(ValueError):
            two_proportion_test(11, 10, 5, 10)
        with pytest.raises(ValueError):
            two_proportion_test(1, 0, 5, 10)


# =========================================================================== #
# Effect sizes
# =========================================================================== #
class TestEffectSizes:
    def test_cohens_h_known_value(self):
        # h(0.5, 0.6) = 2·asin(√.6) − 2·asin(√.5) ≈ 0.2013579
        assert cohens_h(0.5, 0.6) == pytest.approx(0.2013579, abs=1e-6)
        assert cohens_h(0.3, 0.3) == 0.0

    def test_cohens_d_one_sd_shift(self):
        rng = np.random.default_rng(0)
        a = rng.normal(0, 1, 50_000)
        b = rng.normal(1, 1, 50_000)
        assert cohens_d(a, b) == pytest.approx(1.0, abs=0.02)

    def test_cohens_d_constant_groups(self):
        assert cohens_d(np.ones(5), np.ones(5)) == 0.0


# =========================================================================== #
# Mann-Whitney U
# =========================================================================== #
class TestMannWhitney:
    def test_identical_distributions_not_significant(self):
        rng = np.random.default_rng(1)
        a = rng.lognormal(4, 0.5, 3000)
        b = rng.lognormal(4, 0.5, 3000)
        r = mann_whitney_test(a, b)
        assert r.p_value > 0.01
        assert abs(r.rank_biserial) < 0.05

    def test_detects_shift_in_skewed_metric(self):
        rng = np.random.default_rng(2)
        a = rng.lognormal(np.log(94), 0.55, 2000)
        b = rng.lognormal(np.log(71), 0.55, 2000)
        r = mann_whitney_test(a, b)
        assert r.significant and r.p_value < 1e-10
        assert r.median_b < r.median_a
        assert r.rank_biserial > 0  # B tends to be faster

    def test_matches_scipy(self):
        a, b = np.arange(1, 21, dtype=float), np.arange(5, 25, dtype=float)
        ref = stats.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic")
        assert mann_whitney_test(a, b).p_value == pytest.approx(ref.pvalue)


# =========================================================================== #
# Power analysis
# =========================================================================== #
class TestPower:
    def test_textbook_sample_size(self):
        # Classic reference: 10 % → 12 %, α=.05, power=.80 ⇒ ≈ 3,841 per arm
        assert required_sample_size(0.10, 0.12) == 3841

    def test_round_trip_power_is_target(self):
        n = required_sample_size(0.12, 0.1368, alpha=0.05, power=0.80)
        assert achieved_power(0.12, 0.1368, n, n) == pytest.approx(0.80, abs=0.005)

    def test_power_monotonic_in_n(self):
        powers = [achieved_power(0.3, 0.31, n, n) for n in (1000, 5000, 20_000, 80_000)]
        assert powers == sorted(powers)
        assert powers[-1] > 0.8

    def test_power_under_null_equals_alpha(self):
        assert achieved_power(0.2, 0.2, 1000, 1000, alpha=0.05) == 0.05

    def test_smaller_mde_needs_more_samples(self):
        n5 = power_analysis(0.12, 0.05).sample_size_per_variant
        n10 = power_analysis(0.12, 0.10).sample_size_per_variant
        assert n5 > 3.5 * n10  # n ∝ 1/δ² ⇒ ≈ 4×

    def test_higher_power_needs_more_samples(self):
        assert required_sample_size(0.1, 0.12, power=0.9) > required_sample_size(0.1, 0.12, power=0.8)

    def test_days_estimate(self):
        r = power_analysis(0.10, 0.20, daily_traffic=500)
        assert r.estimated_days == pytest.approx(math.ceil(r.total_sample_size / 500 * 10) / 10)
        assert r.target_rate == pytest.approx(0.12)

    @pytest.mark.parametrize("bad", [0.0, 1.0, -0.1])
    def test_invalid_baseline(self, bad):
        with pytest.raises(ValueError):
            required_sample_size(bad, 0.5)

    def test_cross_check_with_statsmodels(self):
        sm = pytest.importorskip("statsmodels.stats.power")
        from statsmodels.stats.proportion import proportion_effectsize

        es = proportion_effectsize(0.12, 0.10)
        n_sm = sm.NormalIndPower().solve_power(es, alpha=0.05, power=0.8, ratio=1.0)
        # arcsine (Cohen's h) and Fleiss methods agree within ~1 %
        assert required_sample_size(0.10, 0.12) == pytest.approx(n_sm, rel=0.02)


# =========================================================================== #
# Bayesian
# =========================================================================== #
class TestBayesian:
    def test_conjugate_update(self):
        assert posterior_params(30, 100) == (31.0, 71.0)
        assert posterior_params(0, 0) == (1.0, 1.0)
        with pytest.raises(ValueError):
            posterior_params(5, 3)

    def test_identical_posteriors_give_half(self):
        assert prob_b_beats_a_exact(51, 451, 51, 451) == pytest.approx(0.5, abs=1e-6)

    def test_exact_vs_closed_form_integer_params(self):
        # Evan Miller's closed form for integer Beta parameters
        from scipy.special import betaln

        a_a, b_a, a_b, b_b = 13, 89, 21, 81

        def closed():
            tot = 0.0
            for i in range(a_b):
                tot += math.exp(
                    betaln(a_a + i, b_a + b_b) - math.log(b_b + i)
                    - betaln(1 + i, b_b) - betaln(a_a, b_a)
                )
            return tot

        assert prob_b_beats_a_exact(a_a, b_a, a_b, b_b) == pytest.approx(closed(), abs=1e-7)

    def test_mc_agrees_with_numerical(self):
        r = bayesian_ab_test(1200, 10_000, 1368, 10_000)
        assert r.prob_b_beats_a == pytest.approx(r.prob_b_beats_a_mc, abs=0.003)

    def test_posterior_bounds(self):
        r = bayesian_ab_test(5, 50, 9, 50)
        for lo, hi in (r.cred_int_a, r.cred_int_b):
            assert 0 <= lo < hi <= 1
        assert 0 <= r.prob_b_beats_a <= 1
        assert r.expected_loss_a >= 0 and r.expected_loss_b >= 0
        assert r.uplift_cred_low < r.uplift_mean < r.uplift_cred_high

    def test_strong_winner_has_low_expected_loss(self):
        r = bayesian_ab_test(1000, 10_000, 1300, 10_000)
        assert r.prob_b_beats_a > 0.9999
        assert r.expected_loss_b < 1e-6
        assert r.expected_loss_a > 0.02

    def test_expected_loss_identity(self):
        # E[max(A−B,0)] − E[max(B−A,0)] = E[A] − E[B]
        r = bayesian_ab_test(300, 2000, 320, 2000, n_samples=400_000)
        assert r.expected_loss_b - r.expected_loss_a == pytest.approx(r.mean_a - r.mean_b, abs=2e-4)

    def test_pdf_curve_shape_and_density(self):
        curve = posterior_pdf_curve(121, 881, 141, 861, points=100)
        assert len(curve) == 100
        xs = np.array([c["x"] for c in curve])
        assert np.all(np.diff(xs) > 0)
        area = np.trapezoid([c["control_pdf"] for c in curve], xs)
        assert area == pytest.approx(1.0, abs=0.01)

    def test_seed_reproducibility(self):
        r1 = bayesian_ab_test(50, 500, 60, 500, seed=3, n_samples=10_000)
        r2 = bayesian_ab_test(50, 500, 60, 500, seed=3, n_samples=10_000)
        assert r1.prob_b_beats_a_mc == r2.prob_b_beats_a_mc


# =========================================================================== #
# AI benchmark metrics
# =========================================================================== #
class TestBenchmarkMetrics:
    def test_wilson_matches_reference(self):
        # Known reference: k=10, n=100 → [0.0552, 0.1744]
        lo, hi = wilson_ci(10, 100)
        assert lo == pytest.approx(0.0552, abs=1e-4)
        assert hi == pytest.approx(0.1744, abs=1e-4)
        assert wilson_ci(0, 50)[0] == 0.0

    def test_mean_ci_t(self):
        m, lo, hi = mean_ci_t([1, 2, 3, 4, 5])
        assert m == 3
        h = stats.t.ppf(0.975, 4) * math.sqrt(2.5) / math.sqrt(5)
        assert (lo, hi) == pytest.approx((3 - h, 3 + h))

    def test_model_summary_and_comparison(self):
        rows = generate_ai_eval_runs(300)
        by_model: dict[str, list[dict]] = {}
        for r in rows:
            by_model.setdefault(r["model"], []).append(r)
        summaries = {
            m: model_summary(
                [r["accuracy_score"] for r in rs], [r["hallucination"] for r in rs],
                [r["latency_ms"] for r in rs], [r["cost_usd"] for r in rs],
            )
            for m, rs in by_model.items()
        }
        assert all(s["n"] == 300 for s in summaries.values())
        for s in summaries.values():
            assert s["accuracy_ci_low"] < s["mean_accuracy"] < s["accuracy_ci_high"]
            assert s["p95_latency_ms"] > s["p50_latency_ms"]
        cmp = compare_models(
            {m: [r["accuracy_score"] for r in rs] for m, rs in by_model.items()},
            {m: (sum(r["hallucination"] for r in rs), len(rs)) for m, rs in by_model.items()},
        )
        assert cmp["kruskal_p"] < 0.05


# =========================================================================== #
# Seeded data contains the intended statistical signals
# =========================================================================== #
@pytest.fixture(scope="module")
def assignments():
    return generate_experiment_assignments()


class TestSeededSignals:
    def _counts(self, rows, exp):
        sub = [r for r in rows if r["experiment_id"] == exp]
        a = [r for r in sub if r["variant"] == "A"]
        b = [r for r in sub if r["variant"] == "B"]
        return sum(r["converted"] for r in a), len(a), sum(r["converted"] for r in b), len(b)

    def test_exp01_significant_14pct_lift(self, assignments):
        r = two_proportion_test(*self._counts(assignments, "EXP-01"))
        assert r.relative_uplift == pytest.approx(0.14, abs=0.005)
        assert r.p_value_z < 0.01

    def test_exp02_underpowered(self, assignments):
        r = two_proportion_test(*self._counts(assignments, "EXP-02"))
        assert 0.02 < r.relative_uplift < 0.04
        assert r.p_value_z == pytest.approx(0.18, abs=0.02)
        assert r.achieved_power < 0.5
        spec = EXPERIMENTS_BY_ID["EXP-02"]
        assert spec.n_control == 10_000

    def test_regional_bottleneck(self):
        events = list(generate_session_events(n_sessions=12_000, seed=5))
        assert {e["stage"] for e in events} == set(FUNNEL_STAGES)
        search = {}
        quote = set()
        for e in events:
            if e["stage"] == "ROUTE_SEARCH":
                search[e["session_id"]] = (e["region"], e["device_type"])
            elif e["stage"] == "RATE_QUOTE":
                quote.add(e["session_id"])

        def rate(pred):
            ids = [s for s, k in search.items() if pred(k)]
            return sum(s in quote for s in ids), len(ids)

        slow = rate(lambda k: k[0] in ("BR - Santos", "CN - Shanghai") and k[1] == "Mobile")
        rest = rate(lambda k: not (k[0] in ("BR - Santos", "CN - Shanghai") and k[1] == "Mobile"))
        r = two_proportion_test(slow[0], slow[1], rest[0], rest[1])
        assert r.rate_a < r.rate_b - 0.15
        assert r.p_value_z < 1e-10
