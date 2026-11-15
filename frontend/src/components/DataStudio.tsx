import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Info,
  Link2,
  Loader2,
  Lock,
  OctagonX,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  type AiEvalResult,
  type AnalysisResult,
  analyzeAiEval,
  analyzeEvents,
  analyzeExperiment,
  detectStages,
  type EventsResult,
  type ExperimentResult,
  type Insight,
  listVariants,
  guessControl,
  toMarkdown,
} from "../lib/data/analyze";
import { normalizeSourceUrl, parseCsv, type Table, toCsv } from "../lib/data/csv";
import {
  type ColumnProfile,
  type DatasetKind,
  detectKind,
  KIND_INFO,
  type Mapping,
  missingRoles,
  profile,
  type Role,
  ROLE_LABEL,
  suggestMapping,
} from "../lib/data/detect";
import { fmtInt, fmtMs, fmtP, fmtPct } from "../lib/format";
import type { ExperimentAnalysis } from "../types/analytics";
import { ExperimentDetail } from "./AbTestLab";
import { CategoryMatrix, TestRow } from "./AiBenchmarkStudio";
import { Card, ErrorState, LegendItem, NumberField, Pill, TooltipBox } from "./ui";

const SAMPLES = [
  { file: "maritime_portal_events.csv", label: "Shipping portal events", hint: "Funnel · 6k sessions · regions & latency" },
  { file: "ecommerce_checkout_events.csv", label: "E-commerce checkout", hint: "Funnel · 7k sessions · countries & devices" },
  { file: "ab_test_booking_flow.csv", label: "A/B test (per user)", hint: "20k users · conversion + time metric" },
  { file: "ab_test_summary_eta_banner.csv", label: "A/B test (summary)", hint: "Two rows: users & conversions" },
  { file: "ai_assistant_eval.csv", label: "AI model evaluation", hint: "900 graded answers · 3 models" },
];

interface Loaded {
  table: Table;
  cols: ColumnProfile[];
  source: string;
}

export default function DataStudio() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const ingest = (text: string, source: string) => {
    try {
      const table = parseCsv(text);
      if (table.rows.length > 1_000_000) throw new Error("Files over 1M rows are best analysed with the Docker deployment.");
      setLoaded({ table, cols: profile(table), source });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const fromUrl = async (url: string, label?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(normalizeSourceUrl(url));
      if (!res.ok) throw new Error(`Could not fetch the data (HTTP ${res.status}). For Google Sheets, share as “Anyone with the link”.`);
      const text = await res.text();
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("The link returned a web page, not CSV. For Google Sheets, share as “Anyone with the link”.");
      ingest(text, label ?? url);
    } catch (e) {
      setError(e instanceof TypeError ? new Error("The source blocked the request (CORS) or is unreachable. Download it as CSV and upload the file instead.") : (e as Error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Database className="h-5 w-5 text-brand" aria-hidden /> Data Studio: analyse your own data
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              Bring an event log, A/B test results or an AI evaluation log from any product or industry. PulsePort detects the structure,
              runs the same statistics as the backend engine (verified against SciPy) and explains what matters.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2.5 py-1 text-xs font-medium text-good">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Runs in your browser. Data is never uploaded
          </span>
        </div>
        {loaded ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-ink-2">
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              <b className="text-ink">{loaded.source}</b> · {fmtInt(loaded.table.rows.length)} rows · {loaded.table.headers.length} columns
              {loaded.table.skipped > 0 && <Pill tone="warning">{loaded.table.skipped} malformed rows skipped</Pill>}
            </span>
            <button className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink" onClick={() => setLoaded(null)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Use different data
            </button>
          </div>
        ) : (
          <SourcePicker onText={ingest} onUrl={fromUrl} busy={busy} />
        )}
        {error && (
          <p className="mt-3 flex items-start gap-2 text-sm text-critical" role="alert">
            <OctagonX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error.message}
          </p>
        )}
      </div>
      {loaded && <Workbench key={loaded.source + loaded.table.rows.length} loaded={loaded} />}
    </div>
  );
}

// ------------------------------------------------------------------ sources
function SourcePicker({ onText, onUrl, busy }: { onText: (t: string, s: string) => void; onUrl: (u: string, label?: string) => void; busy: boolean }) {
  const [tab, setTab] = useState<"file" | "paste" | "url">("file");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const readFile = (f: File) => f.text().then((t) => onText(t, f.name));
  const base = import.meta.env.BASE_URL;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mb-2 flex gap-1" role="tablist">
          {(
            [
              ["file", "Upload CSV", Upload],
              ["paste", "Paste table", ClipboardPaste],
              ["url", "Google Sheet / URL", Link2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-brand/15 text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
        {tab === "file" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm transition ${drag ? "border-brand bg-brand/5" : "border-line hover:border-ink-3"}`}
          >
            <Upload className="h-6 w-6 text-ink-3" aria-hidden />
            <span className="font-medium text-ink">Drop a CSV file here or click to choose</span>
            <span className="text-xs text-ink-3">Comma, semicolon or tab separated · exports from Excel, Google Sheets, GA4, Mixpanel, SQL…</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </div>
        )}
        {tab === "paste" && (
          <div className="space-y-2">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Paste rows copied from Excel / Sheets, including the header row\nvariant\tusers\tconversions\nA\t10000\t1200\nB\t10000\t1368"}
              className="h-40 w-full rounded-xl border border-line bg-surface p-3 font-mono text-xs text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none"
            />
            <button disabled={!paste.trim()} onClick={() => onText(paste, "Pasted table")} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:text-[#04261b]">
              Use pasted data
            </button>
          </div>
        )}
        {tab === "url" && (
          <div className="space-y-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…  or any public .csv link"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none"
            />
            <p className="text-xs text-ink-3">
              Google Sheets: Share → “Anyone with the link can view”, then paste the sheet link. The tab you have open (gid) is the one loaded. Re-load any time to
              refresh with live data.
            </p>
            <button disabled={!url.trim() || busy} onClick={() => onUrl(url)} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:text-[#04261b]">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Connect
            </button>
          </div>
        )}
      </div>
      <div className="lg:col-span-2">
        <div className="mb-2 text-sm font-medium text-ink-2">…or try a sample dataset</div>
        <ul className="space-y-1.5">
          {SAMPLES.map((s) => (
            <li key={s.file} className="flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() => onUrl(`${base}samples/${s.file}`, s.file)}
                className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left hover:border-ink-3 disabled:opacity-50"
              >
                <span>
                  <span className="block text-sm font-medium text-ink">{s.label}</span>
                  <span className="block text-[11px] text-ink-3">{s.hint}</span>
                </span>
                <Play className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              </button>
              <a href={`${base}samples/${s.file}`} download className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-3 hover:text-ink" aria-label={`Download ${s.file}`}>
                <Download className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- workbench
function Workbench({ loaded }: { loaded: Loaded }) {
  const { table, cols } = loaded;
  const [kind, setKind] = useState<DatasetKind>(() => detectKind(cols, table.rows.length));
  const detected = useMemo(() => detectKind(cols, table.rows.length), [cols, table.rows.length]);
  const [mapping, setMapping] = useState<Mapping>(() => suggestMapping(kind, cols));
  const [stageOrder, setStageOrder] = useState<string[] | null>(null);
  const [control, setControl] = useState<string | null>(null);
  const [mde, setMde] = useState(5);
  const [guardrail, setGuardrail] = useState(5);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [runError, setRunError] = useState<Error | null>(null);
  const [running, setRunning] = useState(false);

  const changeKind = (k: DatasetKind) => {
    setKind(k);
    setMapping(suggestMapping(k, cols));
    setStageOrder(null);
    setResult(null);
  };
  const missing = missingRoles(kind, mapping);
  const stages = useMemo(() => (kind === "events" && mapping.session_id && mapping.step ? detectStages(table, mapping) : []), [kind, mapping, table]);
  const order = stageOrder ?? stages.slice(0, 6).map((s) => s.stage);
  const variants = useMemo(() => (kind.startsWith("experiment") && mapping.variant ? listVariants(table, mapping) : []), [kind, mapping, table]);

  const run = () => {
    setRunning(true);
    setRunError(null);
    // let the spinner paint before the (synchronous) number crunching
    setTimeout(() => {
      try {
        const r =
          kind === "events"
            ? analyzeEvents(table, mapping, order)
            : kind === "ai_eval"
              ? analyzeAiEval(table, mapping, guardrail / 100)
              : analyzeExperiment(table, kind === "experiment_summary" ? { variant: mapping.variant, users: mapping.users, conversions: mapping.conversions } : mapping, {
                  control: control ?? undefined,
                  mde: mde / 100,
                });
        setResult(r);
      } catch (e) {
        setRunError(e instanceof Error ? e : new Error(String(e)));
        setResult(null);
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const roles = [...KIND_INFO[kind].required, ...KIND_INFO[kind].optional].filter((r) => r !== "segment");
  const catCols = cols.filter((c) => c.type === "category" || c.type === "boolean");

  return (
    <>
      <Card title="1 · What is this data?" subtitle="Auto-detected from column names and types. Change it if needed.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(KIND_INFO) as DatasetKind[]).map((k) => (
            <button
              key={k}
              onClick={() => changeKind(k)}
              className={`rounded-lg border p-3 text-left ${kind === k ? "border-brand bg-brand/5 ring-2 ring-brand/25" : "border-line hover:border-ink-3"}`}
            >
              <div className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
                {KIND_INFO[k].label}
                {k === detected && <Pill tone="good">detected</Pill>}
              </div>
              <p className="mt-1 text-xs text-ink-3">{KIND_INFO[k].description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card title="2 · Map your columns" subtitle="Required fields are marked *. Any column names work. These are only suggestions.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {roles.map((r) => (
            <RoleSelect key={r} role={r} required={KIND_INFO[kind].required.includes(r)} value={mapping[r]} cols={cols} onChange={(v) => {
              setMapping({ ...mapping, [r]: v });
              if (r === "step" || r === "session_id") setStageOrder(null);
            }} />
          ))}
        </div>

        {(kind === "events" || kind === "experiment") && catCols.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-ink-3">Segments to compare (up to 3; pairs are tested too)</div>
            <div className="flex flex-wrap gap-2">
              {catCols
                .filter((c) => !Object.values(mapping).includes(c.name) || mapping.segments?.includes(c.name))
                .map((c) => {
                  const on = mapping.segments?.includes(c.name) ?? false;
                  return (
                    <label key={c.name} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-ink-2"}`}>
                      <input
                        type="checkbox"
                        className="accent-current"
                        checked={on}
                        onChange={() => {
                          const cur = mapping.segments ?? [];
                          setMapping({ ...mapping, segments: on ? cur.filter((x) => x !== c.name) : [...cur, c.name].slice(-3) });
                        }}
                      />
                      {c.name} <span className="text-ink-3">({c.distinct})</span>
                    </label>
                  );
                })}
            </div>
          </div>
        )}

        {kind === "events" && stages.length > 0 && (
          <StageEditor stages={stages} order={order} onChange={setStageOrder} />
        )}

        {kind.startsWith("experiment") && variants.length >= 2 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
              Control (baseline)
              <select className="h-9 min-w-40 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink" value={control ?? guessControl(variants)} onChange={(e) => setControl(e.target.value)}>
                {variants.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <div className="w-44">
              <NumberField label="Min. detectable effect" value={mde} onChange={setMde} step={1} min={1} max={100} suffix="%" />
            </div>
          </div>
        )}
        {kind === "ai_eval" && (
          <div className="mt-4 w-56">
            <NumberField label="Hallucination guardrail" value={guardrail} onChange={setGuardrail} step={1} min={0} max={100} suffix="%" />
          </div>
        )}

        <Preview table={table} cols={cols} mapping={mapping} />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={missing.length > 0 || running}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 dark:text-[#04261b]"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            Analyse
          </button>
          {missing.length > 0 && <span className="text-xs text-warning">Map: {missing.map((r) => ROLE_LABEL[r]).join(", ")}</span>}
        </div>
        {runError && <ErrorState error={runError} />}
      </Card>

      {result && <Results r={result} source={loaded.source} />}
    </>
  );
}

function RoleSelect({ role, required, value, cols, onChange }: { role: Role; required: boolean; value?: string; cols: ColumnProfile[]; onChange: (v?: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {ROLE_LABEL[role]}
      {required ? " *" : ""}
      <select
        className={`h-9 rounded-lg border bg-surface px-2.5 text-sm text-ink ${required && !value ? "border-warning" : "border-line"}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{required ? "Choose a column…" : "(none)"}</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} · {c.type}
          </option>
        ))}
      </select>
    </label>
  );
}

function StageEditor({ stages, order, onChange }: { stages: { stage: string; sessions: number }[]; order: string[]; onChange: (o: string[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const o = [...order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    onChange(o);
  };
  const unused = stages.filter((s) => !order.includes(s.stage));
  const count = (s: string) => stages.find((x) => x.stage === s)?.sessions ?? 0;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-3">Funnel steps, in order (sessions must pass them in this sequence)</div>
        <ol className="space-y-1">
          {order.map((s, i) => (
            <li key={s} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm">
              <span className="tabular w-5 text-xs text-ink-3">{i + 1}</span>
              <span className="flex-1 font-medium text-ink">{s}</span>
              <span className="tabular text-xs text-ink-3">{fmtInt(count(s))}</span>
              <button aria-label="Move up" className="text-ink-3 hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-4 w-4" />
              </button>
              <button aria-label="Move down" className="text-ink-3 hover:text-ink disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-4 w-4" />
              </button>
              <button aria-label="Remove step" className="text-xs text-ink-3 hover:text-critical" onClick={() => onChange(order.filter((x) => x !== s))}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      </div>
      {unused.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">Other events found (click to add)</div>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {unused.map((s) => (
              <button key={s.stage} onClick={() => onChange([...order, s.stage])} className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-ink-3">
                + {s.stage} <span className="text-ink-3">({fmtInt(s.sessions)})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Preview({ table, cols, mapping }: { table: Table; cols: ColumnProfile[]; mapping: Mapping }) {
  const roleOf = (name: string) => (Object.entries(mapping).find(([k, v]) => k !== "segments" && v === name)?.[0] as Role | undefined) ?? (mapping.segments?.includes(name) ? "segment" : undefined);
  return (
    <details className="mt-4 rounded-lg border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-2">Preview first rows &amp; column profile</summary>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-xs">
          <thead className="bg-surface-2 text-ink-3">
            <tr>
              {cols.map((c) => (
                <th key={c.name} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                  <div className="text-ink">{c.name}</div>
                  <div>
                    {c.type}
                    {c.missing ? ` · ${c.missing} blank` : ""}
                    {roleOf(c.name) ? ` · → ${ROLE_LABEL[roleOf(c.name)!]}` : ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 6).map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((v, j) => (
                  <td key={j} className="max-w-48 truncate px-2 py-1 text-ink-2">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ results
const LEVEL: Record<Insight["level"], { cls: string; Icon: typeof Info; label: string }> = {
  critical: { cls: "border-critical/40 bg-critical/5", Icon: OctagonX, label: "Critical" },
  warning: { cls: "border-warning/40 bg-warning/5", Icon: AlertTriangle, label: "Watch" },
  good: { cls: "border-good/40 bg-good/5", Icon: CheckCircle2, label: "Positive" },
  info: { cls: "border-line bg-surface-2", Icon: Info, label: "Note" },
};
const LEVEL_TEXT: Record<Insight["level"], string> = { critical: "text-critical", warning: "text-warning", good: "text-good", info: "text-ink-3" };

function Results({ r, source }: { r: AnalysisResult; source: string }) {
  const md = useMemo(() => toMarkdown(r, source), [r, source]);
  const [copied, setCopied] = useState(false);
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const findingsCsv = () => {
    if (r.kind === "events")
      return toCsv(
        ["dimension", "value", "step", "entries", "rate", "rest_rate", "diff_pp", "p", "q_fdr", "lost_conversions"],
        r.findings.map((f) => [f.dimension, f.value, f.transition, f.entries, f.rate.toFixed(5), f.rest_rate.toFixed(5), f.diff_pp.toFixed(2), f.p, f.q, Math.round(f.lost_conversions)]),
      );
    if (r.kind === "experiment")
      return toCsv(
        ["variant", "vs", "rate_control", "rate_variant", "uplift", "ci_low", "ci_high", "p", "p_adjusted", "prob_beats_control", "verdict"],
        r.comparisons.map((c) => [c.variant, r.control, c.freq.rate_a, c.freq.rate_b, c.freq.relative_uplift, c.freq.uplift_ci_low, c.freq.uplift_ci_high, c.freq.p_value_z, c.p_adjusted, c.bayes.prob_b_beats_a, c.decision.verdict]),
      );
    return toCsv(
      ["model", "n", "mean_accuracy", "ci_low", "ci_high", "hallucination_rate", "p95_latency", "cost_per_1k"],
      r.models.map((m) => [m.model, m.n, m.mean_accuracy, m.accuracy_ci_low, m.accuracy_ci_high, m.hallucination_rate, m.p95_latency_ms, m.cost_per_1k_usd]),
    );
  };

  return (
    <div className="space-y-5">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden /> 3 · Insights
          </span>
        }
        subtitle={`${fmtInt(r.quality.used)} of ${fmtInt(r.quality.rows)} rows used · ranked by severity and business impact`}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2"
              onClick={async () => {
                await navigator.clipboard.writeText(md);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? "Copied" : "Copy report"}
            </button>
            <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2" onClick={() => download("pulseport-findings.md", md, "text/markdown")}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Report .md
            </button>
            <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2" onClick={() => download("pulseport-results.csv", findingsCsv(), "text/csv")}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Results .csv
            </button>
          </div>
        }
      >
        <ul className="grid gap-2 lg:grid-cols-2">
          {r.insights.map((i, k) => {
            const L = LEVEL[i.level];
            return (
              <li key={k} className={`rounded-lg border p-3 ${L.cls}`}>
                <div className="flex items-start gap-2">
                  <L.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${LEVEL_TEXT[i.level]}`} aria-label={L.label} />
                  <div>
                    <div className="text-sm font-semibold text-ink">{i.title}</div>
                    <p className="mt-0.5 text-xs text-ink-2">{i.detail}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {r.kind === "events" && <EventsView r={r} />}
      {r.kind === "experiment" && <ExperimentView r={r} />}
      {r.kind === "ai_eval" && <AiView r={r} />}
    </div>
  );
}

function EventsView({ r }: { r: EventsResult }) {
  const [showAll, setShowAll] = useState(false);
  const findings = r.findings.filter((f) => showAll || f.q < 0.05);
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Funnel" subtitle={`${fmtInt(r.sessions)} sessions · ordered progression · ${fmtPct(r.conversion_rate, 2)} end-to-end`}>
          <ol className="space-y-1">
            {r.funnel.map((s, i) => (
              <li key={s.stage}>
                {i > 0 && (
                  <div className="py-1 pl-2 text-xs text-ink-3">
                    ↓ {s.step_conversion_pct!.toFixed(1)}% continue ·{" "}
                    <span className={s.step_dropoff_pct! > 50 ? "font-medium text-critical" : ""}>{s.step_dropoff_pct!.toFixed(1)}% drop</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="h-9 flex-1 rounded-md bg-surface-2">
                    <div className="flex h-9 items-center truncate rounded-md bg-s1 px-3 text-xs font-medium text-white" style={{ width: `${Math.max(s.cumulative_conversion_pct, 8)}%` }}>
                      {s.stage}
                    </div>
                  </div>
                  <div className="tabular w-24 text-right text-sm font-semibold text-ink">{fmtInt(s.sessions)}</div>
                </div>
              </li>
            ))}
          </ol>
          {r.latency && (
            <p className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
              <b className="text-ink">Latency link</b> at {r.latency.worst_step}: r = {r.latency.r.toFixed(2)} (p = {fmtP(r.latency.p)}), median {fmtMs(r.latency.p50)}, P95{" "}
              {fmtMs(r.latency.p95)}
            </p>
          )}
        </Card>
        <Card className="xl:col-span-3" title="Conversion trend" subtitle={r.trend.length ? "Daily end-to-end conversion with 7-day moving average" : "Map a timestamp column to see trends"}
          action={r.trend.length ? <div className="flex gap-3"><LegendItem color="var(--series-1)" label="7-day MA" /><LegendItem color="var(--text-3)" label="Daily" dashed /></div> : undefined}>
          {r.trend.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={r.trend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
                  <YAxis tickFormatter={(v: number) => `${v}%`} width={52} />
                  <Tooltip
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as EventsResult["trend"][number] | undefined;
                      if (!active || !p) return null;
                      return <TooltipBox title={p.day} rows={[{ label: "7-day MA", value: `${p.conversion_ma7_pct.toFixed(2)}%`, color: "var(--series-1)" }, { label: "Daily", value: `${p.conversion_pct.toFixed(2)}%` }, { label: "Sessions", value: fmtInt(p.sessions) }]} />;
                    }}
                  />
                  <Line dataKey="conversion_pct" stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} />
                  <Line dataKey="conversion_ma7_pct" stroke="var(--series-1)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-ink-3">No timestamp column mapped.</p>
          )}
        </Card>
      </div>
      {r.findings.length > 0 && (
        <Card
          title="Segment × step diagnostics"
          subtitle="Each segment vs everyone else at every step · two-proportion z / Fisher exact · Benjamini–Hochberg FDR (q)"
          action={
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show non-significant
            </label>
          }
        >
          <SimpleTable
            head={["Segment", "Value", "Step", "Entries", "Pass rate", "Everyone else", "Δ pp", "q", "Lost conv."]}
            rows={findings.slice(0, 40).map((f) => [
              f.dimension,
              <b key="v" className="text-ink">{f.value}</b>,
              f.transition,
              fmtInt(f.entries),
              fmtPct(f.rate),
              fmtPct(f.rest_rate),
              <span key="d" className={f.diff_pp < -2 && f.q < 0.05 ? "font-semibold text-critical" : f.diff_pp > 2 && f.q < 0.05 ? "font-semibold text-good" : ""}>{f.diff_pp > 0 ? "+" : ""}{f.diff_pp.toFixed(1)}</span>,
              fmtP(f.q),
              fmtInt(f.lost_conversions),
            ])}
            empty="No statistically significant segment differences."
          />
        </Card>
      )}
    </>
  );
}

function toAnalysis(r: ExperimentResult, i: number): ExperimentAnalysis {
  const c = r.comparisons[i]!;
  return {
    experiment_id: `${c.variant} vs ${r.control}`,
    name: `${c.variant} vs ${r.control}`,
    hypothesis: "",
    control_label: r.control,
    variant_label: c.variant,
    primary_metric: "Conversion rate",
    days_running: r.days_running ? Math.round(r.days_running * 10) / 10 : 0,
    daily_traffic: r.daily_traffic ?? 0,
    required_n_per_arm_observed_effect: c.required_n,
    days_remaining_for_power: c.days_remaining,
    mde_relative: r.mde,
    power_at_mde: c.power_at_mde,
    frequentist: c.freq,
    bayesian: c.bayes,
    time_to_quote: c.metric,
    secondary_label: r.metric_name ?? undefined,
    decision: c.decision,
  };
}

function ExperimentView({ r }: { r: ExperimentResult }) {
  return (
    <>
      <Card title="Arms" subtitle={r.srm ? `Sample-ratio check: χ² = ${r.srm.chi2.toFixed(2)}, p = ${fmtP(r.srm.p)}${r.srm.p < 0.001 ? " ⚠ mismatch" : " · OK"}` : undefined}>
        <SimpleTable
          head={["Variant", "Users", "Conversions", "Rate"]}
          rows={r.arms.map((a) => [<b key="v" className="text-ink">{a.variant}{a.variant === r.control ? " (control)" : ""}</b>, fmtInt(a.users), fmtInt(a.conversions), fmtPct(a.rate, 2)])}
        />
      </Card>
      {r.comparisons.map((_, i) => (
        <ExperimentDetail key={i} e={toAnalysis(r, i)} />
      ))}
      {r.segment_effects.length > 0 && (
        <Card title="Does the effect hold in every segment?" subtitle="Lift within each segment value · FDR-adjusted q · look for reversals before a full rollout">
          <SimpleTable
            head={["Segment", "Value", "Users", "Lift", "q"]}
            rows={r.segment_effects.map((e) => [e.dimension, <b key="v" className="text-ink">{e.value}</b>, fmtInt(e.users), fmtPct(e.uplift, 1, true), fmtP(e.q)])}
          />
        </Card>
      )}
    </>
  );
}

function AiView({ r }: { r: AiEvalResult }) {
  const order = [...r.models.map((m) => m.model)].sort();
  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Card className="xl:col-span-3" title="Model comparison" subtitle={`Mean score with 95% t-CI · hallucination with Wilson CI · guardrail ${fmtPct(r.guardrail, 0)}`}>
        <SimpleTable
          head={["Model", "n", "Score (95% CI)", "Hallucination", "P95 latency", "Cost / 1k", ""]}
          rows={r.models.map((m, i) => [
            <b key="m" className="text-ink">{i === 0 ? "★ " : ""}{m.model}</b>,
            fmtInt(m.n),
            `${m.mean_accuracy.toFixed(1)} [${m.accuracy_ci_low.toFixed(1)}–${m.accuracy_ci_high.toFixed(1)}]`,
            m.hallucination_rate === null ? "—" : fmtPct(m.hallucination_rate),
            m.p95_latency_ms === null ? "—" : fmtMs(m.p95_latency_ms),
            m.cost_per_1k_usd === null ? "—" : `$${m.cost_per_1k_usd.toFixed(2)}`,
            m.passes_guardrail ? <Pill key="g" tone="good">OK</Pill> : <Pill key="g" tone="critical">Over guardrail</Pill>,
          ])}
        />
        {r.categories.length > 1 && (
          <div className="mt-5">
            <CategoryMatrix cells={r.category_matrix} order={order} />
          </div>
        )}
      </Card>
      <Card className="xl:col-span-2" title="Statistical tests">
        <ul className="space-y-3 text-sm">
          <TestRow name="Kruskal-Wallis H (all models)" stat={r.tests.kruskal_h != null ? `H = ${r.tests.kruskal_h.toFixed(2)}` : "—"} p={r.tests.kruskal_p} />
          <TestRow name={`Welch t: ${r.tests.top_two?.[0]} vs ${r.tests.top_two?.[1]}`} stat={r.tests.welch_t != null ? `t = ${r.tests.welch_t.toFixed(2)}` : "—"} p={r.tests.welch_p} />
          <TestRow name="χ²: model × hallucination" stat={r.tests.halluc_chi2 != null ? `χ² = ${r.tests.halluc_chi2.toFixed(2)}` : "—"} p={r.tests.halluc_p} />
        </ul>
      </Card>
    </div>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-3">{empty ?? "No rows."}</p>;
  return (
    <div className="-mx-5 -mb-5 overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs text-ink-3">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-medium ${i < 3 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 text-ink-2 ${j < 3 ? "text-left" : "text-right"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
