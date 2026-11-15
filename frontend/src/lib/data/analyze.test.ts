// End-to-end tests of the Data Studio pipeline on the sample CSVs:
// parse → profile → detect kind → suggest mapping → analyze → insights.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyzeAiEval, analyzeEvents, analyzeExperiment, analyzeFunnelSummary, detectStages, toMarkdown } from "./analyze.ts";
import { parseCsv } from "./csv.ts";
import { detectKind, missingRoles, profile, suggestMapping } from "./detect.ts";

const load = (f: string) => parseCsv(readFileSync(new URL(`../../../public/samples/${f}`, import.meta.url), "utf8"));

test("csv parser: quotes, escaped quotes, CRLF, semicolons, BOM", () => {
  const t = parseCsv('﻿a;b;c\r\n1;"x;y";"say ""hi"""\r\n2;z;\r\n');
  assert.deepEqual(t.headers, ["a", "b", "c"]);
  assert.equal(t.delimiter, ";");
  assert.deepEqual(t.rows[0], ["1", "x;y", 'say "hi"']);
  assert.equal(t.rows.length, 2);
});

test("maritime events: detects kind, mapping, funnel order and the regional bottleneck", () => {
  const t = load("maritime_portal_events.csv");
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "events");
  const m = suggestMapping("events", cols);
  assert.deepEqual(missingRoles("events", m), []);
  assert.equal(m.session_id, "session_id");
  assert.equal(m.step, "event");
  assert.equal(m.timestamp, "timestamp");
  assert.equal(suggestMapping("experiment", profile(load("ab_test_booking_flow.csv"))).timestamp, "assigned_at");
  assert.equal(m.latency, "quote_latency_ms");
  assert.ok(m.segments?.includes("region") && m.segments.includes("device"));
  assert.deepEqual(detectStages(t, m).map((s) => s.stage), ["portal_visit", "route_search", "rate_quote", "booking_confirmed"]);
  const r = analyzeEvents(t, m);
  assert.equal(r.funnel.length, 4);
  assert.equal(r.funnel[0]!.sessions, 6000);
  const top = r.findings.filter((f) => f.q < 0.05 && f.diff_pp < 0).map((f) => `${f.dimension}=${f.value}@${f.from_stage}`);
  // The injected bottleneck is the *interaction* region × device at the quote step
  assert.ok(top.some((s) => s.includes("BR - Santos · Mobile@route_search")), top.join(" | "));
  assert.ok(top.some((s) => s.includes("CN - Shanghai · Mobile@route_search")), top.join(" | "));
  assert.ok(r.latency && r.latency.worst_step === "route_search → rate_quote" && r.latency.r < -0.2 && r.latency.p < 1e-6, JSON.stringify(r.latency));
  assert.ok(r.insights.some((i) => i.level === "critical"));
  assert.ok(r.trend.length >= 55);
  assert.ok(toMarkdown(r, "sample").includes("## Funnel"));
});

test("row-level A/B test: GO with SRM pass and metric test", () => {
  const t = load("ab_test_booking_flow.csv");
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "experiment");
  const m = suggestMapping("experiment", cols);
  assert.equal(m.variant, "variant");
  assert.equal(m.converted, "converted");
  const r = analyzeExperiment(t, { ...m, metric: "time_to_quote_s" });
  assert.equal(r.control, "control");
  assert.ok(r.srm!.p > 0.05);
  const c = r.comparisons[0]!;
  assert.equal(c.decision.verdict, "GO");
  assert.ok(Math.abs(c.freq.relative_uplift - 0.14) < 1e-9);
  assert.ok(c.metric!.significant && c.metric!.median_b < c.metric!.median_a);
  assert.ok(r.days_running! > 25);
});

test("summary A/B table: KEEP RUNNING (underpowered)", () => {
  const t = load("ab_test_summary_eta_banner.csv");
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "experiment_summary");
  const m = suggestMapping("experiment_summary", cols);
  const r = analyzeExperiment(t, m, { control: "Standard tracking" });
  assert.equal(r.comparisons[0]!.decision.verdict, "KEEP RUNNING");
  assert.ok(Math.abs(r.comparisons[0]!.freq.p_value_z - 0.1812) < 1e-3);
});

test("SRM is detected and blocks the verdict", () => {
  const t = parseCsv("variant,users,conversions\nA,10000,1200\nB,10600,1368\n");
  const r = analyzeExperiment(t, { variant: "variant", users: "users", conversions: "conversions" });
  assert.ok(r.srm!.p < 0.001);
  assert.equal(r.comparisons[0]!.decision.verdict, "NO-GO");
  assert.equal(r.insights[0]!.title.startsWith("Sample ratio mismatch"), true);
});

test("AI evaluation log: ranking, tests, guardrail", () => {
  const t = load("ai_assistant_eval.csv");
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "ai_eval");
  const m = suggestMapping("ai_eval", cols);
  assert.equal(m.model, "model");
  assert.equal(m.score, "accuracy_score");
  assert.equal(m.hallucination, "hallucination");
  const r = analyzeAiEval(t, m);
  assert.equal(r.models.length, 3);
  assert.equal(r.models[0]!.model, "Claude 3.5 Sonnet");
  assert.ok(r.tests.kruskal_p! < 0.001);
  assert.equal(r.categories.length, 4);
});

test("domain-agnostic: e-commerce checkout funnel with its own step names", () => {
  const t = load("ecommerce_checkout_events.csv");
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "events");
  const m = suggestMapping("events", cols);
  assert.equal(m.step, "event_name");
  assert.equal(m.timestamp, "event_time");
  const r = analyzeEvents(t, m, ["product_view", "add_to_cart", "checkout_start", "payment", "order_confirmed"]);
  assert.equal(r.funnel.length, 5);
  assert.ok(r.findings.some((f) => f.value === "BR" && f.q < 0.05 && f.diff_pp < 0));
});

test("aggregated funnel (GA4-style export): detection and segment diagnostics", () => {
  const rows = [["eventName", "country", "totalUsers"]];
  const n: Record<string, number[]> = { IL: [5000, 1600, 500], US: [9000, 3000, 1000], BR: [4000, 1300, 210] };
  const ev = ["page_view", "add_to_cart", "purchase"];
  for (const [c, v] of Object.entries(n)) v.forEach((u, i) => rows.push([ev[i]!, c, String(u)]));
  const t = parseCsv(rows.map((r) => r.join(",")).join("\n"));
  const cols = profile(t);
  assert.equal(detectKind(cols, t.rows.length), "funnel_summary");
  const m = suggestMapping("funnel_summary", cols);
  assert.equal(m.step, "eventName");
  assert.equal(m.users, "totalUsers");
  assert.deepEqual(m.segments, ["country"]);
  const r = analyzeFunnelSummary(t, m);
  assert.deepEqual(r.funnel.map((f) => f.sessions), [18000, 5900, 1710]);
  const br = r.findings.find((f) => f.value === "BR" && f.from_stage === "add_to_cart")!;
  assert.ok(br.q < 0.001 && br.diff_pp < -10, JSON.stringify(br));
  assert.equal(r.insights.find((i) => i.level === "critical")?.title, "country = BR under-performs at add_to_cart → purchase");
});
