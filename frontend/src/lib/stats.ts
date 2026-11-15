/**
 * Browser statistics library for the Data Studio.
 *
 * A dependency-free TypeScript port of the methods in backend/app/stats_engine
 * plus the distribution functions they need. Every public function is checked
 * against SciPy on exported fixtures (stats.test.ts), so analyses run on a
 * user's own data in the browser give the same answers as the Python engine.
 *
 * Special functions use standard, well-conditioned algorithms:
 *   lgamma            Lanczos (g = 7, n = 9)
 *   erf / erfc        positive-term series (|x| < 1) / Lentz continued fraction
 *   incomplete beta   Lentz continued fraction (Numerical Recipes betacf)
 *   incomplete gamma  series / continued fraction
 */

// ============================================================ special functions
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const lbeta = (a: number, b: number) => lgamma(a) + lgamma(b) - lgamma(a + b);

/** erfc with full double precision on the whole real line. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 1) {
    // erf(x) = 2/√π · e^{-x²} · Σ (2x²)^n · x / (1·3·…·(2n+1))   (all terms positive)
    let term = x;
    let sum = x;
    const x2 = 2 * x * x;
    for (let n = 1; n < 500; n++) {
      term *= x2 / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
  }
  // Continued fraction: erfc(x) = e^{-x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …))))
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 5000; n++) {
    const an = n / 2;
    D = x + an * D;
    D = Math.abs(D) < tiny ? tiny : D;
    C = x + an / C;
    C = Math.abs(C) < tiny ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

export const normCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);
export const normSf = (x: number) => 0.5 * erfc(x / Math.SQRT2);
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Inverse normal CDF: Acklam's approximation polished by Newton steps on the exact CDF. */
export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  for (let i = 0; i < 2; i++) {
    // Newton on the tail that keeps relative precision
    const err = p < 0.5 ? normCdf(x) - p : 1 - p - normSf(x);
    const pdf = normPdf(x);
    if (pdf > 0) x -= err / pdf;
  }
  return x;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  if (x > (a + 1) / (a + b + 2)) return 1 - (front * betacf(1 - x, b, a)) / b;
  return (front * betacf(x, a, b)) / a;
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  d = Math.abs(d) < tiny ? tiny : d;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10_000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

export const betaPdf = (x: number, a: number, b: number) =>
  x <= 0 || x >= 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta(a, b));

export function betaPpf(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betaInc(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 10_000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    d = Math.abs(d) < tiny ? tiny : d;
    c = b + an / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

export const chi2Sf = (x: number, df: number) => gammaQ(df / 2, x / 2);

/** Student-t survival function P(T > t). */
export function tSf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t >= 0 ? tail : 1 - tail;
}

export function tPpf(p: number, df: number): number {
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (1 - tSf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

// ===================================================================== random
/** Small fast seeded PRNG (mulberry32) — reproducible Monte Carlo. */
export function rng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSampler(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let a = 0;
    while (a === 0) a = u();
    const b = u();
    const r = Math.sqrt(-2 * Math.log(a));
    spare = r * Math.sin(2 * Math.PI * b);
    return r * Math.cos(2 * Math.PI * b);
  };
}

/** Marsaglia–Tsang gamma sampler (shape ≥ 1; boosts for shape < 1). */
function gammaSample(shape: number, u: () => number, n: () => number): number {
  if (shape < 1) return gammaSample(shape + 1, u, n) * Math.pow(u(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = n();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const uu = u();
    if (uu < 1 - 0.0331 * x ** 4 || Math.log(uu) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// ============================================================ descriptive helpers
export const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
export function variance(x: number[]): number {
  const m = mean(x);
  return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1);
}
/** Linear-interpolated percentile (NumPy default / PERCENTILE_CONT). */
export function percentile(x: number[], q: number): number {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function rankWithTies(values: number[]): { ranks: number[]; tieTerm: number } {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  let tieTerm = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]![1]] = r;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  return { ranks, tieTerm };
}

// ================================================================ proportions
export interface ProportionTest {
  n_a: number;
  n_b: number;
  conv_a: number;
  conv_b: number;
  rate_a: number;
  rate_b: number;
  absolute_diff: number;
  relative_uplift: number;
  z_stat: number;
  p_value_z: number;
  chi2_stat: number;
  p_value_chi2: number;
  abs_diff_ci_low: number;
  abs_diff_ci_high: number;
  uplift_ci_low: number;
  uplift_ci_high: number;
  cohens_h: number;
  achieved_power: number;
  significant: boolean;
  alpha: number;
  fisher_p: number | null;
  small_sample: boolean;
}

export const cohensH = (p1: number, p2: number) => 2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1));

export function achievedPower(pA: number, pB: number, nA: number, nB: number, alpha = 0.05): number {
  if (pA === pB) return alpha;
  const zA = normPpf(1 - alpha / 2);
  const pBar = (pA * nA + pB * nB) / (nA + nB);
  const se0 = Math.sqrt(pBar * (1 - pBar) * (1 / nA + 1 / nB));
  const se1 = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  if (se1 === 0) return 1;
  const delta = Math.abs(pB - pA);
  return Math.min(1, normSf((zA * se0 - delta) / se1) + normCdf((-zA * se0 - delta) / se1));
}

export function requiredSampleSize(baseline: number, target: number, alpha = 0.05, power = 0.8): number {
  if (!(baseline > 0 && baseline < 1) || !(target > 0 && target < 1)) throw new RangeError("rates must be in (0, 1)");
  if (baseline === target) throw new RangeError("baseline and target must differ");
  const zA = normPpf(1 - alpha / 2);
  const zB = normPpf(power);
  const pBar = (baseline + target) / 2;
  const num = (zA * Math.sqrt(2 * pBar * (1 - pBar)) + zB * Math.sqrt(baseline * (1 - baseline) + target * (1 - target))) ** 2;
  return Math.ceil(num / (target - baseline) ** 2 - 1e-9);
}

/** Two-sided Fisher exact test for a 2×2 table [[a, b], [c, d]] (SciPy's definition). */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  const lf = (k: number) => lgamma(k + 1);
  const logP = (x: number) => lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x);
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  const pObs = logP(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= pObs + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

export function twoProportionTest(convA: number, nA: number, convB: number, nB: number, alpha = 0.05): ProportionTest {
  if (nA <= 0 || nB <= 0) throw new RangeError("sample sizes must be positive");
  if (convA < 0 || convA > nA || convB < 0 || convB > nB) throw new RangeError("conversions must be between 0 and n");
  const pA = convA / nA;
  const pB = convB / nB;
  const diff = pB - pA;
  const pooled = (convA + convB) / (nA + nB);
  const seP = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  const z = seP === 0 ? 0 : diff / seP;
  const pz = seP === 0 ? 1 : 2 * normSf(Math.abs(z));
  const zc = normPpf(1 - alpha / 2);
  const seU = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  let upLo = -Infinity;
  let upHi = Infinity;
  if (convA > 0 && convB > 0) {
    const lr = Math.log(pB / pA);
    const se = Math.sqrt((1 - pA) / (nA * pA) + (1 - pB) / (nB * pB));
    upLo = Math.exp(lr - zc * se) - 1;
    upHi = Math.exp(lr + zc * se) - 1;
  }
  // Small expected counts invalidate the normal approximation → report Fisher's exact test
  const expectedMin = Math.min(pooled * nA, (1 - pooled) * nA, pooled * nB, (1 - pooled) * nB);
  const small = expectedMin < 5;
  const fisher = small || nA + nB <= 2000 ? fisherExact(convA, nA - convA, convB, nB - convB) : null;
  const pDecision = small && fisher !== null ? fisher : pz;
  return {
    n_a: nA,
    n_b: nB,
    conv_a: convA,
    conv_b: convB,
    rate_a: pA,
    rate_b: pB,
    absolute_diff: diff,
    relative_uplift: pA > 0 ? diff / pA : Infinity,
    z_stat: z,
    p_value_z: pz,
    chi2_stat: z * z,
    p_value_chi2: pz,
    abs_diff_ci_low: diff - zc * seU,
    abs_diff_ci_high: diff + zc * seU,
    uplift_ci_low: upLo,
    uplift_ci_high: upHi,
    cohens_h: cohensH(pA, pB),
    achieved_power: achievedPower(pA, pB, nA, nB, alpha),
    significant: pDecision < alpha,
    alpha,
    fisher_p: fisher,
    small_sample: small,
  };
}

/** Wilson score interval. */
export function wilsonCi(k: number, n: number, conf = 0.95): [number, number] {
  if (n === 0) return [0, 1];
  const z = normPpf((1 + conf) / 2);
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [k === 0 ? 0 : Math.max(0, centre - half), k === n ? 1 : Math.min(1, centre + half)];
}

// ================================================================= continuous
export interface ContinuousTest {
  n_a: number;
  n_b: number;
  median_a: number;
  median_b: number;
  mean_a: number;
  mean_b: number;
  u_stat: number;
  p_value: number;
  rank_biserial: number;
  cohens_d: number;
  welch_t: number;
  welch_df: number;
  welch_p: number;
  significant: boolean;
  alpha: number;
}

export function cohensD(a: number[], b: number[]): number {
  const pooled = ((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2);
  return pooled === 0 ? 0 : (mean(b) - mean(a)) / Math.sqrt(pooled);
}

/** Two-sided Mann-Whitney U, asymptotic with tie & continuity correction (SciPy default). */
export function mannWhitney(a: number[], b: number[]): { u: number; p: number } {
  const n1 = a.length;
  const n2 = b.length;
  const { ranks, tieTerm } = rankWithTies([...a, ...b]);
  let r1 = 0;
  for (let i = 0; i < n1; i++) r1 += ranks[i]!;
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const n = n1 + n2;
  const mu = (n1 * n2) / 2;
  const s = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  const z = s === 0 ? 0 : (Math.max(u1, u2) - mu - 0.5) / s;
  return { u: u1, p: Math.min(1, 2 * normSf(z)) };
}

export function welchT(a: number[], b: number[]): { t: number; df: number; p: number } {
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return { t: 0, df: a.length + b.length - 2, p: 1 };
  const t = (mean(a) - mean(b)) / se;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: Math.min(1, 2 * tSf(Math.abs(t), df)) };
}

export function continuousTest(a: number[], b: number[], alpha = 0.05): ContinuousTest {
  if (a.length < 2 || b.length < 2) throw new RangeError("each group needs at least two observations");
  const mw = mannWhitney(a, b);
  const w = welchT(a, b);
  return {
    n_a: a.length,
    n_b: b.length,
    median_a: percentile(a, 0.5),
    median_b: percentile(b, 0.5),
    mean_a: mean(a),
    mean_b: mean(b),
    u_stat: mw.u,
    p_value: mw.p,
    rank_biserial: (2 * mw.u) / (a.length * b.length) - 1,
    cohens_d: cohensD(a, b),
    welch_t: w.t,
    welch_df: w.df,
    welch_p: w.p,
    significant: mw.p < alpha,
    alpha,
  };
}

export function meanCiT(x: number[], conf = 0.95): [number, number, number] {
  const m = mean(x);
  if (x.length < 2) return [m, m, m];
  const h = tPpf((1 + conf) / 2, x.length - 1) * Math.sqrt(variance(x) / x.length);
  return [m, m - h, m + h];
}

/** Kruskal-Wallis H with tie correction. */
export function kruskal(groups: number[][]): { h: number; p: number } {
  const all = groups.flat();
  const n = all.length;
  const { ranks, tieTerm } = rankWithTies(all);
  let h = 0;
  let off = 0;
  for (const g of groups) {
    let r = 0;
    for (let i = 0; i < g.length; i++) r += ranks[off + i]!;
    off += g.length;
    h += (r * r) / g.length;
  }
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const corr = 1 - tieTerm / (n ** 3 - n);
  if (corr > 0) h /= corr;
  return { h, p: chi2Sf(h, groups.length - 1) };
}

/** Pearson χ² test of independence on an r×c table (Yates correction only for 2×2, like SciPy). */
export function chi2Independence(table: number[][], yates = true): { chi2: number; p: number; dof: number } {
  const rows = table.map((r) => r.reduce((s, v) => s + v, 0));
  const cols = table[0]!.map((_, j) => table.reduce((s, r) => s + r[j]!, 0));
  const n = rows.reduce((s, v) => s + v, 0);
  const dof = (table.length - 1) * (cols.length - 1);
  let chi2 = 0;
  for (let i = 0; i < table.length; i++)
    for (let j = 0; j < cols.length; j++) {
      const e = (rows[i]! * cols[j]!) / n;
      if (e === 0) continue;
      let dev = Math.abs(table[i]![j]! - e);
      if (yates && dof === 1) dev = Math.max(0, dev - 0.5);
      chi2 += (dev * dev) / e;
    }
  return { chi2, p: dof > 0 ? chi2Sf(chi2, dof) : 1, dof };
}

/** Sample-ratio-mismatch check: χ² goodness-of-fit of observed arm sizes vs planned split. */
export function srmTest(observed: number[], expectedShares?: number[]): { chi2: number; p: number } {
  const n = observed.reduce((s, v) => s + v, 0);
  const shares = expectedShares ?? observed.map(() => 1 / observed.length);
  let chi2 = 0;
  observed.forEach((o, i) => {
    const e = n * shares[i]!;
    chi2 += (o - e) ** 2 / e;
  });
  return { chi2, p: chi2Sf(chi2, observed.length - 1) };
}

export function pearson(x: number[], y: number[]): { r: number; p: number } {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { r: 0, p: 1 };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const df = x.length - 2;
  if (df < 1 || Math.abs(r) === 1) return { r, p: Math.abs(r) === 1 ? 0 : 1 };
  const t = r * Math.sqrt(df / (1 - r * r));
  return { r, p: 2 * tSf(Math.abs(t), df) };
}

/** Benjamini–Hochberg q-values (false-discovery-rate control for many segment tests). */
export function benjaminiHochberg(p: number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [pv, i] = order[k]!;
    prev = Math.min(prev, (pv * m) / (k + 1));
    q[i] = prev;
  }
  return q;
}

/** Holm step-down adjusted p-values (family-wise error control for multi-arm tests). */
export function holm(p: number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const adj = new Array<number>(m);
  let prev = 0;
  order.forEach(([pv, i], k) => {
    prev = Math.max(prev, Math.min(1, (m - k) * pv));
    adj[i] = prev;
  });
  return adj;
}

// ================================================================== Bayesian
export interface BayesianResult {
  alpha_a: number;
  beta_a: number;
  alpha_b: number;
  beta_b: number;
  mean_a: number;
  mean_b: number;
  cred_int_a: [number, number];
  cred_int_b: [number, number];
  prob_b_beats_a: number;
  prob_b_beats_a_mc: number;
  expected_loss_b: number;
  expected_loss_a: number;
  uplift_mean: number;
  uplift_cred_low: number;
  uplift_cred_high: number;
  n_samples: number;
  pdf_curve: { x: number; control_pdf: number; variant_pdf: number }[];
}

/** P(p_B > p_A) = ∫ f_B(x) F_A(x) dx — composite Simpson over B's ±12 sd support. */
export function probBBeatsA(aA: number, bA: number, aB: number, bB: number): number {
  const mB = aB / (aB + bB);
  const sdB = Math.sqrt((aB * bB) / ((aB + bB) ** 2 * (aB + bB + 1)));
  const lo = Math.max(0, mB - 12 * sdB);
  const hi = Math.min(1, mB + 12 * sdB);
  const n = 4000;
  const h = (hi - lo) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const x = lo + i * h;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w * betaPdf(x, aB, bB) * betaInc(x, aA, bA);
  }
  return Math.min(1, Math.max(0, (s * h) / 3));
}

export function bayesianAbTest(
  convA: number,
  nA: number,
  convB: number,
  nB: number,
  opts: { prior?: [number, number]; samples?: number; seed?: number; points?: number } = {},
): BayesianResult {
  const [a0, b0] = opts.prior ?? [1, 1];
  const samples = opts.samples ?? 100_000;
  const aA = a0 + convA;
  const bA = b0 + nA - convA;
  const aB = a0 + convB;
  const bB = b0 + nB - convB;
  const u = rng(opts.seed ?? 42);
  const nrm = normalSampler(u);
  const beta = (a: number, b: number) => {
    const x = gammaSample(a, u, nrm);
    return x / (x + gammaSample(b, u, nrm));
  };
  let wins = 0;
  let lossB = 0;
  let lossA = 0;
  const uplift = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const sa = beta(aA, bA);
    const sb = beta(aB, bB);
    if (sb > sa) wins++;
    lossB += Math.max(sa - sb, 0);
    lossA += Math.max(sb - sa, 0);
    uplift[i] = sb / sa - 1;
  }
  uplift.sort();
  const q = (p: number) => uplift[Math.min(samples - 1, Math.floor(p * samples))]!;
  const lo = Math.min(betaPpf(1e-4, aA, bA), betaPpf(1e-4, aB, bB));
  const hi = Math.max(betaPpf(1 - 1e-4, aA, bA), betaPpf(1 - 1e-4, aB, bB));
  const pad = (hi - lo) * 0.05;
  const points = opts.points ?? 100;
  const x0 = Math.max(0, lo - pad);
  const x1 = Math.min(1, hi + pad);
  const pdf_curve = Array.from({ length: points }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / (points - 1);
    return { x, control_pdf: betaPdf(x, aA, bA), variant_pdf: betaPdf(x, aB, bB) };
  });
  let upliftSum = 0;
  for (let i = 0; i < samples; i++) upliftSum += uplift[i]!;
  return {
    alpha_a: aA,
    beta_a: bA,
    alpha_b: aB,
    beta_b: bB,
    mean_a: aA / (aA + bA),
    mean_b: aB / (aB + bB),
    cred_int_a: [betaPpf(0.025, aA, bA), betaPpf(0.975, aA, bA)],
    cred_int_b: [betaPpf(0.025, aB, bB), betaPpf(0.975, aB, bB)],
    prob_b_beats_a: probBBeatsA(aA, bA, aB, bB),
    prob_b_beats_a_mc: wins / samples,
    expected_loss_b: lossB / samples,
    expected_loss_a: lossA / samples,
    uplift_mean: upliftSum / samples,
    uplift_cred_low: q(0.025),
    uplift_cred_high: q(0.975),
    n_samples: samples,
    pdf_curve,
  };
}

// ============================================================== decision rule
export type Verdict = "GO" | "NO-GO" | "KEEP RUNNING" | "STOP";

/** Same rule as backend/app/services/experiments.py::decide. */
export function decide(
  f: Pick<ProportionTest, "significant" | "relative_uplift" | "p_value_z" | "achieved_power">,
  b: Pick<BayesianResult, "prob_b_beats_a" | "expected_loss_b">,
  powerAtMde: number,
  opts: { alpha?: number; targetPower?: number; lossThreshold?: number; mde?: number; daysRemaining?: number | null } = {},
): { verdict: Verdict; headline: string; rationale: string } {
  const alpha = opts.alpha ?? 0.05;
  const target = opts.targetPower ?? 0.8;
  const thr = opts.lossThreshold ?? 0.001;
  const mde = opts.mde ?? 0.05;
  const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
  const prob = (p: number) => (p > 0.999 ? ">99.9%" : pct(p, 1));
  const pv = f.p_value_z < 0.001 ? f.p_value_z.toExponential(1) : f.p_value_z.toFixed(3);
  if (f.significant && f.relative_uplift > 0 && b.prob_b_beats_a >= 0.95 && b.expected_loss_b < thr)
    return {
      verdict: "GO",
      headline: "Roll out Variant B",
      rationale: `Statistically significant lift (p = ${pv} < α = ${alpha}), ${prob(b.prob_b_beats_a)} probability that B beats A and negligible expected loss.`,
    };
  if (f.significant && f.relative_uplift < 0)
    return { verdict: "NO-GO", headline: "Do not ship — variant is significantly worse", rationale: `B underperforms A (p = ${pv}).` };
  if (powerAtMde < target) {
    const eta = opts.daysRemaining ? ` ≈ ${Math.ceil(opts.daysRemaining)} more days at current traffic` : "";
    return {
      verdict: "KEEP RUNNING",
      headline: "Inconclusive — do not roll out yet",
      rationale: `p = ${pv} ≥ α and the test has only ${pct(powerAtMde)} power to detect a ${mde > 0 ? "+" : ""}${pct(mde)} effect (target ${pct(target)}). P(B>A) = ${prob(b.prob_b_beats_a)}; collect more data${eta}.`,
    };
  }
  return {
    verdict: "STOP",
    headline: "No meaningful effect detected",
    rationale: `The test had ${pct(powerAtMde)} power to detect a ${pct(mde)} effect and found none (p = ${pv}); keep control.`,
  };
}
