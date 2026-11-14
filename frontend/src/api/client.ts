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

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

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

export const api = {
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
};
