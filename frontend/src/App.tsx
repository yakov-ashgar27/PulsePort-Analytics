import { Anchor, BarChart3, Bot, FileText, FlaskConical, Github, Info, Moon, Sun } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api, IS_DEMO, snapshotInfo } from "./api/client";
import FunnelAnalytics from "./components/FunnelAnalytics";
import KpiOverview from "./components/KpiOverview";
import { ErrorState, Loading } from "./components/ui";
import { useApi } from "./hooks/useApi";
import type { Filters } from "./types/analytics";

const AbTestLab = lazy(() => import("./components/AbTestLab"));
const AiBenchmarkStudio = lazy(() => import("./components/AiBenchmarkStudio"));
const ExecutiveBriefModal = lazy(() => import("./components/ExecutiveBriefModal"));

const TABS = [
  { id: "funnel", label: "Digital Funnel & Regions", Icon: BarChart3 },
  { id: "ab", label: "A/B Testing Lab", Icon: FlaskConical },
  { id: "ai", label: "AI Evaluation & ROI", Icon: Bot },
] as const;
type TabId = (typeof TABS)[number]["id"];

const EMPTY_FILTERS: Filters = { region: null, device_type: null, date_from: null, date_to: null };

function readTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem("pulseport-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readTab(): TabId {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? "funnel") as TabId;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  const [tab, setTab] = useState<TabId>(readTab);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [briefOpen, setBriefOpen] = useState(false);
  const meta = useApi((s) => api.meta(s), []);
  const snap = useApi((s) => (IS_DEMO ? snapshotInfo(s) : Promise.resolve(null)), []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("pulseport-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#0b1526] ring-1 ring-white/10">
              <Anchor className="h-5 w-5 text-[#34d399]" aria-hidden />
            </div>
            <div>
              <h1 className="text-[15px] leading-tight font-semibold text-ink">PulsePort Analytics</h1>
              <p className="text-[11px] text-ink-3">Digital experience · Statistical A/B testing · AI evaluation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setBriefOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:text-[#04261b]"
            >
              <FileText className="h-4 w-4" aria-hidden /> Generate Management Brief
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 sm:px-6" role="tablist" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === id ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
        {IS_DEMO && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-s1/40 bg-s1/10 px-4 py-2.5 text-xs text-ink-2">
            <Info className="h-4 w-4 shrink-0 text-s1" aria-hidden />
            <span>
              <b className="text-ink">Static live demo.</b> Every figure was computed by the real pipeline (PostgreSQL → SQL → SciPy) in CI
              {snap.data ? ` on ${snap.data.generated_at.slice(0, 10)}` : ""}. Run <code className="font-mono">docker compose up</code> for the
              full interactive API.
            </span>
            <a
              href="https://github.com/yakov-ashgar27/PulsePort-Analytics"
              className="ml-auto inline-flex items-center gap-1 font-medium text-ink hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              <Github className="h-3.5 w-3.5" aria-hidden /> Source
            </a>
          </div>
        )}
        {meta.error ? (
          <ErrorState error={meta.error} onRetry={meta.reload} />
        ) : !meta.data ? (
          <Loading label="Connecting to analytics API…" />
        ) : (
          <>
            <KpiOverview filters={filters} slaMs={meta.data.quote_sla_ms} />
            <Suspense fallback={<Loading />}>
              {tab === "funnel" && <FunnelAnalytics filters={filters} setFilters={setFilters} meta={meta.data} />}
              {tab === "ab" && <AbTestLab />}
              {tab === "ai" && <AiBenchmarkStudio />}
            </Suspense>
          </>
        )}
        <footer className="pt-4 pb-8 text-center text-[11px] text-ink-3">
          Synthetic portal data for demonstration · Statistics computed with SciPy / NumPy · Aggregations in PostgreSQL 16
        </footer>
      </main>

      {briefOpen && (
        <Suspense fallback={null}>
          <ExecutiveBriefModal onClose={() => setBriefOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
