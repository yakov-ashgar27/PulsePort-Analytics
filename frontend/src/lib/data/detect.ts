/**
 * Column profiling, dataset-kind detection and field-mapping suggestions.
 */
import type { Table } from "./csv.ts";

export type ColumnType = "number" | "boolean" | "datetime" | "category" | "id" | "text" | "empty";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  distinct: number;
  missing: number;
  sample: string[];
}

export type DatasetKind = "events" | "experiment" | "experiment_summary" | "ai_eval";

export type Role =
  // events
  | "session_id"
  | "timestamp"
  | "step"
  | "segment"
  | "latency"
  // experiment (row-level)
  | "variant"
  | "converted"
  | "metric"
  // experiment (aggregated)
  | "users"
  | "conversions"
  // ai eval
  | "model"
  | "score"
  | "hallucination"
  | "cost"
  | "category";

export type Mapping = Partial<Record<Role, string>> & { segments?: string[] };

export const KIND_INFO: Record<DatasetKind, { label: string; description: string; required: Role[]; optional: Role[] }> = {
  events: {
    label: "Event log / funnel",
    description: "One row per user action (page view, step, click). Finds where users drop off and which segments struggle.",
    required: ["session_id", "step"],
    optional: ["timestamp", "latency", "segment"],
  },
  experiment: {
    label: "A/B test — one row per user",
    description: "Each row is a user with the variant they saw and whether they converted (and optionally a numeric metric).",
    required: ["variant", "converted"],
    optional: ["metric", "timestamp", "segment"],
  },
  experiment_summary: {
    label: "A/B test — summary table",
    description: "One row per variant with the number of users and conversions.",
    required: ["variant", "users", "conversions"],
    optional: [],
  },
  ai_eval: {
    label: "AI / model evaluation log",
    description: "One row per graded answer: model, score, hallucination flag, latency, cost, category.",
    required: ["model", "score"],
    optional: ["hallucination", "latency", "cost", "category"],
  },
};

export const ROLE_LABEL: Record<Role, string> = {
  session_id: "Session / user ID",
  timestamp: "Timestamp",
  step: "Event / step name",
  segment: "Segment",
  latency: "Latency / duration",
  variant: "Variant / group",
  converted: "Converted (0/1)",
  metric: "Numeric metric",
  users: "Users",
  conversions: "Conversions",
  model: "Model",
  score: "Score / accuracy",
  hallucination: "Hallucination (0/1)",
  cost: "Cost",
  category: "Category",
};

const TRUE = new Set(["1", "true", "yes", "y", "t", "converted", "success", "purchased", "pass"]);
const FALSE = new Set(["0", "false", "no", "n", "f", "", "fail", "failed"]);
export const parseBool = (v: string) => TRUE.has(v.trim().toLowerCase());
export const isBoolLike = (v: string) => TRUE.has(v.trim().toLowerCase()) || FALSE.has(v.trim().toLowerCase());
export const parseNum = (v: string) => {
  const s = v.trim().replace(/[$€£₪%\s]/g, "").replace(/,(?=\d{3}\b)/g, "");
  return s === "" ? NaN : Number(s);
};
export function parseTime(v: string): number {
  const s = v.trim();
  if (!s) return NaN;
  if (/^\d{10}(\.\d+)?$/.test(s)) return Number(s) * 1000; // unix seconds
  if (/^\d{13}$/.test(s)) return Number(s); // unix ms
  const t = Date.parse(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s);
  return t;
}

export function profile(t: Table): ColumnProfile[] {
  const sampleRows = t.rows.length > 5000 ? t.rows.filter((_, i) => i % Math.ceil(t.rows.length / 5000) === 0) : t.rows;
  return t.headers.map((name, j) => {
    const vals = sampleRows.map((r) => r[j] ?? "");
    const nonEmpty = vals.filter((v) => v !== "");
    const distinct = new Set(nonEmpty).size;
    const missing = vals.length - nonEmpty.length;
    let type: ColumnType = "text";
    if (!nonEmpty.length) type = "empty";
    else if (distinct <= 2 && nonEmpty.every(isBoolLike)) type = "boolean";
    else if (nonEmpty.every((v) => Number.isFinite(parseNum(v)))) type = distinct === nonEmpty.length && distinct > 50 && /id/i.test(name) ? "id" : "number";
    else if (nonEmpty.slice(0, 200).every((v) => Number.isFinite(parseTime(v)) && /\d{4}|\d{1,2}[/.-]\d{1,2}/.test(v))) type = "datetime";
    else if (distinct > Math.max(50, nonEmpty.length * 0.5)) type = "id";
    else type = "category";
    return { name, type, distinct, missing, sample: [...new Set(nonEmpty)].slice(0, 4) };
  });
}

const HINTS: Record<Role, RegExp> = {
  session_id: /^(session|user|visitor|customer|client|account|device)?[_ -]?(id|uuid|key)$|session|visitor|user_?id|customer_?id/i,
  timestamp: /timestamp|date|_at$|^ts$|_ts$|created|occurred|assigned|exposed|^time$|event_?time/i,
  step: /^(event|step|stage|action|page|screen|funnel)(_?name|_?type)?$|event|stage|step/i,
  segment: /region|country|market|segment|device|platform|channel|source|city|plan|tier|browser|os|agency|store|branch/i,
  latency: /latency|duration|load|response|ms$|_ms|seconds|time_to/i,
  variant: /variant|group|arm|bucket|treatment|version|cohort/i,
  converted: /convert|conversion|success|purchase|booked|signup|outcome|clicked|is_|did_/i,
  metric: /revenue|amount|value|order|aov|spend|time|duration|score/i,
  users: /users|visitors|sessions|participants|n$|count|sample|exposures/i,
  conversions: /conversions|converted|purchases|signups|successes|orders/i,
  model: /model|llm|engine|assistant|provider/i,
  score: /score|accuracy|grade|rating|correct/i,
  hallucination: /halluc|fabricat|unsupported|error_flag/i,
  cost: /cost|price|usd|\$|spend/i,
  category: /category|topic|intent|type|task|domain/i,
};

const ROLE_TYPES: Record<Role, ColumnType[]> = {
  session_id: ["id", "category", "number", "text"],
  timestamp: ["datetime", "number"],
  step: ["category", "text"],
  segment: ["category", "boolean"],
  latency: ["number"],
  variant: ["category", "boolean", "number"],
  converted: ["boolean", "number"],
  metric: ["number"],
  users: ["number"],
  conversions: ["number"],
  model: ["category"],
  score: ["number"],
  hallucination: ["boolean"],
  cost: ["number"],
  category: ["category"],
};

function pick(cols: ColumnProfile[], role: Role, used: Set<string>): string | undefined {
  const ok = cols.filter((c) => !used.has(c.name) && ROLE_TYPES[role].includes(c.type));
  const hit = ok.find((c) => HINTS[role].test(c.name));
  if (hit) return hit.name;
  // A lone datetime column is the timestamp even when its name gives no hint
  if (role === "timestamp") return ok.find((c) => c.type === "datetime")?.name;
  return undefined;
}

export function suggestMapping(kind: DatasetKind, cols: ColumnProfile[]): Mapping {
  const used = new Set<string>();
  const m: Mapping = {};
  const roles = [...KIND_INFO[kind].required, ...KIND_INFO[kind].optional].filter((r) => r !== "segment");
  for (const r of roles) {
    const c = pick(cols, r, used);
    if (c) {
      m[r] = c;
      used.add(c);
    }
  }
  if (kind === "events" || kind === "experiment") {
    m.segments = cols
      .filter((c) => !used.has(c.name) && c.type === "category" && c.distinct >= 2 && c.distinct <= 30)
      .map((c) => c.name)
      .slice(0, 3);
  }
  return m;
}

/** Score each dataset kind by how many of its required roles can be filled. */
export function detectKind(cols: ColumnProfile[], rows: number): DatasetKind {
  const score = (k: DatasetKind) => {
    const m = suggestMapping(k, cols);
    const req = KIND_INFO[k].required;
    const filled = req.filter((r) => m[r]).length;
    const opt = KIND_INFO[k].optional.filter((r) => r !== "segment" && m[r]).length;
    return filled === req.length ? 10 + filled * 2 + opt : filled;
  };
  const kinds: DatasetKind[] = ["experiment_summary", "ai_eval", "experiment", "events"];
  let best: DatasetKind = "events";
  let bestScore = -1;
  for (const k of kinds) {
    let s = score(k);
    if (k === "experiment_summary" && rows > 20) s -= 20; // summaries are tiny
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  return best;
}

export function missingRoles(kind: DatasetKind, m: Mapping): Role[] {
  return KIND_INFO[kind].required.filter((r) => !m[r]);
}
