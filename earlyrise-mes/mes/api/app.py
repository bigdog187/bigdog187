"""FastAPI application: REST reporting API + the live dashboard.

Run on the on-site reporting PC (see scripts/run_web.py). Endpoints return
plain JSON; the dashboard in ``web/`` polls them. Lines are discovered from
config, so new lines appear automatically with no API changes.

Set ``MES_RUN_COLLECTOR=1`` to also run the polling collector in a background
thread inside this same process — convenient for a single-box deployment or a
demo. For production you'd typically run the collector as its own service.
"""

from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..config import PACKAGE_ROOT, load_config
from ..database import describe_backend, init_db, new_session
from .. import analytics

WEB_DIR = PACKAGE_ROOT / "web"

app = FastAPI(title="Earlyrise Bakery MES", version=__version__)

_collector_thread: threading.Thread | None = None


def _parse_window(hours: float | None, frm: str | None, to: str | None):
    """Resolve a time window from either ?hours= or ?from=&to= (ISO)."""
    now = datetime.now(timezone.utc)
    if frm or to:
        start = datetime.fromisoformat(frm) if frm else now - timedelta(hours=24)
        end = datetime.fromisoformat(to) if to else now
    else:
        end = now
        start = now - timedelta(hours=hours or 24)
    return start, end


@app.on_event("startup")
def _startup() -> None:
    init_db()
    if os.getenv("MES_RUN_COLLECTOR", "").lower() in {"1", "true", "yes"}:
        _start_collector()


def _start_collector() -> None:
    global _collector_thread
    if _collector_thread and _collector_thread.is_alive():
        return
    from ..collector import Collector

    collector = Collector()
    collector.setup()

    def _loop() -> None:
        import time as _t

        interval = collector.config.poll_interval_seconds
        while True:
            collector.poll_once()
            _t.sleep(interval)

    _collector_thread = threading.Thread(target=_loop, name="mes-collector", daemon=True)
    _collector_thread.start()


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "database": describe_backend(),
        "collector_running": bool(_collector_thread and _collector_thread.is_alive()),
    }


@app.get("/api/summary")
def summary() -> dict:
    with new_session() as s:
        return analytics.site_summary(s)


@app.get("/api/lines")
def lines() -> dict:
    cfg = load_config()
    return {
        "lines": [
            {"key": l.key, "name": l.name, "area": l.area,
             "driver": l.driver, "ideal_rate_per_hour": l.ideal_rate_per_hour}
            for l in cfg.enabled_lines
        ]
    }


@app.get("/api/lines/{key}/status")
def line_status(key: str) -> dict:
    with new_session() as s:
        try:
            return analytics.live_status(s, key)
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


@app.get("/api/lines/{key}/production")
def line_production(
    key: str,
    hours: float | None = Query(None),
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    group_by: str | None = Query(None, pattern="^(recipe|operator|shift)$"),
) -> dict:
    start, end = _parse_window(hours, frm, to)
    with new_session() as s:
        try:
            return analytics.production_totals(s, key, start, end, group_by)
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


@app.get("/api/lines/{key}/oee")
def line_oee(key: str, hours: float | None = Query(None),
             frm: str | None = Query(None, alias="from"), to: str | None = None) -> dict:
    start, end = _parse_window(hours, frm, to)
    with new_session() as s:
        try:
            return analytics.oee(s, key, start, end)
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


@app.get("/api/lines/{key}/timeseries")
def line_timeseries(key: str, hours: float | None = Query(None),
                    frm: str | None = Query(None, alias="from"), to: str | None = None) -> dict:
    start, end = _parse_window(hours, frm, to)
    with new_session() as s:
        try:
            return analytics.timeseries(s, key, start, end)
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


@app.get("/api/lines/{key}/runs")
def line_runs(key: str, limit: int = Query(25, ge=1, le=500)) -> dict:
    with new_session() as s:
        try:
            return {"key": key, "runs": analytics.recent_runs(s, key, limit)}
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


@app.get("/api/lines/{key}/events")
def line_events(key: str, limit: int = Query(50, ge=1, le=500)) -> dict:
    with new_session() as s:
        try:
            return {"key": key, "events": analytics.recent_events(s, key, limit)}
        except KeyError:
            raise HTTPException(404, f"Unknown line: {key}")


# --------------------------------------------------------------------------- #
# Dashboard (static) — mounted last so /api/* wins.
# --------------------------------------------------------------------------- #

@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
