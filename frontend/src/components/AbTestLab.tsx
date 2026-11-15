import { Calculator, FlaskConical, Info, Sigma } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, IS_DEMO } from "../api/client";
import { useApi, useDebounced } from "../hooks/useApi";
import { fmtInt, fmtP, fmtPct, fmtProb } from "../lib/format";
import type { ExperimentAnalysis, PdfPoint, PowerAnalysisRequest } from "../types/analytics";
import { Card, ErrorState, LegendItem, Loading, NumberField, Pill, TooltipBox, VerdictBadge } from "./ui";

export default function AbTestLab() {
  const list = useApi((s) => api.experiments(s), []);
  const [selected, setSelected] = useState("EXP-01");
  const exp = useApi((s) => api.experiment(selected, s), [selected]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2" role="tablist" aria-label="Experiments">
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.data?.map((e) => (
          <button
            key={e.experiment_id}
            role="tab"
            aria-selected={selected === e.experiment_id}
            onClick={() => setSelected(e.experiment_id)}
            className={`rounded-xl border p-4 text-left shadow-sm transition ${
              selected === e.experiment_id ? "border-brand bg-surface ring-2 ring-brand/30" : "border-line bg-surface hover:border-ink-3"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold tracking-wide text-ink-3">{e.experiment_id}</div>
                <div className="mt-0.5 font-semibold text-ink">{e.name}</div>
                <div className="text-xs text-ink-3">{e.primary_metric}</div>
              </div>
              <VerdictBadge verdict={e.verdict} />
            </div>
            <div className="tabular mt-3 flex gap-5 text-xs text-ink-2">
              <span>
                Uplift <b className="text-ink">{fmtPct(e.relative_uplift, 1, true)}</b>
              </span>
              <span>
                p = <b className="text-ink">{fmtP(e.p_value)}</b>
              </span>
              <span>
                P(B&gt;A) <b className="text-ink">{fmtProb(e.prob_b_beats_a)}</b>
              </span>
            </div>
          </button>
        ))}
      </div>

      {exp.error ? <ErrorState error={exp.error} onRetry={exp.reload} /> : !exp.data ? <Loading /> : <ExperimentDetail e={exp.data} />}

      <SampleSizeCalculator
        key={exp.data?.experiment_id ?? "default"}
        defaultBaseline={exp.data?.frequentist.rate_a ?? 0.12}
        defaultTraffic={exp.data?.daily_traffic ?? 1400}
      />
    </div>
  );
}

export function ExperimentDetail({ e }: { e: ExperimentAnalysis }) {
  const f = e.frequentist;
  const b = e.bayesian;
  const mw = e.time_to_quote;
  const powered = e.power_at_mde >= 0.8;

  return (
    <>
      <section
        className={`rounded-xl border p-5 shadow-sm ${
          e.decision.verdict === "GO" ? "border-good/40 bg-good/5" : e.decision.verdict === "KEEP RUNNING" ? "border-warning/40 bg-warning/5" : "border-critical/40 bg-critical/5"
        }`}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-3">
          <VerdictBadge verdict={e.decision.verdict} size="lg" />
          <h2 className="text-lg font-semibold text-ink">{e.decision.headline}</h2>
        </div>
        <p className="mt-2 max-w-4xl text-sm text-ink-2">{e.decision.rationale}</p>
        <p className="mt-2 text-xs text-ink-3">
          {e.hypothesis && (
            <>
              <b>Hypothesis:</b> {e.hypothesis} ·{" "}
            </>
          )}
          {e.days_running > 0 ? `Running ${e.days_running} days · ≈${fmtInt(e.daily_traffic)} users/day` : "No timestamps: duration unknown"}
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Sigma className="h-4 w-4 text-ink-3" aria-hidden /> Frequentist inference
            </span>
          }
          subtitle="Pooled two-proportion z-test · Pearson χ² · Katz log-ratio CI · Cohen's h"
          action={
            <Pill tone={powered ? "good" : "warning"}>
              Power @ {fmtPct(e.mde_relative, 0, true)} MDE: {fmtPct(e.power_at_mde, 0)}
            </Pill>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <ArmBox color="var(--series-1)" label={`A · ${e.control_label}`} rate={f.rate_a} conv={f.conv_a} n={f.n_a} />
            <ArmBox color="var(--series-2)" label={`B · ${e.variant_label}`} rate={f.rate_b} conv={f.conv_b} n={f.n_b} />
          </div>

          <dl className="tabular mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <KV k="Relative uplift" v={fmtPct(f.relative_uplift, 2, true)} strong />
            <KV k="p-value (z)" v={fmtP(f.p_value_z)} strong />
            <KV k="z statistic" v={f.z_stat.toFixed(3)} />
            <KV k="χ² (p)" v={`${f.chi2_stat.toFixed(2)} (${fmtP(f.p_value_chi2)})`} />
            <KV k="Abs. diff 95% CI" v={`${fmtPct(f.abs_diff_ci_low, 2, true)} … ${fmtPct(f.abs_diff_ci_high, 2, true)}`} />
            <KV k="Cohen's h" v={f.cohens_h.toFixed(4)} />
            <KV k="Achieved power (obs.)" v={fmtPct(f.achieved_power, 0)} />
            <KV k="Significant at α" v={`${f.significant ? "Yes" : "No"} (α = ${f.alpha})`} />
            <KV
              k="Days to 80% power"
              v={e.days_remaining_for_power == null ? "—" : e.days_remaining_for_power === 0 ? "Reached" : `≈ ${e.days_remaining_for_power} days`}
            />
          </dl>

          <UpliftInterval lo={f.uplift_ci_low} hi={f.uplift_ci_high} point={f.relative_uplift} label="95% CI of relative uplift" />

          {mw && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
              <b className="text-ink">Secondary · {e.secondary_label ?? "time-to-quote"}</b> (Mann-Whitney U, skew-robust): median {mw.median_a.toFixed(1)} → {mw.median_b.toFixed(1)}, p ={" "}
              {fmtP(mw.p_value)}, rank-biserial r = {mw.rank_biserial.toFixed(3)}, Cohen's d = {mw.cohens_d.toFixed(3)}
            </div>
          )}
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-ink-3" aria-hidden /> Bayesian posterior
            </span>
          }
          subtitle={`Beta(1,1) prior → Beta(${fmtInt(b.alpha_a)}, ${fmtInt(b.beta_a)}) vs Beta(${fmtInt(b.alpha_b)}, ${fmtInt(b.beta_b)})`}
          action={
            <div className="flex gap-3">
              <LegendItem color="var(--series-1)" label="Control A" />
              <LegendItem color="var(--series-2)" label="Variant B" />
            </div>
          }
        >
          <PosteriorChart data={b.pdf_curve} meanA={b.mean_a} meanB={b.mean_b} />
          <dl className="tabular mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <KV k="P(B > A) · quadrature" v={fmtProb(b.prob_b_beats_a)} strong />
            <KV k="P(B > A) · Monte Carlo" v={fmtProb(b.prob_b_beats_a_mc)} />
            <KV k="Expected loss (ship B)" v={`${(b.expected_loss_b * 100).toFixed(4)} pp`} strong />
            <KV k="Expected loss (keep A)" v={`${(b.expected_loss_a * 100).toFixed(4)} pp`} />
            <KV k="Uplift 95% CrI" v={`${fmtPct(b.uplift_cred_low, 1, true)} … ${fmtPct(b.uplift_cred_high, 1, true)}`} />
            <KV k="MC draws" v={fmtInt(b.n_samples)} />
          </dl>
        </Card>
      </div>
    </>
  );
}

function ArmBox({ color, label, rate, conv, n }: { color: string; label: string; rate: number; conv: number; n: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{fmtPct(rate, 2)}</div>
      <div className="tabular text-xs text-ink-3">
        {fmtInt(conv)} / {fmtInt(n)}
      </div>
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-3">{k}</dt>
      <dd className={strong ? "font-semibold text-ink" : "text-ink-2"}>{v}</dd>
    </div>
  );
}

/** Horizontal CI strip with a zero line — shows at a glance whether the CI spans "no effect". */
function UpliftInterval({ lo, hi, point, label }: { lo: number; hi: number; point: number; label: string }) {
  const span = Math.max(Math.abs(lo), Math.abs(hi), 0.05) * 1.15;
  const pos = (x: number) => `${((x + span) / (2 * span)) * 100}%`;
  const crossesZero = lo < 0 && hi > 0;
  return (
    <figure className="mt-5" aria-label={`${label}: ${fmtPct(lo, 1)} to ${fmtPct(hi, 1)}`}>
      <figcaption className="mb-2 flex justify-between text-[11px] text-ink-3">
        <span>{label}</span>
        <span className={crossesZero ? "font-medium text-warning" : "font-medium text-good"}>
          {crossesZero ? "Interval includes 0 → inconclusive" : "Interval excludes 0"}
        </span>
      </figcaption>
      <div className="relative h-8">
        <div className="absolute top-1/2 h-px w-full bg-line" />
        <div className="absolute top-0 h-8 w-px bg-ink-3" style={{ left: pos(0) }} title="No effect" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-s2"
          style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-s2"
          style={{ left: pos(point) }}
        />
      </div>
      <div className="tabular flex justify-between text-[11px] text-ink-3">
        <span>{fmtPct(-span, 0)}</span>
        <span>0%</span>
        <span>{fmtPct(span, 0, true)}</span>
      </div>
    </figure>
  );
}

function PosteriorChart({ data, meanA, meanB }: { data: PdfPoint[]; meanA: number; meanB: number }) {
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} tickCount={6} />
          <YAxis tickFormatter={(v: number) => v.toFixed(0)} width={44} label={{ value: "density", angle: -90, position: "insideLeft", offset: 20 }} />
          <Tooltip
            cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as PdfPoint | undefined;
              if (!active || !p) return null;
              return (
                <TooltipBox
                  title={`Conversion rate ${(p.x * 100).toFixed(2)}%`}
                  rows={[
                    { label: "Control A", value: p.control_pdf.toFixed(1), color: "var(--series-1)" },
                    { label: "Variant B", value: p.variant_pdf.toFixed(1), color: "var(--series-2)" },
                  ]}
                />
              );
            }}
          />
          <Area isAnimationActive={false} type="monotone" dataKey="control_pdf" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.15} />
          <Area isAnimationActive={false} type="monotone" dataKey="variant_pdf" stroke="var(--series-2)" strokeWidth={2} fill="var(--series-2)" fillOpacity={0.15} />
          <ReferenceLine x={meanA} stroke="var(--series-1)" strokeDasharray="4 4" />
          <ReferenceLine x={meanB} stroke="var(--series-2)" strokeDasharray="4 4" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const MDE_GRID = [0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3];

function SampleSizeCalculator({ defaultBaseline, defaultTraffic }: { defaultBaseline: number; defaultTraffic: number }) {
  const [form, setForm] = useState<PowerAnalysisRequest>({
    baseline_rate: Number(defaultBaseline.toFixed(4)),
    mde_relative: 0.1,
    alpha: 0.05,
    power: 0.8,
    daily_traffic: Math.round(defaultTraffic),
  });
  const q = useDebounced(form, 350);
  const valid = q.baseline_rate > 0 && q.baseline_rate < 1 && q.mde_relative !== 0 && q.daily_traffic > 0;

  const result = useApi((s) => (valid ? api.powerAnalysis(q, s) : Promise.reject(new Error("Invalid inputs"))), [JSON.stringify(q)]);
  // Sample-size curve: same endpoint across a grid of MDEs (authoritative server maths, no client re-implementation)
  const curve = useApi(
    (s) =>
      valid
        ? Promise.all(MDE_GRID.map((m) => api.powerAnalysis({ ...q, mde_relative: m }, s))).then((rs) =>
            rs.map((r) => ({ mde: r.mde_relative * 100, n: r.sample_size_per_variant, days: r.estimated_days })),
          )
        : Promise.resolve([]),
    [JSON.stringify(q)],
  );
  const set = (k: keyof PowerAnalysisRequest) => (v: number) => setForm((f) => ({ ...f, [k]: v }));
  const r = result.data;
  const curveData = useMemo(() => curve.data ?? [], [curve.data]);

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Calculator className="h-4 w-4 text-ink-3" aria-hidden /> Sample size &amp; MDE calculator
        </span>
      }
      subtitle={IS_DEMO ? "Fleiss two-proportion formula · computed in-browser (parity-tested against the SciPy engine)" : "Fleiss two-proportion formula · POST /api/stats/power-analysis"}
    >
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Baseline conversion" value={+(form.baseline_rate * 100).toFixed(3)} step={0.1} min={0.1} max={99} suffix="%" onChange={(v) => set("baseline_rate")(v / 100)} />
            <NumberField label="MDE (relative)" value={+(form.mde_relative * 100).toFixed(2)} step={0.5} min={0.5} max={200} suffix="%" onChange={(v) => set("mde_relative")(v / 100)} />
            <NumberField label="Significance α" value={form.alpha} step={0.01} min={0.001} max={0.2} onChange={set("alpha")} />
            <NumberField label="Power 1−β" value={form.power} step={0.05} min={0.5} max={0.99} onChange={set("power")} />
            <div className="col-span-2">
              <NumberField label="Eligible traffic / day (all arms)" value={form.daily_traffic} step={100} min={1} max={1_000_000} onChange={set("daily_traffic")} />
            </div>
          </div>
          {result.error && valid ? (
            <ErrorState error={result.error} />
          ) : r ? (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-surface-2 p-3 text-center">
              <Big label="per variant" value={fmtInt(r.sample_size_per_variant)} />
              <Big label="total" value={fmtInt(r.total_sample_size)} />
              <Big label="days" value={r.estimated_days.toFixed(1)} />
              <p className="col-span-3 mt-1 text-[11px] text-ink-3">
                Detects {fmtPct(r.baseline_rate, 2)} → {fmtPct(r.target_rate, 2)} (Cohen's h = {r.cohens_h.toFixed(3)})
              </p>
            </div>
          ) : null}
          <p className="flex gap-1.5 text-[11px] text-ink-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Fix n before launch and don't stop the moment p dips below α. Peeking at results inflates the false-positive rate.
          </p>
        </div>
        <div className="lg:col-span-3">
          <div className="mb-1 text-xs text-ink-3">Required sample size per variant vs MDE (log scale)</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={curveData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="mde" type="number" scale="log" domain={["dataMin", "dataMax"]} ticks={MDE_GRID.map((m) => m * 100)} tickFormatter={(v: number) => `${v}%`} />
                <YAxis scale="log" domain={["auto", "auto"]} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} width={48} />
                <Tooltip
                  cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as { mde: number; n: number; days: number } | undefined;
                    if (!active || !p) return null;
                    return (
                      <TooltipBox
                        title={`MDE +${p.mde}%`}
                        rows={[
                          { label: "n per variant", value: fmtInt(p.n), color: "var(--series-1)" },
                          { label: "Days", value: p.days.toFixed(1) },
                        ]}
                      />
                    );
                  }}
                />
                {r && <ReferenceLine x={r.mde_relative * 100} stroke="var(--series-2)" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="n" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tabular text-xl font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}
