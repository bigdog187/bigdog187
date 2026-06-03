"""PLC driver abstraction.

Every production line talks to the MES through a ``PLCDriver``. This keeps the
collector completely ignorant of the underlying hardware/protocol, which is
what makes the system modular: add a new driver class to support a different
controller family, or point a line at the simulator, with no collector changes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class LineReading:
    """One snapshot of a line's state, normalised across all driver types."""

    operator: Optional[str] = None
    recipe: Optional[str] = None
    count: Optional[int] = None
    running: Optional[bool] = None
    fault: Optional[bool] = None
    reject: Optional[int] = None
    rate: Optional[float] = None
    # Whether the PLC was reachable and the read succeeded.
    online: bool = True
    error: Optional[str] = None
    # Values of ad-hoc custom metrics this read: {metric_key: value}.
    extra: dict[str, Any] = field(default_factory=dict)
    # Raw tag values keyed by PLC tag name (for debugging / future use).
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def offline(cls, error: str) -> "LineReading":
        return cls(online=False, error=error)


class PLCDriver(ABC):
    """Base class for all line drivers."""

    def __init__(self, key: str, name: str, tags: dict[str, str],
                 metrics: Optional[list[dict]] = None, **kwargs: Any):
        self.key = key
        self.name = name
        # Maps logical field -> PLC tag name (e.g. {"count": "Product_Count"}).
        self.tags = tags
        # Ad-hoc custom metrics: list of {key, tag, type, label, unit}.
        self.metrics = metrics or []
        self.options = kwargs

    @abstractmethod
    def connect(self) -> None:
        """Open the connection (idempotent)."""

    @abstractmethod
    def read(self) -> LineReading:
        """Read the configured tags. Must never raise — return an offline
        :class:`LineReading` on failure so the collector keeps running."""

    @abstractmethod
    def close(self) -> None:
        """Close the connection (idempotent)."""

    def list_tags(self) -> list[dict[str, Any]]:
        """Return the controller's tag list as ``[{name, type}]`` for the tag
        browser. Drivers that can't enumerate tags return an empty list."""
        return []

    def __enter__(self) -> "PLCDriver":
        self.connect()
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


def build_driver(line) -> PLCDriver:
    """Factory: construct the right driver for a :class:`~mes.config.LineConfig`."""
    # Local imports avoid importing pycomm3 unless a real line needs it.
    metrics = getattr(line, "metrics", None) or []
    if line.driver == "simulator":
        from .simulator import SimulatorDriver

        return SimulatorDriver(
            key=line.key,
            name=line.name,
            tags=line.tags,
            metrics=metrics,
            ideal_rate_per_hour=line.ideal_rate_per_hour,
        )
    if line.driver in {"logix", "controllogix", "compactlogix"}:
        from .logix import LogixDriver

        return LogixDriver(
            key=line.key,
            name=line.name,
            tags=line.tags,
            metrics=metrics,
            host=line.host,
            slot=line.slot,
        )
    raise ValueError(f"Unknown driver '{line.driver}' for line '{line.key}'")
