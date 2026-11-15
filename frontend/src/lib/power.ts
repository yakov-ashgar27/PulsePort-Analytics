/**
 * Sample-size calculator used by the static demo (no API server).
 * Thin wrapper over the parity-tested browser stats library.
 */
import { cohensH, normPpf, requiredSampleSize } from "./stats.ts";

export { normPpf };

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
