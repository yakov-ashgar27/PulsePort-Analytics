// Parity tests: browser stats library vs SciPy / the Python engine.
// Run: node --experimental-strip-types --test src/lib/*.test.ts
// Fixtures: python -m scripts.make_stats_fixtures (backend) → __fixtures__/scipy.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as S from "./stats.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx: any = JSON.parse(readFileSync(new URL("./__fixtures__/scipy.json", import.meta.url), "utf8"));

function close(actual: number, expected: number, rel: number, abs = 0, msg = "") {
  const tol = Math.max(abs, rel * Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected}, got ${actual} (tol ${tol})`);
}

test("erfc — full precision incl. deep tail", () => {
  for (const [x, v] of fx.erfc) close(S.erfc(x), v, 1e-12, 1e-300, `erfc(${x})`);
});

test("normal ppf", () => {
  for (const [p, v] of fx.norm_ppf) close(S.normPpf(p), v, 1e-10, 1e-12, `ppf(${p})`);
});

test("incomplete beta, beta ppf", () => {
  for (const [x, a, b, v] of fx.beta_inc) close(S.betaInc(x, a, b), v, 1e-9, 1e-14, `I(${x};${a},${b})`);
  for (const [p, a, b, v] of fx.beta_ppf) close(S.betaPpf(p, a, b), v, 1e-9, 1e-12, `betaPpf(${p})`);
});

test("chi² and Student-t", () => {
  for (const [x, k, v] of fx.chi2_sf) close(S.chi2Sf(x, k), v, 1e-9, 1e-300, `chi2Sf(${x},${k})`);
  for (const [t, df, v] of fx.t_sf) close(S.tSf(t, df), v, 1e-9, 1e-300, `tSf(${t},${df})`);
  for (const [p, df, v] of fx.t_ppf) close(S.tPpf(p, df), v, 1e-8, 1e-10, `tPpf(${p},${df})`);
});

test("two-proportion test, Katz CI, Fisher exact, power", () => {
  for (const { in: i, out: o } of fx.proportions) {
    const r = S.twoProportionTest(i[0], i[1], i[2], i[3]);
    for (const k of ["z_stat", "p_value_z", "chi2_stat", "abs_diff_ci_low", "abs_diff_ci_high", "cohens_h", "achieved_power"])
      close((r as never)[k], o[k], 1e-9, 1e-12, `${k} ${i}`);
    if (Number.isFinite(o.uplift_ci_low)) close(r.uplift_ci_low, o.uplift_ci_low, 1e-9, 1e-12, `upliftLo ${i}`);
    close(S.fisherExact(i[0], i[1] - i[0], i[2], i[3] - i[2]), o.fisher_p, 1e-9, 1e-14, `fisher ${i}`);
  }
  for (const { in: i, out } of fx.required_n) assert.equal(S.requiredSampleSize(i[0], i[1], i[2], i[3]), out);
  for (const { in: i, out } of fx.power) close(S.achievedPower(i[0], i[1], i[2], i[3]), out, 1e-9);
});

test("Mann-Whitney (ties) and Welch t", () => {
  for (const c of fx.mann_whitney) {
    const r = S.mannWhitney(c.a, c.b);
    close(r.u, c.u, 1e-12, 0, "U");
    close(r.p, c.p, 1e-9, 1e-15, "MW p");
  }
  for (const c of fx.welch) {
    const r = S.welchT(c.a, c.b);
    close(r.t, c.t, 1e-10, 0, "t");
    close(r.p, c.p, 1e-8, 1e-15, "welch p");
  }
});

test("Kruskal-Wallis, χ² independence, SRM, Pearson", () => {
  const k = S.kruskal(fx.kruskal.groups);
  close(k.h, fx.kruskal.h, 1e-10);
  close(k.p, fx.kruskal.p, 1e-8);
  const c = S.chi2Independence(fx.chi2_table.table);
  close(c.chi2, fx.chi2_table.chi2, 1e-10);
  close(c.p, fx.chi2_table.p, 1e-9);
  const s = S.srmTest(fx.srm.obs);
  close(s.chi2, fx.srm.chi2, 1e-12);
  close(s.p, fx.srm.p, 1e-9);
  const r = S.pearson(fx.pearson.x, fx.pearson.y);
  close(r.r, fx.pearson.r, 1e-10);
  close(r.p, fx.pearson.p, 1e-7);
});

test("multiple-comparison corrections", () => {
  S.benjaminiHochberg(fx.bh.p).forEach((q, i) => close(q, fx.bh.q[i], 1e-12));
  S.holm(fx.holm.p).forEach((q, i) => close(q, fx.holm.adj[i], 1e-12));
});

test("t-interval and Wilson interval", () => {
  const [m, lo, hi] = S.meanCiT(fx.mean_ci.x);
  close(m, fx.mean_ci.ci[0], 1e-12);
  close(lo, fx.mean_ci.ci[1], 1e-9);
  close(hi, fx.mean_ci.ci[2], 1e-9);
  for (const [k, n, lo2, hi2] of fx.wilson) {
    const [a, b] = S.wilsonCi(k, n);
    close(a, lo2, 1e-9, 1e-15);
    close(b, hi2, 1e-9, 1e-15);
  }
});

test("Bayesian Beta-Binomial matches the Python engine", () => {
  for (const { in: i, out: o } of fx.bayes) {
    const r = S.bayesianAbTest(i[0], i[1], i[2], i[3], { samples: 200_000, seed: 7 });
    close(r.prob_b_beats_a, o.prob_b_beats_a, 1e-6, 1e-7, "P(B>A) exact");
    close(r.prob_b_beats_a_mc, o.prob_b_beats_a, 0, 0.004, "P(B>A) MC");
    close(r.expected_loss_b, o.expected_loss_b, 0.03, 2e-5, "loss B");
    close(r.uplift_cred_low, o.uplift_cred_low, 0, 0.005, "CrI low");
    r.cred_int_a.forEach((v, j) => close(v, o.cred_int_a[j], 1e-8));
    assert.equal(r.pdf_curve.length, 100);
  }
});

test("decision rule reproduces the seeded verdicts", () => {
  const go = S.twoProportionTest(1200, 10000, 1368, 10000);
  const gob = S.bayesianAbTest(1200, 10000, 1368, 10000, { samples: 50_000 });
  assert.equal(S.decide(go, gob, S.achievedPower(0.12, 0.126, 10000, 10000)).verdict, "GO");
  const kr = S.twoProportionTest(3000, 10000, 3087, 10000);
  const krb = S.bayesianAbTest(3000, 10000, 3087, 10000, { samples: 50_000 });
  assert.equal(S.decide(kr, krb, S.achievedPower(0.3, 0.315, 10000, 10000)).verdict, "KEEP RUNNING");
});
