# PulsePort Analytics

**Digital-experience analytics, statistical A/B testing and AI-model evaluation for a global maritime shipping customer portal** (in the spirit of *myZIM* / *Maersk* digital portals).

This is not a CRUD app or an LLM wrapper. Every number on the dashboard comes from one of three sources:

| Layer | What it does | Where |
|---|---|---|
| **Analytical SQL** | Funnels, cohorts, P95 latency, rankings via CTEs, `LAG()`, `RANK()`, `SUM() OVER ()`, `PERCENTILE_CONT`, `CORR` | [`backend/app/analytics/sql_queries.py`](backend/app/analytics/sql_queries.py) |
| **Statistical engine** | Two-proportion z, χ², Mann-Whitney U, Katz CI, Cohen's h/d, power analysis, Beta-Binomial posteriors, P(B>A), expected loss | [`backend/app/stats_engine/`](backend/app/stats_engine/) |
| **AI benchmarking** | Accuracy t-CIs, Wilson CIs on hallucination rate, Kruskal-Wallis, Welch t, χ² independence, cost per 1k tickets | [`backend/app/ai_benchmark/`](backend/app/ai_benchmark/) |

The **Management Brief** turns those outputs into Go / No-Go recommendations with a deterministic rule engine. Every sentence in it traces back to a computed figure, so the brief can't hallucinate.

---

## Architecture

```mermaid
flowchart LR
    subgraph Client["React 18 · Vite · TypeScript · Tailwind · Recharts"]
        K[KPI Overview]
        F[Funnel & Regional Analytics]
        AB[A/B Testing Lab]
        AI[AI Benchmark Studio]
        EB[Executive Brief]
    end

    subgraph API["FastAPI (async) · Pydantic v2"]
        R[REST endpoints]
        SVC[Services<br/>analytics · experiments · brief]
        STATS[Stats engine<br/>SciPy · NumPy]
        EVAL[AI evaluator]
        SEED[Seeder<br/>COPY + advisory lock]
    end

    subgraph DB["PostgreSQL 16"]
        T1[(session_events)]
        T2[(experiment_assignments)]
        T3[(ai_eval_runs)]
    end

    Client -- "/api (nginx proxy)" --> R
    R --> SVC
    SVC --> STATS
    SVC --> EVAL
    SVC -- "raw SQL: CTE · window functions · PERCENTILE_CONT" --> DB
    EVAL --> DB
    SEED -- "asyncpg COPY on first start" --> DB
```

**Request flow for one experiment:**

```mermaid
sequenceDiagram
    participant UI as A/B Testing Lab
    participant API as FastAPI
    participant PG as PostgreSQL
    participant S as Stats engine
    UI->>API: GET /api/experiments/EXP-02
    API->>PG: arm counts (COUNT FILTER) + time-to-quote samples
    PG-->>API: n, conversions per arm
    API->>S: two_proportion_test · bayesian_ab_test · mann_whitney_test
    S-->>API: p, CI, power, P(B>A), expected loss, 100-pt PDF curve
    API->>API: decide() → GO / NO-GO / KEEP RUNNING / STOP
    API-->>UI: ExperimentAnalysis (typed Pydantic schema)
```

---

## Quick start

```bash
git clone https://github.com/yakov-ashgar27/PulsePort-Analytics.git
cd PulsePort-Analytics
docker compose up --build
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API docs (OpenAPI / Swagger) | http://localhost:8000/docs |
| PostgreSQL | `localhost:5432` (pulseport / pulseport) |

On first start the API seeds **50,000 portal sessions (~110k funnel events), 40,000 experiment assignments and 900 graded AI answers**. It uses PostgreSQL `COPY`, which takes a few seconds. The backend image **runs the statistical test suite during `docker build`**, so a mathematically broken engine never ships.

### Local development (without Docker)

```bash
# backend
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest                      # statistical engine tests
export PULSEPORT_DATABASE_URL=postgresql+asyncpg://pulseport:pulseport@localhost:5432/pulseport
uvicorn app.main:app --reload

# frontend (new terminal)
cd frontend
npm install
npm run dev                           # http://localhost:5173, proxies /api → :8000
```

---

## The seeded dataset (synthetic, with known ground truth)

The data is generated with **known statistical signals**, so the analytics can be checked against ground truth (see `TestSeededSignals` in the tests):

| Signal | Design | What the platform should show |
|---|---|---|
| Regional bottleneck | BR-Santos & CN-Shanghai **mobile** rate-quote latency is log-normal with a median of ≈3.2 s. Users abandon with probability following a logistic curve in latency | P95 > 2.5 s SLA, search→quote ≈50% vs ≈62% global, p < 1e-40, cross-region r ≈ −0.99 |
| **EXP-01** AI-Assisted Booking Flow | 1,200/10,000 vs 1,368/10,000 (+14.0%) | p ≈ 0.0004, P(B>A) > 99.9% → **GO** |
| **EXP-02** Predictive ETA Banner | 3,000/10,000 vs 3,087/10,000 (+2.9%) | p ≈ 0.18, power 27% → **KEEP RUNNING** (≈48 more days) |
| AI evaluation | 300 prompts × 3 models × 4 categories with model-specific accuracy, hallucination, latency and token-price profiles | Leader significantly better (Welch p < 0.001); guardrail flags models over 5% hallucination |

Experiment outcomes are generated with **exact counts** and then shuffled, so the headline p-values are fully reproducible.

> **Note on the AI benchmark:** the evaluation runs are **simulated** and do not measure the real vendors. The UI and the brief label them that way. In production, `run_batch()` would call each provider and grade answers against a rubric. Storage, SQL and statistics would stay the same. Model names and price profiles live in one place: `MODEL_PROFILES` in `seed/generators.py`.

---

## Statistical methods

### Frequentist (`stats_engine/frequentist.py`)

**Two-proportion z-test (pooled):**

$$
z = \frac{\hat p_B - \hat p_A}{\sqrt{\bar p(1-\bar p)\left(\frac{1}{n_A}+\frac{1}{n_B}\right)}}, \qquad \bar p = \frac{x_A + x_B}{n_A + n_B}
$$

**Pearson χ²** on the 2×2 table (`scipy.stats.chi2_contingency`, no Yates correction, so χ² = z² exactly. A unit test asserts this).

**Relative-uplift CI (Katz log risk-ratio):** asymmetric and always > −100%:

$$
\ln\!\frac{\hat p_B}{\hat p_A} \;\pm\; z_{1-\alpha/2}\sqrt{\frac{1-\hat p_A}{n_A\hat p_A} + \frac{1-\hat p_B}{n_B\hat p_B}}
$$

**Effect sizes:** Cohen's $h = 2\arcsin\sqrt{p_B} - 2\arcsin\sqrt{p_A}$; Cohen's $d$ with pooled SD; rank-biserial $r = 2U_A/(n_An_B) - 1$.

**Mann-Whitney U** (two-sided) for the skewed time-to-quote metric. A t-test's normality assumption fails for log-normal latencies.

**Sample size (Fleiss):**

$$
n = \frac{\left[z_{1-\alpha/2}\sqrt{2\bar p\bar q} + z_{1-\beta}\sqrt{p_1q_1 + p_2q_2}\right]^2}{(p_2-p_1)^2}
$$

Verified against the textbook value (10% → 12%, α = 0.05, power 0.8 ⇒ **3,841 per arm**) and cross-checked against `statsmodels.NormalIndPower`.

### Bayesian (`stats_engine/bayesian.py`)

Conjugate model: prior $\text{Beta}(1,1)$, posterior $\text{Beta}(1 + x,\; 1 + n - x)$.

$$
P(p_B > p_A) = \int_0^1 f_B(x)\,F_A(x)\,dx
$$

This integral is computed by adaptive quadrature over the posterior's support. It is validated against Evan Miller's closed form to 1e-7, and the Monte-Carlo estimate (200k draws) is reported alongside it.

**Expected loss** of shipping B: $\mathbb{E}[\max(p_A - p_B, 0)]$. A test checks the identity $\mathbb{E}[\text{loss}_B] - \mathbb{E}[\text{loss}_A] = \mathbb{E}[p_A] - \mathbb{E}[p_B]$.

The API returns a **100-point PDF curve** `(x, control_pdf, variant_pdf)` for Recharts. The tests check that it integrates to 1.

### Decision rule (`services/experiments.py`)

| Verdict | Condition |
|---|---|
| **GO** | p < α, uplift > 0, P(B>A) ≥ 95%, expected loss < 0.1 pp |
| **NO-GO** | p < α and uplift < 0 |
| **KEEP RUNNING** | not significant **and** power to detect the pre-registered MDE (+5%) < 80% |
| **STOP** | not significant although the test *could* detect the MDE, so there's no worthwhile effect |

Using power at a **pre-registered MDE** instead of post-hoc "observed power" is deliberate. Observed power is just a restatement of the p-value, and it would make STOP unreachable.

---

## Sample SQL

**Funnel with step conversion via `LAG()`** (from `FUNNEL`):

```sql
WITH scoped_sessions AS (...),            -- filter on PORTAL_VISIT, typed binds
session_flags AS (                        -- one row per session (conditional aggregation)
    SELECT s.session_id,
           BOOL_OR(e.stage = 'ROUTE_SEARCH')      AS did_search,
           BOOL_OR(e.stage = 'RATE_QUOTE')        AS did_quote,
           BOOL_OR(e.stage = 'BOOKING_CONFIRMED') AS did_book
    FROM scoped_sessions s JOIN session_events e USING (session_id)
    GROUP BY s.session_id
),
funnel AS (                               -- unpivot with LATERAL VALUES
    SELECT v.* FROM stage_totals t
    CROSS JOIN LATERAL (VALUES (1,'PORTAL_VISIT',t.portal_visit), ...) v(step_order, stage, sessions)
)
SELECT stage, sessions,
       ROUND(100.0 * sessions / NULLIF(LAG(sessions) OVER w, 0), 2)         AS step_conversion_pct,
       ROUND(100.0 * sessions / NULLIF(FIRST_VALUE(sessions) OVER w, 0), 2) AS cumulative_conversion_pct
FROM funnel
WINDOW w AS (ORDER BY step_order);
```

**Bottleneck detector: P95 vs SLA + latency↔conversion correlation:**

```sql
SELECT region,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms)                                   AS p95_latency_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) FILTER (WHERE device_type='Mobile') AS p95_mobile_ms,
       CORR(quote_latency_ms, reached_quote)                                                            AS latency_conv_corr
FROM searched
GROUP BY region;
-- outer query: CORR(p95, quote_rate) OVER () across regions, SLA breach & bottleneck flags
```

Optional filters use `CAST(:param AS TYPE) IS NULL OR col = CAST(:param AS TYPE)`. One prepared statement covers every filter combination, and the explicit casts let asyncpg prepare it without type inference errors.

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/kpis` | Executive KPIs (filterable) |
| GET | `/api/funnel` | 4-stage funnel with LAG() conversions |
| GET | `/api/analytics/regions` | Region × device table, ranked |
| GET | `/api/analytics/bottlenecks` | SLA / P95 detector + z-test vs rest |
| GET | `/api/analytics/trend` | Daily conversion + 7-day MA |
| GET | `/api/experiments` · `/api/experiments/{id}` | Experiment list / full analysis |
| POST | `/api/stats/power-analysis` | Sample size, days to significance |
| GET | `/api/ai-benchmark?category=` | Model metrics, CIs, tests, category matrix |
| POST | `/api/ai-benchmark/run` | Simulate and persist a new evaluation batch |
| GET | `/api/executive-brief` | Structured memo + Markdown |

Filters on analytics endpoints: `region`, `device_type`, `date_from`, `date_to` (ISO-8601).

---

## Testing

```bash
cd backend && python -m pytest -v                           # 40+ math / decision-rule tests
PULSEPORT_DATABASE_URL=... python -m scripts.smoke_test     # end-to-end against real Postgres
```

The tests check against **first principles, not against the engine itself**: hand-computed z, χ² = z², the textbook sample size, Evan Miller's closed form for P(B>A), the Wilson interval reference values, a power round-trip (n → power ≈ 0.80), the expected-loss identity, PDF normalisation, and that the seeded data reproduces its designed p-values.

CI (`.github/workflows/ci.yml`) runs the unit tests, then a seeded-Postgres smoke test of every endpoint, then the frontend typecheck and build.

---

## Project structure

```text
pulseport-analytics/
├── docker-compose.yml
├── .github/workflows/ci.yml
├── backend/
│   ├── Dockerfile · requirements.txt · pytest.ini
│   ├── scripts/smoke_test.py            # end-to-end API test against Postgres
│   ├── tests/
│   │   ├── test_stats_engine.py         # math verification (p-values, power, posteriors, seeds)
│   │   └── test_decision_rules.py       # GO / NO-GO / KEEP RUNNING / STOP
│   └── app/
│       ├── main.py · config.py · database.py · models.py · schemas.py
│       ├── seed/          generators.py (pure, deterministic) · maritime_seeder.py (COPY)
│       ├── stats_engine/  frequentist.py · bayesian.py
│       ├── analytics/     sql_queries.py
│       ├── ai_benchmark/  metrics.py (pure) · evaluator.py (DB)
│       └── services/      analytics.py · experiments.py · executive_brief.py
└── frontend/
    ├── Dockerfile (multi-stage → nginx) · nginx.conf · vite.config.ts
    └── src/
        ├── App.tsx · api/client.ts · hooks/useApi.ts · types/analytics.ts
        └── components/  KpiOverview · FunnelAnalytics · AbTestLab · AiBenchmarkStudio · ExecutiveBriefModal
```

## Design notes

- **Colour carries a meaning.** Series colours follow a fixed, colour-vision-deficiency-validated order (blue = control / model 1, orange = variant / model 2, aqua = model 3) and stick to their entity, never its rank. Status colours (good / warning / critical) are reserved for verdicts, and they always come with an icon and a label.
- **No dual-axis charts.** Daily sessions appear in the tooltip, not on a second y-scale.
- **Dark and light themes** are each chosen deliberately, not produced by inverting the other. The navy surface keeps the maritime look.
- Fetches are **cancelled when filters change**, so a slow, stale response can't overwrite a fresh one.

---

*Data is synthetic. Statistics are computed with SciPy/NumPy, and aggregations run in PostgreSQL 16.*
