"""AI-style insights for the day's production data.

Two providers, selected by ``MES_INSIGHTS_PROVIDER`` (default ``local``):

* ``local``  — a deterministic, offline "insight engine" that analyses the
  data and writes plain-English findings. No external calls; always available,
  which suits an on-prem bakery LAN that may have no internet.
* ``claude`` — sends the same computed facts to Claude (Anthropic API) for
  richer prose. Enabled with ``MES_INSIGHTS_PROVIDER=claude`` plus an
  ``ANTHROPIC_API_KEY``; falls back to ``local`` if the SDK/key is missing.

Either way the *facts* are computed here from the database — the model only
phrases them, so the numbers are always grounded in real data.

Each insight is ``{severity, title, text}`` where severity is one of
``good | info | warn | bad`` (drives the colour on the dashboard).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import analytics
from .models import Line, LineEvent

# --------------------------------------------------------------------------- #
# Fact gathering (grounded in the DB)
# --------------------------------------------------------------------------- #

def _window(hours: float = 24.0):
    end = datetime.now(timezone.utc)
    return end - timedelta(hours=hours), end


def _event_counts(s: Session, line_id: int, start: datetime, end: datetime) -> dict:
    rows = s.execute(
        select(LineEvent.kind, func.count(LineEvent.id))
        .where(LineEvent.line_id == line_id,
               LineEvent.ts >= start.replace(tzinfo=None),
               LineEvent.ts <= end.replace(tzinfo=None))
        .group_by(LineEvent.kind)
    ).all()
    return {kind: n for kind, n in rows}


def line_facts(s: Session, key: str, hours: float = 24.0) -> dict:
    start, end = _window(hours)
    line = s.scalar(select(Line).where(Line.key == key))
    if line is None:
        raise KeyError(key)
    status = analytics.live_status(s, key)
    rate = analytics.rate_stats(s, key, start, end)
    oee = analytics.oee(s, key, start, end)
    byrecipe = analytics.production_totals(s, key, start, end, group_by="recipe").get("groups", [])
    byoperator = analytics.production_totals(s, key, start, end, group_by="operator").get("groups", [])
    events = _event_counts(s, line.id, start, end)
    return {
        "line": line.name,
        "status": status["status"],
        "operator": status["operator"],
        "recipe": status["recipe"],
        "target_rate": rate["target_rate"],
        "actual_rate": rate["actual_rate"],
        "attainment_pct": round(rate["attainment"] * 100, 1),
        "produced": rate["produced"],
        "running_hours": rate["running_hours"],
        "oee_pct": round(oee["oee"] * 100, 1),
        "availability_pct": round(oee["availability"] * 100, 1),
        "performance_pct": round(oee["performance"] * 100, 1),
        "quality_pct": round(oee["quality"] * 100, 1),
        "reject": oee["reject"],
        "stops": events.get("line_stop", 0),
        "faults": events.get("fault", 0),
        "changeovers": events.get("recipe_change", 0),
        "top_recipe": byrecipe[0] if byrecipe else None,
        "top_operator": byoperator[0] if byoperator else None,
    }


def site_facts(s: Session, hours: float = 24.0) -> dict:
    summary = analytics.site_summary(s)
    per_line = [line_facts(s, l["key"], hours) for l in summary["lines"]]
    ranked = [f for f in per_line if f["running_hours"] > 0.01]
    best = max(ranked, key=lambda f: f["attainment_pct"], default=None)
    worst = min(ranked, key=lambda f: f["attainment_pct"], default=None)
    return {
        "produced_today": summary["produced_today"],
        "site_attainment_pct": round(summary["site_attainment"] * 100, 1),
        "lines_total": summary["lines_total"],
        "lines_running": summary["lines_running"],
        "lines_fault": summary["lines_fault"],
        "lines_offline": summary["lines_offline"],
        "total_faults": sum(f["faults"] for f in per_line),
        "total_stops": sum(f["stops"] for f in per_line),
        "best_line": best,
        "worst_line": worst,
        "lines": per_line,
    }


# --------------------------------------------------------------------------- #
# Local generator (deterministic, offline)
# --------------------------------------------------------------------------- #

def _attainment_severity(pct: float) -> str:
    if pct >= 98:
        return "good"
    if pct >= 85:
        return "info"
    if pct >= 70:
        return "warn"
    return "bad"


def _local_line_insights(f: dict) -> list[dict]:
    out: list[dict] = []
    sev = _attainment_severity(f["attainment_pct"])
    verb = {"good": "at or above", "info": "tracking near", "warn": "below", "bad": "well below"}[sev]
    out.append({
        "severity": sev,
        "title": f"Rate {f['attainment_pct']:.0f}% of target",
        "text": (f"{f['line']} is running {verb} target — {f['actual_rate']:.0f} vs "
                 f"{f['target_rate']:.0f} units/hr. {f['produced']:,} units made over "
                 f"{f['running_hours']:.1f} running hours today."),
    })
    if f["faults"] or f["stops"]:
        sev2 = "bad" if f["faults"] >= 3 else "warn"
        out.append({
            "severity": sev2,
            "title": f"{f['stops']} stop(s), {f['faults']} fault(s)",
            "text": (f"Downtime events today: {f['stops']} line stop(s) and {f['faults']} fault(s)"
                     f"{', the main drag on availability (%.0f%%).' % f['availability_pct'] if f['availability_pct'] < 90 else '.'}"),
        })
    if f["quality_pct"] < 99 and f["reject"]:
        out.append({
            "severity": "warn" if f["quality_pct"] >= 95 else "bad",
            "title": f"Quality {f['quality_pct']:.1f}%",
            "text": f"{f['reject']:,} unit(s) rejected today on {f['line']}. Worth checking the line setup or material.",
        })
    if f["top_recipe"]:
        tr = f["top_recipe"]
        out.append({
            "severity": "info",
            "title": f"Top product: {tr['recipe']}",
            "text": (f"{tr['recipe']} leads output at {tr['produced']:,} units"
                     + (f", with {f['changeovers']} changeover(s) today." if f["changeovers"] else ".")),
        })
    if f["top_operator"] and f["top_operator"].get("operator"):
        op = f["top_operator"]
        out.append({
            "severity": "good",
            "title": f"Most output: {op['operator']}",
            "text": f"{op['operator']} produced the most today on {f['line']} — {op['produced']:,} units.",
        })
    return out


def _local_site_insights(f: dict) -> list[dict]:
    out: list[dict] = []
    sev = _attainment_severity(f["site_attainment_pct"])
    out.append({
        "severity": sev,
        "title": f"Site at {f['site_attainment_pct']:.0f}% of target rate",
        "text": (f"{f['produced_today']:,} units produced site-wide today across "
                 f"{f['lines_running']}/{f['lines_total']} running lines, "
                 f"averaging {f['site_attainment_pct']:.0f}% of combined target rate."),
    })
    if f["best_line"]:
        b = f["best_line"]
        out.append({
            "severity": "good",
            "title": f"Top performer: {b['line']}",
            "text": f"{b['line']} leads at {b['attainment_pct']:.0f}% of target ({b['actual_rate']:.0f} units/hr).",
        })
    if f["worst_line"] and (not f["best_line"] or f["worst_line"]["line"] != f["best_line"]["line"]):
        w = f["worst_line"]
        out.append({
            "severity": _attainment_severity(w["attainment_pct"]),
            "title": f"Main constraint: {w['line']}",
            "text": (f"{w['line']} is the slowest against target at {w['attainment_pct']:.0f}% "
                     f"({w['actual_rate']:.0f} vs {w['target_rate']:.0f} units/hr)"
                     + (f", with {w['faults']} fault(s) today." if w["faults"] else ".")),
        })
    if f["lines_fault"] or f["total_faults"]:
        out.append({
            "severity": "bad" if f["lines_fault"] else "warn",
            "title": f"{f['total_faults']} fault event(s) today",
            "text": (f"{f['lines_fault']} line(s) currently in fault; {f['total_stops']} stop(s) and "
                     f"{f['total_faults']} fault(s) logged across the site today."),
        })
    if f["lines_offline"]:
        out.append({
            "severity": "warn",
            "title": f"{f['lines_offline']} line(s) offline",
            "text": "One or more PLCs are unreachable — check network/power on offline lines.",
        })
    return out


# --------------------------------------------------------------------------- #
# Optional Claude generator (Anthropic API)
# --------------------------------------------------------------------------- #

_SYSTEM_PROMPT = (
    "You are the analytics engine for Earlyrise Bakery's manufacturing execution "
    "system. You are given factual production metrics computed from the plant's "
    "database for one day. Write concise, concrete operational insights a plant "
    "manager can act on. The headline KPI is actual rate per hour vs target rate "
    "per hour (attainment). Ground every statement in the numbers provided — never "
    "invent figures. Each insight: a short title and one or two sentences. Assign a "
    "severity: 'good' (on/above target, positive), 'info' (neutral/contextual), "
    "'warn' (mild concern), 'bad' (significant problem). Return only the final "
    "answer as the structured object; do not include analysis or commentary."
)

_INSIGHTS_SCHEMA = {
    "type": "object",
    "properties": {
        "insights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["good", "info", "warn", "bad"]},
                    "title": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["severity", "title", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["insights"],
    "additionalProperties": False,
}


def _claude_insights(scope: str, facts: dict) -> list[dict] | None:
    """Phrase the computed facts via Claude. Returns None on any failure so the
    caller can fall back to the local generator."""
    try:
        import anthropic
    except ImportError:
        return None
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        return None

    model = os.getenv("MES_INSIGHTS_MODEL", "claude-opus-4-8")
    try:
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=model,
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},  # stable prefix, cache when large enough
            }],
            messages=[{
                "role": "user",
                "content": (f"Scope: {scope}. Produce 3-5 insights for today.\n\n"
                            f"Facts (JSON):\n{json.dumps(facts, default=str)}"),
            }],
            output_config={"format": {"type": "json_schema", "schema": _INSIGHTS_SCHEMA}},
        )
        text = next((b.text for b in resp.content if b.type == "text"), "")
        data = json.loads(text)
        return data.get("insights") or None
    except Exception:  # noqa: BLE001 - never let insights break the dashboard
        return None


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def _provider() -> str:
    return os.getenv("MES_INSIGHTS_PROVIDER", "local").strip().lower()


def site_insights(s: Session, hours: float = 24.0) -> dict:
    facts = site_facts(s, hours)
    provider = _provider()
    insights = None
    if provider == "claude":
        insights = _claude_insights("whole site", facts)
    if insights is None:
        insights = _local_site_insights(facts)
        provider = "local"
    return {"scope": "site", "generated_by": provider,
            "generated_at": datetime.now(timezone.utc).isoformat(), "insights": insights}


def line_insights(s: Session, key: str, hours: float = 24.0) -> dict:
    facts = line_facts(s, key, hours)
    provider = _provider()
    insights = None
    if provider == "claude":
        insights = _claude_insights(f"the {facts['line']} production line", facts)
    if insights is None:
        insights = _local_line_insights(facts)
        provider = "local"
    return {"scope": key, "generated_by": provider,
            "generated_at": datetime.now(timezone.utc).isoformat(), "insights": insights}
