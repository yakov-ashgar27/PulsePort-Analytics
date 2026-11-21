<div align="center">

# ⚓ PulsePort Analytics

**Statistically rigorous product analytics for funnels, A/B tests and AI-model evaluations, on your own data.**

[![CI](https://github.com/yakov-ashgar27/PulsePort-Analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/yakov-ashgar27/PulsePort-Analytics/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/live%20demo-online-34d399?logo=githubpages&logoColor=white)](https://yakov-ashgar27.github.io/PulsePort-Analytics/)
![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![SciPy](https://img.shields.io/badge/SciPy-verified-8CAAE6?logo=scipy&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

### [🔗 Open the app](https://yakov-ashgar27.github.io/PulsePort-Analytics/): free, no install, no sign-up. Your data never leaves the browser.

<img src="docs/screenshots/data-studio-insights.png" alt="Data Studio: ranked statistical insights from an uploaded e-commerce event log" width="100%">

</div>

📐 **System design:** [DFD (levels 0–1) and ERD](docs/DIAGRAMS.md), drawn from the code.

---

## Contents

[The problem](#the-problem) · [What it does](#what-it-does) · [Screenshots](#screenshots) · [Data Studio](#data-studio-bring-your-own-data) · [Connectors](#connect-your-data-sources-self-hosted-free) · [Architecture](#architecture) · [Design decisions](#design-decisions) · [Statistical methods](#statistical-methods) · [Quick start](#quick-start) · [Testing](#testing) · [Limitations](#limitations--roadmap)

---

## The problem

Digital teams make product decisions from dashboards every day. Three mistakes recur, and each one is expensive:

| Mistake | What it looks like | What it costs |
|---|---|---|
| **Shipping noise** | "Variant B is up 3%, ship it!" The test is underpowered and *p = 0.18*. | Roll-outs of features that do nothing, or harm, and a team that stops trusting experiments. |
| **Averages hide the problem** | The overall funnel looks fine, while mobile users in one market abandon at twice the rate. | Revenue leaks silently at the highest-intent step. |
| **Choosing AI on vibes** | An LLM is picked from a few impressive answers, without confidence intervals, hallucination rates or cost per ticket. | Over-paying for accuracy that isn't significantly better, or deploying a model that fabricates answers. |

Most tools stop at charts. **PulsePort turns data into decisions:** every insight comes with the statistical test behind it, a correction for multiple comparisons, and a plain-language recommendation.

## What it does

PulsePort answers three questions for any digital product: a booking portal, an online store, a SaaS app, a bank.

1. **Where are we losing users, and who exactly?** An ordered funnel analysis tests every segment *and segment pair* (e.g. *country × device*) at every step against everyone else. It controls the false-discovery rate, estimates lost conversions, and detects when latency predicts abandonment.
2. **Did the change actually work?** A/B analysis runs frequentist and Bayesian inference side by side. It adds a sample-ratio-mismatch check, Fisher's exact test for small samples, Holm correction for more than two variants and a pre-registered power rule. The result is an explicit **GO / NO-GO / KEEP RUNNING / STOP** verdict that **prevents false-positive roll-outs**.
3. **Which AI assistant should we deploy?** Model evaluation reports scores with confidence intervals, hallucination rates against a safety guardrail, P95 latency, cost per 1,000 tickets, and significance tests between models.

It works in two modes:

| | **Data Studio** (public site) | **Full platform** (self-hosted, `docker compose up`) |
|---|---|---|
| Data in | CSV upload, paste from Excel or Sheets, Google Sheet / CSV link | Plus PostgreSQL, MySQL, SQLite, Google Analytics 4, server-side CSV |
| Engine | TypeScript port of the stats engine, **verified against SciPy** | Python / SciPy engine + analytical SQL on PostgreSQL 16 |
| Privacy | Runs entirely in the browser; nothing is uploaded | Credentials stay on your server, with read-only queries |
| Cost | Free (GitHub Pages) | Free (open source, your own machine) |

### Example: what it finds on the bundled e-commerce sample

> 🔴 **country × device = BR · mobile under-performs at checkout_start → payment**: 32.6% pass vs 64.4% for everyone else (−31.8 pp, FDR q < 0.0001). Closing the gap is worth ≈24 conversions in the period.
> 🔴 **Slower checkout load predicts abandonment** at checkout_start → payment: r = −0.23, Holm-adjusted p < 0.0001.
> 🟢 Desktop out-performs at product_view → add_to_cart (+4.0 pp, q = 0.008).

And on an A/B test with a +2.9% lift (p = 0.18):

> 🟡 **KEEP RUNNING**. Inconclusive, so do not roll out yet. The test has only 63% power to detect a +5% effect, and P(B>A) = 90.9% is suggestive but not conclusive. About 48 more days are needed at current traffic.

---

## Screenshots

| A/B Testing Lab: a false positive caught | Funnel & regional bottleneck detector |
|---|---|
| <img src="docs/screenshots/ab-lab.png" alt="A/B lab showing KEEP RUNNING verdict, confidence interval and Bayesian posteriors"> | <img src="docs/screenshots/funnel-regions.png" alt="Funnel, trend and P95-latency bottleneck detector by region"> |
| **Data Studio: automatic detection & column mapping** | **Segment × step diagnostics with FDR control** |
| <img src="docs/screenshots/data-studio-mapping.png" alt="Data Studio detecting dataset type and mapping columns"> | <img src="docs/screenshots/data-studio-segments.png" alt="Table of segment by step comparisons with q-values and lost conversions"> |
| **AI model evaluation: accuracy vs cost, safety** | **One-click management brief** |
| <img src="docs/screenshots/ai-evaluation.png" alt="AI model comparison with confidence intervals, cost and hallucination guardrail"> | <img src="docs/screenshots/management-brief.png" alt="Executive brief with hypothesis, evidence, risk and Go/No-Go"> |

---

## Data Studio: bring your own data

| Step | What happens |
|---|---|
| **1. Connect** | Upload a CSV, paste a table copied from Excel or Google Sheets, or connect a **Google Sheet / public CSV URL**. Re-connect any time to refresh with live data. |
| **2. Detect & map** | Columns are profiled (id, timestamp, category, number, boolean) and the dataset type is detected. Every mapping can be changed, and any column names work. |
| **3. Analyse** | The same statistics as the Python engine run **in your browser**, verified against SciPy on 22 test groups. |
| **4. Act** | Insights are ranked by severity and business impact. Export a Markdown report or a CSV of the results. |

**Supported datasets**

| Type | Minimum columns | What you get |
|---|---|---|
| **Event log / funnel** | session or user id, event name (optional: timestamp, latency, up to 3 segment columns) | Ordered funnel. Every segment **and segment pair** is tested at every step against everyone else, with Benjamini–Hochberg FDR control and an estimate of lost conversions. You also get the latency ↔ abandonment link (Holm-adjusted), a daily trend with a 7-day MA, and a week-over-week change alert. |
| **Funnel, aggregated** | step, users (optional: segment columns) | The same diagnostics from counts, e.g. a GA4 export or a `GROUP BY` result. Warns when counts aren't nested. |
| **A/B test, per user** | variant, converted 0/1 (optional: numeric metric, timestamp, segments) | Sample-ratio-mismatch check, z / χ² / **Fisher exact** for small samples, Katz CI, Holm correction for more than two variants, Beta-Binomial P(B>A) and expected loss, power at your MDE, days remaining, Mann-Whitney and Welch on the metric, effect reversals by segment, and a verdict. |
| **A/B test, summary** | variant, users, conversions | The same, from aggregated counts. |
| **AI evaluation log** | model, score (optional: hallucination flag, latency, cost, category) | Mean score with t-CI, Wilson CI on hallucination, Kruskal-Wallis, Welch on the top two, χ² on safety, a category leaderboard, a cost trade-off and a guardrail verdict. |

Five sample datasets ship with the app: a shipping portal, an **e-commerce checkout**, an A/B test per user, an A/B summary and an AI evaluation log. Anyone can try it in one click.

---

## Connect your data sources (self-hosted, free)

In the self-hosted version, the **Your Data → Database / GA4** tab connects directly to:

| Source | How it connects | Notes |
|---|---|---|
| **PostgreSQL** | asyncpg | Any SELECT / WITH query. Templates for event logs, A/B tests and AI logs. |
| **MySQL / MariaDB** | aiomysql | Same. |
| **SQLite** | aiosqlite, opened read-only | Put files in `connectors/data/`. |
| **Google Analytics 4** | Official Data API (free quota) | Users per event × country / device / channel, analysed as an aggregated funnel. |
| **CSV URL** | Fetched by the server | Works when the browser would be blocked by CORS. |

**Safety model**
- **Two layers of read-only protection.** First, a static check accepts only a single SELECT / WITH statement. Second, **every query runs inside a `READ ONLY` transaction with a timeout**, so the database itself refuses writes. CI proves the second layer separately on real PostgreSQL and MySQL, with the first layer disabled.
- **Row cap.** Results are limited to `PULSEPORT_CONNECTOR_MAX_ROWS` (default 500k).
- **Passwords.** They are sent only to your own server and never stored. To keep credentials off the browser entirely, use **saved connections**:
  ```bash
  PULSEPORT_CONNECTIONS='{"warehouse":{"type":"postgres","host":"host.docker.internal","database":"analytics","user":"readonly","password":"…"}}'
  PULSEPORT_ALLOW_ADHOC_CONNECTIONS=false   # only saved connections can be used
  ```
- **Path restriction.** SQLite files are opened only from `connectors/data/`, and paths are traversal-checked.
- **Reaching your own machine.** A database running on your own computer is reachable from Docker as `host.docker.internal`.

**Try it instantly:** click **Use bundled demo database**. That queries the PostgreSQL that ships with the stack.

<details>
<summary><b>Connect Google Analytics 4 (one-time, ~5 minutes, free)</b></summary>

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Analytics Data API**.
2. Create a **service account** → *Keys* → *Add key* → JSON. Save it as `connectors/secrets/ga4-service-account.json` (it's git-ignored).
3. In GA4, go to *Admin → Property access management*. Add the service account's e-mail as **Viewer**.
4. Copy the numeric **Property ID** from *Admin → Property details*. Then run `docker compose up` and pick **Google Analytics 4** in the Data Studio.

GA4 returns *users per event* (aggregated). For exact per-user journeys, enable the free **GA4 → BigQuery export** and query the event table with SQL.
</details>

---

## Architecture

```mermaid
flowchart LR
    subgraph Browser["Browser · React 18 · TypeScript · Recharts"]
        DS[Data Studio<br/>CSV · Sheets · paste]
        TS[TS stats engine<br/>SciPy-verified]
        DEMO[Demo dashboards<br/>Funnel · A/B · AI · Brief]
        DS --> TS
    end

    subgraph API["FastAPI (async) · Pydantic v2"]
        CONN[Connectors<br/>read-only SQL · GA4 · CSV]
        SVC[Services<br/>analytics · experiments · brief]
        STATS[Python stats engine<br/>SciPy · NumPy]
        SEED[Seeder<br/>COPY + advisory lock]
    end

    subgraph DB["PostgreSQL 16"]
        T[(session_events<br/>experiment_assignments<br/>ai_eval_runs)]
    end

    EXT[(Your PostgreSQL / MySQL<br/>SQLite · GA4 · CSV URL)]

    DEMO -- "/api" --> SVC
    DS -- "/api/connectors" --> CONN
    CONN -- "READ ONLY tx" --> EXT
    SVC --> STATS
    SVC -- "CTE · window functions · PERCENTILE_CONT" --> T
    SEED -- "asyncpg COPY" --> T
```

The public site is the same React app built in demo mode. CI runs the real pipeline against a throwaway PostgreSQL, exports every API response as a JSON snapshot, and publishes the result to GitHub Pages.

<details>
<summary><b>Request flow for one experiment</b></summary>

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
</details>

---

## Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| **Analyse user data in the browser** | Privacy by construction: data never leaves the device. Hosting costs nothing, and analysis is instant. | Practical up to about 1–2M rows. Larger data should be aggregated in SQL first, via a connector. |
| **Port the stats engine to TypeScript and test it against SciPy** | One source of truth. The browser must give the *same* numbers as the Python engine, so 22 parity test groups compare against SciPy reference values (erfc to 1e-12, Bayesian P(B>A) to 1e-6). | Two implementations to maintain, so parity is enforced in CI. |
| **Frequentist *and* Bayesian, side by side** | p-values answer "is it real?". P(B>A) and expected loss answer "what's the risk if we ship?". Executives need both. | More numbers on screen, so the verdict summarises them. |
| **Power at a pre-registered MDE, not "observed power"** | Observed power is a restatement of the p-value and would make STOP unreachable. | You need to choose an MDE (default +5%). |
| **FDR (Benjamini–Hochberg) across segment × step tests** | Testing 6 countries × 2 devices × 4 steps × pairs means hundreds of comparisons. Without correction, false alarms are guaranteed. | Slightly less sensitive to tiny effects. |
| **Pairs reported only when they add information** | "Mobile in Norfolk" is not a finding if *all* mobile is equally weak. A pair is reported only when it is worse than both of its parts. | Some real interactions with small effects stay in the table rather than the headline. |
| **SRM check before any A/B verdict** | A broken 50/50 split invalidates the whole test. It's the most common real-world A/B bug. | None. |
| **Rule-based management brief, not an LLM** | Every sentence traces back to a computed number, so the brief can't hallucinate. | Less flowing prose. |
| **Two independent read-only layers for SQL** | Static checks can be bypassed; a `READ ONLY` transaction can't. CI tests the second layer with the first disabled. | A column literally named `lock`, `set` or `call` must be quoted or aliased. |
| **Synthetic demo with known ground truth** | The planted signals (a regional bottleneck, a 14% lift, an underpowered test) let tests verify that the analytics *find what was planted*. | The demo isn't real company data. The Data Studio is for that. |

---

## Statistical methods

<details>
<summary><b>Frequentist</b> (<code>stats_engine/frequentist.py</code>, <code>lib/stats.ts</code>)</summary>

**Two-proportion z-test (pooled):**

$$
z = \frac{\hat p_B - \hat p_A}{\sqrt{\bar p(1-\bar p)\left(\frac{1}{n_A}+\frac{1}{n_B}\right)}}, \qquad \bar p = \frac{x_A + x_B}{n_A + n_B}
$$

**Pearson χ²** on the 2×2 table, without Yates correction, so χ² = z² exactly. A unit test asserts this. When an expected cell count is below 5, **Fisher's exact test** is used instead.

**Relative-uplift CI (Katz log risk-ratio):** asymmetric and always > −100%:

$$
\ln\!\frac{\hat p_B}{\hat p_A} \;\pm\; z_{1-\alpha/2}\sqrt{\frac{1-\hat p_A}{n_A\hat p_A} + \frac{1-\hat p_B}{n_B\hat p_B}}
$$

**Effect sizes:** Cohen's $h = 2\arcsin\sqrt{p_B} - 2\arcsin\sqrt{p_A}$; Cohen's $d$ with pooled SD; rank-biserial $r = 2U_A/(n_An_B) - 1$.

**Mann-Whitney U** (two-sided, with tie and continuity correction) and **Welch's t** handle skewed continuous metrics.

**Sample size (Fleiss):**

$$
n = \frac{\left[z_{1-\alpha/2}\sqrt{2\bar p\bar q} + z_{1-\beta}\sqrt{p_1q_1 + p_2q_2}\right]^2}{(p_2-p_1)^2}
$$

This is verified against the textbook value (10% → 12%, α = 0.05, power 0.8 ⇒ **3,841 per arm**) and cross-checked against `statsmodels`.

**Multiple comparisons:** Benjamini–Hochberg q-values for segment diagnostics; Holm step-down for multi-arm tests and latency checks. **SRM:** χ² goodness-of-fit against the planned split.
</details>

<details>
<summary><b>Bayesian</b> (<code>stats_engine/bayesian.py</code>)</summary>

Conjugate model: prior $\text{Beta}(1,1)$, posterior $\text{Beta}(1 + x,\; 1 + n - x)$.

$$
P(p_B > p_A) = \int_0^1 f_B(x)\,F_A(x)\,dx
$$

The integral is computed by adaptive quadrature (Simpson's rule in the browser). It is validated against Evan Miller's closed form to 1e-7, with a Monte-Carlo estimate reported alongside.

**Expected loss** of shipping B: $\mathbb{E}[\max(p_A - p_B, 0)]$. A test checks the identity $\mathbb{E}[\text{loss}_B] - \mathbb{E}[\text{loss}_A] = \mathbb{E}[p_A] - \mathbb{E}[p_B]$.
</details>

<details>
<summary><b>Decision rule</b></summary>

| Verdict | Condition |
|---|---|
| **GO** | p < α, uplift > 0, P(B>A) ≥ 95%, expected loss < 0.1 pp |
| **NO-GO** | p < α and uplift < 0, or a sample-ratio mismatch |
| **KEEP RUNNING** | not significant **and** power to detect the pre-registered MDE < 80% |
| **STOP** | not significant although the test *could* detect the MDE, so there's no worthwhile effect |
</details>

<details>
<summary><b>Sample analytical SQL</b> (<code>analytics/sql_queries.py</code>)</summary>

```sql
-- Funnel with step conversion via LAG()
WITH session_flags AS (                    -- one row per session (conditional aggregation)
    SELECT s.session_id,
           BOOL_OR(e.stage = 'ROUTE_SEARCH')      AS did_search,
           BOOL_OR(e.stage = 'RATE_QUOTE')        AS did_quote,
           BOOL_OR(e.stage = 'BOOKING_CONFIRMED') AS did_book
    FROM scoped_sessions s JOIN session_events e USING (session_id)
    GROUP BY s.session_id
),
funnel AS (                                -- unpivot with LATERAL VALUES
    SELECT v.* FROM stage_totals t
    CROSS JOIN LATERAL (VALUES (1,'PORTAL_VISIT',t.portal_visit), ...) v(step_order, stage, sessions)
)
SELECT stage, sessions,
       ROUND(100.0 * sessions / NULLIF(LAG(sessions) OVER w, 0), 2)         AS step_conversion_pct,
       ROUND(100.0 * sessions / NULLIF(FIRST_VALUE(sessions) OVER w, 0), 2) AS cumulative_conversion_pct
FROM funnel
WINDOW w AS (ORDER BY step_order);

-- Bottleneck detector: P95 vs SLA and latency ↔ conversion correlation
SELECT region,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms)                                     AS p95_latency_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY quote_latency_ms) FILTER (WHERE device_type='Mobile') AS p95_mobile_ms,
       CORR(quote_latency_ms, reached_quote)                                                              AS latency_conv_corr
FROM searched
GROUP BY region;
```

Optional filters use `CAST(:param AS TYPE) IS NULL OR col = CAST(:param AS TYPE)`. One prepared statement covers every filter combination.
</details>

---

## Quick start

**Use it now:** open the [live app](https://yakov-ashgar27.github.io/PulsePort-Analytics/), go to *Your Data*, and upload a CSV or try a sample.

**Run the full platform** (Docker, free):

```bash
git clone https://github.com/yakov-ashgar27/PulsePort-Analytics.git
cd PulsePort-Analytics
docker compose up --build
```

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| API docs (OpenAPI / Swagger) | http://localhost:8000/docs |
| PostgreSQL | `localhost:5432` (pulseport / pulseport) |

On first start the API seeds **50,000 portal sessions (~110k events), 40,000 experiment assignments and 900 graded AI answers** with PostgreSQL `COPY`, which takes a few seconds. The backend image **runs the statistical test suite during `docker build`**, so a mathematically broken engine never ships.

<details>
<summary><b>Local development without Docker</b></summary>

```bash
cd backend && python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python -m pytest
export PULSEPORT_DATABASE_URL=postgresql+asyncpg://pulseport:pulseport@localhost:5432/pulseport
uvicorn app.main:app --reload

cd frontend && npm install && npm test && npm run dev   # http://localhost:5173 (proxies /api → :8000)
```
</details>

<details>
<summary><b>REST API</b></summary>

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/kpis` · `/api/funnel` · `/api/analytics/{regions,bottlenecks,trend}` | Demo analytics (filter by `region`, `device_type`, `date_from`, `date_to`) |
| GET | `/api/experiments` · `/api/experiments/{id}` | Experiment list / full analysis with verdict |
| POST | `/api/stats/power-analysis` | Sample size and days to significance |
| GET / POST | `/api/ai-benchmark` · `/api/ai-benchmark/run` | Model metrics, tests; simulate a new batch |
| GET | `/api/executive-brief` | Structured memo + Markdown |
| GET / POST | `/api/connectors` · `/api/connectors/test` · `/api/connectors/query` | Data-source connectors (read-only) |
</details>

---

## Testing

Each layer is tested against **first principles or an independent reference**, never against itself. All of it runs in CI on every push.

| Suite | What it proves |
|---|---|
| **Python engine**: 60 tests (`backend/tests`) | Hand-computed z, χ² = z², the textbook sample size, Evan Miller's closed form for P(B>A), Wilson reference values, a power round-trip, the expected-loss identity, PDF normalisation, the GO/NO-GO/KEEP RUNNING/STOP rules, SQL safety rules, and the GA4 & SQLite connectors. |
| **Browser engine**: 22 test groups (`frontend/src/lib/**/*.test.ts`) | Parity with SciPy for every function, plus end-to-end Data Studio runs on every sample, including that the planted bottlenecks and verdicts are *found*. |
| **API smoke test** against a real PostgreSQL | Seeds the database, calls every endpoint, and asserts that the designed signals surface through SQL → stats → API. |
| **Connector test** against real PostgreSQL + MySQL | Round-trips data, checks the row cap and the API guard, and proves that **the database itself blocks writes** with the static check disabled. |
| **Frontend** | Strict TypeScript typecheck and production build. |

```bash
cd backend && python -m pytest -v
cd frontend && npm test
```

---

## Project structure

```text
├── backend/
│   ├── app/
│   │   ├── stats_engine/   frequentist.py · bayesian.py           # SciPy / NumPy inference
│   │   ├── analytics/      sql_queries.py                         # CTEs, window functions, PERCENTILE_CONT
│   │   ├── services/       analytics · experiments · executive_brief
│   │   ├── ai_benchmark/   metrics.py (pure) · evaluator.py (DB)
│   │   ├── connectors/     service.py · safety.py · models.py     # read-only SQL, GA4, CSV
│   │   ├── seed/           generators.py (deterministic) · maritime_seeder.py (COPY)
│   │   └── main.py · config.py · database.py · models.py · schemas.py
│   ├── tests/              stats engine · decision rules · connectors
│   └── scripts/            smoke_test · connector_test · export_static · make_samples · make_stats_fixtures
├── frontend/
│   ├── src/lib/            stats.ts (SciPy-verified) · data/{csv,detect,analyze}.ts
│   ├── src/components/     DataStudio · ConnectPanel · FunnelAnalytics · AbTestLab · AiBenchmarkStudio · ExecutiveBriefModal
│   └── public/samples/     five sample datasets
├── connectors/             data/ (SQLite files) · secrets/ (GA4 key, git-ignored)
├── docs/screenshots/
├── .github/workflows/      ci.yml (4 jobs) · pages.yml (live demo)
└── docker-compose.yml      PostgreSQL 16 · FastAPI · nginx + React
```

---

## Limitations & roadmap

- **Demo data is synthetic.** The planted signals make the analytics verifiable. The AI benchmark profiles are simulated and don't measure real vendors; they live in `MODEL_PROFILES`. Use the Data Studio for real data.
- **GA4 returns aggregated counts**, so funnels from it are "users per event", not strictly ordered journeys. For exact journeys, query the GA4 BigQuery export.
- **The browser handles up to about 1–2M rows.** Aggregate larger data in SQL first.
- **Roadmap:** BigQuery and Snowflake connectors, CUPED variance reduction, sequential testing (always-valid p-values), and scheduled reports.

---

<div align="center">

**Built by [yakov-ashgar27](https://github.com/yakov-ashgar27)** · MIT licensed · ⭐ Star the repo if it's useful

</div>
