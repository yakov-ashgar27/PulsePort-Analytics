import { AlertTriangle, ArrowDown, Gauge, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, IS_DEMO } from "../api/client";
import { useApi } from "../hooks/useApi";
import { fmtInt, fmtMs, fmtP, fmtPct100, stageLabel } from "../lib/format";
import type { Filters, Meta, RegionRow, TrendPoint } from "../types/analytics";
import { Card, ErrorState, LegendItem, Loading, Pill, Select, TooltipBox } from "./ui";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  meta: Meta;
}

export default function FunnelAnalytics({ filters, setFilters, meta }: Props) {
  const key = JSON.stringify(filters);
  const funnel = useApi((s) => api.funnel(filters, s), [key]);
  const regions = useApi((s) => api.regions(filters, s), [key]);
  const bottlenecks = useApi((s) => api.bottlenecks(filters, s), [key]);
  const trend = useApi((s) => api.trend(filters, s), [key]);

  return (
    <div className="space-y-5">
      {/* Filters: one row above all charts */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <Select
          label="Regional agency"
          value={filters.region}
          options={meta.regions}
          allLabel="All regions"
          onChange={(region) => setFilters({ ...filters, region })}
        />
        <Select
          label="Device"
          value={filters.device_type}
          options={meta.device_types}
          allLabel="All devices"
          onChange={(device_type) => setFilters({ ...filters, device_type })}
        />
        {!IS_DEMO && (
          <>
            <DateField label="From" value={filters.date_from} onChange={(date_from) => setFilters({ ...filters, date_from })} />
            <DateField label="To (exclusive)" value={filters.date_to} onChange={(date_to) => setFilters({ ...filters, date_to })} />
          </>
        )}
        <button
          className="h-9 rounded-lg border border-line px-3 text-sm text-ink-2 hover:bg-surface-2"
          onClick={() => setFilters({ region: null, device_type: null, date_from: null, date_to: null })}
        >
          Reset
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card
          className="xl:col-span-2"
          title="Booking funnel"
          subtitle="Distinct sessions per stage · step conversion via SQL LAG() window function"
        >
          {funnel.error ? (
            <ErrorState error={funnel.error} onRetry={funnel.reload} />
          ) : !funnel.data ? (
            <Loading />
          ) : (
            <ol className="space-y-1" aria-label="Conversion funnel">
              {funnel.data.map((s, i) => {
                const width = s.cumulative_conversion_pct ?? 100;
                return (
                  <li key={s.stage}>
                    {i > 0 && (
                      <div className="flex items-center gap-2 py-1 pl-2 text-xs text-ink-3">
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        <span className="tabular">
                          {fmtPct100(s.step_conversion_pct)} continue ·{" "}
                          <span className={Number(s.step_dropoff_pct) > 50 ? "font-medium text-critical" : ""}>
                            {fmtPct100(s.step_dropoff_pct)} drop off
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="h-9 flex-1 rounded-md bg-surface-2">
                        <div
                          className="flex h-9 items-center rounded-md bg-s1 px-3 text-xs font-medium whitespace-nowrap text-white transition-[width] duration-500"
                          style={{ width: `${Math.max(width, 6)}%` }}
                          title={`${stageLabel(s.stage)}: ${fmtInt(s.sessions)} sessions`}
                        >
                          {stageLabel(s.stage)}
                        </div>
                      </div>
                      <div className="tabular w-28 text-right">
                        <div className="text-sm font-semibold text-ink">{fmtInt(s.sessions)}</div>
                        <div className="text-[11px] text-ink-3">{fmtPct100(s.cumulative_conversion_pct)} of visits</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card
          className="xl:col-span-3"
          title="Booking conversion trend"
          subtitle="Daily conversion with 7-day moving average (SQL window frame ROWS 6 PRECEDING)"
          action={
            <div className="flex gap-3">
              <LegendItem color="var(--series-1)" label="7-day MA" />
              <LegendItem color="var(--text-3)" label="Daily" dashed />
            </div>
          }
        >
          {trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : !trend.data ? <Loading /> : <TrendChart data={trend.data} />}
        </Card>
      </div>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Gauge className="h-4 w-4 text-ink-3" aria-hidden /> Quote-latency bottleneck detector
          </span>
        }
        subtitle={`PERCENTILE_CONT(0.95) per region vs ${fmtMs(meta.quote_sla_ms)} SLA · two-proportion z-test of search→quote rate vs all other regions`}
      >
        {bottlenecks.error ? (
          <ErrorState error={bottlenecks.error} onRetry={bottlenecks.reload} />
        ) : !bottlenecks.data ? (
          <Loading />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bottlenecks.data.map((b) => (
              <div
                key={b.region}
                className={`rounded-lg border p-3.5 ${b.is_bottleneck ? "border-critical/50 bg-critical/5" : "border-line bg-surface-2"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{b.region}</span>
                  {b.is_bottleneck ? (
                    <Pill tone="critical">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> Bottleneck
                    </Pill>
                  ) : b.sla_breach ? (
                    <Pill tone="warning">SLA breach</Pill>
                  ) : (
                    <Pill tone="good">Within SLA</Pill>
                  )}
                </div>
                <dl className="tabular mt-2.5 grid grid-cols-3 gap-2 text-xs">
                  <Metric label="P95 latency" value={fmtMs(b.p95_latency_ms)} strong={b.sla_breach} />
                  <Metric label="P95 mobile" value={fmtMs(b.p95_mobile_ms)} />
                  <Metric label="Search→quote" value={fmtPct100(b.quote_rate_pct)} />
                  <Metric
                    label="Δ vs rest"
                    value={b.rate_diff_vs_rest_pp == null ? "—" : `${b.rate_diff_vs_rest_pp > 0 ? "+" : ""}${b.rate_diff_vs_rest_pp.toFixed(1)} pp`}
                  />
                  <Metric label="p-value" value={fmtP(b.p_value_vs_rest)} />
                  <Metric label="r(latency, conv)" value={b.latency_conv_corr == null ? "—" : Number(b.latency_conv_corr).toFixed(2)} />
                </dl>
              </div>
            ))}
          </div>
        )}
        {bottlenecks.data?.[0]?.cross_region_corr != null && (
          <p className="mt-3 text-xs text-ink-3">
            Cross-region Pearson correlation between P95 latency and search→quote rate:{" "}
            <span className="tabular font-semibold text-ink">r = {Number(bottlenecks.data[0].cross_region_corr).toFixed(2)}</span>
          </p>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <TableProperties className="h-4 w-4 text-ink-3" aria-hidden /> Regional agency performance
          </span>
        }
        subtitle="Region × device · ranked by search→quote drop-off (RANK() OVER) · Δ vs traffic-weighted global rate (SUM() OVER ())"
      >
        {regions.error ? <ErrorState error={regions.error} onRetry={regions.reload} /> : !regions.data ? <Loading /> : <RegionTable rows={regions.data} />}
      </Card>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${strong ? "text-critical" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {label}
      <input
        type="date"
        className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none"
        value={value ? value.slice(0, 10) : ""}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T00:00:00Z` : null)}
      />
    </label>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const rows = useMemo(
    () => data.map((d) => ({ ...d, conversion_pct: Number(d.conversion_pct), conversion_ma7_pct: Number(d.conversion_ma7_pct) })),
    [data],
  );
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
          <YAxis tickFormatter={(v: number) => `${v}%`} domain={["auto", "auto"]} width={52} />
          <Tooltip
            cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as TrendPoint | undefined;
              if (!active || !p) return null;
              return (
                <TooltipBox
                  title={p.day}
                  rows={[
                    { label: "7-day MA", value: fmtPct100(p.conversion_ma7_pct, 2), color: "var(--series-1)" },
                    { label: "Daily", value: fmtPct100(p.conversion_pct, 2), color: "var(--text-3)" },
                    { label: "Sessions", value: fmtInt(p.sessions) },
                    { label: "Bookings", value: fmtInt(p.bookings) },
                  ]}
                />
              );
            }}
          />
          <Line type="monotone" dataKey="conversion_pct" stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="conversion_ma7_pct" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type SortKey = "dropoff_rank" | "sessions" | "booking_conversion_pct" | "p95_latency_ms";

function RegionTable({ rows }: { rows: RegionRow[] }) {
  const [sort, setSort] = useState<SortKey>("dropoff_rank");
  const sorted = useMemo(() => {
    const dir = sort === "dropoff_rank" ? 1 : -1;
    return [...rows].sort((a, b) => dir * (Number(a[sort] ?? 0) - Number(b[sort] ?? 0)));
  }, [rows, sort]);
  const th = (k: SortKey, label: string) => (
    <th className="px-3 py-2 text-right font-medium">
      <button className={`hover:text-ink ${sort === k ? "text-ink" : ""}`} onClick={() => setSort(k)}>
        {label}
        {sort === k ? " ↓" : ""}
      </button>
    </th>
  );
  return (
    <div className="-mx-5 -mb-5 overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs text-ink-3">
          <tr>
            {th("dropoff_rank", "Rank")}
            <th className="px-3 py-2 text-left font-medium">Region</th>
            <th className="px-3 py-2 text-left font-medium">Device</th>
            {th("sessions", "Sessions")}
            <th className="px-3 py-2 text-right font-medium">Search→Quote</th>
            <th className="px-3 py-2 text-right font-medium">Δ vs global</th>
            {th("booking_conversion_pct", "Booking conv.")}
            <th className="px-3 py-2 text-right font-medium">P50 latency</th>
            {th("p95_latency_ms", "P95 latency")}
            <th className="px-3 py-2 text-left font-medium">SLA</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const delta = Number(r.delta_vs_global_pp);
            return (
              <tr key={`${r.region}-${r.device_type}`} className={`border-b border-line last:border-0 ${r.sla_breach ? "bg-critical/5" : ""}`}>
                <td className="px-3 py-2 text-right text-ink-3">{r.dropoff_rank}</td>
                <td className="px-3 py-2 font-medium text-ink">{r.region}</td>
                <td className="px-3 py-2 text-ink-2">{r.device_type}</td>
                <td className="px-3 py-2 text-right">{fmtInt(r.sessions)}</td>
                <td className="px-3 py-2 text-right">{fmtPct100(r.search_to_quote_pct)}</td>
                <td className={`px-3 py-2 text-right font-medium ${delta < -5 ? "text-critical" : "text-ink-2"}`}>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)} pp
                </td>
                <td className="px-3 py-2 text-right">{fmtPct100(r.booking_conversion_pct, 2)}</td>
                <td className="px-3 py-2 text-right text-ink-2">{fmtMs(r.p50_latency_ms)}</td>
                <td className={`px-3 py-2 text-right font-medium ${r.sla_breach ? "text-critical" : ""}`}>{fmtMs(r.p95_latency_ms)}</td>
                <td className="px-3 py-2">
                  {r.sla_breach ? (
                    <Pill tone="critical">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> Breach
                    </Pill>
                  ) : (
                    <Pill tone="good">OK</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
