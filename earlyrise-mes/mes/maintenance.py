"""Production data maintenance: retention purge + daily roll-up.

In full production the collector polls every couple of seconds, so the raw
``samples`` table grows ~1.3M rows / line / month. These jobs keep storage
bounded and keep long-range reports fast:

* ``rollup_daily``   — fold each closed production run into a compact
  ``daily_stats`` row (per line/day/operator/recipe/shift). Incremental and
  idempotent: a run is rolled up once, then flagged. This is the durable,
  query-cheap summary that survives sample retention.
* ``purge_samples`` / ``purge_events`` — delete rows older than the retention
  window, in batches so the delete never takes a long lock on SQL Server.

The collector schedules these (see ``Collector.run_maintenance``); they're also
safe to call manually. ``production_runs`` and ``daily_stats`` are never purged
here — they're small and are what the reports read.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import DailyStat, LineEvent, ProductionRun, Sample

log = logging.getLogger("mes.maintenance")


def _local_day(when_naive_utc: datetime, tz):
    """Date a run belongs to, in the site's local timezone."""
    return when_naive_utc.replace(tzinfo=timezone.utc).astimezone(tz).date()


def rollup_daily(s: Session, tz, batch: int = 2000) -> int:
    """Fold not-yet-rolled closed runs into ``daily_stats``. Returns the number
    of runs rolled up this pass (call again until it returns 0 to drain)."""
    runs = list(s.scalars(
        select(ProductionRun)
        .where(ProductionRun.status == "closed", ProductionRun.rolled_up == False)  # noqa: E712
        .order_by(ProductionRun.id)
        .limit(batch)
    ).all())
    if not runs:
        return 0

    for r in runs:
        key = {
            "line_id": r.line_id,
            "day": _local_day(r.started_at, tz),
            "operator": r.operator or "",
            "recipe": r.recipe or "",
            "shift": r.shift or "",
        }
        row = s.scalar(select(DailyStat).where(
            DailyStat.line_id == key["line_id"], DailyStat.day == key["day"],
            DailyStat.operator == key["operator"], DailyStat.recipe == key["recipe"],
            DailyStat.shift == key["shift"],
        ))
        if row is None:
            row = DailyStat(**key)
            s.add(row)
        row.produced = (row.produced or 0) + r.total_produced
        row.reject = (row.reject or 0) + r.total_reject
        row.running_seconds = (row.running_seconds or 0.0) + (r.running_seconds or 0.0)
        row.runs = (row.runs or 0) + 1
        r.rolled_up = True

    s.commit()
    log.info("Daily roll-up: folded %d run(s) into daily_stats", len(runs))
    return len(runs)


def _purge(s: Session, model, older_than: datetime, batch: int) -> int:
    """Delete rows of ``model`` with ``ts`` < cutoff, in batches."""
    older_than = older_than.replace(tzinfo=None)
    total = 0
    while True:
        ids = list(s.scalars(
            select(model.id).where(model.ts < older_than).limit(batch)
        ).all())
        if not ids:
            break
        s.execute(delete(model).where(model.id.in_(ids)))
        s.commit()
        total += len(ids)
        if len(ids) < batch:
            break
    return total


def purge_samples(s: Session, older_than: datetime, batch: int = 5000) -> int:
    n = _purge(s, Sample, older_than, batch)
    if n:
        log.info("Retention: purged %d sample(s) older than %s", n, older_than.date())
    return n


def purge_events(s: Session, older_than: datetime, batch: int = 5000) -> int:
    n = _purge(s, LineEvent, older_than, batch)
    if n:
        log.info("Retention: purged %d event(s) older than %s", n, older_than.date())
    return n
