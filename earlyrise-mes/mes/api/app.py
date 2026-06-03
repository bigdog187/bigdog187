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
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import __version__
from ..config import PACKAGE_ROOT
from ..database import describe_backend, init_db, new_session
from ..models import Line
from ..plc import build_driver
from ..config import LineConfig
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
    with new_session() as s:
        rows = s.scalars(select(Line).where(Line.enabled == True).order_by(Line.id)).all()  # noqa: E712
        return {"lines": [{"key": l.key, "name": l.name, "area": l.area,
                           "driver": l.driver, "ideal_rate_per_hour": l.ideal_rate_per_hour}
                          for l in rows]}


# --------------------------------------------------------------------------- #
# Settings / configuration (runtime-editable lines)
# --------------------------------------------------------------------------- #

class LinePayload(BaseModel):
    key: str | None = Field(None, description="Stable id; auto-derived from name if omitted")
    name: str
    area: str = "Production"
    enabled: bool = True
    driver: str = "logix"
    host: str | None = None
    slot: int = 0
    ideal_rate_per_hour: float = 0.0
    tags: dict[str, str] = Field(default_factory=dict)


def _slugify(name: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "_" for c in name).strip("_")
    while "__" in out:
        out = out.replace("__", "_")
    return out or "line"


def _line_dict(l: Line) -> dict:
    return {
        "key": l.key, "name": l.name, "area": l.area, "enabled": l.enabled,
        "driver": l.driver, "host": l.host, "slot": l.slot,
        "ideal_rate_per_hour": l.ideal_rate_per_hour, "tags": l.tags,
        "updated_at": l.updated_at.isoformat() if l.updated_at else None,
    }


@app.get("/api/config/lines")
def config_lines() -> dict:
    """Full editable config for every line (used by the settings page)."""
    with new_session() as s:
        rows = s.scalars(select(Line).order_by(Line.id)).all()
        return {"lines": [_line_dict(l) for l in rows]}


@app.post("/api/config/lines", status_code=201)
def create_line(payload: LinePayload) -> dict:
    key = payload.key or _slugify(payload.name)
    with new_session() as s:
        if s.scalar(select(Line).where(Line.key == key)):
            raise HTTPException(409, f"Line '{key}' already exists")
        line = Line(
            key=key, name=payload.name, area=payload.area, enabled=payload.enabled,
            driver=payload.driver, host=payload.host, slot=payload.slot,
            ideal_rate_per_hour=payload.ideal_rate_per_hour,
        )
        line.tags = payload.tags
        s.add(line)
        s.commit()
        s.refresh(line)
        return _line_dict(line)


@app.put("/api/config/lines/{key}")
def update_line(key: str, payload: LinePayload) -> dict:
    with new_session() as s:
        line = s.scalar(select(Line).where(Line.key == key))
        if line is None:
            raise HTTPException(404, f"Unknown line: {key}")
        line.name = payload.name
        line.area = payload.area
        line.enabled = payload.enabled
        line.driver = payload.driver
        line.host = payload.host
        line.slot = payload.slot
        line.ideal_rate_per_hour = payload.ideal_rate_per_hour
        line.tags = payload.tags
        s.commit()
        s.refresh(line)
        return _line_dict(line)


@app.delete("/api/config/lines/{key}")
def delete_line(key: str) -> dict:
    with new_session() as s:
        line = s.scalar(select(Line).where(Line.key == key))
        if line is None:
            raise HTTPException(404, f"Unknown line: {key}")
        # Disable rather than hard-delete so historical samples/runs are kept.
        line.enabled = False
        s.commit()
        return {"key": key, "enabled": False, "note": "Line disabled; history retained."}


@app.post("/api/config/test")
def test_connection(payload: LinePayload) -> dict:
    """Try a single read against the given PLC config and report the result.
    Lets operators verify an IP / tag map from the settings page before saving."""
    cfg = LineConfig(
        key=payload.key or "test", name=payload.name, driver=payload.driver,
        host=payload.host, slot=payload.slot, tags=payload.tags,
        ideal_rate_per_hour=payload.ideal_rate_per_hour,
    )
    try:
        driver = build_driver(cfg)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    try:
        driver.connect()
        reading = driver.read()
        return {
            "ok": reading.online,
            "error": reading.error,
            "sample": {
                "operator": reading.operator, "recipe": reading.recipe,
                "count": reading.count, "running": reading.running,
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    finally:
        try:
            driver.close()
        except Exception:  # noqa: BLE001
            pass


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
