// Mirrors backend/app/schemas.py (Pydantic v2 response models).

export type Verdict = "GO" | "NO-GO" | "KEEP RUNNING" | "STOP" | "CONDITIONAL" | "ACTION REQUIRED" | "OK";

export interface Filters {
  region: string | null;
  device_type: string | null;
  date_from: string | null;
  date_to: string | null;
}

export interface Meta {
  regions: string[];
  device_types: string[];
  experiments: string[];
  ai_categories: string[];
  quote_sla_ms: number;
}

export interface Kpis {
  total_sessions: number;
  bookings: number;
  booking_conversion_pct: number | null;
  avg_quote_time_s: number | null;
  p95_quote_time_s: number | null;
  active_experiments: number;
}

export interface FunnelStep {
  step_order: number;
  stage: string;
  sessions: number;
  prev_sessions: number | null;
  step_conversion_pct: number | null;
  step_dropoff_pct: number | null;
  cumulative_conversion_pct: number | null;
}

export interface RegionRow {
  region: string;
  device_type: string;
  sessions: number;
  searches: number;
  quotes: number;
  bookings: number;
  search_to_quote_pct: number | null;
  booking_conversion_pct: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  global_search_to_quote_pct: number | null;
  delta_vs_global_pp: number | null;
  dropoff_rank: number;
  sla_breach: boolean | null;
}

export interface BottleneckRow {
  region: string;
  searches: number;
  quotes: number;
  quote_rate_pct: number;
  global_quote_rate_pct: number;
  p95_latency_ms: number;
  p95_mobile_ms: number | null;
  p95_desktop_ms: number | null;
  global_p95_ms: number;
  latency_conv_corr: number | null;
  cross_region_corr: number | null;
  sla_breach: boolean;
  is_bottleneck: boolean;
  p_value_vs_rest: number | null;
  rate_diff_vs_rest_pp: number | null;
  significant: boolean;
}

export interface TrendPoint {
  day: string;
  sessions: number;
  bookings: number;
  conversion_pct: number | null;
  sessions_ma7: number | null;
  conversion_ma7_pct: number | null;
}

export interface Frequentist {
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
}

export interface PdfPoint {
  x: number;
  control_pdf: number;
  variant_pdf: number;
}

export interface Bayesian {
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
  pdf_curve: PdfPoint[];
}

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
  significant: boolean;
  alpha: number;
}

export interface Decision {
  verdict: Verdict;
  headline: string;
  rationale: string;
}

export interface ExperimentAnalysis {
  experiment_id: string;
  name: string;
  hypothesis: string;
  control_label: string;
  variant_label: string;
  primary_metric: string;
  days_running: number;
  daily_traffic: number;
  required_n_per_arm_observed_effect: number | null;
  days_remaining_for_power: number | null;
  mde_relative: number;
  power_at_mde: number;
  frequentist: Frequentist;
  bayesian: Bayesian;
  time_to_quote: ContinuousTest;
  decision: Decision;
}

export interface ExperimentSummary {
  experiment_id: string;
  name: string;
  primary_metric: string;
  relative_uplift: number;
  p_value: number;
  prob_b_beats_a: number;
  verdict: Verdict;
}

export interface PowerAnalysisRequest {
  baseline_rate: number;
  mde_relative: number;
  alpha: number;
  power: number;
  daily_traffic: number;
}

export interface PowerAnalysis extends PowerAnalysisRequest {
  target_rate: number;
  sample_size_per_variant: number;
  total_sample_size: number;
  estimated_days: number;
  cohens_h: number;
}

export interface ModelMetrics {
  model: string;
  vendor: string;
  n: number;
  mean_accuracy: number;
  accuracy_ci_low: number;
  accuracy_ci_high: number;
  hallucination_rate: number;
  hallucination_ci_low: number;
  hallucination_ci_high: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  cost_per_1k_usd: number;
  accuracy_per_dollar: number;
  passes_guardrail: boolean;
}

export interface ModelTests {
  kruskal_h: number | null;
  kruskal_p: number | null;
  top_two: string[] | null;
  welch_t: number | null;
  welch_p: number | null;
  halluc_chi2: number | null;
  halluc_p: number | null;
}

export interface CategoryCell {
  model: string;
  category: string;
  n: number;
  mean_accuracy: number;
  hallucination_pct: number;
  rank_in_category: number;
}

export interface Benchmark {
  category: string | null;
  categories: string[];
  guardrail_hallucination_rate: number;
  models: ModelMetrics[];
  tests: ModelTests;
  category_matrix: CategoryCell[];
  totals: { runs: number; prompts: number; batches: number; last_run_at: string | null };
  simulated: boolean;
  last_batch?: { batch_id: string; prompts: number; runs: number } | null;
}

export interface BriefSection {
  id: string;
  title: string;
  hypothesis: string;
  evidence: string[];
  risk: string;
  verdict: Verdict;
  recommendation: string;
}

export interface ExecutiveBrief {
  title: string;
  generated_at: string;
  alpha: number;
  power: number;
  sections: BriefSection[];
  markdown: string;
}
