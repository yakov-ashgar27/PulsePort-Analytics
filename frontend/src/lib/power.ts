/**
 * In-browser port of backend/app/stats_engine/frequentist.py::power_analysis.
 *
 * Used only by the static (GitHub Pages) demo, where there is no API server.
 * Parity with the Python engine is enforced by power.test.ts against fixtures
 * exported from the real API in CI.
 */

export interface PowerInput {
  baseline_rate: number;
  mde_relative: number;
  alpha: number;
  power: number;
  daily_traffic: number;
}

export interface PowerOutput extends PowerInput {
  target_rate: number;
  sample_size_per_variant: number;
  total_sample_size: number;
  estimated_days: number;
  cohens_h: number;
}

/**
 * Inverse standard-normal CDF — Acklam's rational approximation
 * (|relative error| < 1.15e-9 over the whole domain), ample for integer
 * sample sizes; parity with SciPy is asserted by power.test.ts.
 */
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
  return x;
}

export function cohensH(p1: number, p2: number): number {
  return 2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1));
}

export function requiredSampleSize(baseline: number, target: number, alpha = 0.05, power = 0.8): number {
  if (!(baseline > 0 && baseline < 1) || !(target > 0 && target < 1)) throw new RangeError("rates must be in (0, 1)");
  if (baseline === target) throw new RangeError("baseline and target must differ");
  const zA = normPpf(1 - alpha / 2);
  const zB = normPpf(power);
  const pBar = (baseline + target) / 2;
  const num = (zA * Math.sqrt(2 * pBar * (1 - pBar)) + zB * Math.sqrt(baseline * (1 - baseline) + target * (1 - target))) ** 2;
  // Guard against 1-ulp float noise flipping Math.ceil at integer boundaries
  return Math.ceil(num / (target - baseline) ** 2 - 1e-9);
}

export function powerAnalysis(req: PowerInput): PowerOutput {
  const target = req.baseline_rate * (1 + req.mde_relative);
  const n = requiredSampleSize(req.baseline_rate, target, req.alpha, req.power);
  const total = n * 2;
  return {
    ...req,
    target_rate: target,
    sample_size_per_variant: n,
    total_sample_size: total,
    estimated_days: Math.ceil((total / req.daily_traffic) * 10) / 10,
    cohens_h: cohensH(req.baseline_rate, target),
  };
}
