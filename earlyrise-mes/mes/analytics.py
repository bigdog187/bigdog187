"""MES-style analytics and reporting queries.

These functions turn the raw samples / runs / events into the numbers the
dashboard and reports care about: live status, production totals sliced by
recipe / operator / shift, throughput, and OEE (Availability x Performance x
Quality). All times stored in the DB are UTC; callers pass UTC windows.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Line, LineEvent, ProductionRun, Sample


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _line(s: Session, key: str) -> Line:
    line = s.scalar(select(Line).where(Line.key == key))
    if line is None:
        raise KeyError(f"Unknown line: {key}")
    return line


# --------------------------------------------------------------------------- #
# Live status
# --------------------------------------------------------------------------- #

def live_status(s: Session, key: str, stale_after_s: float = 15.0) -> dict:
    """Current snapshot for one line: latest telemetry + open run."""
    line = _line(s, key)
    last = s.scalar(
        select(Sample).where(Sample.line_id == line.id).order_by(Sample.ts.desc())
    )
    run = s.scalar(
        select(ProductionRun)
        .where(ProductionRun.line_id == line.id, ProductionRun.status == "open")
        .order_by(ProductionRun.started_at.desc())
    )

    online = False
    stale = True
    if last is not None:
        age = (_now() - last.ts.replace(tzinfo=timezone.utc)).total_seconds()
        stale = age > stale_after_s
        online = bool(last.online) and not stale

    status = "offline"
    if online:
        status = "fault" if (last and last.fault) else ("running" if (last and last.running) else "idle")

    return {
        "key": line.key,
        "name": line.name,
        "area": line.area,
        "status": status,
        "online": online,
        "operator": last.operator if last else None,
        "recipe": last.recipe if last else None,
        "count": last.count if last else None,
        "rate": last.rate if last else None,
        "running": bool(last.running) if last else False,
        "fault": bool(last.fault) if last else False,
        "last_seen": last.ts.replace(tzinfo=timezone.utc).isoformat() if last else None,
        "run": _run_dict(run) if run else None,
        "ideal_rate_per_hour": line.ideal_rate_per_hour,
    }


def site_summary(s: Session) -> dict:
    """Site-wide rollup across every line for the dashboard header."""
    lines = s.scalars(select(Line).where(Line.enabled == True)).all()  # noqa: E712
    statuses = [live_status(s, l.key) for l in lines]
    today_from = _start_of_local_day()
    produced_today = sum(
        production_totals(s, l.key, today_from, _now()).get("total_produced", 0)
        for l in lines
    )
    return {
        "site": "Earlyrise Bakery",
        "generated_at": _now().isoformat(),
        "lines_total": len(statuses),
        "lines_running": sum(1 for x in statuses if x["status"] == "running"),
        "lines_fault": sum(1 for x in statuses if x["status"] == "fault"),
        "lines_offline": sum(1 for x in statuses if x["status"] == "offline"),
        "produced_today": produced_today,
        "lines": statuses,
    }


# --------------------------------------------------------------------------- #
# Production totals
# --------------------------------------------------------------------------- #

def production_totals(
    s: Session,
    key: str,
    start: datetime,
    end: datetime,
    group_by: Optional[str] = None,
) -> dict:
    """Production produced / reject totals for a line over a window.

    ``group_by`` may be ``recipe``, ``operator`` or ``shift`` to get a
    breakdown; omit it for the headline total.
    """
    line = _line(s, key)
    runs = _runs_in_window(s, line.id, start, end)

    total_produced = sum(r.total_produced for r in runs)
    total_reject = sum(r.total_reject for r in runs)

    result = {
        "key": line.key,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "total_produced": total_produced,
        "total_reject": total_reject,
        "runs": len(runs),
    }

    if group_by in {"recipe", "operator", "shift"}:
        buckets: dict[str, dict] = {}
        for r in runs:
            label = getattr(r, group_by) or "(unspecified)"
            b = buckets.setdefault(label, {"produced": 0, "reject": 0, "runs": 0})
            b["produced"] += r.total_produced
            b["reject"] += r.total_reject
            b["runs"] += 1
        result["group_by"] = group_by
        result["groups"] = [
            {group_by: k, **v} for k, v in
            sorted(buckets.items(), key=lambda kv: kv[1]["produced"], reverse=True)
        ]
    return result


def oee(s: Session, key: str, start: datetime, end: datetime) -> dict:
    """Approximate OEE for a line over a window.

    Availability = running time / run time.
    Performance  = actual output / theoretical output at ideal rate.
    Quality      = good / (good + reject).
    OEE          = A x P x Q.
    """
    line = _line(s, key)
    runs = _runs_in_window(s, line.id, start, end)

    run_seconds = 0.0
    running_seconds = 0.0
    produced = 0
    reject = 0
    for r in runs:
        r_end = r.ended_at or _as_naive_utc(_now())
        run_seconds += max(0.0, (r_end - r.started_at).total_seconds())
        running_seconds += r.running_seconds or 0.0
        produced += r.total_produced
        reject += r.total_reject

    availability = (running_seconds / run_seconds) if run_seconds else 0.0
    ideal_rate = line.ideal_rate_per_hour or 0.0
    theoretical = ideal_rate * (running_seconds / 3600.0)
    performance = (produced / theoretical) if theoretical else 0.0
    performance = min(performance, 1.0)
    good = max(0, produced - reject)
    quality = (good / produced) if produced else 1.0
    oee_value = availability * performance * quality

    return {
        "key": line.key,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "availability": round(availability, 4),
        "performance": round(performance, 4),
        "quality": round(quality, 4),
        "oee": round(oee_value, 4),
        "produced": produced,
        "reject": reject,
        "running_hours": round(running_seconds / 3600.0, 3),
        "ideal_rate_per_hour": ideal_rate,
    }


# --------------------------------------------------------------------------- #
# Time-series / history
# --------------------------------------------------------------------------- #

def timeseries(s: Session, key: str, start: datetime, end: datetime, max_points: int = 500) -> dict:
    """Count / rate samples over a window, thinned to ``max_points``."""
    line = _line(s, key)
    start, end = _as_naive_utc(start), _as_naive_utc(end)
    rows = s.scalars(
        select(Sample)
        .where(Sample.line_id == line.id, Sample.ts >= start, Sample.ts <= end)
        .order_by(Sample.ts.asc())
    ).all()
    step = max(1, len(rows) // max_points)
    points = [
        {
            "ts": r.ts.replace(tzinfo=timezone.utc).isoformat(),
            "count": r.count,
            "rate": r.rate,
            "running": bool(r.running),
        }
        for r in rows[::step]
    ]
    return {"key": line.key, "points": points}


def recent_runs(s: Session, key: str, limit: int = 25) -> list[dict]:
    line = _line(s, key)
    runs = s.scalars(
        select(ProductionRun)
        .where(ProductionRun.line_id == line.id)
        .order_by(ProductionRun.started_at.desc())
        .limit(limit)
    ).all()
    return [_run_dict(r) for r in runs]


def recent_events(s: Session, key: str, limit: int = 50) -> list[dict]:
    line = _line(s, key)
    events = s.scalars(
        select(LineEvent)
        .where(LineEvent.line_id == line.id)
        .order_by(LineEvent.ts.desc())
        .limit(limit)
    ).all()
    return [
        {
            "ts": e.ts.replace(tzinfo=timezone.utc).isoformat(),
            "kind": e.kind,
            "detail": e.detail,
        }
        for e in events
    ]


# --------------------------------------------------------------------------- #
# Internals
# --------------------------------------------------------------------------- #

def _runs_in_window(s: Session, line_id: int, start: datetime, end: datetime) -> list[ProductionRun]:
    """Runs overlapping [start, end] — started before the window ends and not
    finished before it begins (open runs included)."""
    start = _as_naive_utc(start)
    end = _as_naive_utc(end)
    return list(
        s.scalars(
            select(ProductionRun).where(
                ProductionRun.line_id == line_id,
                ProductionRun.started_at <= end,
                (ProductionRun.ended_at == None) | (ProductionRun.ended_at >= start),  # noqa: E711
            )
        ).all()
    )


def _run_dict(r: ProductionRun) -> dict:
    duration = None
    if r.started_at:
        end = r.ended_at or _now().replace(tzinfo=None)
        duration = round((end - r.started_at).total_seconds(), 1)
    return {
        "id": r.id,
        "operator": r.operator,
        "recipe": r.recipe,
        "shift": r.shift,
        "started_at": _iso(r.started_at),
        "ended_at": _iso(r.ended_at),
        "duration_s": duration,
        "total_produced": r.total_produced,
        "total_reject": r.total_reject,
        "running_seconds": round(r.running_seconds, 1),
        "status": r.status,
    }


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


def _as_naive_utc(dt: datetime) -> datetime:
    """DB datetimes are stored naive-UTC; normalise inputs to match."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _start_of_local_day() -> datetime:
    # Approximate "today" using UTC midnight; the site tz refinement lives in
    # the collector's shift logic. Good enough for the header KPI.
    now = _now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)
