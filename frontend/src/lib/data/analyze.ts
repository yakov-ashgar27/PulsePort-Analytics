/**
 * Analyses for user-supplied data. Each analysis returns structured results
 * plus a ranked list of plain-language insights backed by statistical tests.
 *
 * Rigor built in:
 *  • Benjamini–Hochberg FDR control across all segment × step comparisons
 *  • Holm correction across multiple variants
 *  • Sample-ratio-mismatch (SRM) check before trusting any A/B result
 *  • Fisher's exact test when expected cell counts are small
 *  • Minimum-sample guards and explicit data-quality reporting
 */
import * as S from "../stats.ts";
import type { Table } from "./csv.ts";
import { type Mapping, parseBool, parseNum, parseTime } from "./detect.ts";

export type Level = "critical" | "warning" | "good" | "info";
export interface Insight {
  level: Level;
  title: string;
  detail: string;
  impact?: number; // used for ranking
}

export interface DataQuality {
  rows: number;
  used: number;
  dropped: { reason: string; count: number }[];
}

const MIN_SEGMENT = 30;
const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmtP = (p: number) => (p < 0.0001 ? "< 0.0001" : p < 0.01 ? p.toFixed(4) : p.toFixed(3));
const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
const col = (t: Table, name?: string) => (name ? t.headers.indexOf(name) : -1);
const rank = (xs: Insight[]) => {
  const w: Record<Level, number> = { critical: 3, warning: 2, good: 1, info: 0 };
  return xs.sort((a, b) => w[b.level] - w[a.level] || (b.impact ?? 0) - (a.impact ?? 0));
};

// ===================================================================== EVENTS
export interface FunnelStepResult {
  step_order: number;
  stage: string;
  sessions: number;
  step_conversion_pct: number | null;
  step_dropoff_pct: number | null;
  cumulative_conversion_pct: number;
}

export interface SegmentFinding {
  dimension: string;
  value: string;
  transition: string;
  from_stage: string;
  entries: number;
  rate: number;
  rest_rate: number;
  diff_pp: number;
  p: number;
  q: number;
  lost_conversions: number;
}

export interface SegmentRow {
  dimension: string;
  value: string;
  sessions: number;
  conversions: number;
  conversion_rate: number;
  delta_vs_rest_pp: number;
  p: number;
  q: number;
  p95_latency: number | null;
}

export interface EventsResult {
  kind: "events";
  quality: DataQuality;
  stages_detected: { stage: string; sessions: number }[];
  stage_order: string[];
  funnel: FunnelStepResult[];
  sessions: number;
  conversions: number;
  conversion_rate: number;
  segments: SegmentRow[];
  findings: SegmentFinding[];
  latency: { worst_step: string; r: number; p: number; n: number; p50: number; p95: number } | null;
  trend: { day: string; sessions: number; conversions: number; conversion_pct: number; conversion_ma7_pct: number }[];
  period_change: { last: number; prev: number; p: number } | null;
  insights: Insight[];
}

export function detectStages(t: Table, m: Mapping): { stage: string; sessions: number }[] {
  const si = col(t, m.session_id);
  const ei = col(t, m.step);
  const per = new Map<string, Set<string>>();
  for (const r of t.rows) {
    const s = r[si];
    const e = r[ei];
    if (!s || !e) continue;
    if (!per.has(e)) per.set(e, new Set());
    per.get(e)!.add(s);
  }
  return [...per.entries()].map(([stage, set]) => ({ stage, sessions: set.size })).sort((a, b) => b.sessions - a.sessions);
}

export function analyzeEvents(t: Table, m: Mapping, stageOrder?: string[]): EventsResult {
  const si = col(t, m.session_id);
  const ei = col(t, m.step);
  const ti = col(t, m.timestamp);
  const li = col(t, m.latency);
  const baseSegs = (m.segments ?? []).map((name) => ({ name, i: col(t, name) })).filter((c) => c.i >= 0);
  // Single dimensions plus every pair (e.g. region × device): problems often live in an interaction
  const segCols: { name: string; get: (r: string[]) => string }[] = baseSegs.map((c) => ({ name: c.name, get: (r: string[]) => r[c.i] || "(blank)" }));
  for (let a = 0; a < baseSegs.length; a++)
    for (let b = a + 1; b < baseSegs.length; b++) {
      const x = baseSegs[a]!;
      const y = baseSegs[b]!;
      segCols.push({ name: `${x.name} × ${y.name}`, get: (r: string[]) => `${r[x.i] || "(blank)"} · ${r[y.i] || "(blank)"}` });
    }
  const detected = detectStages(t, m);
  const order = (stageOrder?.length ? stageOrder : detected.slice(0, 6).map((d) => d.stage)).filter((s) => detected.some((d) => d.stage === s));
  if (order.length < 2) throw new Error("Pick at least two funnel steps.");
  const ordIdx = new Map(order.map((s, i) => [s, i]));

  // ---- parse
  let missing = 0;
  let badTime = 0;
  const sessions = new Map<string, { ev: [number, number, number][]; seg: string[]; lat: number[] }>();
  t.rows.forEach((r, rowNo) => {
    const s = r[si];
    const e = r[ei];
    if (!s || !e) {
      missing++;
      return;
    }
    let ts = rowNo;
    if (ti >= 0) {
      ts = parseTime(r[ti] ?? "");
      if (!Number.isFinite(ts)) {
        badTime++;
        return;
      }
    }
    let sess = sessions.get(s);
    if (!sess) {
      sess = { ev: [], seg: segCols.map((c) => c.get(r)), lat: [] };
      sessions.set(s, sess);
    }
    const k = ordIdx.get(e);
    sess.ev.push([ts, k ?? -1, rowNo]);
    if (li >= 0) {
      const v = parseNum(r[li] ?? "");
      if (Number.isFinite(v)) sess.lat.push(v);
    }
  });

  // ---- ordered funnel: walk events chronologically, advance when the next expected step occurs
  const recs: { depth: number; seg: string[]; lat: number; start: number }[] = [];
  for (const sess of sessions.values()) {
    sess.ev.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let depth = -1;
    for (const [, k] of sess.ev) if (k === depth + 1) depth = k;
    if (depth < 0) continue; // never entered the funnel
    recs.push({ depth, seg: sess.seg, lat: sess.lat.length ? Math.max(...sess.lat) : NaN, start: sess.ev[0]![0] });
  }
  const n = recs.length;
  if (!n) throw new Error("No session reached the first funnel step — check the step order.");
  const reach = order.map((_, k) => recs.filter((r) => r.depth >= k).length);
  const funnel: FunnelStepResult[] = order.map((stage, k) => ({
    step_order: k + 1,
    stage,
    sessions: reach[k]!,
    step_conversion_pct: k ? (100 * reach[k]!) / Math.max(reach[k - 1]!, 1) : null,
    step_dropoff_pct: k ? 100 - (100 * reach[k]!) / Math.max(reach[k - 1]!, 1) : null,
    cumulative_conversion_pct: (100 * reach[k]!) / reach[0]!,
  }));
  const last = order.length - 1;
  const conversions = reach[last]!;
  const insights: Insight[] = [];

  // worst transition
  let worst = 1;
  for (let k = 1; k <= last; k++) if (funnel[k]!.step_conversion_pct! < funnel[worst]!.step_conversion_pct!) worst = k;
  insights.push({
    level: "warning",
    title: `Biggest drop-off: ${order[worst - 1]} → ${order[worst]}`,
    detail: `${fmtPct(1 - reach[worst]! / reach[worst - 1]!)} of sessions that reach "${order[worst - 1]}" never reach "${order[worst]}" (${fmtN(reach[worst - 1]! - reach[worst]!)} sessions). End-to-end conversion is ${fmtPct(conversions / n, 2)}.`,
    impact: reach[worst - 1]! - reach[worst]!,
  });

  // downstream conversion from stage k (used to translate a step gap into lost conversions)
  const downstream = (k: number) => (reach[k]! ? conversions / reach[k]! : 0);

  // ---- segments: every dimension × value × transition, with FDR control
  const findings: SegmentFinding[] = [];
  const segRows: SegmentRow[] = [];
  segCols.forEach((c, d) => {
    const values = new Map<string, typeof recs>();
    for (const r of recs) {
      const v = r.seg[d]!;
      if (!values.has(v)) values.set(v, []);
      values.get(v)!.push(r);
    }
    for (const [value, rs] of values) {
      if (rs.length < MIN_SEGMENT || rs.length === n) continue;
      const conv = rs.filter((r) => r.depth >= last).length;
      const restConv = conversions - conv;
      const t2 = S.twoProportionTest(restConv, n - rs.length, conv, rs.length);
      const lats = rs.map((r) => r.lat).filter(Number.isFinite);
      segRows.push({
        dimension: c.name,
        value,
        sessions: rs.length,
        conversions: conv,
        conversion_rate: conv / rs.length,
        delta_vs_rest_pp: t2.absolute_diff * 100,
        p: t2.small_sample && t2.fisher_p !== null ? t2.fisher_p : t2.p_value_z,
        q: 1,
        p95_latency: lats.length >= 10 ? S.percentile(lats, 0.95) : null,
      });
      for (let k = 1; k <= last; k++) {
        const ent = rs.filter((r) => r.depth >= k - 1).length;
        const pass = rs.filter((r) => r.depth >= k).length;
        const restEnt = reach[k - 1]! - ent;
        const restPass = reach[k]! - pass;
        if (ent < MIN_SEGMENT || restEnt < MIN_SEGMENT) continue;
        const tt = S.twoProportionTest(restPass, restEnt, pass, ent);
        const rate = pass / ent;
        const restRate = restPass / restEnt;
        findings.push({
          dimension: c.name,
          value,
          transition: `${order[k - 1]} → ${order[k]}`,
          from_stage: order[k - 1]!,
          entries: ent,
          rate,
          rest_rate: restRate,
          diff_pp: (rate - restRate) * 100,
          p: tt.small_sample && tt.fisher_p !== null ? tt.fisher_p : tt.p_value_z,
          q: 1,
          lost_conversions: Math.max(0, (restRate - rate) * ent * downstream(k)),
        });
      }
    }
  });
  S.benjaminiHochberg(findings.map((f) => f.p)).forEach((q, i) => (findings[i]!.q = q));
  S.benjaminiHochberg(segRows.map((f) => f.p)).forEach((q, i) => (segRows[i]!.q = q));
  findings.sort((a, b) => b.lost_conversions - a.lost_conversions);
  segRows.sort((a, b) => a.delta_vs_rest_pp - b.delta_vs_rest_pp);

  const sigBad = findings.filter((f) => f.q < 0.05 && f.diff_pp <= -2);
  // A pair (e.g. region × device) is only reported when it is clearly worse than both of its
  // single-dimension parts at the same step — otherwise it merely restates a main effect.
  const single = new Map(findings.filter((f) => !f.dimension.includes(" × ")).map((f) => [`${f.dimension}=${f.value}@${f.transition}`, f.diff_pp]));
  const addsInfo = (f: SegmentFinding) => {
    if (!f.dimension.includes(" × ")) return true;
    const dims = f.dimension.split(" × ");
    const vals = f.value.split(" · ");
    return dims.every((d, i) => f.diff_pp < (single.get(`${d}=${vals[i]}@${f.transition}`) ?? 0) - 2);
  };
  const seenSeg = new Set<string>();
  const topBad = sigBad.filter(addsInfo).filter((f) => {
    const key = `${f.dimension}=${f.value}`;
    if (seenSeg.has(key)) return false;
    seenSeg.add(key);
    return true;
  });
  for (const f of topBad.slice(0, 3))
    insights.push({
      level: "critical",
      title: `${f.dimension} = ${f.value} under-performs at ${f.transition}`,
      detail: `${fmtPct(f.rate)} pass this step vs ${fmtPct(f.rest_rate)} for everyone else (${f.diff_pp.toFixed(1)} pp, FDR-adjusted q = ${fmtP(f.q)}, n = ${fmtN(f.entries)}). Closing the gap is worth ≈${fmtN(f.lost_conversions)} extra conversions in this period.`,
      impact: f.lost_conversions,
    });
  const sigGood = findings.filter((f) => f.q < 0.05 && f.diff_pp >= 2).sort((a, b) => b.diff_pp - a.diff_pp);
  if (sigGood[0])
    insights.push({
      level: "good",
      title: `${sigGood[0].dimension} = ${sigGood[0].value} out-performs at ${sigGood[0].transition}`,
      detail: `${fmtPct(sigGood[0].rate)} vs ${fmtPct(sigGood[0].rest_rate)} (+${sigGood[0].diff_pp.toFixed(1)} pp, q = ${fmtP(sigGood[0].q)}). Worth studying what this segment experiences differently.`,
      impact: sigGood[0].entries * 0.01,
    });
  if (segCols.length && !sigBad.length)
    insights.push({
      level: "info",
      title: "No segment is significantly worse than the rest",
      detail: `${findings.length} segment × step comparisons were tested with false-discovery-rate control; none shows a reliable gap of 2 pp or more.`,
    });

  // ---- latency ↔ abandonment: test every transition, keep the strongest negative association
  let latency: EventsResult["latency"] = null;
  if (li >= 0) {
    const tests: { k: number; r: number; p: number; n: number; x: number[] }[] = [];
    for (let k = 1; k <= last; k++) {
      const atRisk = recs.filter((r) => r.depth >= k - 1 && Number.isFinite(r.lat));
      if (atRisk.length < 30) continue;
      const x = atRisk.map((r) => r.lat);
      const pr = S.pearson(x, atRisk.map((r) => (r.depth >= k ? 1 : 0)));
      tests.push({ k, r: pr.r, p: pr.p, n: atRisk.length, x });
    }
    const adjP = S.holm(tests.map((t2) => t2.p));
    tests.forEach((t2, i) => (t2.p = adjP[i]!));
    const best = tests.filter((t2) => t2.r < 0).sort((a, b) => a.r - b.r)[0];
    if (best) {
      latency = { worst_step: `${order[best.k - 1]} → ${order[best.k]}`, r: best.r, p: best.p, n: best.n, p50: S.percentile(best.x, 0.5), p95: S.percentile(best.x, 0.95) };
      if (best.p < 0.05 && best.r < -0.05)
        insights.push({
          level: "critical",
          title: `Slower ${m.latency} predicts abandonment at ${latency.worst_step}`,
          detail: `Point-biserial r = ${best.r.toFixed(2)} (Holm-adjusted p = ${fmtP(best.p)}, n = ${fmtN(best.n)}). P95 ${m.latency} is ${latency.p95.toFixed(0)} vs median ${latency.p50.toFixed(0)}. Performance work on this step is likely to lift conversion.`,
          impact: (reach[best.k - 1]! - reach[best.k]!) * Math.abs(best.r),
        });
    }
  }

  // ---- trend
  const trend: EventsResult["trend"] = [];
  let period: EventsResult["period_change"] = null;
  if (ti >= 0) {
    const byDay = new Map<string, { s: number; c: number }>();
    for (const r of recs) {
      const day = new Date(r.start).toISOString().slice(0, 10);
      const v = byDay.get(day) ?? { s: 0, c: 0 };
      v.s++;
      if (r.depth >= last) v.c++;
      byDay.set(day, v);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    days.forEach(([day, v], i) => {
      const win = days.slice(Math.max(0, i - 6), i + 1);
      const ws = win.reduce((s, [, x]) => s + x.s, 0);
      const wc = win.reduce((s, [, x]) => s + x.c, 0);
      trend.push({ day, sessions: v.s, conversions: v.c, conversion_pct: (100 * v.c) / v.s, conversion_ma7_pct: (100 * wc) / ws });
    });
    if (days.length >= 14) {
      const sum = (xs: typeof days) => xs.reduce((a, [, v]) => ({ s: a.s + v.s, c: a.c + v.c }), { s: 0, c: 0 });
      const lastW = sum(days.slice(-7));
      const prevW = sum(days.slice(-14, -7));
      const tt = S.twoProportionTest(prevW.c, prevW.s, lastW.c, lastW.s);
      period = { last: lastW.c / lastW.s, prev: prevW.c / prevW.s, p: tt.p_value_z };
      // Stricter α: this week-over-week check runs on every upload, so guard against routine false alarms
      if (tt.p_value_z < 0.01)
        insights.push({
          level: tt.absolute_diff < 0 ? "critical" : "good",
          title: `Conversion ${tt.absolute_diff < 0 ? "fell" : "rose"} in the last 7 days`,
          detail: `${fmtPct(period.prev, 2)} → ${fmtPct(period.last, 2)} versus the previous week (p = ${fmtP(tt.p_value_z)}). ${tt.absolute_diff < 0 ? "Check releases, campaigns or incidents in that window." : ""}`,
          impact: Math.abs(tt.absolute_diff) * lastW.s,
        });
    }
  }

  const dropped = [
    { reason: "missing session or step", count: missing },
    { reason: "unparseable timestamp", count: badTime },
  ].filter((d) => d.count);
  if (dropped.length)
    insights.push({
      level: "info",
      title: "Data quality",
      detail: `${dropped.map((d) => `${fmtN(d.count)} rows dropped (${d.reason})`).join("; ")}. Results use ${fmtN(t.rows.length - missing - badTime)} of ${fmtN(t.rows.length)} rows.`,
    });

  return {
    kind: "events",
    quality: { rows: t.rows.length, used: t.rows.length - missing - badTime, dropped },
    stages_detected: detected,
    stage_order: order,
    funnel,
    sessions: n,
    conversions,
    conversion_rate: conversions / n,
    segments: segRows,
    findings,
    latency,
    trend,
    period_change: period,
    insights: rank(insights),
  };
}

// ============================================================ FUNNEL SUMMARY
export function summaryStages(t: Table, m: Mapping): { stage: string; sessions: number }[] {
  const si = col(t, m.step);
  const ui = col(t, m.users);
  const tot = new Map<string, number>();
  for (const r of t.rows) {
    const u = parseNum(r[ui] ?? "");
    if (r[si] && Number.isFinite(u)) tot.set(r[si]!, (tot.get(r[si]!) ?? 0) + u);
  }
  return [...tot.entries()].map(([stage, n]) => ({ stage, sessions: Math.round(n) })).sort((a, b) => b.sessions - a.sessions);
}

/**
 * Aggregated funnel (e.g. GA4 "users per event" by country). Assumes a nested
 * funnel — users at step k are a subset of users at step k-1 — and warns when
 * counts increase, which signals non-sequential events or sampling.
 */
export function analyzeFunnelSummary(t: Table, m: Mapping, stageOrder?: string[]): EventsResult {
  const si = col(t, m.step);
  const ui = col(t, m.users);
  const segCols = (m.segments ?? []).map((name) => ({ name, i: col(t, name) })).filter((c) => c.i >= 0);
  const totals = new Map<string, number>();
  const bySeg = segCols.map(() => new Map<string, Map<string, number>>()); // dim → value → step → users
  let dropped = 0;
  for (const r of t.rows) {
    const step = r[si];
    const u = parseNum(r[ui] ?? "");
    if (!step || !Number.isFinite(u) || u < 0) {
      dropped++;
      continue;
    }
    totals.set(step, (totals.get(step) ?? 0) + u);
    segCols.forEach((c, d) => {
      const v = r[c.i] || "(blank)";
      const mm = bySeg[d]!.get(v) ?? new Map<string, number>();
      mm.set(step, (mm.get(step) ?? 0) + u);
      bySeg[d]!.set(v, mm);
    });
  }
  const detected = [...totals.entries()].map(([stage, sessions]) => ({ stage, sessions })).sort((a, b) => b.sessions - a.sessions);
  const order = (stageOrder?.length ? stageOrder : detected.slice(0, 6).map((d) => d.stage)).filter((s) => totals.has(s));
  if (order.length < 2) throw new Error("Pick at least two funnel steps.");
  const reach = order.map((s) => Math.round(totals.get(s)!));
  const insights: Insight[] = [];
  const nonNested = order.slice(1).filter((_, k) => reach[k + 1]! > reach[k]!);
  if (nonNested.length)
    insights.push({
      level: "warning",
      title: "Counts increase between steps",
      detail: `${nonNested.join(", ")} has more users than the previous step. Aggregated exports count users per event, not ordered journeys. Reorder the steps or use an event log for exact funnels.`,
      impact: 1e9,
    });
  const funnel: FunnelStepResult[] = order.map((stage, k) => ({
    step_order: k + 1,
    stage,
    sessions: reach[k]!,
    step_conversion_pct: k ? (100 * reach[k]!) / Math.max(reach[k - 1]!, 1) : null,
    step_dropoff_pct: k ? 100 - (100 * reach[k]!) / Math.max(reach[k - 1]!, 1) : null,
    cumulative_conversion_pct: (100 * reach[k]!) / Math.max(reach[0]!, 1),
  }));
  const last = order.length - 1;
  let worst = 1;
  for (let k = 1; k <= last; k++) if (funnel[k]!.step_conversion_pct! < funnel[worst]!.step_conversion_pct!) worst = k;
  insights.push({
    level: "warning",
    title: `Biggest drop-off: ${order[worst - 1]} → ${order[worst]}`,
    detail: `${fmtPct(Math.max(0, 1 - reach[worst]! / Math.max(reach[worst - 1]!, 1)))} of users lost at this step (${fmtN(Math.max(0, reach[worst - 1]! - reach[worst]!))}). End-to-end ${fmtPct(reach[last]! / Math.max(reach[0]!, 1), 2)}.`,
    impact: reach[worst - 1]! - reach[worst]!,
  });

  const conversionsAll = reach[last]!;
  const downstream = (k: number) => (reach[k]! ? conversionsAll / reach[k]! : 0);
  const findings: SegmentFinding[] = [];
  const segRows: SegmentRow[] = [];
  segCols.forEach((c, d) => {
    for (const [value, steps] of bySeg[d]!) {
      const cnt = order.map((s) => Math.round(steps.get(s) ?? 0));
      if (cnt[0]! < MIN_SEGMENT || cnt[0] === reach[0]) continue;
      const restFirst = reach[0]! - cnt[0]!;
      const restLast = reach[last]! - cnt[last]!;
      if (cnt[last]! <= cnt[0]! && restLast <= restFirst && restFirst > 0) {
        const tt = S.twoProportionTest(restLast, restFirst, cnt[last]!, cnt[0]!);
        segRows.push({ dimension: c.name, value, sessions: cnt[0]!, conversions: cnt[last]!, conversion_rate: cnt[last]! / cnt[0]!, delta_vs_rest_pp: tt.absolute_diff * 100, p: tt.p_value_z, q: 1, p95_latency: null });
      }
      for (let k = 1; k <= last; k++) {
        const ent = cnt[k - 1]!;
        const pass = cnt[k]!;
        const restEnt = reach[k - 1]! - ent;
        const restPass = reach[k]! - pass;
        if (ent < MIN_SEGMENT || restEnt < MIN_SEGMENT || pass > ent || restPass > restEnt) continue;
        const tt = S.twoProportionTest(restPass, restEnt, pass, ent);
        const rate = pass / ent;
        const restRate = restPass / restEnt;
        findings.push({ dimension: c.name, value, transition: `${order[k - 1]} → ${order[k]}`, from_stage: order[k - 1]!, entries: ent, rate, rest_rate: restRate, diff_pp: (rate - restRate) * 100, p: tt.small_sample && tt.fisher_p !== null ? tt.fisher_p : tt.p_value_z, q: 1, lost_conversions: Math.max(0, (restRate - rate) * ent * downstream(k)) });
      }
    }
  });
  S.benjaminiHochberg(findings.map((f) => f.p)).forEach((q, i) => (findings[i]!.q = q));
  S.benjaminiHochberg(segRows.map((f) => f.p)).forEach((q, i) => (segRows[i]!.q = q));
  findings.sort((a, b) => b.lost_conversions - a.lost_conversions);
  const seen = new Set<string>();
  for (const f of findings.filter((x) => x.q < 0.05 && x.diff_pp <= -2)) {
    const key = `${f.dimension}=${f.value}`;
    if (seen.has(key) || seen.size >= 3) continue;
    seen.add(key);
    insights.push({ level: "critical", title: `${f.dimension} = ${f.value} under-performs at ${f.transition}`, detail: `${fmtPct(f.rate)} continue vs ${fmtPct(f.rest_rate)} for everyone else (${f.diff_pp.toFixed(1)} pp, FDR q = ${fmtP(f.q)}). ≈${fmtN(f.lost_conversions)} conversions lost.`, impact: f.lost_conversions });
  }
  if (segCols.length && !seen.size)
    insights.push({ level: "info", title: "No segment is significantly worse than the rest", detail: `${findings.length} segment × step comparisons tested with FDR control.` });
  if (dropped) insights.push({ level: "info", title: "Data quality", detail: `${fmtN(dropped)} rows dropped (missing step or invalid count).` });

  return {
    kind: "events",
    quality: { rows: t.rows.length, used: t.rows.length - dropped, dropped: dropped ? [{ reason: "missing step / invalid count", count: dropped }] : [] },
    stages_detected: detected.map((d) => ({ ...d, sessions: Math.round(d.sessions) })),
    stage_order: order,
    funnel,
    sessions: reach[0]!,
    conversions: conversionsAll,
    conversion_rate: conversionsAll / Math.max(reach[0]!, 1),
    segments: segRows,
    findings,
    latency: null,
    trend: [],
    period_change: null,
    insights: rank(insights),
  };
}

// ================================================================= EXPERIMENT
export interface ArmSummary {
  variant: string;
  users: number;
  conversions: number;
  rate: number;
}

export interface VariantComparison {
  variant: string;
  freq: S.ProportionTest;
  bayes: S.BayesianResult;
  p_adjusted: number;
  power_at_mde: number;
  decision: ReturnType<typeof S.decide>;
  metric: S.ContinuousTest | null;
  required_n: number | null;
  days_remaining: number | null;
}

export interface SegmentEffect {
  dimension: string;
  value: string;
  users: number;
  uplift: number;
  p: number;
  q: number;
}

export interface ExperimentResult {
  kind: "experiment";
  quality: DataQuality;
  control: string;
  arms: ArmSummary[];
  srm: { chi2: number; p: number } | null;
  comparisons: VariantComparison[];
  days_running: number | null;
  daily_traffic: number | null;
  mde: number;
  metric_name: string | null;
  segment_effects: SegmentEffect[];
  insights: Insight[];
}

export interface ExperimentOptions {
  control?: string;
  mde?: number;
  alpha?: number;
  expectedShares?: number[];
}

export function guessControl(variants: string[]): string {
  return variants.find((v) => /^(a|control|ctrl|baseline|original|default|old|0)$/i.test(v.trim())) ?? [...variants].sort()[0]!;
}

export function listVariants(t: Table, m: Mapping): string[] {
  const vi = col(t, m.variant);
  return [...new Set(t.rows.map((r) => r[vi]!).filter(Boolean))].sort();
}

export function analyzeExperiment(t: Table, m: Mapping, opts: ExperimentOptions = {}): ExperimentResult {
  const alpha = opts.alpha ?? 0.05;
  const mde = opts.mde ?? 0.05;
  const vi = col(t, m.variant);
  const summary = m.users !== undefined && m.conversions !== undefined && m.converted === undefined;
  const arms = new Map<string, { users: number; conv: number; metric: number[]; ts: number[]; rows: string[][] }>();
  let dropped = 0;

  for (const r of t.rows) {
    const v = r[vi];
    if (!v) {
      dropped++;
      continue;
    }
    const a = arms.get(v) ?? { users: 0, conv: 0, metric: [], ts: [], rows: [] };
    if (summary) {
      const u = parseNum(r[col(t, m.users)] ?? "");
      const c = parseNum(r[col(t, m.conversions)] ?? "");
      if (!Number.isFinite(u) || !Number.isFinite(c) || c > u) {
        dropped++;
        continue;
      }
      a.users += u;
      a.conv += c;
    } else {
      a.users++;
      if (parseBool(r[col(t, m.converted)] ?? "")) a.conv++;
      if (m.metric) {
        const x = parseNum(r[col(t, m.metric)] ?? "");
        if (Number.isFinite(x)) a.metric.push(x);
      }
      if (m.timestamp) {
        const x = parseTime(r[col(t, m.timestamp)] ?? "");
        if (Number.isFinite(x)) a.ts.push(x);
      }
      a.rows.push(r);
    }
    arms.set(v, a);
  }
  const variants = [...arms.keys()].sort();
  if (variants.length < 2) throw new Error("Need at least two variants (e.g. A and B).");
  if (variants.length > 10) throw new Error(`Found ${variants.length} variant values — is the right column mapped as the variant?`);
  const control = opts.control && arms.has(opts.control) ? opts.control : guessControl(variants);
  const ctrl = arms.get(control)!;
  const armList: ArmSummary[] = variants.map((v) => ({ variant: v, users: arms.get(v)!.users, conversions: arms.get(v)!.conv, rate: arms.get(v)!.conv / arms.get(v)!.users }));
  const insights: Insight[] = [];

  const srm = S.srmTest(armList.map((a) => a.users), opts.expectedShares);
  if (srm.p < 0.001)
    insights.push({
      level: "critical",
      title: "Sample ratio mismatch — results are not trustworthy",
      detail: `Arm sizes (${armList.map((a) => `${a.variant}: ${fmtN(a.users)}`).join(", ")}) deviate from the planned split (χ² = ${srm.chi2.toFixed(1)}, p = ${fmtP(srm.p)}). Usually a bug in assignment, redirects or tracking. Fix it before reading the lift.`,
      impact: 1e12,
    });

  // timing
  const allTs = [...arms.values()].flatMap((a) => a.ts);
  let days: number | null = null;
  let daily: number | null = null;
  if (allTs.length > 1) {
    const min = allTs.reduce((a, b) => Math.min(a, b));
    const max = allTs.reduce((a, b) => Math.max(a, b));
    days = Math.max((max - min) / 86_400_000, 1);
    daily = armList.reduce((s, a) => s + a.users, 0) / days;
  }

  const others = variants.filter((v) => v !== control);
  const raw = others.map((v) => {
    const a = arms.get(v)!;
    const freq = S.twoProportionTest(ctrl.conv, ctrl.users, a.conv, a.users, alpha);
    return { v, a, freq };
  });
  const adj = S.holm(raw.map((x) => (x.freq.small_sample && x.freq.fisher_p !== null ? x.freq.fisher_p : x.freq.p_value_z)));
  const comparisons: VariantComparison[] = raw.map(({ v, a, freq }, i) => {
    const sig = adj[i]! < alpha;
    const f = { ...freq, significant: sig };
    const bayes = S.bayesianAbTest(ctrl.conv, ctrl.users, a.conv, a.users, { samples: 60_000 });
    const pA = ctrl.conv / ctrl.users;
    const target = Math.min(0.999, pA * (1 + mde));
    const powerAtMde = pA > 0 && pA < 1 ? S.achievedPower(pA, target, ctrl.users, a.users, alpha) : 0;
    let requiredN: number | null = null;
    let daysRemaining: number | null = null;
    if (freq.rate_a !== freq.rate_b && freq.rate_a > 0 && freq.rate_a < 1 && freq.rate_b > 0 && freq.rate_b < 1) {
      requiredN = S.requiredSampleSize(freq.rate_a, freq.rate_b, alpha, 0.8);
      if (daily) daysRemaining = Math.max(0, Math.ceil((2 * requiredN - ctrl.users - a.users) / daily));
    }
    const decision = srm.p < 0.001
      ? { verdict: "NO-GO" as const, headline: "Fix the sample ratio mismatch first", rationale: "Arm sizes deviate from the planned split, so the comparison may be biased." }
      : S.decide(f, bayes, powerAtMde, { alpha, mde, daysRemaining });
    const metric = m.metric && ctrl.metric.length >= 2 && a.metric.length >= 2 ? S.continuousTest(ctrl.metric, a.metric, alpha) : null;
    return { variant: v, freq: f, bayes, p_adjusted: adj[i]!, power_at_mde: powerAtMde, decision, metric, required_n: requiredN, days_remaining: daysRemaining };
  });

  for (const c of comparisons) {
    const lvl: Level = c.decision.verdict === "GO" ? "good" : c.decision.verdict === "NO-GO" ? "critical" : "warning";
    insights.push({
      level: lvl,
      title: `${c.variant} vs ${control}: ${c.decision.verdict}`,
      detail: `${c.decision.headline}. Lift ${c.freq.relative_uplift >= 0 ? "+" : ""}${fmtPct(c.freq.relative_uplift)} (95% CI ${fmtPct(c.freq.uplift_ci_low)} … ${fmtPct(c.freq.uplift_ci_high)}), ${others.length > 1 ? "Holm-adjusted " : ""}p = ${fmtP(c.p_adjusted)}, P(B>A) = ${fmtPct(c.bayes.prob_b_beats_a)}.${c.freq.small_sample ? " Small sample: Fisher's exact test used." : ""}`,
      impact: Math.abs(c.freq.absolute_diff) * 1e6,
    });
    if (c.metric?.significant)
      insights.push({
        level: c.metric.median_b > c.metric.median_a ? "info" : "info",
        title: `${m.metric}: ${c.variant} differs from ${control}`,
        detail: `Median ${c.metric.median_a.toFixed(2)} → ${c.metric.median_b.toFixed(2)} (Mann-Whitney p = ${fmtP(c.metric.p_value)}; Welch p = ${fmtP(c.metric.welch_p)}).`,
      });
  }

  // heterogeneity across segments (variant vs control within each segment value), FDR-controlled
  const effects: SegmentEffect[] = [];
  if (!summary && others.length === 1) {
    const vAll = arms.get(others[0]!)!;
    for (const seg of m.segments ?? []) {
      const si = col(t, seg);
      const vals = new Set([...ctrl.rows, ...vAll.rows].map((r) => r[si] || "(blank)"));
      for (const val of vals) {
        const cr = ctrl.rows.filter((r) => (r[si] || "(blank)") === val);
        const vr = vAll.rows.filter((r) => (r[si] || "(blank)") === val);
        if (cr.length < MIN_SEGMENT || vr.length < MIN_SEGMENT) continue;
        const cc = cr.filter((r) => parseBool(r[col(t, m.converted)] ?? "")).length;
        const vc = vr.filter((r) => parseBool(r[col(t, m.converted)] ?? "")).length;
        if (cc === 0) continue;
        const tt = S.twoProportionTest(cc, cr.length, vc, vr.length, alpha);
        effects.push({ dimension: seg, value: val, users: cr.length + vr.length, uplift: tt.relative_uplift, p: tt.p_value_z, q: 1 });
      }
    }
    S.benjaminiHochberg(effects.map((e) => e.p)).forEach((q, i) => (effects[i]!.q = q));
    const overall = comparisons[0]!.freq.relative_uplift;
    const opposite = effects.filter((e) => e.q < 0.05 && Math.sign(e.uplift) !== Math.sign(overall));
    if (opposite[0])
      insights.push({
        level: "warning",
        title: `Effect reverses for ${opposite[0].dimension} = ${opposite[0].value}`,
        detail: `Overall lift is ${fmtPct(overall)}, but in this segment it is ${fmtPct(opposite[0].uplift)} (q = ${fmtP(opposite[0].q)}). Consider a targeted rollout.`,
        impact: opposite[0].users,
      });
  }

  if (dropped)
    insights.push({ level: "info", title: "Data quality", detail: `${fmtN(dropped)} rows dropped (missing variant or invalid counts).` });

  return {
    kind: "experiment",
    quality: { rows: t.rows.length, used: t.rows.length - dropped, dropped: dropped ? [{ reason: "missing variant / invalid", count: dropped }] : [] },
    control,
    arms: armList,
    srm,
    comparisons,
    days_running: days,
    daily_traffic: daily,
    mde,
    metric_name: m.metric ?? null,
    segment_effects: effects.sort((a, b) => a.q - b.q),
    insights: rank(insights),
  };
}

// ==================================================================== AI EVAL
export interface ModelRow {
  model: string;
  n: number;
  mean_accuracy: number;
  accuracy_ci_low: number;
  accuracy_ci_high: number;
  hallucination_rate: number | null;
  hallucination_ci_low: number | null;
  hallucination_ci_high: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  cost_per_1k_usd: number | null;
  passes_guardrail: boolean;
}

export interface AiEvalResult {
  kind: "ai_eval";
  quality: DataQuality;
  models: ModelRow[];
  tests: { kruskal_h: number | null; kruskal_p: number | null; top_two: string[] | null; welch_t: number | null; welch_p: number | null; halluc_chi2: number | null; halluc_p: number | null };
  category_matrix: { model: string; category: string; n: number; mean_accuracy: number; hallucination_pct: number; rank_in_category: number }[];
  categories: string[];
  guardrail: number;
  insights: Insight[];
}

export function analyzeAiEval(t: Table, m: Mapping, guardrail = 0.05): AiEvalResult {
  const mi = col(t, m.model);
  const si = col(t, m.score);
  const hi = col(t, m.hallucination);
  const li = col(t, m.latency);
  const ci = col(t, m.cost);
  const gi = col(t, m.category);
  const by = new Map<string, { acc: number[]; hal: number[]; lat: number[]; cost: number[]; cat: string[] }>();
  let dropped = 0;
  for (const r of t.rows) {
    const model = r[mi];
    const s = parseNum(r[si] ?? "");
    if (!model || !Number.isFinite(s)) {
      dropped++;
      continue;
    }
    const g = by.get(model) ?? { acc: [], hal: [], lat: [], cost: [], cat: [] };
    g.acc.push(s);
    if (hi >= 0) g.hal.push(parseBool(r[hi] ?? "") ? 1 : 0);
    if (li >= 0) {
      const v = parseNum(r[li] ?? "");
      if (Number.isFinite(v)) g.lat.push(v);
    }
    if (ci >= 0) {
      const v = parseNum(r[ci] ?? "");
      if (Number.isFinite(v)) g.cost.push(v);
    }
    g.cat.push(gi >= 0 ? r[gi] || "(blank)" : "All");
    by.set(model, g);
  }
  if (by.size < 2) throw new Error("Need results for at least two models to compare.");

  const models: ModelRow[] = [...by.entries()].map(([model, g]) => {
    const [mean, lo, hi2] = S.meanCiT(g.acc);
    const k = g.hal.reduce((s, v) => s + v, 0);
    const w = g.hal.length ? S.wilsonCi(k, g.hal.length) : null;
    const rate = g.hal.length ? k / g.hal.length : null;
    return {
      model,
      n: g.acc.length,
      mean_accuracy: mean,
      accuracy_ci_low: lo,
      accuracy_ci_high: hi2,
      hallucination_rate: rate,
      hallucination_ci_low: w?.[0] ?? null,
      hallucination_ci_high: w?.[1] ?? null,
      p50_latency_ms: g.lat.length ? S.percentile(g.lat, 0.5) : null,
      p95_latency_ms: g.lat.length ? S.percentile(g.lat, 0.95) : null,
      cost_per_1k_usd: g.cost.length ? S.mean(g.cost) * 1000 : null,
      passes_guardrail: rate === null ? true : rate <= guardrail,
    };
  });
  models.sort((a, b) => b.mean_accuracy - a.mean_accuracy);

  const groups = models.map((x) => by.get(x.model)!.acc);
  const kw = groups.every((g) => g.length >= 2) ? S.kruskal(groups) : null;
  const welch = groups[0]!.length >= 2 && groups[1]!.length >= 2 ? S.welchT(groups[0]!, groups[1]!) : null;
  const halTable = models.filter((x) => by.get(x.model)!.hal.length).map((x) => {
    const h = by.get(x.model)!.hal;
    const k = h.reduce((s, v) => s + v, 0);
    return [k, h.length - k];
  });
  const halTest = halTable.length >= 2 && halTable.every((r) => r[0]! + r[1]! > 0) && halTable.some((r) => r[0]! > 0) ? S.chi2Independence(halTable) : null;

  const cats = new Set<string>();
  const cells: AiEvalResult["category_matrix"] = [];
  for (const x of models) {
    const g = by.get(x.model)!;
    const perCat = new Map<string, { acc: number[]; hal: number }>();
    g.cat.forEach((c, i) => {
      cats.add(c);
      const v = perCat.get(c) ?? { acc: [], hal: 0 };
      v.acc.push(g.acc[i]!);
      v.hal += g.hal[i] ?? 0;
      perCat.set(c, v);
    });
    for (const [c, v] of perCat) cells.push({ model: x.model, category: c, n: v.acc.length, mean_accuracy: S.mean(v.acc), hallucination_pct: (100 * v.hal) / v.acc.length, rank_in_category: 0 });
  }
  for (const c of cats) {
    cells.filter((x) => x.category === c).sort((a, b) => b.mean_accuracy - a.mean_accuracy).forEach((x, i) => (x.rank_in_category = i + 1));
  }

  const insights: Insight[] = [];
  const best = models[0]!;
  const second = models[1]!;
  const safe = models.filter((x) => x.passes_guardrail);
  if (welch && welch.p < 0.05)
    insights.push({ level: "good", title: `${best.model} is significantly more accurate than ${second.model}`, detail: `${best.mean_accuracy.toFixed(1)} vs ${second.mean_accuracy.toFixed(1)} (Welch p = ${fmtP(welch.p)}; Kruskal-Wallis across all models p = ${kw ? fmtP(kw.p) : "—"}).`, impact: 10 });
  else if (welch)
    insights.push({ level: "warning", title: `${best.model} and ${second.model} are statistically tied on accuracy`, detail: `Difference ${(best.mean_accuracy - second.mean_accuracy).toFixed(1)} points, Welch p = ${fmtP(welch.p)}. Choose on cost, latency or safety instead, or collect more graded samples.`, impact: 9 });
  if (!best.passes_guardrail && best.hallucination_rate !== null)
    insights.push({ level: "critical", title: `${best.model} breaches the ${fmtPct(guardrail, 0)} hallucination guardrail`, detail: `Hallucination rate ${fmtPct(best.hallucination_rate)} (95% CI ${fmtPct(best.hallucination_ci_low!)}–${fmtPct(best.hallucination_ci_high!)}). ${safe[0] ? `Safest compliant option: ${safe[0].model}.` : "No model meets the guardrail. Keep a human in the loop."}`, impact: 20 });
  const priced = models.filter((x) => x.cost_per_1k_usd !== null);
  if (priced.length >= 2) {
    const cheapest = [...priced].sort((a, b) => a.cost_per_1k_usd! - b.cost_per_1k_usd!)[0]!;
    if (cheapest.model !== best.model)
      insights.push({ level: "info", title: "Cost trade-off", detail: `${best.model} costs $${best.cost_per_1k_usd!.toFixed(2)} per 1k answers vs $${cheapest.cost_per_1k_usd!.toFixed(2)} for ${cheapest.model} (${(best.mean_accuracy - cheapest.mean_accuracy).toFixed(1)} accuracy points apart). Routing easy categories to ${cheapest.model} could cut cost.` });
  }
  for (const c of cats) {
    const row = cells.filter((x) => x.category === c);
    const winner = row.find((x) => x.rank_in_category === 1);
    if (winner && winner.model !== best.model && row.length > 1 && winner.n >= 20)
      insights.push({ level: "info", title: `${winner.model} leads in "${c}"`, detail: `Best average accuracy in this category (${winner.mean_accuracy.toFixed(1)}), even though ${best.model} leads overall.` });
  }
  if (halTest && halTest.p < 0.05)
    insights.push({ level: "warning", title: "Hallucination rates differ between models", detail: `χ² = ${halTest.chi2.toFixed(2)}, p = ${fmtP(halTest.p)}. Safety is a real differentiator here, not noise.` });

  return {
    kind: "ai_eval",
    quality: { rows: t.rows.length, used: t.rows.length - dropped, dropped: dropped ? [{ reason: "missing model or score", count: dropped }] : [] },
    models,
    tests: { kruskal_h: kw?.h ?? null, kruskal_p: kw?.p ?? null, top_two: [best.model, second.model], welch_t: welch?.t ?? null, welch_p: welch?.p ?? null, halluc_chi2: halTest?.chi2 ?? null, halluc_p: halTest?.p ?? null },
    category_matrix: cells,
    categories: [...cats],
    guardrail,
    insights: rank(insights),
  };
}

export type AnalysisResult = EventsResult | ExperimentResult | AiEvalResult;

// ===================================================================== BRIEF
export function toMarkdown(r: AnalysisResult, source: string): string {
  const lines = [`# PulsePort Data Studio — Findings`, `_Source: ${source} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${fmtN(r.quality.used)} of ${fmtN(r.quality.rows)} rows used_`, ""];
  lines.push("## Key insights", ...r.insights.map((i) => `- **[${i.level.toUpperCase()}] ${i.title}.** ${i.detail}`), "");
  if (r.kind === "events") {
    lines.push("## Funnel", "| Step | Sessions | Step conversion | Cumulative |", "|---|---:|---:|---:|");
    for (const s of r.funnel) lines.push(`| ${s.stage} | ${fmtN(s.sessions)} | ${s.step_conversion_pct === null ? "—" : `${s.step_conversion_pct.toFixed(1)}%`} | ${s.cumulative_conversion_pct.toFixed(1)}% |`);
  } else if (r.kind === "experiment") {
    lines.push("## Arms", "| Variant | Users | Conversions | Rate |", "|---|---:|---:|---:|");
    for (const a of r.arms) lines.push(`| ${a.variant}${a.variant === r.control ? " (control)" : ""} | ${fmtN(a.users)} | ${fmtN(a.conversions)} | ${fmtPct(a.rate, 2)} |`);
    if (r.srm) lines.push("", `Sample-ratio check: χ² = ${r.srm.chi2.toFixed(2)}, p = ${fmtP(r.srm.p)}`);
  } else {
    lines.push("## Models", "| Model | n | Accuracy (95% CI) | Hallucination | P95 latency | Cost / 1k |", "|---|---:|---|---:|---:|---:|");
    for (const x of r.models)
      lines.push(`| ${x.model} | ${x.n} | ${x.mean_accuracy.toFixed(1)} (${x.accuracy_ci_low.toFixed(1)}–${x.accuracy_ci_high.toFixed(1)}) | ${x.hallucination_rate === null ? "—" : fmtPct(x.hallucination_rate)} | ${x.p95_latency_ms === null ? "—" : x.p95_latency_ms.toFixed(0)} | ${x.cost_per_1k_usd === null ? "—" : `$${x.cost_per_1k_usd.toFixed(2)}`} |`);
  }
  lines.push("", "_Methods: two-proportion z / Fisher exact, Benjamini–Hochberg FDR, Holm, SRM χ², Beta-Binomial posteriors, Mann-Whitney U, Welch t, Kruskal-Wallis, Wilson intervals._");
  return lines.join("\n");
}
