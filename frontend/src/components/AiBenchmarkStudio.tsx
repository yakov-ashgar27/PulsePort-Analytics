import { Beaker, Bot, Loader2, PlayCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { api } from "../api/client";
import { useApi } from "../hooks/useApi";
import { fmtInt, fmtMs, fmtP, fmtPct, fmtUsd } from "../lib/format";
import type { Benchmark, CategoryCell, ModelMetrics } from "../types/analytics";
import { Card, ErrorState, LegendItem, Loading, Pill, Select, TooltipBox } from "./ui";

// Colour follows the entity (model), never its rank — stable across filters.
const MODEL_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const colorFor = (models: string[], m: string) => MODEL_COLORS[Math.max(0, models.indexOf(m)) % MODEL_COLORS.length]!;

export default function AiBenchmarkStudio() {
  const [category, setCategory] = useState<string | null>(null);
  const bench = useApi((s) => api.benchmark(category, s), [category]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<Error | null>(null);
  const [lastBatch, setLastBatch] = useState<Benchmark["last_batch"]>(null);

  const runBatch = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.runBenchmark(40);
      setLastBatch(res.last_batch ?? null);
      if (category) bench.reload();
      else bench.setData(res);
    } catch (e) {
      setRunError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setRunning(false);
    }
  };

  if (bench.error) return <ErrorState error={bench.error} onRetry={bench.reload} />;
  if (!bench.data) return <Loading label="Loading benchmark…" />;
  const b = bench.data;
  // Stable model order (alphabetical) so colours never repaint when ranking changes.
  const modelOrder = [...b.models.map((m) => m.model)].sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Support category" value={category} options={b.categories} allLabel="All categories" onChange={setCategory} />
          <div className="tabular text-xs text-ink-3">
            {fmtInt(b.totals.runs)} graded answers · {fmtInt(b.totals.prompts)} prompts · {b.totals.batches} batch(es)
          </div>
          {b.simulated && (
            <Pill tone="warning">
              <Beaker className="h-3 w-3" aria-hidden /> Simulated evaluation data
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastBatch && <span className="text-xs text-ink-3">Last batch: +{lastBatch.runs} runs</span>}
          {runError && <span className="text-xs text-critical">{runError.message}</span>}
          <button
            onClick={runBatch}
            disabled={running}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60 dark:text-[#04261b]"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />}
            Simulate new prompt batch
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {b.models.map((m, i) => (
          <ModelCard key={m.model} m={m} rank={i + 1} color={colorFor(modelOrder, m.model)} guardrail={b.guardrail_hallucination_rate} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Accuracy vs cost"
          subtitle="Mean grounded accuracy (±95% t-CI) against cost per 1,000 tickets · upper-left is best"
          action={
            <div className="flex flex-wrap gap-3">
              {modelOrder.map((m) => (
                <LegendItem key={m} color={colorFor(modelOrder, m)} label={m} />
              ))}
            </div>
          }
        >
          <AccuracyCostScatter models={b.models} order={modelOrder} />
        </Card>
        <Card title="Hallucination rate" subtitle={`Wilson 95% CI · guardrail ${fmtPct(b.guardrail_hallucination_rate, 0)}`}>
          <HallucinationBars models={b.models} order={modelOrder} guardrail={b.guardrail_hallucination_rate} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Accuracy by maritime support category" subtitle="RANK() OVER (PARTITION BY category) · darker = higher accuracy">
          <CategoryMatrix cells={b.category_matrix} order={modelOrder} />
        </Card>
        <Card className="xl:col-span-2" title="Statistical tests" subtitle="Is the leader actually better, or is it noise?">
          <ul className="space-y-3 text-sm">
            <TestRow
              name="Kruskal-Wallis H (all models)"
              stat={b.tests.kruskal_h != null ? `H = ${b.tests.kruskal_h.toFixed(2)}` : "—"}
              p={b.tests.kruskal_p}
            />
            <TestRow
              name={b.tests.top_two ? `Welch t: ${b.tests.top_two[0]} vs ${b.tests.top_two[1]}` : "Welch t (top two)"}
              stat={b.tests.welch_t != null ? `t = ${b.tests.welch_t.toFixed(2)}` : "—"}
              p={b.tests.welch_p}
            />
            <TestRow
              name="χ² independence: model × hallucination"
              stat={b.tests.halluc_chi2 != null ? `χ² = ${b.tests.halluc_chi2.toFixed(2)}` : "—"}
              p={b.tests.halluc_p}
            />
          </ul>
          <p className="mt-4 text-[11px] text-ink-3">
            Non-parametric omnibus test first (accuracy scores are bounded and skewed), then a pairwise Welch test on the two leaders.
          </p>
        </Card>
      </div>
    </div>
  );
}

function ModelCard({ m, rank, color, guardrail }: { m: ModelMetrics; rank: number; color: string; guardrail: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}>
            <Bot className="h-4 w-4" style={{ color }} aria-hidden />
          </span>
          <div>
            <div className="font-semibold text-ink">{m.model}</div>
            <div className="text-[11px] text-ink-3">
              {m.vendor} · #{rank} by accuracy
            </div>
          </div>
        </div>
        {m.passes_guardrail ? (
          <Pill tone="good">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Guardrail
          </Pill>
        ) : (
          <Pill tone="critical">
            <ShieldAlert className="h-3 w-3" aria-hidden /> &gt; {fmtPct(guardrail, 0)}
          </Pill>
        )}
      </div>
      <dl className="tabular mt-3 grid grid-cols-2 gap-y-2 text-xs">
        <div>
          <dt className="text-ink-3">Accuracy (95% CI)</dt>
          <dd className="text-sm font-semibold text-ink">
            {m.mean_accuracy.toFixed(1)} <span className="text-xs font-normal text-ink-3">[{m.accuracy_ci_low.toFixed(1)}–{m.accuracy_ci_high.toFixed(1)}]</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Hallucination</dt>
          <dd className="text-sm font-semibold text-ink">{fmtPct(m.hallucination_rate, 1)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">P95 latency</dt>
          <dd className="text-sm font-semibold text-ink">{fmtMs(m.p95_latency_ms)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Cost / 1k tickets</dt>
          <dd className="text-sm font-semibold text-ink">{fmtUsd(m.cost_per_1k_usd)}</dd>
        </div>
      </dl>
    </div>
  );
}

function AccuracyCostScatter({ models, order }: { models: ModelMetrics[]; order: string[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 0 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="cost_per_1k_usd"
            name="Cost / 1k"
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            domain={[0, "auto"]}
            label={{ value: "Cost per 1,000 tickets (USD)", position: "insideBottom", offset: -8 }}
          />
          <YAxis type="number" dataKey="mean_accuracy" name="Accuracy" domain={["auto", "auto"]} width={44} />
          <ZAxis range={[140, 140]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const m = payload?.[0]?.payload as ModelMetrics | undefined;
              if (!active || !m) return null;
              return (
                <TooltipBox
                  title={m.model}
                  rows={[
                    { label: "Accuracy", value: `${m.mean_accuracy.toFixed(1)} ± ${(m.accuracy_ci_high - m.mean_accuracy).toFixed(1)}`, color: colorFor(order, m.model) },
                    { label: "Cost / 1k", value: fmtUsd(m.cost_per_1k_usd) },
                    { label: "P95 latency", value: fmtMs(m.p95_latency_ms) },
                    { label: "Accuracy / $", value: m.accuracy_per_dollar.toFixed(1) },
                  ]}
                />
              );
            }}
          />
          {models.map((m) => {
            const row = { ...m, err: [m.mean_accuracy - m.accuracy_ci_low, m.accuracy_ci_high - m.mean_accuracy] };
            return (
              <Scatter key={m.model} name={m.model} data={[row]} fill={colorFor(order, m.model)} stroke="var(--surface)" strokeWidth={2}>
                <ErrorBar dataKey="err" direction="y" width={6} stroke={colorFor(order, m.model)} strokeWidth={1.5} />
                <LabelList dataKey="model" position="right" offset={12} style={{ fill: "var(--text-2)", fontSize: 11 }} />
              </Scatter>
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function HallucinationBars({ models, order, guardrail }: { models: ModelMetrics[]; order: string[]; guardrail: number }) {
  const data = [...models]
    .sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model))
    .map((m) => ({
      model: m.model,
      rate: m.hallucination_rate * 100,
      err: [(m.hallucination_rate - m.hallucination_ci_low) * 100, (m.hallucination_ci_high - m.hallucination_rate) * 100],
      lo: m.hallucination_ci_low,
      hi: m.hallucination_ci_high,
    }));
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -8 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="model" tickLine={false} />
          <YAxis tickFormatter={(v: number) => `${v}%`} width={44} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <TooltipBox
                  title={p.model}
                  rows={[
                    { label: "Hallucination rate", value: `${p.rate.toFixed(1)}%`, color: colorFor(order, p.model) },
                    { label: "95% Wilson CI", value: `${fmtPct(p.lo, 1)} – ${fmtPct(p.hi, 1)}` },
                    { label: "Guardrail", value: fmtPct(guardrail, 0) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.model} fill={colorFor(order, d.model)} />
            ))}
            <ErrorBar dataKey="err" width={8} stroke="var(--text-2)" strokeWidth={1.5} />
            <LabelList dataKey="rate" position="insideTop" offset={8} formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} style={{ fill: "#fff", fontSize: 11, fontWeight: 600 }} />
          </Bar>
          {/* Recharts only renders direct children of known types, so the reference line is inline */}
          <ReferenceLine
            y={guardrail * 100}
            stroke="var(--critical)"
            strokeDasharray="5 4"
            label={{ value: `Guardrail ${(guardrail * 100).toFixed(0)}%`, position: "insideTopRight", fill: "var(--critical)", fontSize: 11 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryMatrix({ cells, order }: { cells: CategoryCell[]; order: string[] }) {
  const categories = [...new Set(cells.map((c) => c.category))];
  const lookup = new Map(cells.map((c) => [`${c.model}|${c.category}`, c]));
  const vals = cells.map((c) => Number(c.mean_accuracy));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // Sequential single-hue ramp (blue), light → dark with magnitude.
  const shade = (v: number) => 12 + ((v - min) / Math.max(max - min, 1e-9)) * 68;
  return (
    <div className="-mx-5 -mb-5 overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs text-ink-3">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            {order.map((m) => (
              <th key={m} className="px-3 py-2 text-center font-medium">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat} className="border-b border-line last:border-0">
              <td className="px-3 py-2 font-medium whitespace-nowrap text-ink">{cat}</td>
              {order.map((m) => {
                const c = lookup.get(`${m}|${cat}`);
                if (!c) return <td key={m} className="px-3 py-2 text-center text-ink-3">—</td>;
                const pct = shade(Number(c.mean_accuracy));
                return (
                  <td key={m} className="p-1">
                    <div
                      className="rounded-md px-2 py-1.5 text-center"
                      style={{ background: `color-mix(in oklab, var(--series-1) ${pct}%, var(--surface))`, color: pct > 45 ? "#fff" : "var(--text)" }}
                      title={`${m} · ${cat}: accuracy ${Number(c.mean_accuracy).toFixed(1)}, hallucination ${Number(c.hallucination_pct).toFixed(1)}%, n = ${c.n}`}
                    >
                      <div className="font-semibold">
                        {Number(c.mean_accuracy).toFixed(1)}
                        {c.rank_in_category === 1 && <span className="ml-1 text-[10px]">★</span>}
                      </div>
                      <div className="text-[10px] opacity-80">{Number(c.hallucination_pct).toFixed(1)}% halluc.</div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestRow({ name, stat, p }: { name: string; stat: string; p: number | null }) {
  const sig = p != null && p < 0.05;
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div>
        <div className="font-medium text-ink">{name}</div>
        <div className="tabular text-xs text-ink-3">
          {stat} · p = {fmtP(p)}
        </div>
      </div>
      <Pill tone={sig ? "good" : "neutral"}>{sig ? "Significant" : "Not sig."}</Pill>
    </li>
  );
}
