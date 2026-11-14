"""
Analytical SQL layer (PostgreSQL 16).

All queries are raw, parameterised SQL executed through ``sqlalchemy.text``.
Optional filters use the ``CAST(:param AS type) IS NULL OR ...`` idiom so a
single prepared statement serves every filter combination, and every bind is
explicitly typed so asyncpg can prepare the statement without guessing.

Conventions
-----------
* A session "belongs" to the date range in which its PORTAL_VISIT happened,
  so later funnel events are never cut off by the window boundary.
* Percentages are returned as 0–100 numerics rounded to 2 dp.
"""

from __future__ import annotations

from sqlalchemy import text

# --------------------------------------------------------------------------- #
# Shared CTE: sessions in scope after filters (one row per session)
# --------------------------------------------------------------------------- #
_SCOPED_SESSIONS = """
scoped_sessions AS (
    SELECT session_id, region, device_type, event_ts AS started_at
    FROM session_events
    WHERE stage = 'PORTAL_VISIT'
      AND (CAST(:region      AS TEXT)        IS NULL OR region      = CAST(:region AS TEXT))
      AND (CAST(:device_type AS TEXT)        IS NULL OR device_type = CAST(:device_type AS TEXT))
      AND (CAST(:date_from   AS TIMESTAMPTZ) IS NULL OR event_ts   >= CAST(:date_from AS TIMESTAMPTZ))
      AND (CAST(:date_to     AS TIMESTAMPTZ) IS NULL OR event_ts   <  CAST(:date_to   AS TIMESTAMPTZ))
),
-- Pivot each session's events into one row of stage flags (conditional aggregation)
session_flags AS (
    SELECT
        s.session_id,
        s.region,
        s.device_type,
        s.started_at,
        BOOL_OR(e.stage = 'ROUTE_SEARCH')       AS did_search,
        BOOL_OR(e.stage = 'RATE_QUOTE')         AS did_quote,
        BOOL_OR(e.stage = 'BOOKING_CONFIRMED')  AS did_book,
        MAX(e.quote_latency_ms)                 AS quote_latency_ms
    FROM scoped_sessions s
    JOIN session_events e USING (session_id)
    GROUP BY s.session_id, s.region, s.device_type, s.started_at
)
"""

# --------------------------------------------------------------------------- #
# 1. Executive KPIs
# --------------------------------------------------------------------------- #
KPI_OVERVIEW = text(
    f"""
WITH {_SCOPED_SESSIONS}
SELECT
    COUNT(*)                                                         AS total_sessions,
    COUNT(*) FILTER (WHERE did_book)                                 AS bookings,
    ROUND(100.0 * COUNT(*) FILTER (WHERE did_book) / NULLIF(COUNT(*), 0), 2)
                                                                     AS booking_conversion_pct,
    ROUND(AVG(quote_latency_ms) / 1000.0, 3)                         AS avg_quote_time_s,
    ROUND(CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) AS NUMERIC) / 1000.0, 3)
                                                                     AS p95_quote_time_s,
    (SELECT COUNT(DISTINCT experiment_id) FROM experiment_assignments) AS active_experiments
FROM session_flags
"""
)

# --------------------------------------------------------------------------- #
# 2. Multi-stage funnel with LAG() step-to-step conversion
# --------------------------------------------------------------------------- #
FUNNEL = text(
    f"""
WITH {_SCOPED_SESSIONS},
stage_totals AS (
    -- Conditional aggregation: one pass, four counters
    SELECT
        COUNT(*)                          AS portal_visit,
        COUNT(*) FILTER (WHERE did_search) AS route_search,
        COUNT(*) FILTER (WHERE did_quote)  AS rate_quote,
        COUNT(*) FILTER (WHERE did_book)   AS booking_confirmed
    FROM session_flags
),
funnel AS (
    -- Unpivot to one row per stage so window functions can walk the funnel
    SELECT v.step_order, v.stage, v.sessions
    FROM stage_totals t
    CROSS JOIN LATERAL (VALUES
        (1, 'PORTAL_VISIT',      t.portal_visit),
        (2, 'ROUTE_SEARCH',      t.route_search),
        (3, 'RATE_QUOTE',        t.rate_quote),
        (4, 'BOOKING_CONFIRMED', t.booking_confirmed)
    ) AS v(step_order, stage, sessions)
)
SELECT
    step_order,
    stage,
    sessions,
    LAG(sessions) OVER w                                             AS prev_sessions,
    ROUND(100.0 * sessions / NULLIF(LAG(sessions) OVER w, 0), 2)     AS step_conversion_pct,
    ROUND(100.0 - 100.0 * sessions / NULLIF(LAG(sessions) OVER w, 0), 2)
                                                                     AS step_dropoff_pct,
    ROUND(100.0 * sessions / NULLIF(FIRST_VALUE(sessions) OVER w, 0), 2)
                                                                     AS cumulative_conversion_pct
FROM funnel
WINDOW w AS (ORDER BY step_order)
ORDER BY step_order
"""
)

# --------------------------------------------------------------------------- #
# 3. Regional agency × device breakdown, ranked against the global baseline
# --------------------------------------------------------------------------- #
REGIONAL_BREAKDOWN = text(
    f"""
WITH {_SCOPED_SESSIONS},
segments AS (
    SELECT
        region,
        device_type,
        COUNT(*)                            AS sessions,
        COUNT(*) FILTER (WHERE did_search)  AS searches,
        COUNT(*) FILTER (WHERE did_quote)   AS quotes,
        COUNT(*) FILTER (WHERE did_book)    AS bookings,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) AS p95_latency_ms,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY quote_latency_ms) AS p50_latency_ms
    FROM session_flags
    GROUP BY region, device_type
)
SELECT
    region,
    device_type,
    sessions,
    searches,
    quotes,
    bookings,
    ROUND(100.0 * quotes   / NULLIF(searches, 0), 2)                  AS search_to_quote_pct,
    ROUND(100.0 * bookings / NULLIF(sessions, 0), 2)                  AS booking_conversion_pct,
    ROUND(CAST(p50_latency_ms AS NUMERIC), 0)                         AS p50_latency_ms,
    ROUND(CAST(p95_latency_ms AS NUMERIC), 0)                         AS p95_latency_ms,
    -- Global (traffic-weighted) search→quote rate via window aggregates
    ROUND(100.0 * SUM(quotes) OVER () / NULLIF(SUM(searches) OVER (), 0), 2)
                                                                     AS global_search_to_quote_pct,
    ROUND(100.0 * quotes / NULLIF(searches, 0)
          - 100.0 * SUM(quotes) OVER () / NULLIF(SUM(searches) OVER (), 0), 2)
                                                                     AS delta_vs_global_pp,
    RANK() OVER (ORDER BY 1.0 * quotes / NULLIF(searches, 0) ASC)    AS dropoff_rank,
    ROUND(CAST(p95_latency_ms AS NUMERIC), 0) > CAST(:sla_ms AS INTEGER)              AS sla_breach
FROM segments
ORDER BY dropoff_rank
"""
)

# --------------------------------------------------------------------------- #
# 4. Anomaly / bottleneck detector
#    P95 latency vs SLA + Pearson correlation between latency and conversion
# --------------------------------------------------------------------------- #
BOTTLENECK_DETECTOR = text(
    f"""
WITH {_SCOPED_SESSIONS},
searched AS (
    SELECT region, device_type, quote_latency_ms,
           CAST(did_quote AS INT) AS reached_quote
    FROM session_flags
    WHERE did_search
),
region_stats AS (
    SELECT
        region,
        COUNT(*)                                                       AS searches,
        SUM(reached_quote)                                             AS quotes,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) AS p95_latency_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms)
            FILTER (WHERE device_type = 'Mobile')                      AS p95_mobile_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms)
            FILTER (WHERE device_type = 'Desktop')                     AS p95_desktop_ms,
        -- Session-level point-biserial correlation latency ↔ reached quote
        CORR(quote_latency_ms, reached_quote)                          AS latency_conv_corr
    FROM searched
    GROUP BY region
),
global_stats AS (
    SELECT
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) AS global_p95_ms,
        1.0 * SUM(reached_quote) / NULLIF(COUNT(*), 0)                 AS global_quote_rate
    FROM searched
)
SELECT
    r.region,
    r.searches,
    r.quotes,
    ROUND(100.0 * r.quotes / NULLIF(r.searches, 0), 2)               AS quote_rate_pct,
    ROUND(100.0 * g.global_quote_rate, 2)                            AS global_quote_rate_pct,
    ROUND(CAST(r.p95_latency_ms  AS NUMERIC), 0)                     AS p95_latency_ms,
    ROUND(CAST(r.p95_mobile_ms   AS NUMERIC), 0)                     AS p95_mobile_ms,
    ROUND(CAST(r.p95_desktop_ms  AS NUMERIC), 0)                     AS p95_desktop_ms,
    ROUND(CAST(g.global_p95_ms   AS NUMERIC), 0)                     AS global_p95_ms,
    ROUND(CAST(r.latency_conv_corr AS NUMERIC), 3)                   AS latency_conv_corr,
    -- Cross-region correlation of P95 latency with quote rate (window aggregate)
    ROUND(CAST(CORR(r.p95_latency_ms, 1.0 * r.quotes / r.searches) OVER () AS NUMERIC), 3)
                                                                     AS cross_region_corr,
    r.p95_latency_ms > CAST(:sla_ms AS INTEGER)                                       AS sla_breach,
    (r.p95_latency_ms > CAST(:sla_ms AS INTEGER)
        AND 1.0 * r.quotes / NULLIF(r.searches, 0) < g.global_quote_rate) AS is_bottleneck
FROM region_stats r
CROSS JOIN global_stats g
ORDER BY r.p95_latency_ms DESC
"""
)

# --------------------------------------------------------------------------- #
# 5. Daily trend with 7-day moving averages
# --------------------------------------------------------------------------- #
DAILY_TREND = text(
    f"""
WITH {_SCOPED_SESSIONS},
daily AS (
    SELECT
        CAST(date_trunc('day', started_at) AS DATE) AS day,
        COUNT(*)                                    AS sessions,
        COUNT(*) FILTER (WHERE did_book)            AS bookings
    FROM session_flags
    GROUP BY 1
)
SELECT
    day,
    sessions,
    bookings,
    ROUND(100.0 * bookings / NULLIF(sessions, 0), 2)                                AS conversion_pct,
    ROUND(AVG(sessions) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1)
                                                                                    AS sessions_ma7,
    ROUND(100.0 * SUM(bookings) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
        / NULLIF(SUM(sessions) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 0), 2)
                                                                                    AS conversion_ma7_pct
FROM daily
ORDER BY day
"""
)

# --------------------------------------------------------------------------- #
# 6. Experiments
# --------------------------------------------------------------------------- #
EXPERIMENT_ARM_COUNTS = text(
    """
SELECT
    variant,
    COUNT(*)                                   AS n,
    COUNT(*) FILTER (WHERE converted)          AS conversions,
    MIN(assigned_at)                           AS first_assigned,
    MAX(assigned_at)                           AS last_assigned
FROM experiment_assignments
WHERE experiment_id = :experiment_id
GROUP BY variant
ORDER BY variant
"""
)

EXPERIMENT_TIME_TO_QUOTE = text(
    """
SELECT variant, time_to_quote_s
FROM experiment_assignments
WHERE experiment_id = :experiment_id
"""
)

# --------------------------------------------------------------------------- #
# 7. AI benchmark aggregates
# --------------------------------------------------------------------------- #
AI_MODEL_AGGREGATES = text(
    """
SELECT
    model,
    COUNT(*)                                                       AS n,
    AVG(accuracy_score)                                            AS mean_accuracy,
    STDDEV_SAMP(accuracy_score)                                    AS sd_accuracy,
    COUNT(*) FILTER (WHERE hallucination)                          AS hallucinations,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)       AS p50_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)       AS p95_latency_ms,
    AVG(cost_usd) * 1000                                           AS cost_per_1k_usd,
    AVG(input_tokens + output_tokens)                              AS avg_tokens
FROM ai_eval_runs
WHERE (CAST(:category AS TEXT) IS NULL OR category = CAST(:category AS TEXT))
GROUP BY model
ORDER BY mean_accuracy DESC
"""
)

AI_CATEGORY_MATRIX = text(
    """
SELECT
    model,
    category,
    COUNT(*)                                               AS n,
    ROUND(CAST(AVG(accuracy_score) AS NUMERIC), 2)         AS mean_accuracy,
    ROUND(100.0 * COUNT(*) FILTER (WHERE hallucination) / COUNT(*), 2) AS hallucination_pct,
    -- Rank models within each category
    RANK() OVER (PARTITION BY category ORDER BY AVG(accuracy_score) DESC) AS rank_in_category
FROM ai_eval_runs
GROUP BY model, category
ORDER BY category, rank_in_category
"""
)

AI_RAW_SCORES = text(
    """
SELECT model, accuracy_score
FROM ai_eval_runs
WHERE (CAST(:category AS TEXT) IS NULL OR category = CAST(:category AS TEXT))
"""
)

AI_RUN_TOTALS = text(
    """
SELECT COUNT(*) AS runs, COUNT(DISTINCT prompt_id) AS prompts,
       COUNT(DISTINCT batch_id) AS batches, MAX(created_at) AS last_run_at
FROM ai_eval_runs
"""
)
