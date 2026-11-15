"""
Generate SciPy reference values for the browser stats library
(frontend/src/lib/stats.test.ts). Re-run after changing either engine:

    python -m scripts.make_stats_fixtures ../frontend/src/lib/__fixtures__/scipy.json
"""

from __future__ import annotations

import json
import sys

import numpy as np
from scipy import special, stats

from app.ai_benchmark.metrics import wilson_ci
from app.stats_engine.bayesian import bayesian_ab_test
from app.stats_engine.frequentist import achieved_power, required_sample_size, two_proportion_test


def main(out: str) -> None:
    rng = np.random.default_rng(2026)
    fx: dict = {}

    fx["erfc"] = [[x, float(special.erfc(x))] for x in (-3, -1, -0.2, 0, 0.1, 0.7, 1.5, 2.9, 3.1, 5, 8, 12, 26)]
    fx["norm_ppf"] = [[p, float(stats.norm.ppf(p))] for p in (1e-12, 1e-6, 0.001, 0.02, 0.025, 0.3, 0.5, 0.8, 0.975, 0.999, 1 - 1e-9)]
    fx["beta_inc"] = [[x, a, b, float(special.betainc(a, b, x))]
                      for x, a, b in ((0.1, 2, 3), (0.5, 0.5, 0.5), (0.12, 121, 881), (0.9, 30, 2), (0.3, 1500, 3500), (0.001, 1, 1000))]
    fx["beta_ppf"] = [[p, a, b, float(stats.beta.ppf(p, a, b))] for p, a, b in ((0.025, 121, 881), (0.975, 3088, 6914), (0.5, 2, 5))]
    fx["chi2_sf"] = [[x, k, float(stats.chi2.sf(x, k))] for x, k in ((0.5, 1), (3.84, 1), (12.6, 2), (52.9, 2), (7.8, 3), (150, 5), (0.01, 4))]
    fx["t_sf"] = [[t, df, float(stats.t.sf(t, df))] for t, df in ((0.5, 3), (2.1, 10), (-1.3, 7.5), (4.2, 597.3), (8, 30), (1.96, 1e6))]
    fx["t_ppf"] = [[p, df, float(stats.t.ppf(p, df))] for p, df in ((0.975, 4), (0.975, 299), (0.995, 12.5), (0.05, 2))]

    props = [(1200, 10000, 1368, 10000), (3000, 10000, 3087, 10000), (3, 40, 9, 41), (0, 25, 4, 25),
             (50, 400, 48, 410), (10, 100, 25, 100), (2, 2000, 11, 2000)]
    fx["proportions"] = []
    for ca, na, cb, nb in props:
        r = two_proportion_test(ca, na, cb, nb).to_dict()
        r["fisher_p"] = float(stats.fisher_exact([[ca, na - ca], [cb, nb - cb]])[1])
        fx["proportions"].append({"in": [ca, na, cb, nb], "out": r})

    fx["required_n"] = [{"in": [b, t, a, p], "out": required_sample_size(b, t, a, p)}
                        for b, t, a, p in ((0.1, 0.12, 0.05, 0.8), (0.03, 0.033, 0.01, 0.9), (0.3, 0.27, 0.05, 0.8))]
    fx["power"] = [{"in": [pa, pb, na, nb], "out": achieved_power(pa, pb, na, nb)}
                   for pa, pb, na, nb in ((0.3, 0.3087, 10000, 10000), (0.12, 0.1368, 10000, 10000), (0.5, 0.6, 50, 60))]

    fx["mann_whitney"] = []
    fx["welch"] = []
    for _ in range(4):
        a = np.round(rng.lognormal(4, 0.6, int(rng.integers(15, 300))), 0)  # rounding ⇒ ties
        b = np.round(rng.lognormal(4.15, 0.6, int(rng.integers(15, 300))), 0)
        mw = stats.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic")
        w = stats.ttest_ind(a, b, equal_var=False)
        fx["mann_whitney"].append({"a": a.tolist(), "b": b.tolist(), "u": float(mw.statistic), "p": float(mw.pvalue)})
        fx["welch"].append({"a": a.tolist(), "b": b.tolist(), "t": float(w.statistic), "p": float(w.pvalue)})

    groups = [np.round(rng.normal(m, 10, 60), 0).tolist() for m in (85, 81, 77)]
    h, p = stats.kruskal(*groups)
    fx["kruskal"] = {"groups": groups, "h": float(h), "p": float(p)}

    table = [[7, 293], [19, 281], [19, 281]]
    c2, p, dof, _ = stats.chi2_contingency(table)
    fx["chi2_table"] = {"table": table, "chi2": float(c2), "p": float(p)}
    srm = stats.chisquare([10250, 9750])
    fx["srm"] = {"obs": [10250, 9750], "chi2": float(srm.statistic), "p": float(srm.pvalue)}

    x = rng.normal(0, 1, 200)
    y = 0.3 * x + rng.normal(0, 1, 200)
    r, p = stats.pearsonr(x, y)
    fx["pearson"] = {"x": x.tolist(), "y": y.tolist(), "r": float(r), "p": float(p)}

    # Reference adjustments written out from the definitions (vectorised NumPy),
    # cross-checkable against statsmodels.multipletests when it is installed.
    ps = np.array([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216])
    m = len(ps)
    o = np.argsort(ps)
    bh = np.minimum.accumulate((ps[o] * m / np.arange(1, m + 1))[::-1])[::-1]
    holm = np.maximum.accumulate(np.minimum(1, ps[o] * (m - np.arange(m))))
    q, adj = np.empty(m), np.empty(m)
    q[o], adj[o] = np.minimum(bh, 1), holm
    try:
        from statsmodels.stats.multitest import multipletests  # type: ignore[import-not-found]

        assert np.allclose(q, multipletests(ps, method="fdr_bh")[1])
        assert np.allclose(adj, multipletests(ps, method="holm")[1])
    except ImportError:
        pass
    fx["bh"] = {"p": ps.tolist(), "q": q.tolist()}
    fx["holm"] = {"p": ps.tolist(), "adj": adj.tolist()}

    vals = rng.normal(80, 12, 300)
    m, se = vals.mean(), stats.sem(vals)
    lo, hi = stats.t.interval(0.95, len(vals) - 1, loc=m, scale=se)
    fx["mean_ci"] = {"x": vals.tolist(), "ci": [float(m), float(lo), float(hi)]}
    fx["wilson"] = [[k, n, *wilson_ci(k, n)] for k, n in ((10, 100), (0, 50), (19, 300), (300, 300))]

    fx["bayes"] = []
    for ca, na, cb, nb in ((1200, 10000, 1368, 10000), (3000, 10000, 3087, 10000), (5, 50, 9, 50)):
        r = bayesian_ab_test(ca, na, cb, nb, n_samples=400_000)
        fx["bayes"].append({"in": [ca, na, cb, nb], "out": {k: v for k, v in r.to_dict().items() if k != "pdf_curve"}})

    def clean(o):  # JSON has no Infinity/NaN — encode them as null
        if isinstance(o, float) and not np.isfinite(o):
            return None
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list | tuple):
            return [clean(v) for v in o]
        return o

    with open(out, "w") as f:
        json.dump(clean(fx), f, allow_nan=False)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1])
