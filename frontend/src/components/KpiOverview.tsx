import { Activity, FlaskConical, Ship, Timer } from "lucide-react";
import { api } from "../api/client";
import { useApi } from "../hooks/useApi";
import { fmtInt, fmtPct100 } from "../lib/format";
import type { Filters } from "../types/analytics";
import { ErrorState, Stat } from "./ui";

export default function KpiOverview({ filters, slaMs }: { filters: Filters; slaMs: number }) {
  const { data, error, reload } = useApi((s) => api.kpis(filters, s), [JSON.stringify(filters)]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const p95 = data?.p95_quote_time_s ?? null;
  const breach = p95 != null && p95 * 1000 > slaMs;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Portal sessions"
        icon={<Activity className="h-4 w-4" aria-hidden />}
        value={data ? fmtInt(data.total_sessions) : "…"}
        hint="Unique sessions in selected scope"
      />
      <Stat
        label="Booking conversion"
        icon={<Ship className="h-4 w-4" aria-hidden />}
        value={data ? fmtPct100(data.booking_conversion_pct, 2) : "…"}
        hint={data ? `${fmtInt(data.bookings)} confirmed bookings` : " "}
      />
      <Stat
        label="Avg quote time"
        icon={<Timer className="h-4 w-4" aria-hidden />}
        value={data?.avg_quote_time_s != null ? `${data.avg_quote_time_s.toFixed(2)} s` : "…"}
        hint={
          p95 != null ? (
            <span className={breach ? "font-medium text-critical" : ""}>
              P95 {p95.toFixed(2)} s · SLA {(slaMs / 1000).toFixed(1)} s{breach ? " · breached" : ""}
            </span>
          ) : (
            " "
          )
        }
      />
      <Stat
        label="Active experiments"
        icon={<FlaskConical className="h-4 w-4" aria-hidden />}
        value={data ? data.active_experiments : "…"}
        hint="Randomised A/B tests running"
      />
    </div>
  );
}
