"""The data collector — polls every line and maintains the MES state machine.

Responsibilities per poll, per line:
  1. Read the PLC (or simulator) via its driver.
  2. Persist a fine-grained :class:`Sample` (the time-series).
  3. Compute reset-aware "produced" deltas from the running product counter.
  4. Drive the :class:`ProductionRun` state machine: a run is one continuous
     stint of a single (operator, recipe). Changing either closes the open run
     and opens a new one.
  5. Emit :class:`LineEvent` rows for operator/recipe changes, start/stop,
     faults and counter resets (the audit trail).

The collector never lets a single line's failure stop the others — driver
errors surface as an "offline" sample plus an event, and polling continues.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .config import SiteConfig, load_config
from .database import init_db, new_session
from .models import Line, LineEvent, ProductionRun, Sample, utcnow
from .plc import LineReading, PLCDriver, build_driver

log = logging.getLogger("mes.collector")


@dataclass
class LineState:
    """In-memory tracking for one line between polls."""

    line_id: int
    ideal_rate: float
    run_id: Optional[int] = None
    last_count: Optional[int] = None
    last_operator: Optional[str] = None
    last_recipe: Optional[str] = None
    last_running: Optional[bool] = None
    last_fault: Optional[bool] = None
    last_ts: Optional[datetime] = None
    online: bool = True


class Collector:
    def __init__(self, config: Optional[SiteConfig] = None):
        self.config = config or load_config()
        self.tz = ZoneInfo(self.config.timezone) if self.config.timezone else timezone.utc
        self.drivers: dict[str, PLCDriver] = {}
        self.states: dict[str, LineState] = {}
        self._stop = threading.Event()

    # -- lifecycle -----------------------------------------------------------

    def setup(self) -> None:
        """Create tables, sync lines from config to DB, build drivers, recover
        any runs left open from a previous process."""
        init_db()
        with new_session() as s:
            for cfg in self.config.enabled_lines:
                line = s.scalar(select(Line).where(Line.key == cfg.key))
                if line is None:
                    line = Line(key=cfg.key)
                    s.add(line)
                line.name = cfg.name
                line.area = cfg.area
                line.enabled = cfg.enabled
                line.ideal_rate_per_hour = cfg.ideal_rate_per_hour
                s.flush()

                state = LineState(line_id=line.id, ideal_rate=cfg.ideal_rate_per_hour)
                # Recover an open run so we don't double-count across restarts.
                open_run = s.scalar(
                    select(ProductionRun)
                    .where(ProductionRun.line_id == line.id, ProductionRun.status == "open")
                    .order_by(ProductionRun.started_at.desc())
                )
                if open_run is not None:
                    state.run_id = open_run.id
                    state.last_operator = open_run.operator
                    state.last_recipe = open_run.recipe
                    state.last_count = open_run.end_count
                self.states[cfg.key] = state
                self.drivers[cfg.key] = build_driver(cfg)
            s.commit()
        log.info("Collector ready: %d line(s), backend=%s",
                 len(self.drivers), self.config.simulate and "SIMULATOR" or "configured")

    def close(self) -> None:
        for d in self.drivers.values():
            try:
                d.close()
            except Exception:  # noqa: BLE001
                pass

    # -- polling -------------------------------------------------------------

    def poll_once(self) -> None:
        """Poll every line exactly once. Used by run_forever and by tests."""
        with new_session() as s:
            for key, driver in self.drivers.items():
                try:
                    reading = driver.read()
                except Exception as exc:  # noqa: BLE001 - drivers shouldn't raise, but be safe
                    reading = LineReading.offline(str(exc))
                try:
                    self._ingest(s, key, reading)
                except Exception:  # noqa: BLE001
                    log.exception("Failed to ingest reading for line %s", key)
                    s.rollback()
            s.commit()

    def run_forever(self) -> None:
        self.setup()
        interval = self.config.poll_interval_seconds
        log.info("Polling every %.1fs. Ctrl-C to stop.", interval)
        try:
            while not self._stop.is_set():
                start = time.monotonic()
                self.poll_once()
                elapsed = time.monotonic() - start
                self._stop.wait(max(0.0, interval - elapsed))
        finally:
            self.close()

    def stop(self) -> None:
        self._stop.set()

    # -- core state machine --------------------------------------------------

    def _ingest(self, s, key: str, reading: LineReading) -> None:
        st = self.states[key]
        now = utcnow()
        shift = self._shift_for(now)

        # --- offline handling -------------------------------------------------
        if not reading.online:
            if st.online:
                self._event(s, st, "offline", reading.error or "PLC unreachable")
                st.online = False
            s.add(Sample(line_id=st.line_id, ts=now, online=False, produced=0,
                         operator=st.last_operator, recipe=st.last_recipe,
                         count=st.last_count, running=False))
            st.last_ts = now
            return
        if not st.online:
            self._event(s, st, "online", "PLC reachable")
            st.online = True

        # --- produced delta (reset-aware) ------------------------------------
        produced = 0
        if reading.count is not None:
            if st.last_count is None:
                produced = 0  # first reading just establishes the baseline
            elif reading.count >= st.last_count:
                produced = reading.count - st.last_count
            else:
                # Counter went backwards -> recipe changeover / PLC reset.
                self._event(s, st, "counter_reset",
                            f"{st.last_count} -> {reading.count}")
                produced = max(0, reading.count)

        # --- detect transitions & emit events --------------------------------
        if reading.operator != st.last_operator and reading.operator is not None:
            self._event(s, st, "operator_change",
                        f"{st.last_operator or '-'} -> {reading.operator}")
        if reading.recipe != st.last_recipe and reading.recipe is not None:
            self._event(s, st, "recipe_change",
                        f"{st.last_recipe or '-'} -> {reading.recipe}")
        if reading.running is not None and reading.running != st.last_running:
            self._event(s, st, "line_start" if reading.running else "line_stop", None)
        if reading.fault and not st.last_fault:
            self._event(s, st, "fault", None)
        elif st.last_fault and not reading.fault:
            self._event(s, st, "fault_clear", None)

        # --- persist the telemetry sample ------------------------------------
        s.add(Sample(
            line_id=st.line_id, ts=now, online=True, produced=produced,
            operator=reading.operator, recipe=reading.recipe, count=reading.count,
            reject=reading.reject, rate=reading.rate,
            running=reading.running, fault=reading.fault,
        ))

        # --- production-run state machine ------------------------------------
        run = self._current_run(s, st)
        # A new run is needed when operator or recipe changes (or none is open).
        changed = (run is None
                   or run.operator != reading.operator
                   or run.recipe != reading.recipe)
        if changed and (reading.operator or reading.recipe):
            if run is not None:
                self._close_run(run, now)
            run = ProductionRun(
                line_id=st.line_id, operator=reading.operator, recipe=reading.recipe,
                shift=shift, started_at=now, start_count=reading.count or 0,
                end_count=reading.count or 0, status="open",
            )
            s.add(run)
            s.flush()
            st.run_id = run.id

        if run is not None and run.status == "open":
            run.total_produced += produced
            if reading.reject is not None:
                # reject is a running total on the PLC; track the max seen this run.
                run.total_reject = max(run.total_reject, reading.reject)
            run.end_count = reading.count
            run.ended_at = now
            # Accumulate running time using the gap since the last poll.
            if reading.running and st.last_ts is not None:
                run.running_seconds += (now - st.last_ts).total_seconds()

        # --- remember for next poll ------------------------------------------
        st.last_count = reading.count
        st.last_operator = reading.operator
        st.last_recipe = reading.recipe
        st.last_running = reading.running
        st.last_fault = bool(reading.fault)
        st.last_ts = now

    # -- helpers -------------------------------------------------------------

    def _current_run(self, s, st: LineState) -> Optional[ProductionRun]:
        if st.run_id is None:
            return None
        run = s.get(ProductionRun, st.run_id)
        if run is None or run.status != "open":
            return None
        return run

    @staticmethod
    def _close_run(run: ProductionRun, when: datetime) -> None:
        run.status = "closed"
        run.ended_at = when

    def _event(self, s, st: LineState, kind: str, detail: Optional[str]) -> None:
        s.add(LineEvent(line_id=st.line_id, ts=utcnow(), kind=kind, detail=detail))

    def _shift_for(self, when_utc: datetime) -> Optional[str]:
        local = when_utc.astimezone(self.tz)
        return self.config.shift_for(local.time())
