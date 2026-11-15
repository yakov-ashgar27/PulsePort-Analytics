import type {
  Benchmark,
  BottleneckRow,
  ExecutiveBrief,
  ExperimentAnalysis,
  ExperimentSummary,
  Filters,
  FunnelStep,
  Kpis,
  Meta,
  PowerAnalysis,
  PowerAnalysisRequest,
  RegionRow,
  TrendPoint,
} from "../types/analytics";
import { powerAnalysis } from "../lib/power";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * Static demo mode (GitHub Pages): responses come from JSON snapshots that CI
 * exported from the real API; the power calculator runs in-browser (parity-
 * tested against the Python engine). Live-only actions are disabled.
 */
export const IS_DEMO = import.meta.env.VITE_DEMO === "true";
const DATA = `${import.meta.env.BASE_URL}data`;

const slug = (v: string | null | undefined) =>
  v ? v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "all";
const fkey = (f: Filters) => `${slug(f.region)}__${slug(f.device_type)}`;

async function snapshot<T>(name: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${DATA}/${name}.json`, { signal });
  if (!res.ok) throw new ApiError(res.status, `Snapshot not found: ${name}`);
  return (await res.json()) as T;
}

export interface ConnectorsInfo {
  saved: { name: string; type: string; label: string }[];
  adhoc_allowed: boolean;
  ga4_configured: boolean;
  max_rows: number;
  sqlite_dir: string | null;
  types: string[];
}

export interface TableOut {
  headers: string[];
  rows: string[][];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
  source_label: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConnectorRequest = { connection?: string; source?: Record<string, any>; query?: string; max_rows?: number };

export interface SnapshotInfo {
  generated_at: string;
  files: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const filterQs = (f: Filters) => qs({ ...f });

const live = {
  meta: (signal?: AbortSignal) => request<Meta>("/meta", { signal }),
  kpis: (f: Filters, signal?: AbortSignal) => request<Kpis>(`/kpis${filterQs(f)}`, { signal }),
  funnel: (f: Filters, signal?: AbortSignal) => request<FunnelStep[]>(`/funnel${filterQs(f)}`, { signal }),
  regions: (f: Filters, signal?: AbortSignal) =>
    request<RegionRow[]>(`/analytics/regions${filterQs(f)}`, { signal }),
  bottlenecks: (f: Filters, signal?: AbortSignal) =>
    request<BottleneckRow[]>(`/analytics/bottlenecks${filterQs(f)}`, { signal }),
  trend: (f: Filters, signal?: AbortSignal) => request<TrendPoint[]>(`/analytics/trend${filterQs(f)}`, { signal }),
  experiments: (signal?: AbortSignal) => request<ExperimentSummary[]>("/experiments", { signal }),
  experiment: (id: string, signal?: AbortSignal) =>
    request<ExperimentAnalysis>(`/experiments/${encodeURIComponent(id)}`, { signal }),
  powerAnalysis: (body: PowerAnalysisRequest, signal?: AbortSignal) =>
    request<PowerAnalysis>("/stats/power-analysis", { method: "POST", body: JSON.stringify(body), signal }),
  benchmark: (category: string | null, signal?: AbortSignal) =>
    request<Benchmark>(`/ai-benchmark${qs({ category })}`, { signal }),
  runBenchmark: (n_prompts: number) =>
    request<Benchmark>("/ai-benchmark/run", { method: "POST", body: JSON.stringify({ n_prompts }) }),
  brief: (signal?: AbortSignal) => request<ExecutiveBrief>("/executive-brief", { signal }),
  connectors: (signal?: AbortSignal) => request<ConnectorsInfo>("/connectors", { signal }),
  connectorTest: (body: ConnectorRequest) =>
    request<{ ok: boolean; source_label: string; elapsed_ms: number }>("/connectors/test", { method: "POST", body: JSON.stringify(body) }),
  connectorQuery: (body: ConnectorRequest) => request<TableOut>("/connectors/query", { method: "POST", body: JSON.stringify(body) }),
};

const SELF_HOSTED = "Database and GA4 connectors run in the free self-hosted version (docker compose up)";

const demo: typeof live = {
  meta: (signal) => snapshot<Meta>("meta", signal),
  kpis: (f, signal) => snapshot<Kpis>(`kpis/${fkey(f)}`, signal),
  funnel: (f, signal) => snapshot<FunnelStep[]>(`funnel/${fkey(f)}`, signal),
  regions: (f, signal) => snapshot<RegionRow[]>(`regions/${fkey(f)}`, signal),
  bottlenecks: (f, signal) => snapshot<BottleneckRow[]>(`bottlenecks/${fkey(f)}`, signal),
  trend: (f, signal) => snapshot<TrendPoint[]>(`trend/${fkey(f)}`, signal),
  experiments: (signal) => snapshot<ExperimentSummary[]>("experiments", signal),
  experiment: (id, signal) => snapshot<ExperimentAnalysis>(`experiment/${id}`, signal),
  powerAnalysis: async (body) => powerAnalysis(body),
  benchmark: (category, signal) => snapshot<Benchmark>(`ai-benchmark/${slug(category)}`, signal),
  runBenchmark: async () => {
    throw new ApiError(501, "Live evaluation batches run in the full Docker deployment");
  },
  brief: (signal) => snapshot<ExecutiveBrief>("executive-brief", signal),
  connectors: async () => {
    throw new ApiError(501, SELF_HOSTED);
  },
  connectorTest: async () => {
    throw new ApiError(501, SELF_HOSTED);
  },
  connectorQuery: async () => {
    throw new ApiError(501, SELF_HOSTED);
  },
};

export const api = IS_DEMO ? demo : live;

export const snapshotInfo = (signal?: AbortSignal) => snapshot<SnapshotInfo>("snapshot", signal);
