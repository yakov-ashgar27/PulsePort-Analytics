import { CheckCircle2, Loader2, PlugZap, Server, Terminal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, type ConnectorRequest, IS_DEMO, type TableOut } from "../api/client";
import { useApi } from "../hooks/useApi";
import type { Table } from "../lib/data/csv";
import { fmtInt } from "../lib/format";

type Kind = "postgres" | "mysql" | "sqlite" | "csv_url" | "ga4";

const KIND_LABEL: Record<Kind, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite file",
  csv_url: "CSV URL (fetched by server)",
  ga4: "Google Analytics 4",
};

const LAST_30 = { postgres: "CURRENT_DATE - INTERVAL '30 days'", mysql: "CURRENT_DATE - INTERVAL 30 DAY", sqlite: "date('now', '-30 days')" } as const;

function templates(kind: "postgres" | "mysql" | "sqlite") {
  return [
    {
      label: "Event log (funnel)",
      sql: `SELECT user_id      AS session_id,\n       event_time   AS timestamp,\n       event_name   AS event,\n       country,\n       device\nFROM events\nWHERE event_time >= ${LAST_30[kind]}`,
    },
    {
      label: "A/B test, per user",
      sql: `SELECT user_id, variant, assigned_at, converted\nFROM experiment_assignments\nWHERE experiment_id = 'my-experiment'`,
    },
    {
      label: "A/B test, summary",
      sql: `SELECT variant,\n       COUNT(*) AS users,\n       SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conversions\nFROM experiment_assignments\nWHERE experiment_id = 'my-experiment'\nGROUP BY variant`,
    },
    {
      label: "AI evaluation log",
      sql: `SELECT model, category, score, hallucination, latency_ms, cost_usd\nFROM llm_evaluations`,
    },
  ];
}

const DEMO_DB_SQL = `-- Bundled PulsePort demo database (synthetic maritime portal)
SELECT session_id,
       event_ts         AS timestamp,
       stage            AS event,
       region,
       device_type,
       quote_latency_ms
FROM session_events
WHERE event_ts >= CURRENT_DATE - INTERVAL '30 days'`;

const GA4_PRESETS = [
  { label: "Funnel × country", dimensions: "eventName, country", metrics: "totalUsers" },
  { label: "Funnel × device", dimensions: "eventName, deviceCategory", metrics: "totalUsers" },
  { label: "Funnel × traffic source", dimensions: "eventName, sessionDefaultChannelGroup", metrics: "totalUsers" },
];

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(`pp-conn-${k}`) ?? "";
    localStorage.setItem(`pp-conn-${k}`, v);
  } catch {
    /* storage unavailable */
  }
  return v ?? "";
};

export default function ConnectPanel({ onTable }: { onTable: (t: Table, label: string) => void }) {
  if (IS_DEMO) return <SelfHostNotice />;
  return <LiveConnect onTable={onTable} />;
}

function SelfHostNotice() {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-2">
      <p className="flex items-start gap-2">
        <Server className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span>
          Direct connections to <b className="text-ink">PostgreSQL, MySQL, SQLite, Google Analytics 4</b> and server-side CSV links run in the{" "}
          <b className="text-ink">free self-hosted version</b>, so your credentials stay on your own machine. This public site is static and never sees them.
        </span>
      </p>
      <pre className="overflow-x-auto rounded-lg bg-[#0b1526] p-3 font-mono text-xs leading-relaxed text-[#cfe3ff]">
        {`git clone https://github.com/yakov-ashgar27/PulsePort-Analytics.git
cd PulsePort-Analytics
docker compose up --build
# open http://localhost:3000 → Your Data → Database / GA4`}
      </pre>
      <p className="text-xs text-ink-3">
        Meanwhile: export a CSV from your database or analytics tool and upload it, or connect a Google Sheet. Both work right here.
      </p>
    </div>
  );
}

function LiveConnect({ onTable }: { onTable: (t: Table, label: string) => void }) {
  const info = useApi((s) => api.connectors(s), []);
  const [kind, setKind] = useState<Kind | `saved:${string}`>(() => (remember("kind") as Kind) || "postgres");
  const [host, setHost] = useState(() => remember("host") || "localhost");
  const [port, setPort] = useState(() => remember("port"));
  const [database, setDatabase] = useState(() => remember("database"));
  const [user, setUser] = useState(() => remember("user"));
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [path, setPath] = useState(() => remember("path"));
  const [url, setUrl] = useState(() => remember("url"));
  const [propertyId, setPropertyId] = useState(() => remember("ga4"));
  const [dims, setDims] = useState("eventName, country");
  const [mets, setMets] = useState("totalUsers");
  const [events, setEvents] = useState("page_view, add_to_cart, begin_checkout, purchase");
  const [start, setStart] = useState("28daysAgo");
  const [end, setEnd] = useState("today");
  const [sql, setSql] = useState(() => remember("sql") || templates("postgres")[0]!.sql);
  const [busy, setBusy] = useState<"test" | "fetch" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saved = kind.startsWith("saved:") ? kind.slice(6) : null;
  const savedType = saved ? info.data?.saved.find((s) => s.name === saved)?.type : null;
  const effective = (savedType ?? kind) as Kind;
  const isSql = effective === "postgres" || effective === "mysql" || effective === "sqlite";
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const body = (): ConnectorRequest => {
    const base: ConnectorRequest = { max_rows: info.data?.max_rows };
    if (saved) return { ...base, connection: saved, query: isSql ? sql : undefined };
    let source: Record<string, unknown>;
    if (kind === "postgres" || kind === "mysql")
      source = { type: kind, host, port: Number(port) || (kind === "postgres" ? 5432 : 3306), database, user, password: password || undefined, ssl };
    else if (kind === "sqlite") source = { type: "sqlite", path };
    else if (kind === "csv_url") source = { type: "csv_url", url };
    else source = { type: "ga4", property_id: propertyId, start_date: start, end_date: end, dimensions: list(dims), metrics: list(mets), event_names: list(events) };
    return { ...base, source, query: isSql ? sql : undefined };
  };

  const persist = () => {
    remember("kind", kind);
    remember("host", host);
    remember("port", port);
    remember("database", database);
    remember("user", user);
    remember("path", path);
    remember("url", url);
    remember("ga4", propertyId);
    if (isSql) remember("sql", sql);
  };

  const run = async (mode: "test" | "fetch") => {
    setBusy(mode);
    setMsg(null);
    persist();
    try {
      if (mode === "test") {
        const r = await api.connectorTest(body());
        setMsg({ ok: true, text: `Connected to ${r.source_label} (${r.elapsed_ms} ms)` });
      } else {
        const r: TableOut = await api.connectorQuery(body());
        setMsg({ ok: true, text: `${fmtInt(r.row_count)} rows in ${(r.elapsed_ms / 1000).toFixed(1)} s${r.truncated ? ` (truncated at ${fmtInt(r.row_count)})` : ""}` });
        onTable({ headers: r.headers, rows: r.rows, delimiter: "db", skipped: 0 }, `${saved ?? KIND_LABEL[effective]} · ${r.source_label}`);
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const useDemoDb = () => {
    setKind("postgres");
    setHost("db");
    setPort("5432");
    setDatabase("pulseport");
    setUser("pulseport");
    setPassword("pulseport");
    setSql(DEMO_DB_SQL);
  };

  if (info.error)
    return <p className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm text-critical">Connector API unavailable: {info.error.message}</p>;

  const input = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none";
  const field = (label: string, el: ReactNode, cls = "") => (
    <label className={`flex flex-col gap-1 text-xs font-medium text-ink-3 ${cls}`}>
      {label}
      {el}
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {field(
          "Source",
          <select className={`${input} min-w-56`} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {info.data?.saved.length ? (
              <optgroup label="Saved on server">
                {info.data.saved.map((s) => (
                  <option key={s.name} value={`saved:${s.name}`}>
                    {s.name} · {s.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {info.data?.adhoc_allowed !== false && (
              <optgroup label="New connection">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                    {k === "ga4" && info.data && !info.data.ga4_configured ? " (needs setup)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>,
        )}
        {!saved && (kind === "postgres" || kind === "mysql") && (
          <button onClick={useDemoDb} className="h-9 rounded-lg border border-line px-3 text-xs font-medium text-ink-2 hover:bg-surface-2">
            Use bundled demo database
          </button>
        )}
      </div>

      {!saved && (kind === "postgres" || kind === "mysql") && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {field("Host", <input className={input} value={host} onChange={(e) => setHost(e.target.value)} />, "lg:col-span-2")}
          {field("Port", <input className={input} value={port} placeholder={kind === "postgres" ? "5432" : "3306"} onChange={(e) => setPort(e.target.value)} />)}
          {field("Database", <input className={input} value={database} onChange={(e) => setDatabase(e.target.value)} />)}
          {field("User", <input className={input} value={user} autoComplete="username" onChange={(e) => setUser(e.target.value)} />)}
          {field("Password", <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />)}
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} /> Require SSL
          </label>
          <p className="text-[11px] text-ink-3 lg:col-span-5">
            Use a read-only database user. Queries also run in a READ ONLY transaction with a {">"}60 s timeout. The password is sent only to this server and is never stored.
          </p>
        </div>
      )}
      {!saved && kind === "sqlite" &&
        field(
          `File inside ${info.data?.sqlite_dir ?? "/data (mount a folder there)"}`,
          <input className={input} value={path} placeholder="analytics.db" onChange={(e) => setPath(e.target.value)} />,
        )}
      {!saved && kind === "csv_url" &&
        field("CSV URL", <input className={input} value={url} placeholder="https://… (fetched by the server, so browser CORS limits don't apply)" onChange={(e) => setUrl(e.target.value)} />)}
      {effective === "ga4" && !saved && (
        <div className="space-y-3">
          {info.data && !info.data.ga4_configured && (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-ink-2">
              GA4 needs a one-time, free setup: create a Google Cloud service account, add its e-mail as <b>Viewer</b> on your GA4 property, then mount the JSON key
              and set <code>GOOGLE_APPLICATION_CREDENTIALS</code>. See README → “Connect Google Analytics 4”.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {GA4_PRESETS.map((p) => (
              <button key={p.label} onClick={() => {
                  setDims(p.dimensions);
                  setMets(p.metrics);
                }} className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-ink-3">
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {field("Property ID", <input className={input} value={propertyId} placeholder="123456789" onChange={(e) => setPropertyId(e.target.value)} />)}
            {field("Start date", <input className={input} value={start} onChange={(e) => setStart(e.target.value)} />)}
            {field("End date", <input className={input} value={end} onChange={(e) => setEnd(e.target.value)} />)}
            {field("Metrics", <input className={input} value={mets} onChange={(e) => setMets(e.target.value)} />)}
            {field("Dimensions", <input className={input} value={dims} onChange={(e) => setDims(e.target.value)} />, "sm:col-span-2")}
            {field("Funnel events (optional filter)", <input className={input} value={events} onChange={(e) => setEvents(e.target.value)} />, "sm:col-span-2")}
          </div>
          <p className="text-[11px] text-ink-3">
            GA4 returns users per event (aggregated). PulsePort analyses it as an aggregated funnel with segment comparisons. For exact per-user journeys, query
            the GA4 BigQuery export with SQL.
          </p>
        </div>
      )}
      {isSql && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Terminal className="h-3.5 w-3.5" aria-hidden /> Templates:
            {templates(effective as "postgres" | "mysql" | "sqlite").map((t) => (
              <button key={t.label} onClick={() => setSql(t.sql)} className="rounded-md border border-line px-2 py-0.5 text-ink-2 hover:border-ink-3">
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            className="h-44 w-full rounded-xl border border-line bg-[#0b1526] p-3 font-mono text-xs leading-relaxed text-[#cfe3ff] focus:ring-2 focus:ring-brand/40 focus:outline-none"
          />
          <p className="text-[11px] text-ink-3">Read-only SELECT / WITH only. Alias your columns to clear names (e.g. session_id, event, variant) and the mapping is automatic.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run("test")}
          disabled={!!busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />} Test connection
        </button>
        <button
          onClick={() => void run("fetch")}
          disabled={!!busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50 dark:text-[#04261b]"
        >
          {busy === "fetch" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Fetch &amp; analyse
        </button>
        {msg && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${msg.ok ? "text-good" : "text-critical"}`} role="status">
            {msg.ok && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />} {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
