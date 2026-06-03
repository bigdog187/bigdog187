"""Configuration loading for the Earlyrise MES.

The whole system is driven by ``config/lines.yaml`` plus a handful of
environment variables (for secrets like the database password). Everything
here is plain dataclasses so the rest of the code is easy to read and test.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import time
from pathlib import Path
from typing import Optional

import yaml

# Repo layout: <root>/config/lines.yaml relative to this file's parent's parent.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "config" / "lines.yaml"


@dataclass(frozen=True)
class Shift:
    name: str
    start: time
    end: time

    def contains(self, t: time) -> bool:
        """True if local time ``t`` falls in this shift (handles midnight wrap)."""
        if self.start <= self.end:
            return self.start <= t < self.end
        # Wraps past midnight, e.g. 22:00 -> 06:00
        return t >= self.start or t < self.end


@dataclass
class LineConfig:
    key: str
    name: str
    area: str = "Production"
    enabled: bool = True
    driver: str = "logix"          # "logix" | "simulator"
    host: Optional[str] = None
    slot: int = 0
    tags: dict = field(default_factory=dict)
    ideal_rate_per_hour: float = 0.0
    extra: dict = field(default_factory=dict)


@dataclass
class SiteConfig:
    name: str = "Earlyrise Bakery"
    timezone: str = "Australia/Sydney"
    poll_interval_seconds: float = 2.0
    simulate: bool = False
    shifts: list[Shift] = field(default_factory=list)
    lines: list[LineConfig] = field(default_factory=list)

    def line(self, key: str) -> Optional[LineConfig]:
        return next((l for l in self.lines if l.key == key), None)

    @property
    def enabled_lines(self) -> list[LineConfig]:
        return [l for l in self.lines if l.enabled]

    def shift_for(self, t: time) -> Optional[str]:
        for s in self.shifts:
            if s.contains(t):
                return s.name
        return None


def _parse_time(value: str) -> time:
    hh, mm = str(value).strip().split(":")
    return time(int(hh), int(mm))


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def load_config(path: str | os.PathLike | None = None) -> SiteConfig:
    """Load and validate the site configuration.

    ``MES_CONFIG`` env var overrides the default path. ``MES_SIMULATE=1``
    forces every line into simulator mode (useful for demos / off-site dev).
    """
    cfg_path = Path(path or os.getenv("MES_CONFIG") or DEFAULT_CONFIG_PATH)
    if not cfg_path.exists():
        raise FileNotFoundError(f"MES config not found: {cfg_path}")

    with open(cfg_path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    site_raw = raw.get("site", {}) or {}
    force_sim = _env_truthy("MES_SIMULATE") or bool(site_raw.get("simulate", False))

    shifts = [
        Shift(name=s["name"], start=_parse_time(s["start"]), end=_parse_time(s["end"]))
        for s in (raw.get("shifts") or [])
    ]

    lines: list[LineConfig] = []
    for entry in raw.get("lines") or []:
        plc = entry.get("plc", {}) or {}
        driver = "simulator" if force_sim else entry.get("driver", "logix")
        known = {"key", "name", "area", "enabled", "driver", "plc", "tags", "ideal_rate_per_hour"}
        lines.append(
            LineConfig(
                key=entry["key"],
                name=entry.get("name", entry["key"]),
                area=entry.get("area", "Production"),
                enabled=bool(entry.get("enabled", True)),
                driver=driver,
                host=plc.get("host"),
                slot=int(plc.get("slot", 0)),
                tags=dict(entry.get("tags", {}) or {}),
                ideal_rate_per_hour=float(entry.get("ideal_rate_per_hour", 0) or 0),
                extra={k: v for k, v in entry.items() if k not in known},
            )
        )

    if not lines:
        raise ValueError(f"No lines defined in {cfg_path}")

    keys = [l.key for l in lines]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise ValueError(f"Duplicate line keys in config: {sorted(dupes)}")

    return SiteConfig(
        name=site_raw.get("name", "Earlyrise Bakery"),
        timezone=site_raw.get("timezone", "Australia/Sydney"),
        poll_interval_seconds=float(site_raw.get("poll_interval_seconds", 2)),
        simulate=force_sim,
        shifts=shifts,
        lines=lines,
    )
