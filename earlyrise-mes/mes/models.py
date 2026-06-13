"""SQLAlchemy ORM models — the MES data warehouse schema.

Design notes
------------
* ``Line``           : registry of production lines (synced from config).
* ``Sample``         : raw telemetry snapshot, one row per poll per line. The
                       fine-grained time-series feeding charts and OEE.
* ``ProductionRun``  : the MES core. A continuous run of one recipe by one
                       operator. Opened/closed by the collector state machine.
* ``LineEvent``      : discrete events (operator change, recipe change, line
                       start/stop, fault, counter reset) for an audit trail.

The schema is portable across SQLite (dev/demo) and SQL Server (on-site).
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    # Naive UTC: SQLite/SQL Server DATETIME columns carry no timezone, so we
    # store naive-UTC consistently and re-attach UTC when serialising out.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Line(Base):
    __tablename__ = "lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    area: Mapped[str] = mapped_column(String(64), default="Production")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    ideal_rate_per_hour: Mapped[float] = mapped_column(Float, default=0.0)

    # Connection config — editable at runtime from the settings page. This makes
    # the DB the source of truth for lines (seeded once from config/lines.yaml),
    # so lines can be added / re-pointed on the fly without redeploying.
    driver: Mapped[str] = mapped_column(String(32), default="logix")
    host: Mapped[str | None] = mapped_column(String(128), nullable=True)
    slot: Mapped[int] = mapped_column(Integer, default=0)
    tags_json: Mapped[str] = mapped_column(Text, default="{}")
    # Ad-hoc custom metrics: list of {key,label,tag,type,unit}. Lets operators
    # map any extra PLC tag to a named metric from the web UI, beyond the
    # built-in operator/recipe/count fields.
    metrics_json: Mapped[str] = mapped_column(Text, default="[]")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    samples: Mapped[list["Sample"]] = relationship(back_populates="line")
    runs: Mapped[list["ProductionRun"]] = relationship(back_populates="line")
    events: Mapped[list["LineEvent"]] = relationship(back_populates="line")

    @property
    def tags(self) -> dict:
        try:
            return json.loads(self.tags_json or "{}")
        except (TypeError, ValueError):
            return {}

    @tags.setter
    def tags(self, value: dict) -> None:
        self.tags_json = json.dumps(value or {})

    @property
    def metrics(self) -> list:
        try:
            return json.loads(self.metrics_json or "[]")
        except (TypeError, ValueError):
            return []

    @metrics.setter
    def metrics(self, value: list) -> None:
        self.metrics_json = json.dumps(value or [])

    def config_signature(self) -> tuple:
        """Identity of the connection config — used to detect changes that
        require rebuilding the line's PLC driver."""
        return (self.driver, self.host, self.slot, self.tags_json, self.metrics_json, self.enabled)


class Sample(Base):
    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("lines.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    operator: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recipe: Mapped[str | None] = mapped_column(String(128), nullable=True)
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Units produced since the previous sample (delta), reset-aware.
    produced: Mapped[int] = mapped_column(Integer, default=0)
    reject: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    running: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    fault: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Was the PLC reachable for this poll?
    online: Mapped[bool] = mapped_column(Boolean, default=True)
    # Values of any ad-hoc custom metrics this poll: {metric_key: value}.
    extra_json: Mapped[str] = mapped_column(Text, default="{}")

    line: Mapped["Line"] = relationship(back_populates="samples")

    __table_args__ = (Index("ix_samples_line_ts", "line_id", "ts"),)

    @property
    def extra(self) -> dict:
        try:
            return json.loads(self.extra_json or "{}")
        except (TypeError, ValueError):
            return {}


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("lines.id"), index=True)

    operator: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recipe: Mapped[str | None] = mapped_column(String(128), nullable=True)
    shift: Mapped[str | None] = mapped_column(String(64), nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    start_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Authoritative produced total (reset-aware, summed from deltas).
    total_produced: Mapped[int] = mapped_column(Integer, default=0)
    total_reject: Mapped[int] = mapped_column(Integer, default=0)
    # Accumulated seconds the line reported "running" during this run.
    running_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    status: Mapped[str] = mapped_column(String(16), default="open")  # open | closed
    # Set once a closed run has been folded into the daily roll-up table, so the
    # roll-up is incremental and idempotent (each run counted exactly once).
    rolled_up: Mapped[bool] = mapped_column(Boolean, default=False)

    line: Mapped["Line"] = relationship(back_populates="runs")

    __table_args__ = (
        Index("ix_runs_line_status", "line_id", "status"),
        Index("ix_runs_rollup", "status", "rolled_up"),
    )


class DailyStat(Base):
    """Per-day production summary, one row per
    (line, day, operator, recipe, shift). Built incrementally from closed
    production runs by the maintenance job, so long-range reports never have to
    touch the high-frequency ``samples`` table and survive sample retention.
    Grouping keys use ``""`` rather than NULL so upserts match cleanly."""

    __tablename__ = "daily_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("lines.id"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)            # local (site tz) date
    operator: Mapped[str] = mapped_column(String(128), default="")
    recipe: Mapped[str] = mapped_column(String(128), default="")
    shift: Mapped[str] = mapped_column(String(64), default="")

    produced: Mapped[int] = mapped_column(Integer, default=0)
    reject: Mapped[int] = mapped_column(Integer, default=0)
    running_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    runs: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        Index("ix_daily_unique", "line_id", "day", "operator", "recipe", "shift", unique=True),
    )


class LineEvent(Base):
    __tablename__ = "line_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("lines.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    # operator_change | recipe_change | line_start | line_stop |
    # fault | fault_clear | counter_reset | offline | online
    kind: Mapped[str] = mapped_column(String(32), index=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    line: Mapped["Line"] = relationship(back_populates="events")
