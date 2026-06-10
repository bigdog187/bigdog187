"""End-to-end tests for the collector state machine and analytics.

These use a scripted in-memory PLC driver (no hardware, no real DB server —
an isolated SQLite file per test) to assert the MES logic: produced deltas,
counter-reset handling, run open/close on operator/recipe change, and OEE.
"""

import os
import tempfile
from datetime import datetime, timezone

import pytest

# Each test gets its own SQLite DB; set before importing the package.
_TMP = tempfile.mkdtemp()
os.environ["MES_SQLITE_PATH"] = os.path.join(_TMP, "test.db")
os.environ["MES_DB_BACKEND"] = "sqlite"

from mes import analytics  # noqa: E402
from mes.collector import Collector  # noqa: E402
from mes.config import LineConfig, Shift, SiteConfig  # noqa: E402
from mes.database import init_db, new_session  # noqa: E402
from mes.models import Base, LineEvent, ProductionRun, Sample  # noqa: E402
from mes.plc.base import LineReading, PLCDriver  # noqa: E402


class ScriptedDriver(PLCDriver):
    """Replays a list of LineReadings, one per read()."""

    def __init__(self, key, readings):
        super().__init__(key, key, {})
        self._readings = list(readings)
        self._i = 0

    def connect(self): pass
    def close(self): pass

    def read(self) -> LineReading:
        r = self._readings[min(self._i, len(self._readings) - 1)]
        self._i += 1
        return r


def _config():
    return SiteConfig(
        name="Test", timezone="UTC", poll_interval_seconds=1, simulate=True,
        shifts=[Shift("All", datetime.min.time(), datetime.max.time().replace(microsecond=0))],
        lines=[LineConfig(key="l1", name="Line 1", driver="simulator", ideal_rate_per_hour=3600)],
    )


@pytest.fixture
def collector():
    # Fresh schema each test.
    from mes.database import engine
    Base.metadata.drop_all(engine)
    init_db()
    c = Collector(config=_config())
    c.setup()
    return c


def _read(**kw):
    base = dict(operator="Alice", recipe="Sourdough", count=0, running=True, fault=False, reject=0, rate=3600)
    base.update(kw)
    return LineReading(**base)


def test_produced_delta_and_baseline(collector):
    collector.drivers["l1"] = ScriptedDriver("l1", [
        _read(count=0), _read(count=10), _read(count=25),
    ])
    for _ in range(3):
        collector.poll_once()

    with new_session() as s:
        prod = analytics.production_totals(s, "l1", _dt(2000), _dt(2999))
        # First reading is baseline (0), then +10, +15 = 25 produced.
        assert prod["total_produced"] == 25
        samples = s.query(Sample).order_by(Sample.id).all()
        assert [x.produced for x in samples] == [0, 10, 15]


def test_counter_reset_handled(collector):
    collector.drivers["l1"] = ScriptedDriver("l1", [
        _read(count=100), _read(count=140), _read(count=5),  # reset -> 5
    ])
    for _ in range(3):
        collector.poll_once()

    with new_session() as s:
        events = [e.kind for e in s.query(LineEvent).all()]
        assert "counter_reset" in events
        prod = analytics.production_totals(s, "l1", _dt(2000), _dt(2999))
        # baseline 0, +40, then reset counts the new 5 = 45.
        assert prod["total_produced"] == 45


def test_run_splits_on_recipe_and_operator_change(collector):
    collector.drivers["l1"] = ScriptedDriver("l1", [
        _read(operator="Alice", recipe="Sourdough", count=10),
        _read(operator="Alice", recipe="Sourdough", count=20),
        _read(operator="Alice", recipe="White Tin", count=30),   # recipe change
        _read(operator="Bob",   recipe="White Tin", count=40),   # operator change
    ])
    for _ in range(4):
        collector.poll_once()

    with new_session() as s:
        runs = s.query(ProductionRun).order_by(ProductionRun.started_at).all()
        assert len(runs) == 3
        assert [r.status for r in runs] == ["closed", "closed", "open"]
        assert runs[0].recipe == "Sourdough" and runs[0].operator == "Alice"
        assert runs[1].recipe == "White Tin" and runs[1].operator == "Alice"
        assert runs[2].operator == "Bob"

        byrec = analytics.production_totals(s, "l1", _dt(2000), _dt(2999), group_by="recipe")
        labels = {g["recipe"] for g in byrec["groups"]}
        assert {"Sourdough", "White Tin"} <= labels


def test_offline_then_online_events(collector):
    collector.drivers["l1"] = ScriptedDriver("l1", [
        _read(count=10),
        LineReading.offline("comms lost"),
        _read(count=15),
    ])
    for _ in range(3):
        collector.poll_once()

    with new_session() as s:
        kinds = [e.kind for e in s.query(LineEvent).all()]
        assert "offline" in kinds and "online" in kinds


def test_schema_migration_adds_missing_columns():
    """init_db must add columns that didn't exist in older databases
    (create_all alone never alters existing tables)."""
    import sqlite3

    if sqlite3.sqlite_version_info < (3, 35):
        pytest.skip("DROP COLUMN needs sqlite >= 3.35 to simulate an old schema")

    from sqlalchemy import inspect, text

    from mes.database import engine

    init_db()
    with engine.begin() as conn:  # simulate a pre-upgrade database
        conn.execute(text("ALTER TABLE lines DROP COLUMN metrics_json"))
        conn.execute(text("ALTER TABLE samples DROP COLUMN extra_json"))

    init_db()  # must restore the missing columns

    cols_lines = {c["name"] for c in inspect(engine).get_columns("lines")}
    cols_samples = {c["name"] for c in inspect(engine).get_columns("samples")}
    assert "metrics_json" in cols_lines
    assert "extra_json" in cols_samples
    # And the ORM can read rows again (the original failure mode was a crash here).
    with new_session() as s:
        s.query(Sample).all()


def test_oee_components(collector):
    collector.drivers["l1"] = ScriptedDriver("l1", [
        _read(count=0, running=True, reject=0),
        _read(count=100, running=True, reject=2),
        _read(count=200, running=True, reject=4),
    ])
    for _ in range(3):
        collector.poll_once()

    with new_session() as s:
        o = analytics.oee(s, "l1", _dt(2000), _dt(2999))
        assert 0.0 <= o["oee"] <= 1.0
        assert o["produced"] == 200
        assert o["reject"] == 4
        # quality = (200-4)/200
        assert abs(o["quality"] - 0.98) < 1e-6


def _dt(year):
    return datetime(year, 1, 1, tzinfo=timezone.utc)
