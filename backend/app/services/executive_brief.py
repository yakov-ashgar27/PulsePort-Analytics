"""
Deterministic executive-brief generator.

Translates statistical outputs into a management memo with a clear
Go / No-Go per decision. It is rule-based on purpose: every sentence is
traceable to a computed number, so the brief cannot hallucinate.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from ..ai_benchmark.evaluator import get_benchmark
from ..config import get_settings
from ..seed.generators import EXPERIMENTS
from . import analytics
from .experiments import analyze_experiment


def _pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%"


def _prob(p: float) -> str:
    """Avoid displaying 100.0% / 0.0% for probabilities that are merely extreme."""
    if p > 0.999:
        return ">99.9%"
    if p < 0.001:
        return "<0.1%"
    return f"{p:.1%}"


def _loss(x: float) -> str:
    pp = x * 100
    return "<0.001 pp" if pp < 0.001 else f"{pp:.3f} pp"


def _experiment_section(e: dict) -> dict:
    f, b, d = e["frequentist"], e["bayesian"], e["decision"]
    evidence = [
        f"{e['control_label']}: {_pct(f['rate_a'], 2)} (n = {f['n_a']:,}) vs "
        f"{e['variant_label']}: {_pct(f['rate_b'], 2)} (n = {f['n_b']:,})",
        f"Relative uplift {f['relative_uplift']:+.1%} "
        f"(95% CI {f['uplift_ci_low']:+.1%} to {f['uplift_ci_high']:+.1%}); "
        f"two-proportion z = {f['z_stat']:.2f}, p = {f['p_value_z']:.3g}",
        f"Bayesian: P(B > A) = {_prob(b['prob_b_beats_a'])}; expected loss if shipped = "
        f"{_loss(b['expected_loss_b'])}",
        f"Achieved power {f['achieved_power']:.0%}; Cohen's h = {f['cohens_h']:.3f}",
    ]
    mw = e["time_to_quote"]
    if mw["significant"]:
        evidence.append(
            f"Secondary: median time-to-quote {mw['median_a']:.0f}s → {mw['median_b']:.0f}s "
            f"(Mann-Whitney p = {mw['p_value']:.2g})"
        )
    if d["verdict"] == "GO":
        risk = "Low. Lower CI bound of uplift is positive; expected loss is below the risk budget."
    elif d["verdict"] == "KEEP RUNNING":
        risk = (
            "High risk of a false-positive rollout if shipped now. The CI spans zero, so the true "
            "effect may be negative."
        )
    else:
        risk = "Variant is not supported by the evidence."
    return {
        "id": e["experiment_id"],
        "title": e["name"],
        "hypothesis": e["hypothesis"],
        "evidence": evidence,
        "risk": risk,
        "verdict": d["verdict"],
        "recommendation": f"{d['headline']}. {d['rationale']}",
    }


def _ai_section(bench: dict) -> dict:
    models = bench["models"]
    best = max(models, key=lambda m: m["mean_accuracy"])
    cheapest = min(models, key=lambda m: m["cost_per_1k_usd"])
    guard = bench["guardrail_hallucination_rate"]
    safe = [m for m in models if m["hallucination_rate"] <= guard]
    t = bench["tests"]
    evidence = [
        f"{m['model']}: accuracy {m['mean_accuracy']:.1f} "
        f"(95% CI {m['accuracy_ci_low']:.1f}–{m['accuracy_ci_high']:.1f}), "
        f"hallucination {_pct(m['hallucination_rate'])}, P95 {m['p95_latency_ms'] / 1000:.2f}s, "
        f"${m['cost_per_1k_usd']:.2f} / 1k tickets"
        for m in models
    ]
    if t.get("kruskal_p") is not None:
        evidence.append(f"Kruskal-Wallis across models: p = {t['kruskal_p']:.2g}")
    if t.get("welch_p") is not None:
        evidence.append(
            f"Top-two comparison ({t['top_two'][0]} vs {t['top_two'][1]}): Welch p = {t['welch_p']:.2g}"
        )
    if best in safe:
        verdict = "GO"
        rec = (
            f"Adopt {best['model']} for maritime support automation: highest accuracy and within the "
            f"{_pct(guard, 0)} hallucination guardrail. "
        )
        if cheapest is not best:
            premium = best["cost_per_1k_usd"] - cheapest["cost_per_1k_usd"]
            rec += (
                f"It costs ${premium:.2f} more per 1k tickets than {cheapest['model']}; route "
                f"low-risk tracking queries to the cheaper model if budget-constrained."
            )
    else:
        verdict = "CONDITIONAL"
        rec = (
            f"{best['model']} is most accurate but breaches the hallucination guardrail; deploy only "
            f"with human review on Dangerous Goods and Customs categories."
        )
    return {
        "id": "AI-BENCH",
        "title": "AI Support Assistant Selection",
        "hypothesis": "One assistant model delivers significantly higher grounded accuracy on maritime "
                      "support tickets at acceptable cost and safety.",
        "evidence": evidence,
        "risk": "Benchmark data is simulated; validate on a held-out set of real tickets before contract "
                "commitment. Dangerous Goods is the highest-risk category.",
        "verdict": verdict,
        "recommendation": rec,
    }


def _ops_section(bottlenecks: list[dict]) -> dict:
    sla = get_settings().quote_sla_ms
    flagged = [r for r in bottlenecks if r["is_bottleneck"]]
    evidence = [
        f"{r['region']}: P95 quote latency {float(r['p95_latency_ms']) / 1000:.1f}s "
        f"(mobile {float(r['p95_mobile_ms']) / 1000:.1f}s) vs SLA {sla / 1000:.1f}s; "
        f"search→quote {float(r['quote_rate_pct']):.1f}% vs {float(r['global_quote_rate_pct']):.1f}% global "
        f"(p = {r['p_value_vs_rest']:.1g})"
        for r in flagged
    ]
    if flagged:
        evidence.append(
            f"Cross-region correlation of P95 latency with quote rate: r = "
            f"{float(flagged[0]['cross_region_corr']):.2f}"
        )
    return {
        "id": "OPS-SLA",
        "title": "Rate-Quote API Regional Bottleneck",
        "hypothesis": "Slow quote API responses on mobile drive funnel abandonment in specific agencies.",
        "evidence": evidence or ["No region breaches the P95 SLA."],
        "risk": "Revenue leakage at the highest-intent funnel step." if flagged else "None detected.",
        "verdict": "ACTION REQUIRED" if flagged else "OK",
        "recommendation": (
            f"Prioritise quote-API performance work (regional caching / edge deployment) for "
            f"{', '.join(r['region'] for r in flagged)} mobile traffic."
            if flagged else "No action."
        ),
    }


def _to_markdown(brief: dict) -> str:
    lines = [
        f"# {brief['title']}",
        f"_Generated {brief['generated_at']} · α = {brief['alpha']} · target power = {brief['power']:.0%}_",
        "",
        "## Executive Summary",
        *[f"- **{s['title']}** → **{s['verdict']}**" for s in brief["sections"]],
        "",
    ]
    for s in brief["sections"]:
        lines += [
            f"## {s['title']}  ·  {s['verdict']}",
            f"**Hypothesis.** {s['hypothesis']}",
            "",
            "**Statistical evidence.**",
            *[f"- {e}" for e in s["evidence"]],
            "",
            f"**Risk assessment.** {s['risk']}",
            "",
            f"**Recommendation.** {s['recommendation']}",
            "",
        ]
    return "\n".join(lines)


async def build_brief(session: AsyncSession) -> dict:
    s = get_settings()
    exps = [await analyze_experiment(session, e.experiment_id) for e in EXPERIMENTS]
    bench = await get_benchmark(session)
    bn = await analytics.bottlenecks(session, analytics.filter_params(None, None, None, None))
    brief = {
        "title": "PulsePort Analytics — Management Brief",
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "alpha": s.alpha,
        "power": s.target_power,
        "sections": [*map(_experiment_section, exps), _ai_section(bench), _ops_section(bn)],
    }
    brief["markdown"] = _to_markdown(brief)
    return brief
