"""Pydantic v2 request / response contracts."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------- requests
class PowerAnalysisRequest(BaseModel):
    baseline_rate: float = Field(0.12, gt=0, lt=1, description="Control conversion rate")
    mde_relative: float = Field(0.10, description="Minimum detectable effect, relative (0.1 = +10%)")
    alpha: float = Field(0.05, gt=0, lt=0.5)
    power: float = Field(0.80, gt=0.5, lt=1)
    daily_traffic: float = Field(1500, gt=0, description="Eligible users per day (all arms)")

    @field_validator("mde_relative")
    @classmethod
    def _mde(cls, v: float) -> float:
        if v == 0 or v <= -1:
            raise ValueError("mde_relative must be non-zero and > -1")
        return v


class BenchmarkRunRequest(BaseModel):
    n_prompts: int = Field(40, ge=4, le=500)


# ---------------------------------------------------------------- responses
class Kpis(_Out):
    total_sessions: int
    bookings: int
    booking_conversion_pct: float | None
    avg_quote_time_s: float | None
    p95_quote_time_s: float | None
    active_experiments: int


class FunnelStep(_Out):
    step_order: int
    stage: str
    sessions: int
    prev_sessions: int | None
    step_conversion_pct: float | None
    step_dropoff_pct: float | None
    cumulative_conversion_pct: float | None


class RegionRow(_Out):
    region: str
    device_type: str
    sessions: int
    searches: int
    quotes: int
    bookings: int
    search_to_quote_pct: float | None
    booking_conversion_pct: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    global_search_to_quote_pct: float | None
    delta_vs_global_pp: float | None
    dropoff_rank: int
    sla_breach: bool | None


class BottleneckRow(_Out):
    region: str
    searches: int
    quotes: int
    quote_rate_pct: float
    global_quote_rate_pct: float
    p95_latency_ms: float
    p95_mobile_ms: float | None
    p95_desktop_ms: float | None
    global_p95_ms: float
    latency_conv_corr: float | None
    cross_region_corr: float | None
    sla_breach: bool
    is_bottleneck: bool
    p_value_vs_rest: float | None
    rate_diff_vs_rest_pp: float | None
    significant: bool


class TrendPoint(_Out):
    day: date
    sessions: int
    bookings: int
    conversion_pct: float | None
    sessions_ma7: float | None
    conversion_ma7_pct: float | None


class FrequentistOut(_Out):
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


class PdfPoint(_Out):
    x: float
    control_pdf: float
    variant_pdf: float


class BayesianOut(_Out):
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
    pdf_curve: list[PdfPoint]


class ContinuousOut(_Out):
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


class Decision(_Out):
    verdict: str
    headline: str
    rationale: str


class ExperimentAnalysis(_Out):
    experiment_id: str
    name: str
    hypothesis: str
    control_label: str
    variant_label: str
    primary_metric: str
    days_running: float
    daily_traffic: float
    required_n_per_arm_observed_effect: int | None
    days_remaining_for_power: int | None
    mde_relative: float
    power_at_mde: float
    frequentist: FrequentistOut
    bayesian: BayesianOut
    time_to_quote: ContinuousOut
    decision: Decision


class ExperimentSummary(_Out):
    experiment_id: str
    name: str
    primary_metric: str
    relative_uplift: float
    p_value: float
    prob_b_beats_a: float
    verdict: str


class PowerAnalysisOut(_Out):
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


class ModelMetrics(_Out):
    model: str
    vendor: str
    n: int
    mean_accuracy: float
    accuracy_ci_low: float
    accuracy_ci_high: float
    hallucination_rate: float
    hallucination_ci_low: float
    hallucination_ci_high: float
    p50_latency_ms: float
    p95_latency_ms: float
    cost_per_1k_usd: float
    accuracy_per_dollar: float
    passes_guardrail: bool


class ModelTests(_Out):
    kruskal_h: float | None
    kruskal_p: float | None
    top_two: list[str] | None
    welch_t: float | None
    welch_p: float | None
    halluc_chi2: float | None
    halluc_p: float | None


class CategoryCell(_Out):
    model: str
    category: str
    n: int
    mean_accuracy: float
    hallucination_pct: float
    rank_in_category: int


class RunTotals(_Out):
    runs: int
    prompts: int
    batches: int
    last_run_at: datetime | None


class LastBatch(_Out):
    batch_id: str
    prompts: int
    runs: int


class BenchmarkOut(_Out):
    category: str | None
    categories: list[str]
    guardrail_hallucination_rate: float
    models: list[ModelMetrics]
    tests: ModelTests
    category_matrix: list[CategoryCell]
    totals: RunTotals
    simulated: bool
    last_batch: LastBatch | None = None


class BriefSection(_Out):
    id: str
    title: str
    hypothesis: str
    evidence: list[str]
    risk: str
    verdict: str
    recommendation: str


class ExecutiveBrief(_Out):
    title: str
    generated_at: str
    alpha: float
    power: float
    sections: list[BriefSection]
    markdown: str


class Meta(_Out):
    regions: list[str]
    device_types: list[str]
    experiments: list[str]
    ai_categories: list[str]
    quote_sla_ms: int
